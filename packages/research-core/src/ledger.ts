import * as NodeSqlite from "node:sqlite";
import type {
  BranchId,
  Finding,
  Gate,
  JobStatus,
  LeanClaim,
  ResearchBranch,
  ResearchProject,
  ResearchProjectId,
  ResearchRunId,
  ResearchSnapshot,
  Run,
  RunMetric,
  WorkflowNode,
} from "@t3tools/contracts";
import { migrateLedger } from "./migrations.ts";
import { openGate, resolveGate } from "./gates.ts";
import { canonicalJson, freezeSpec, type SpecWithSplit } from "./spec.ts";

interface Rows {
  branches: ResearchBranch;
  workflow_nodes: WorkflowNode;
  runs: Run;
  findings: Finding;
  lean_claims: LeanClaim;
  jobs: JobStatus;
  gates: Gate;
}
type Project = ResearchProjectId;
export interface RunCost {
  tokens: number;
  gpuHours: number;
  usd: number;
}
export type Decision =
  | { kind: "gate"; at: string; prompt: Gate; response: Gate["answer"] | "skip" }
  | { kind: "correction"; at: string; prompt: string; response: string };

function metricRow(row: Record<string, unknown>): RunMetric {
  return {
    runId: row.run as ResearchRunId,
    name: String(row.name),
    value: Number(row.value),
    ...(row.step == null ? {} : { step: Number(row.step) }),
    ...(row.split == null ? {} : { split: row.split as NonNullable<RunMetric["split"]> }),
  };
}

export class ResearchLedger {
  readonly #db: NodeSqlite.DatabaseSync;

