import * as NodeSqlite from "node:sqlite";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { ResearchOperationError, type ResearchProjectId } from "@t3tools/contracts";
import { ResearchLedger } from "@t3tools/research-core";
import { ServerConfig } from "../config.ts";

const make = Effect.gen(function* () {
  const config = yield* ServerConfig;
  const path = yield* Path.Path;
  const db = yield* Effect.acquireRelease(
    Effect.sync(() => new NodeSqlite.DatabaseSync(path.join(config.stateDir, "research.sqlite"))),
    (db) => Effect.sync(() => db.close()),
  );
  const ledger = new ResearchLedger(db);
  db.exec(`CREATE TABLE IF NOT EXISTS research_sessions(node TEXT PRIMARY KEY, project TEXT NOT NULL REFERENCES projects(id), thread TEXT UNIQUE NOT NULL, workspace TEXT, launched INTEGER DEFAULT 0);
 CREATE TABLE IF NOT EXISTS research_job_inputs(run TEXT PRIMARY KEY REFERENCES runs(id), digest TEXT NOT NULL, params TEXT NOT NULL DEFAULT '{}', artifacts TEXT NOT NULL DEFAULT '[]', ticket TEXT, finish TEXT);
 CREATE TABLE IF NOT EXISTS research_rungs(run TEXT PRIMARY KEY REFERENCES runs(id),project TEXT REFERENCES projects(id),branch TEXT,rung TEXT,lower REAL,applied INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS research_controls(id TEXT PRIMARY KEY, node TEXT REFERENCES research_sessions(node), action TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS research_resumed_runs(thread TEXT PRIMARY KEY REFERENCES research_sessions(thread), run TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS research_telemetry(run TEXT PRIMARY KEY REFERENCES runs(id), payload TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS research_routes(thread TEXT PRIMARY KEY, family TEXT NOT NULL, model TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS research_reservations(run TEXT PRIMARY KEY REFERENCES runs(id), hours REAL NOT NULL,usd REAL NOT NULL,gate TEXT UNIQUE);
 CREATE TABLE IF NOT EXISTS research_papers(project TEXT REFERENCES projects(id),id TEXT,payload TEXT,PRIMARY KEY(project,id));
 CREATE TABLE IF NOT EXISTS research_workflows(project TEXT PRIMARY KEY REFERENCES projects(id), source TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS research_edits(branch TEXT PRIMARY KEY,project TEXT REFERENCES projects(id),thread TEXT,checkpoint TEXT,parent TEXT,summary TEXT);
 CREATE TABLE IF NOT EXISTS research_finished_turns(node TEXT PRIMARY KEY, failed INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS research_messages(id TEXT PRIMARY KEY, project TEXT REFERENCES projects(id), branch TEXT, body TEXT, created_at TEXT);
 CREATE TABLE IF NOT EXISTS research_batches(run TEXT REFERENCES runs(id), batch TEXT, PRIMARY KEY(run,batch));`);
  const revisions = yield* SubscriptionRef.make<ReadonlyMap<ResearchProjectId, number>>(new Map());
  const projectsRevision = yield* SubscriptionRef.make(0);
  const write = Effect.fn("ResearchLedgerService.write")(function* <T>(
    operation: string,
    project: ResearchProjectId | (() => ResearchProjectId),
    body: () => T,
    projectChanged = false,
  ) {
    return yield* Effect.uninterruptible(
      Effect.try({
        try: () =>
          ledger.transaction(() => ({
            project: typeof project === "function" ? project() : project,
            result: body(),
          })),
        catch: () => new ResearchOperationError({ operation }),
      }).pipe(
        Effect.tap(({ project }) =>
          SubscriptionRef.update(revisions, (current) =>
            new Map(current).set(project, (current.get(project) ?? 0) + 1),
          ),
        ),
        Effect.tap(() =>
          projectChanged ? SubscriptionRef.update(projectsRevision, (n) => n + 1) : Effect.void,
        ),
        Effect.map(({ result }) => result),
      ),
    );
  });
  const snapshot = (id: ResearchProjectId) => ({
    ...ledger.snapshot(id),
    literature: db
      .prepare("SELECT payload FROM research_papers WHERE project=? ORDER BY rowid")
      .all(id)
      .map(
        (row) =>
          JSON.parse(String(row.payload)) as NonNullable<
            import("@t3tools/contracts").ResearchSnapshot["literature"]
          >[number],
      ),
    workflowYaml: String(
      db.prepare("SELECT source FROM research_workflows WHERE project=?").get(id)?.source ?? "",
    ),
    pendingEdits: Object.fromEntries(
      db
        .prepare("SELECT branch,summary FROM research_edits WHERE project=?")
        .all(id)
        .map((row) => [
          String(row.branch),
          JSON.parse(String(row.summary)) as {
            checkpointId: string;
            filesChanged: number;
            additions: number;
            deletions: number;
            summary: string;
          },
        ]),
    ),
    messages: db
      .prepare(
        "SELECT id,branch,body,created_at FROM research_messages WHERE project=? ORDER BY rowid",
      )
      .all(id)
      .map((row) => ({
        id: String(row.id),
        body: String(row.body),
        createdAt: String(row.created_at),
        ...(row.branch ? { branchId: String(row.branch) } : {}),
      })),
  });
  return {
    ledger,
    db,
    write,
    snapshot,
    changes: SubscriptionRef.changes(revisions),
    projectChanges: SubscriptionRef.changes(projectsRevision),
    snapshotChanges: (id: ResearchProjectId) =>
      SubscriptionRef.changes(revisions).pipe(
        Stream.map((r) => r.get(id) ?? 0),
        Stream.changes,
      ),
  };
});
export class ResearchLedgerService extends Context.Service<
  ResearchLedgerService,
  Effect.Success<typeof make>
>()("t3/research/ResearchLedgerService") {}
export const layer = Layer.effect(ResearchLedgerService, make);
