// @effect-diagnostics-next-line nodeBuiltinImport:off -- The backend boundary runs directly on Node and exposes a Promise API.
import * as NodeCrypto from "node:crypto";
import * as NodeSqlite from "node:sqlite";
import { type BackendId, JobId } from "@t3tools/contracts";
import { maximumCost, checkJob, type Backend, type Job } from "./model.ts";

interface Ticket {
  id: string;
  job: string;
  phase: string;
  backend: BackendId | null;
  native: JobId | null;
  retries: number;
}
const cost = (b: Backend, j: Job) => maximumCost(b.config, j.resources);
export class Scheduler {
  readonly db: NodeSqlite.DatabaseSync;
  readonly backends: readonly Backend[];
  constructor(backends: readonly Backend[], db: NodeSqlite.DatabaseSync) {
    this.backends = backends;
    this.db = db;
    db.exec(`CREATE TABLE IF NOT EXISTS backend_queue(id TEXT PRIMARY KEY,job TEXT NOT NULL,priority INTEGER NOT NULL,retries INTEGER NOT NULL,phase TEXT NOT NULL,backend TEXT,native TEXT);
    CREATE TABLE IF NOT EXISTS backend_attempt(ticket TEXT NOT NULL,backend TEXT NOT NULL,usd REAL NOT NULL,native TEXT,outcome TEXT);`);
  }
  enqueue(job: Job, priority = 0, retries = 1) {
    if (!Number.isFinite(priority) || !Number.isSafeInteger(retries) || retries < 0)
      throw Error("Invalid queue parameters");
    if (!this.backends.some((b) => this.withinBudget(b, job)))
      throw Error("No capable backend within remaining budget");
    const id = NodeCrypto.randomUUID();
    this.db
      .prepare("INSERT INTO backend_queue VALUES(?,?,?,?,'waiting',NULL,NULL)")
      .run(id, JSON.stringify(job), priority, retries);
    return id;
  }
  private withinBudget(b: Backend, j: Job) {
    try {
      checkJob(b.config, j);
    } catch {
      return false;
    }
    const usage = this.db
      .prepare("SELECT coalesce(sum(usd),0) AS reserved FROM backend_attempt WHERE backend=?")
      .get(b.describe().id)!;
    return Number(usage.reserved) + cost(b, j) <= b.config.spendCapUsd;
  }
  private choose(j: Job, resumeBackend?: BackendId | null) {
    const eligible = this.backends.flatMap((b) => {
      const d = b.describe();
      if ((resumeBackend && resumeBackend !== d.id) || !d.healthy || !this.withinBudget(b, j))
        return [];
      const usage = this.db
        .prepare(
          "SELECT count(*) AS active FROM backend_queue WHERE backend=? AND phase IN ('submitting','active','uncertain')",
        )
        .get(d.id)!;
      if (Number(usage.active) >= b.config.maxConcurrent) return [];
      const wait =
        ((d.queueDepth ?? 0) + ((d.gpusFree ?? d.gpusTotal) < j.resources.gpus ? 1 : 0)) *
        (b.config.queueMinutesPerJob ?? 1);
      return [{ b, score: cost(b, j) + wait / 60 }];
    });
    return eligible.sort((a, b) => a.score - b.score)[0]?.b;
  }
  private claim() {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const rows = this.db
        .prepare("SELECT * FROM backend_queue WHERE phase='waiting' ORDER BY priority DESC,rowid")
        .all() as unknown as Ticket[];
      for (const row of rows) {
        const j: Job = JSON.parse(row.job),
          b = this.choose(j, row.backend);
        if (!b) {
          if (
            !this.backends.some(
              (candidate) =>
                (!row.backend || candidate.describe().id === row.backend) &&
                this.withinBudget(candidate, j),
            )
          ) {
            this.db
              .prepare("UPDATE backend_queue SET phase='budget-exhausted' WHERE id=?")
              .run(row.id);
          }
          continue;
        }
        const jobId = JobId.make(NodeCrypto.randomUUID());
        this.db
          .prepare("UPDATE backend_queue SET backend=?,native=?,phase='submitting' WHERE id=?")
          .run(b.describe().id, jobId, row.id);
        const attempt = this.db
          .prepare("INSERT INTO backend_attempt(ticket,backend,usd,native) VALUES(?,?,?,?)")
          .run(row.id, b.describe().id, cost(b, j), jobId).lastInsertRowid;
        this.db.exec("COMMIT");
        return { row, j, b, attempt, jobId };
      }
      this.db.exec("COMMIT");
      return;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  async tick() {
    const failures: unknown[] = [];
    const active = this.db
      .prepare("SELECT * FROM backend_queue WHERE phase IN ('active','submitting','uncertain')")
      .all() as unknown as Ticket[];
    for (const row of active) {
      const b = this.backends.find((b) => b.describe().id === row.backend);
      if (!b || !row.native) continue;
      let s;
      try {
        s = await b.status(row.native);
      } catch (e) {
        if (row.phase === "active") failures.push(e);
        continue;
      }
      if (row.phase !== "active" && s.state !== "unknown") {
        this.db
          .prepare(
            "UPDATE backend_queue SET phase='active' WHERE id=? AND native=? AND phase IN ('uncertain','submitting')",
          )
          .run(row.id, row.native);
      }
      if (!["succeeded", "failed", "cancelled"].includes(s.state)) continue;
      const retry = s.preempted && row.retries > 0;
      this.db.exec("BEGIN IMMEDIATE");
      try {
        this.db
          .prepare("UPDATE backend_attempt SET outcome=? WHERE ticket=? AND native=?")
          .run(s.preempted ? "preempted" : s.state, row.id, row.native);
        this.db
          .prepare(
            "UPDATE backend_queue SET phase=?,retries=retries-? WHERE id=? AND native=? AND phase='active'",
          )
          .run(retry ? "waiting" : s.state, retry ? 1 : 0, row.id, row.native);
        this.db.exec("COMMIT");
      } catch (e) {
        this.db.exec("ROLLBACK");
        throw e;
      }
    }
    for (let claim = this.claim(); claim; claim = this.claim()) {
      const { row, b, j, attempt, jobId } = claim;
      try {
        const native = await b.submit(j, jobId, row.native ?? undefined);
        this.db.exec("BEGIN IMMEDIATE");
        try {
          this.db.prepare("UPDATE backend_attempt SET native=? WHERE rowid=?").run(native, attempt);
          this.db
            .prepare(
              "UPDATE backend_queue SET phase='active',native=? WHERE id=? AND native=? AND phase='submitting'",
            )
            .run(native, row.id, jobId);
          this.db.exec("COMMIT");
        } catch (e) {
          this.db.exec("ROLLBACK");
          throw e;
        }
      } catch (e) {
        // A lost submit response may still have started a billed job.
        this.db
          .prepare(
            "UPDATE backend_queue SET phase='uncertain' WHERE id=? AND native=? AND phase='submitting'",
          )
          .run(row.id, jobId);
        failures.push(e);
      }
    }
    if (failures.length) throw new AggregateError(failures, "Backend operations failed");
  }
  attempts(ticket: string) {
    return this.db
      .prepare(
        "SELECT backend,usd AS reservedUsd,native,outcome FROM backend_attempt WHERE ticket=? ORDER BY rowid",
      )
      .all(ticket);
  }
  status(ticket: string) {
    return this.db
      .prepare("SELECT phase,backend,native,retries FROM backend_queue WHERE id=?")
      .get(ticket);
  }
}