  constructor(path: string | NodeSqlite.DatabaseSync) {
    this.#db = typeof path === "string" ? new NodeSqlite.DatabaseSync(path) : path;
    try {
      migrateLedger(this.#db);
    } catch (error) {
      this.close();
      throw error;
    }
  }
  close() {
    this.#db.close();
  }

  transaction<T>(body: () => T): T {
    this.#db.exec("SAVEPOINT research_write");
    try {
      const result = body();
      if (result instanceof Promise)
        throw new Error("Ledger transactions require synchronous operations");
      this.#db.exec("RELEASE research_write");
      return result;
    } catch (error) {
      this.#db.exec("ROLLBACK TO research_write; RELEASE research_write");
      throw error;
    }
  }

  #put<K extends keyof Rows>(table: K, project: Project, id: string, value: Rows[K]) {
    this.#db
      .prepare(
        `INSERT INTO ${table}(id,project,payload) VALUES(?,?,?) ON CONFLICT(project,id) DO UPDATE SET payload=excluded.payload`,
      )
      .run(id, project, canonicalJson(value));
  }
  #all<K extends keyof Rows>(table: K, project: Project): Rows[K][] {
    return this.#db
      .prepare(`SELECT payload FROM ${table} WHERE project=? ORDER BY rowid`)
      .all(project)
      .map((r) => JSON.parse(String(r.payload)));
  }
  #get<K extends keyof Rows>(table: K, project: Project, id: string): Rows[K] | undefined {
    const row = this.#db
      .prepare(`SELECT payload FROM ${table} WHERE project=? AND id=?`)
      .get(project, id);
    return row ? JSON.parse(String(row.payload)) : undefined;
  }

  projects(): ResearchProject[] {
    return this.#db
      .prepare("SELECT payload FROM projects ORDER BY rowid")
      .all()
      .map((row) => JSON.parse(String(row.payload)));
  }
  putProject(p: ResearchProject) {
    this.#db
      .prepare(
        "INSERT INTO projects VALUES(?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload",
      )
      .run(p.id, canonicalJson(p));
  }
  putBranch(b: ResearchBranch) {
    this.#put("branches", b.researchProjectId, b.id, b);
  }
  putNode(n: WorkflowNode) {
    this.transaction(() => {
      const existing = this.#get("workflow_nodes", n.researchProjectId, n.id);
      if (existing && canonicalJson(existing.parentIds) !== canonicalJson(n.parentIds))
        throw new Error("Existing node ancestry is immutable");
      for (const parent of n.parentIds)
        if (!this.#get("workflow_nodes", n.researchProjectId, parent))
          throw new Error("Unknown parent node");
      this.#put("workflow_nodes", n.researchProjectId, n.id, n);
    });
  }
  putRun(r: Run, hash?: string) {
    this.transaction(() => {
      const existing = this.#get("runs", r.researchProjectId, r.id);
      if (existing && existing.branchId !== r.branchId)
        throw new Error("Existing run branch is immutable");
      this.#put("runs", r.researchProjectId, r.id, r);
      if (hash !== undefined) {
        const previous = this.#db.prepare("SELECT hash FROM run_specs WHERE run=?").get(r.id);
        if (previous && previous.hash !== hash) throw new Error("Existing run spec is immutable");
        this.#db
          .prepare("INSERT INTO run_specs VALUES(?,?,?,?) ON CONFLICT(run) DO NOTHING")
          .run(r.id, r.researchProjectId, r.branchId, hash);
      }
    });
  }
  putSpec(project: Project, branch: BranchId, spec: SpecWithSplit, frozenAt: string) {
    const frozen = freezeSpec(spec, frozenAt);
    this.#db
      .prepare("INSERT INTO specs VALUES(?,?,?,?) ON CONFLICT DO NOTHING")
      .run(project, branch, frozen.specHash, canonicalJson(frozen));
    return frozen;
  }
  branchSpecs(project: Project, branch: BranchId): SpecWithSplit[] {
    return this.#db
      .prepare("SELECT payload FROM specs WHERE project=? AND branch=? ORDER BY rowid")
      .all(project, branch)
      .map((row) => JSON.parse(String(row.payload)));
  }
  runSpec(run: ResearchRunId): SpecWithSplit | undefined {
    const row = this.#db
      .prepare("SELECT payload FROM specs JOIN run_specs USING(project,branch,hash) WHERE run=?")
      .get(run);
    return row ? JSON.parse(String(row.payload)) : undefined;
  }
  addMetric(m: RunMetric) {
    if (!Number.isFinite(m.value)) throw new Error("Metric must be finite");
    this.#db
      .prepare("INSERT INTO run_metrics VALUES(?,?,?,?,?)")
      .run(m.runId, m.name, m.value, m.step ?? null, m.split ?? null);
  }
  metricsForProject(project: Project): RunMetric[] {
    return this.#db
      .prepare(
        "SELECT m.* FROM run_metrics m JOIN runs r ON r.id=m.run WHERE r.project=? ORDER BY m.rowid",
      )
      .all(project)
      .map(metricRow);
  }
  metricSeries(run: ResearchRunId, name?: string) {
    return this.#db
      .prepare(
        "SELECT * FROM run_metrics WHERE run=? AND (? IS NULL OR name=?) ORDER BY step,rowid",
      )
      .all(run, name ?? null, name ?? null)
      .map(metricRow);
  }
  bestMetric(
    project: Project,
    branch: BranchId,
    name: string,
    split: RunMetric["split"],
    higherIsBetter: boolean,
  ) {
    const row = this.#db
      .prepare(`SELECT m.* FROM run_metrics m JOIN runs r ON r.id=m.run
      WHERE project=? AND branch=? AND name=? AND split IS ? AND json_extract(r.payload,'$.status')='finished'
      AND json_extract(r.payload,'$.integrity')!='rejected' AND json_extract(r.payload,'$.verdict') NOT IN ('checks-failed','crash')
      AND m.rowid=(SELECT last.rowid FROM run_metrics last WHERE last.run=m.run AND last.name=m.name AND last.split IS m.split ORDER BY last.step DESC,last.rowid DESC LIMIT 1)
      ORDER BY value ${higherIsBetter ? "DESC" : "ASC"},m.rowid LIMIT 1`)
      .get(project, branch, name, split ?? null);
    return row ? metricRow(row) : undefined;
  }
  putFinding(f: Finding) {
    this.transaction(() => {
      for (const id of f.evidenceRunIds)
        if (!this.#get("runs", f.researchProjectId, id)) throw new Error("Unknown evidence run");
      const { critic, ...body } = f;
      this.#put("findings", f.researchProjectId, f.id, { ...body, critic: [] });
      this.#db
        .prepare("DELETE FROM critic_attacks WHERE project=? AND finding=?")
        .run(f.researchProjectId, f.id);
      const insert = this.#db.prepare("INSERT INTO critic_attacks VALUES(?,?,?,?)");
      critic.forEach((c, i) => insert.run(f.researchProjectId, f.id, i, canonicalJson(c)));
    });
  }
  putLeanClaim(c: LeanClaim) {
    this.#put("lean_claims", c.researchProjectId, c.name, c);
  }
  putJob(project: Project, j: JobStatus) {
    this.#put("jobs", project, j.id, j);
  }
  openGate(input: Parameters<typeof openGate>[0]) {
    const gate = openGate(input);
    this.#db
      .prepare("INSERT INTO gates(id,project,payload) VALUES(?,?,?)")
      .run(gate.id, gate.researchProjectId, canonicalJson(gate));
    return gate;
  }
  answerGate(
    project: Project,
    id: Gate["id"],
    response: NonNullable<Gate["answer"]> | "skip",
    at: string,
  ) {
    return this.transaction(() => {
      const prompt = this.#get("gates", project, id);
      if (!prompt) throw new Error("Unknown gate");
      const gate = resolveGate(prompt, response, at);
      this.#put("gates", project, id, gate);
      this.#log(project, { kind: "gate", at, prompt, response });
      return gate;
    });
  }
  #log(project: Project, entry: Decision) {
    this.#db
      .prepare("INSERT INTO decisions VALUES(?,?)")
      .run(project, canonicalJson({ researchProjectId: project, ...entry }));
  }
  recordCorrection(project: Project, prompt: string, response: string, at: string) {
    this.#log(project, { kind: "correction", at, prompt, response });
  }
  decisionsJsonl(project: Project) {
    return this.#db
      .prepare("SELECT payload FROM decisions WHERE project=? ORDER BY rowid")
      .all(project)
      .map((r) => String(r.payload) + "\n")
      .join("");
  }
  putCost(run: ResearchRunId, cost: RunCost) {
    if (
      !Number.isSafeInteger(cost.tokens) ||
      ![cost.tokens, cost.gpuHours, cost.usd].every((n) => Number.isFinite(n) && n >= 0)
    )
      throw new Error("Invalid run cost");
    this.#db
      .prepare(
        "INSERT INTO costs VALUES(?,?,?,?) ON CONFLICT(run) DO UPDATE SET tokens=excluded.tokens,gpuHours=excluded.gpuHours,usd=excluded.usd",
      )
      .run(run, cost.tokens, cost.gpuHours, cost.usd);
  }
  cost(run: ResearchRunId): RunCost | undefined {
    const row = this.#db.prepare("SELECT tokens,gpuHours,usd FROM costs WHERE run=?").get(run);
    return (
      row && { tokens: Number(row.tokens), gpuHours: Number(row.gpuHours), usd: Number(row.usd) }
    );
  }
  snapshot(project: Project): ResearchSnapshot {
    return this.transaction(() => {
      const row = this.#db.prepare("SELECT payload FROM projects WHERE id=?").get(project);
      if (!row) throw new Error("Unknown research project");
      const attacks = new Map<string, Finding["critic"][number][]>();
      for (const r of this.#db
        .prepare(
          "SELECT finding,payload FROM critic_attacks WHERE project=? ORDER BY finding,position",
        )
        .all(project)) {
        const id = String(r.finding);
        const items = attacks.get(id) ?? [];
        items.push(JSON.parse(String(r.payload)));
        attacks.set(id, items);
      }
      const nodes = this.#all("workflow_nodes", project);
      return {
        metrics: this.metricsForProject(project),
        backends: [],
        workflowStepTotal: nodes.length,
        workflowStepCompleted: nodes.filter((node) =>
          ["done", "pruned", "skipped", "failed"].includes(node.status),
        ).length,
        project: JSON.parse(String(row.payload)),
        nodes,
        branches: this.#all("branches", project),
        runs: this.#all("runs", project),
        findings: this.#all("findings", project).map((f) => ({
          ...f,
          critic: attacks.get(f.id) ?? [],
        })),
        gates: this.#all("gates", project),
        leanClaims: this.#all("lean_claims", project),
        jobs: this.#all("jobs", project),
      };
    });
  }
}
