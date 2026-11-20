// @effect-diagnostics nodeBuiltinImport:off -- Reopen a real SQLite file to exercise migration and restart semantics.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { GateId, FindingId, ResearchProjectId } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";
import { ResearchLedger } from "./ledger.ts";
import { migrateLedger } from "./migrations.ts";
import { spec, run, branch, project } from "./fixtures.test-support.ts";
it("migrates once, enforces run provenance, and reopens complete report and decision records", () => {
  const dir = mkdtempSync(join(tmpdir(), "research-ledger-"));
  const path = join(dir, "ledger");
  let ledger = new ResearchLedger(path);
  try {
    ledger.putProject(project);
    ledger.putBranch(branch);
    const frozen = ledger.putSpec(project.id, branch.id, spec, project.createdAt);
    expect(
      ledger.putSpec(
        project.id,
        branch.id,
        { ...spec, resources: { gpus: 1, hours: 1 } },
        project.createdAt,
      ).specHash,
    ).toBe(frozen.specHash);
    expect(() => ledger.putRun(run, "missing")).toThrow();
    expect(ledger.snapshot(project.id).runs).toEqual([]);
    ledger.putRun(run, frozen.specHash);
    ledger.putCost(run.id, { tokens: 20, gpuHours: 1, usd: 2 });
    const metric = { runId: run.id, name: "loss", split: "holdout", step: 1, value: 3 } as const;
    ledger.addMetric(metric);
    ledger.addMetric({ ...metric, step: 0, value: 5 });
    const finding = {
      id: FindingId.make("finding"),
      researchProjectId: project.id,
      label: "result",
      scope: "toy",
      claim: "lower error",
      evidenceRunIds: [run.id],
      status: "draft",
      critic: [{ attack: "seed", response: "paired", landed: false }],
      caveats: [],
    } as const;
    ledger.putFinding(finding);
    const gate = ledger.openGate({
      id: GateId.make("gate"),
      researchProjectId: project.id,
      kind: "pick-ideas",
      title: "Pick",
      body: "Choose",
      options: [
        { id: "a", label: "A", recommended: true },
        { id: "b", label: "B", recommended: false },
      ],
      multiSelect: true,
      createdAt: project.createdAt,
    });
    expect(() =>
      ledger.answerGate(project.id, gate.id, { optionIds: ["c"] }, project.updatedAt),
    ).toThrow();
    ledger.answerGate(project.id, gate.id, { optionIds: ["b", "a"] }, project.updatedAt);
    expect(() => ledger.answerGate(project.id, gate.id, "skip", project.updatedAt)).toThrow();
    ledger.recordCorrection(project.id, "metric direction", "lower", project.updatedAt);
    ledger.close();
    ledger = new ResearchLedger(path);
    expect(ledger.snapshot(project.id)).toMatchObject({
      runs: [run],
      findings: [finding],
      gates: [{ status: "answered" }],
    });
    expect(ledger.metricSeries(run.id).map((m) => m.value)).toEqual([5, 3]);
    expect(ledger.bestMetric(project.id, branch.id, "loss", "holdout", false)).toEqual(metric);
    expect(
      ledger.bestMetric(ResearchProjectId.make("other"), branch.id, "loss", "holdout", false),
    ).toBeUndefined();
    expect(ledger.cost(run.id)).toEqual({ tokens: 20, gpuHours: 1, usd: 2 });
    expect(ledger.runSpec(run.id)).toEqual(frozen);
    expect(ledger.branchSpecs(project.id, branch.id)).toEqual([frozen]);
    expect(ledger.metricsForProject(project.id)).toHaveLength(2);
    const question = ledger.openGate({
      ...gate,
      id: GateId.make("question"),
      kind: "question",
      multiSelect: false,
      options: [gate.options[0]!],
    });
    expect(ledger.answerGate(project.id, question.id, "skip", project.updatedAt).status).toBe(
      "skipped",
    );
    expect(
      ledger
        .decisionsJsonl(project.id)
        .trim()
        .split("\n")
        .map((s) => JSON.parse(s)),
    ).toMatchObject([
      { kind: "gate", prompt: gate, response: { optionIds: ["b", "a"] } },
      { kind: "correction", response: "lower" },
      { kind: "gate", response: "skip" },
    ]);
  } finally {
    ledger.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
it("leaves newer databases and failed migration transactions intact", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("PRAGMA user_version=50");
    expect(() => migrateLedger(db)).toThrow(/newer/);
    db.exec("PRAGMA user_version=0; CREATE TABLE findings(collision INTEGER)");
    expect(() => migrateLedger(db)).toThrow(/exists/);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()).toEqual([
      { name: "findings" },
    ]);
  } finally {
    db.close();
  }
});
