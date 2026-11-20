import * as Config from "effect/Config";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
// @effect-diagnostics-next-line nodeBuiltinImport:off -- The scheduler stores a digest for authenticating the SDK callback.
import * as NodeCrypto from "node:crypto";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Semaphore from "effect/Semaphore";
import * as Schema from "effect/Schema";
import {
  GateId,
  JobId,
  Run as RunSchema,
  ResearchRunId,
  ResearchOperationError,
  ResearchMetricsBody,
  ResearchParamsBody,
  ResearchArtifactsBody,
  ResearchFinishBody,
  ResearchStatusBody,
  type WorkflowNodeId,
  type BranchId,
  type ResearchProjectId,
  type Run,
  type ExperimentSpec,
} from "@t3tools/contracts";
import { canonicalJson } from "@t3tools/research-core";
import {
  ClusterMonitor,
  ComputeBackend,
  Scheduler,
  parseConfig,
  canServe,
  maximumCost,
  execute,
  type Job,
} from "@t3tools/research-backends";
import { ServerConfig } from "../config.ts";
import * as ResearchLedgerService from "./ResearchLedgerService.ts";
import { evaluateFinishedRun, seedObservation } from "./runIntegrity.ts";

const decodeRun = Schema.decodeUnknownSync(RunSchema);
const decodeMetricsBody = Schema.decodeUnknownSync(ResearchMetricsBody);
const decodeParamsBody = Schema.decodeUnknownSync(ResearchParamsBody);
const decodeArtifactsBody = Schema.decodeUnknownSync(ResearchArtifactsBody);
const readProgress = Schema.decodeUnknownEffect(Schema.fromJsonString(ResearchStatusBody));
const decodeStatusBody = Schema.decodeUnknownSync(ResearchStatusBody);
const decodeFinishBody = Schema.decodeUnknownSync(ResearchFinishBody);
const checkPinnedFile = `import hashlib, pathlib, subprocess, sys
path, oid, command = sys.argv[1:]
def verify():
    file = pathlib.Path(path)
    digest = hashlib.new("sha1" if len(oid) == 40 else "sha256")
    digest.update(("blob " + str(file.stat().st_size)).encode() + bytes(1))
    with file.open("rb") as source:
        for chunk in iter(lambda: source.read(1048576), b""):
            digest.update(chunk)
    if digest.hexdigest() != oid:
        sys.exit("Locked evaluation differs from the pinned Git blob")
verify()
status = subprocess.run(["sh", "-c", command]).returncode
verify()
sys.exit(status)
`;
const jobCommand = Effect.fn("ResearchComputeService.jobCommand")(function* (
  cwd: string,
  spec: ExperimentSpec,
) {
  const pin = spec.lockedEval;
  if (!pin) return ["sh", "-c", spec.command] satisfies Job["command"];
  if (
    !/^[0-9a-f]{4,64}$/i.test(pin.commit) ||
    pin.path.split("/").some((part) => !part || part === "." || part === "..")
  )
    return yield* new ResearchOperationError({ operation: "invalid locked evaluation" });
  const blob = (yield* Effect.tryPromise({
    try: () =>
      execute("git", [
        "-C",
        cwd,
        "rev-parse",
        "--verify",
        "--end-of-options",
        pin.commit + ":" + pin.path,
      ]),
    catch: () => new ResearchOperationError({ operation: "resolve locked evaluation" }),
  })).trim();
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(blob))
    return yield* new ResearchOperationError({ operation: "resolve evaluation blob" });
  return ["python3", "-c", checkPinnedFile, pin.path, blob, spec.command] satisfies Job["command"];
});
const digest = (token: string) => NodeCrypto.createHash("sha256").update(token).digest("hex");
const make = Effect.gen(function* () {
  const clock = yield* Clock.Clock;
  const timestamp = () => DateTime.formatIso(DateTime.makeUnsafe(clock.currentTimeMillisUnsafe()));
  const config = yield* ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const store = yield* ResearchLedgerService.ResearchLedgerService;
  const file = path.join(path.dirname(config.settingsPath), "research-backends.yaml");
  const configs = yield* fs.exists(file).pipe(
    Effect.flatMap((exists) =>
      exists
        ? fs.readFileString(file).pipe(
            Effect.flatMap((source) =>
              Effect.try({
                try: () => parseConfig(source),
                catch: () => new ResearchOperationError({ operation: "parse backend config" }),
              }),
            ),
          )
        : Effect.succeed([]),
    ),
  );
  const backends = configs.map((c) => new ComputeBackend(c));
  const monitor = new ClusterMonitor(backends);
  const scheduler = new Scheduler(backends, store.db);
  const tickLock = yield* Semaphore.make(1);
  const url = yield* Config.String("MULAGENT_LEDGER_URL").pipe(
    Config.withDefault(`http://127.0.0.1:${config.port}`),
  );
  const descriptions = () => backends.map((b) => b.describe());
  const lookup = (id: ResearchRunId) => {
    const row = store.db.prepare("SELECT payload FROM runs WHERE id=?").get(id);
    if (!row) throw Error("Unknown run");
    return decodeRun(JSON.parse(String(row.payload)));
  };
  const finish = (
    run: Run,
    body: typeof ResearchFinishBody.Type,
    params: Record<string, unknown>,
  ) => {
    const spec = store.ledger.runSpec(run.id);
    if (!spec) throw Error("Missing frozen spec");
    const best = store.ledger.bestMetric(
      run.researchProjectId,
      run.branchId,
      spec.metric,
      "holdout",
      spec.higherIsBetter,
    );
    const codeHash = body.codeHash ?? run.codeHash,
      dataHash = body.dataHash ?? run.dataHash;
    const cohort =
      codeHash && dataHash
        ? store.ledger
            .snapshot(run.researchProjectId)
            .runs.filter(
              (peer) =>
                peer.id !== run.id &&
                peer.status === "finished" &&
                peer.integrity !== "rejected" &&
                peer.branchId === run.branchId &&
                peer.change === run.change &&
                peer.scope === run.scope &&
                peer.codeHash === codeHash &&
                peer.dataHash === dataHash &&
                store.ledger.runSpec(peer.id)?.specHash === spec.specHash,
            )
        : [];
    const peers = cohort.flatMap(
      (peer) => seedObservation(peer, spec, store.ledger.metricSeries(peer.id)) ?? [],
    );
    const checked = evaluateFinishedRun(
      spec,
      {
        ...run,
        status: body.exitCode && body.status === "finished" ? "failed" : body.status,
        codeHash: body.codeHash ?? run.codeHash,
        dataHash: body.dataHash ?? run.dataHash,
        trackerUrls: body.trackerUrls ?? run.trackerUrls,
        endedAt: timestamp(),
      },
      store.ledger.metricSeries(run.id),
      params,
      best?.value,
      peers,
    );
    store.ledger.putRun(checked.run);
    if (checked.run.status === "finished" && checked.run.integrity === "trusted" && checked.stats) {
      for (const peer of cohort)
        store.ledger.putRun({
          ...peer,
          integrity: "trusted",
          checks: peer.checks.map((c) =>
            c.name === "stats" ? checked.run.checks.find((x) => x.name === "stats")! : c,
          ),
        });
      store.db
        .prepare("INSERT OR IGNORE INTO research_rungs VALUES(?,?,?,?,?,0)")
        .run(
          run.id,
          run.researchProjectId,
          run.branchId,
          run.scope ?? "toy",
          checked.stats.ci95[0],
        );
    }
  };
  const authorize = (runId: string, token: string) =>
    token.length > 0 &&
    !!store.db
      .prepare("SELECT 1 FROM research_job_inputs WHERE run=? AND digest=?")
      .get(runId, digest(token));
  const ingest = Effect.fn("ResearchComputeService.ingest")(function* (
    id: ResearchRunId,
    token: string,
    operation: string,
    body: unknown,
  ) {
    yield* store.write(
      "job " + operation,
      () => lookup(id).researchProjectId,
      () => {
        if (!authorize(id, token)) throw Error("Unauthorized");
        const row = store.db
          .prepare("SELECT params,finish FROM research_job_inputs WHERE run=?")
          .get(id)!;
        const run = lookup(id);
        if (run.endedAt || row.finish) {
          if (operation === "finish" && row.finish === canonicalJson(body)) return;
          throw Error("Run closed");
        }
        switch (operation) {
          case "metrics": {
            const batch = decodeMetricsBody(body);
            if (
              batch.batchId &&
              !store.db
                .prepare("INSERT OR IGNORE INTO research_batches VALUES(?,?)")
                .run(id, batch.batchId).changes
            )
              return;
            for (const m of batch.metrics) store.ledger.addMetric({ ...m, runId: id });
            break;
          }
          case "params": {
            const { params } = decodeParamsBody(body);
            store.db
              .prepare("UPDATE research_job_inputs SET params=? WHERE run=?")
              .run(JSON.stringify({ ...JSON.parse(String(row.params)), ...params }), id);
            break;
          }
          case "artifacts": {
            const { artifact } = decodeArtifactsBody(body);
            store.db
              .prepare(
                "UPDATE research_job_inputs SET artifacts=json_insert(artifacts,'$[#]',json(?)) WHERE run=? AND NOT EXISTS (SELECT 1 FROM json_each(artifacts) WHERE value=?)",
              )
              .run(canonicalJson(artifact), id, canonicalJson(artifact));
            break;
          }
          case "status": {
            const { status, codeHash, dataHash, ...telemetry } = decodeStatusBody(body);
            store.db
              .prepare(
                `INSERT INTO research_telemetry VALUES(?,?) ON CONFLICT(run) DO UPDATE SET payload=json_patch(research_telemetry.payload,excluded.payload)`,
              )
              .run(id, canonicalJson({ status, ...telemetry }));
            const job = store.ledger
              .snapshot(run.researchProjectId)
              .jobs.find((j) => j.runId === id);
            if (job) store.ledger.putJob(run.researchProjectId, { ...job, ...telemetry });
            store.ledger.putRun({
              ...run,
              status,
              codeHash: codeHash ?? run.codeHash,
              dataHash: dataHash ?? run.dataHash,
            });
            break;
          }
          case "finish": {
            decodeFinishBody(body);
            store.db
              .prepare("UPDATE research_job_inputs SET finish=? WHERE run=?")
              .run(canonicalJson(body), id);
            break;
          }
          default:
            throw Error("Unknown SDK operation");
        }
      },
    );
  });
  const tick = Effect.fn("ResearchComputeService.tick")(function* () {
    yield* Effect.tryPromise({
      try: () => scheduler.tick(),
      catch: () => new ResearchOperationError({ operation: "schedule jobs" }),
    }).pipe(Effect.tapError(Effect.logWarning), Effect.ignore);
    for (const row of store.db
      .prepare(
        "SELECT i.run,i.ticket,i.params,i.finish,j.payload previous FROM research_job_inputs i JOIN runs r ON i.run=r.id LEFT JOIN jobs j ON j.run=r.id WHERE json_extract(r.payload,'$.endedAt') IS NULL OR (i.ticket IS NOT NULL AND coalesce(json_extract(j.payload,'$.state'),'queued') NOT IN ('failed','cancelled','succeeded'))",
      )
      .all()) {
      const ticket = scheduler.status(String(row.ticket));
      if (!ticket) continue;
      const run = lookup(ResearchRunId.make(String(row.run)));
      const backend = backends.find((b) => b.describe().id === ticket.backend);
      if (!backend || !ticket.native) {
        if (
          ["failed", "budget-exhausted", "cancelled"].includes(String(ticket.phase)) &&
          !run.endedAt
        )
          yield* store.write("fail run", run.researchProjectId, () =>
            finish(run, { status: ticket.phase === "cancelled" ? "cancelled" : "failed" }, {}),
          );
        continue;
      }
      const status = yield* Effect.tryPromise({
        try: () => backend.status(JobId.make(String(ticket.native))),
        catch: () => new ResearchOperationError({ operation: "job status" }),
      }).pipe(Effect.tapError(Effect.logWarning), Effect.option);
      if (status._tag === "None") continue;
      const remote = status.value;
      const telemetry = store.db
        .prepare("SELECT payload FROM research_telemetry WHERE run=?")
        .get(run.id);
      const progress = telemetry ? yield* readProgress(String(telemetry.payload)) : undefined;
      const { status: _sdkStatus, codeHash: _code, dataHash: _data, ...live } = progress ?? {};
      const job = { ...remote, ...live, runId: run.id };
      if (
        canonicalJson(job) === row.previous &&
        run.jobId === remote.id &&
        (run.endedAt || ticket.phase === "active")
      )
        continue;
      yield* store.write("sync job", run.researchProjectId, () => {
        const current = lookup(run.id);
        store.ledger.putJob(run.researchProjectId, job);
        const updated = { ...current, backendId: remote.backendId, jobId: remote.id };
        if (current.endedAt) return;
        if (["failed", "cancelled", "succeeded"].includes(String(ticket.phase))) {
          const receipt = row.finish ? decodeFinishBody(JSON.parse(String(row.finish))) : undefined;
          const status =
            ticket.phase === "succeeded" && receipt
              ? receipt.status
              : ticket.phase === "cancelled"
                ? "cancelled"
                : "failed";
          const params = JSON.parse(String(row.params));
          if (status === "finished" && params.lockedEvalCommit === undefined)
            params.lockedEvalCommit = store.ledger.runSpec(run.id)?.lockedEval?.commit;
          finish(updated, { ...receipt, status }, params);
        } else
          store.ledger.putRun({
            ...updated,
            status: remote.state === "running" ? "running" : current.status,
          });
      });
    }
  }, tickLock.withPermits(1));
  const submit = Effect.fn("ResearchComputeService.submit")(function* (
    project: ResearchProjectId,
    branchId: BranchId,
    cwd: string,
    spec: ExperimentSpec,
    seed: number,
    change: string,
    nodeId?: WorkflowNodeId,
  ) {
    const command = yield* jobCommand(cwd, spec);
    const id = ResearchRunId.make(NodeCrypto.randomUUID());
    yield* store.write("submit job", project, () => {
      const snapshot = store.snapshot(project);
      const branch = snapshot.branches.find((b) => b.id === branchId);
      if (!branch || !["running", "promoted"].includes(branch.status) || !spec.seeds.includes(seed))
        throw Error("Branch or seed unavailable");
      const now = timestamp();
      const frozen = branch.spec ?? store.ledger.putSpec(project, branchId, spec, now);
      if (
        branch.spec &&
        canonicalJson({ ...spec, specHash: undefined, frozenAt: undefined }) !==
          canonicalJson({ ...frozen, specHash: undefined, frozenAt: undefined })
      )
        throw Error("Frozen protocol changed");
      store.ledger.putBranch({ ...branch, spec: frozen });
      const token = NodeCrypto.randomBytes(32).toString("hex");
      const costs = backends
        .filter((b) => canServe(b.config, frozen.resources))
        .map((b) => maximumCost(b.config, frozen.resources));
      if (!costs.length) throw Error("No backend for resources");
      const usd = Math.max(...costs),
        hours = frozen.resources.gpus * frozen.resources.hours;
      const branchReserved = store.db
        .prepare(
          "SELECT coalesce(sum(hours),0) hours FROM research_reservations JOIN runs ON run=runs.id WHERE runs.branch=?",
        )
        .get(branchId)!;
      if (hours + Number(branchReserved.hours) > branch.budgetGpuHours)
        throw Error("Branch budget exhausted");
      const reserved = store.db
        .prepare(
          "SELECT COALESCE(sum(hours),0) hours,COALESCE(sum(usd),0) usd FROM research_reservations JOIN runs ON run=runs.id WHERE runs.project=?",
        )
        .get(project)!;
      if (
        usd + Number(reserved.usd) > snapshot.project.budget.usd ||
        hours + Number(reserved.hours) > snapshot.project.budget.gpuHours
      )
        throw Error("Project budget exhausted");
      const gate =
        snapshot.project.approvalMode === "ask-always" ||
        (snapshot.project.approvalMode === "ask-risky" && (hours > 20 || usd > 0))
          ? GateId.make(NodeCrypto.randomUUID())
          : undefined;
      const ticket = scheduler.enqueue(
        {
          command,
          cwd,
          resources: frozen.resources,
          runId: id,
          artifacts: [],
          env: {
            MULAGENT_RUN_ID: id,
            MULAGENT_TOKEN: token,
            MULAGENT_LEDGER_URL: url,
            MULAGENT_SEED: String(seed),
          },
        },
        0,
        0,
        !!gate,
      );
      store.ledger.putRun(
        {
          id,
          researchProjectId: project,
          branchId,
          nodeId,
          number: snapshot.runs.filter((r) => r.branchId === branchId).length + 1,
          seed,
          change,
          scope: branch.rung,
          status: "queued",
          verdict: "pending",
          integrity: "unchecked",
          checks: [],
          trackerUrls: [],
          createdAt: now,
          gpuHours: 0,
          llmUsd: 0,
        },
        frozen.specHash,
      );
      if (gate)
        store.ledger.openGate({
          id: gate,
          researchProjectId: project,
          kind: "budget",
          title: "Approve experiment",
          body: JSON.stringify(
            { seed, change, spec: frozen, maximumUsd: usd, gpuHours: hours },
            null,
            2,
          ),
          multiSelect: false,
          options: [
            { id: "proceed", label: "Run", recommended: true },
            { id: "stop", label: "Cancel", recommended: false },
          ],
          createdAt: now,
        });
      store.db
        .prepare("INSERT INTO research_reservations VALUES(?,?,?,?)")
        .run(id, hours, usd, gate ?? null);
      store.db
        .prepare("INSERT INTO research_job_inputs(run,digest,ticket) VALUES(?,?,?)")
        .run(id, digest(token), ticket);
    });
    yield* tick().pipe(Effect.tapError(Effect.logWarning), Effect.ignore);
    return id;
  });
  const sample = Effect.fn("ResearchComputeService.sample")(function* () {
    yield* Effect.tryPromise({
      try: () => monitor.sample(),
      catch: () => new ResearchOperationError({ operation: "sample backends" }),
    });
    return descriptions();
  });
  const resolveGate = (gateId: GateId, proceed: boolean) => {
    const r = store.db
      .prepare(
        "SELECT ticket,run FROM research_job_inputs JOIN research_reservations USING(run) WHERE gate=?",
      )
      .get(gateId);
    if (!r) return;
    if (proceed) scheduler.release(String(r.ticket));
    else {
      scheduler.cancel(String(r.ticket));
      store.db.prepare("DELETE FROM research_reservations WHERE run=?").run(r.run!);
    }
  };
  const cancelBranch = (id: BranchId) => {
    for (const row of store.db
      .prepare(
        "SELECT ticket FROM research_job_inputs JOIN runs ON run=runs.id WHERE branch=? AND json_extract(runs.payload,'$.endedAt') IS NULL",
      )
      .all(id))
      scheduler.cancel(String(row.ticket));
  };
  return { submit, tick, sample, descriptions, authorize, ingest, resolveGate, cancelBranch };
});
export class ResearchComputeService extends Context.Service<
  ResearchComputeService,
  Effect.Success<typeof make>
>()("t3/research/ResearchComputeService") {}
export const layer = Layer.effect(ResearchComputeService, make);
