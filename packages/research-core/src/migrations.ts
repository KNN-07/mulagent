import type * as NodeSqlite from "node:sqlite";

const projectTable = (name: string, extra = "") => `
  CREATE TABLE ${name} (
    id TEXT NOT NULL, project TEXT NOT NULL REFERENCES projects(id), payload TEXT NOT NULL CHECK(json_valid(payload))
    ${extra}, PRIMARY KEY(project,id)
  );`;

const migrations = [
  `CREATE TABLE projects(id TEXT PRIMARY KEY NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload)));
  ${projectTable("branches")}
  ${projectTable("workflow_nodes", ", branch TEXT GENERATED ALWAYS AS (json_extract(payload,'$.branchId')), FOREIGN KEY(project,branch) REFERENCES branches(project,id)")}
  ${projectTable(
    "runs",
    `, branch TEXT GENERATED ALWAYS AS (json_extract(payload,'$.branchId')) NOT NULL,
    node TEXT GENERATED ALWAYS AS (json_extract(payload,'$.nodeId')),
    UNIQUE(id), FOREIGN KEY(project,branch) REFERENCES branches(project,id),
    FOREIGN KEY(project,node) REFERENCES workflow_nodes(project,id)`,
  )}
  CREATE INDEX runs_by_branch ON runs(project,branch);
  CREATE TABLE specs(project TEXT NOT NULL, branch TEXT NOT NULL, hash TEXT NOT NULL, payload TEXT NOT NULL,
    PRIMARY KEY(project,branch,hash), FOREIGN KEY(project,branch) REFERENCES branches(project,id));
  CREATE TABLE run_specs(run TEXT PRIMARY KEY REFERENCES runs(id), project TEXT NOT NULL, branch TEXT NOT NULL, hash TEXT NOT NULL,
    FOREIGN KEY(project,branch,hash) REFERENCES specs(project,branch,hash));
  CREATE TABLE run_metrics(run TEXT NOT NULL REFERENCES runs(id), name TEXT NOT NULL, value REAL NOT NULL, step INTEGER, split TEXT);
  CREATE INDEX metrics_by_run ON run_metrics(run,name,step);
  ${projectTable("findings")}
  CREATE TABLE critic_attacks(project TEXT NOT NULL, finding TEXT NOT NULL, position INTEGER NOT NULL, payload TEXT NOT NULL,
    PRIMARY KEY(project,finding,position), FOREIGN KEY(project,finding) REFERENCES findings(project,id));
  ${projectTable("gates", ", node TEXT GENERATED ALWAYS AS (json_extract(payload,'$.nodeId')), FOREIGN KEY(project,node) REFERENCES workflow_nodes(project,id)")}
  ${projectTable("lean_claims")}
  ${projectTable("jobs", ", run TEXT GENERATED ALWAYS AS (json_extract(payload,'$.runId')), FOREIGN KEY(project,run) REFERENCES runs(project,id)")}
  CREATE TABLE decisions(project TEXT NOT NULL REFERENCES projects(id), payload TEXT NOT NULL);
  CREATE INDEX decisions_by_project ON decisions(project);
  CREATE TABLE costs(run TEXT PRIMARY KEY REFERENCES runs(id), tokens INTEGER NOT NULL CHECK(tokens>=0),
    gpuHours REAL NOT NULL CHECK(gpuHours>=0), usd REAL NOT NULL CHECK(usd>=0));`,
];

export function migrateLedger(db: NodeSqlite.DatabaseSync) {
  db.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; BEGIN IMMEDIATE");
  try {
    const version = Number(db.prepare("PRAGMA user_version").get()!.user_version);
    if (version > migrations.length) throw new Error("Ledger was written by a newer version");
    for (let i = version; i < migrations.length; i++)
      db.exec(migrations[i]! + ` PRAGMA user_version = ${i + 1}`);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
