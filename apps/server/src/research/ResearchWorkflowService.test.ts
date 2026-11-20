import { ModelRouter } from "@t3tools/research-agents/modelRouter";
import { ComputeBackend, parseConfig, execute } from "@t3tools/research-backends";
import { it, expect } from "@effect/vitest";
import {
  EventId,
  ProjectId,
  ThreadId,
  ResearchOperationError,
  type ExperimentSpec,
  type ResearchRunId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Context from "effect/Context";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import { HttpRouter, HttpServer } from "effect/http";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { ServerConfig } from "../config.ts";
import { emptyProjection } from "../orchestration-v2/ProjectionStore.ts";
import { ThreadLaunchService } from "../orchestration-v2/ThreadLaunchService.ts";
import { ThreadManagementService } from "../orchestration-v2/ThreadManagementService.ts";
import { ManagedProjectFolders } from "../project/ManagedProjectFolders.ts";
import { OrchestrationEventStore } from "../persistence/OrchestrationEventStore.ts";
import * as Compute from "./ResearchComputeService.ts";
import * as Ledger from "./ResearchLedgerService.ts";
import * as Workflow from "./ResearchWorkflowService.ts";
import * as Report from "./ResearchReportService.ts";
import * as Agent from "./ResearchAgentService.ts";
import * as Http from "./http.ts";

it.each([
  ["autonomous", "full-access"],
  ["ask-risky", "auto-accept-edits"],
  ["ask-always", "approval-required"],
] as const)("launches %s projects with %s", (approval, mode) => {
  expect(Workflow.runtimeForApproval[approval]).toBe(mode);
});
it.each([
  ["planner", "reasoningEffort", "high"],
  ["ideator", "effort", "high"],
  ["surveyor", "thought_level", "low"],
] as const)("maps the reasoning level for %s", (role, id, value) => {
  expect(Workflow.nativeModelSelection(new ModelRouter().select(role)).options).toEqual([
    { id, value },
  ]);
});

it.live(
  "records both SDK hillclimb jobs, checks their evidence, and renders their linked results",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem,
        path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "research-e2e-" });
      const workspace = path.join(root, "workspace");
      yield* fs.makeDirectory(workspace);
      const sdk = path.fromFileUrl(
        new URL("../../../../python/mulagent/src/mulagent", import.meta.url),
      );
      yield* fs.copy(yield* sdk, path.join(workspace, "mulagent"));
      yield* fs.writeFileString(
        path.join(workspace, "trial.py"),
        `import os
import mulagent
import urllib.error
import urllib.request
url = os.environ["MULAGENT_LEDGER_URL"] + "/api/research/runs/" + os.environ["MULAGENT_RUN_ID"] + "/metrics"
try:
    urllib.request.urlopen(urllib.request.Request(url, data=b'{}', headers={"Authorization":"Bearer invalid"}))
except urllib.error.HTTPError as error:
    assert error.code == 401
else:
    raise RuntimeError("Unexpected SDK authentication success")
seed = int(os.environ["MULAGENT_SEED"])
with mulagent.init(sinks=[]) as run:
    run.log_params({"trainIds":["train-1"], "testIds":["test-1"]})
    run.log_metric("baseline", 1, split="holdout")
    run.log_metric("loss", 3, step=0, split="train")
    run.log_metric("loss", 2, step=1, split="train")
    run.log_metric("score", seed + 10, split="holdout")
`,
      );
      const git = (...args: string[]) =>
        Effect.promise(() => execute("git", ["-C", workspace, ...args]));
      yield* git("init", "--quiet");
      yield* git("add", "trial.py");
      yield* git(
        "-c",
        "user.name=Research",
        "-c",
        "user.email=research@localhost",
        "commit",
        "--no-gpg-sign",
        "-qm",
        "Pin evaluation",
      );
      const revision = (yield* git("rev-parse", "HEAD")).trim();
      const net = yield* Layer.build(NodeHttpServer.layerTest);
      const server = Context.get(net, HttpServer.HttpServer);
      if (server.address._tag === "UnixPathAddress") throw Error("Expected TCP listener");
      const config = yield* ServerConfig;
      yield* fs.writeFileString(
        path.join(config.stateDir, "research-backends.yaml"),
        JSON.stringify({
          backends: [
            {
              description: {
                id: "local",
                label: "CPU",
                kind: "local",
                gpusTotal: 0,
                healthy: true,
                preemptible: false,
                usdPerGpuHour: 0,
              },
              workRoot: path.join(root, "jobs"),
              maxConcurrent: 2,
              spendCapUsd: 0,
            },
          ],
        }),
      );
      const backend = new ComputeBackend(
        parseConfig(
          yield* fs.readFileString(path.join(config.stateDir, "research-backends.yaml")),
        )[0]!,
      );
      const projections = new Map<ThreadId, ReturnType<typeof emptyProjection>>();
      const services = Layer.mergeAll(Agent.layer, Workflow.layer, Report.layer).pipe(
        Layer.provideMerge(Compute.layer),
        Layer.provideMerge(Ledger.layer),
        Layer.provide(Layer.succeed(ServerConfig, { ...config, port: server.address.port })),
        Layer.provide(
          Layer.mergeAll(
            Layer.mock(ThreadManagementService)({
              getThreadRecords: (id) => Effect.succeed(projections.get(id)!),
            }),
            Layer.mock(OrchestrationEventStore)({}),
            Layer.mock(ManagedProjectFolders)({
              namedProjectsRoot: root,
              createNamedProject: () =>
                Effect.succeed({
                  projectId: ProjectId.make("t3-project"),
                  workspaceRoot: workspace,
                }),
            }),
            Layer.mock(ThreadLaunchService)({
              launch: (i) =>
                Effect.gen(function* () {
                  const t = i.threadId!,
                    at = yield* DateTime.now;
                  const projection = emptyProjection({
                    id: EventId.make(t),
                    threadId: t,
                    type: "thread.created",
                    occurredAt: at,
                    payload: {
                      id: t,
                      createdBy: i.createdBy,
                      creationSource: i.creationSource,
                      projectId: i.projectId,
                      title: i.title,
                      providerInstanceId: i.modelSelection.instanceId,
                      modelSelection: i.modelSelection,
                      runtimeMode: i.runtimeMode,
                      interactionMode: i.interactionMode,
                      branch: "trial",
                      worktreePath: workspace,
                      activeProviderThreadId: null,
                      lineage: {
                        parentThreadId: null,
                        relationshipToParent: null,
                        rootThreadId: t,
                      },
                      forkedFrom: null,
                      createdAt: at,
                      updatedAt: at,
                      archivedAt: null,
                      settledOverride: null,
                      settledAt: null,
                      lastVisitedAt: null,
                      deletedAt: null,
                    },
                  });
                  projections.set(t, projection);
                  return {
                    threadId: t,
                    projection: {
                      ...projection,
                      thread: { ...projection.thread, branch: null, worktreePath: null },
                    },
                    resumed: false,
                  };
                }),
            }),
          ),
        ),
      );
      const ctx = yield* Layer.build(services);
      yield* Layer.build(
        HttpRouter.serve(Http.layer, { disableListenLog: true }).pipe(
          Layer.provide(Layer.succeedContext(Context.merge(net, ctx))),
        ),
      );
      const flow = Context.get(ctx, Workflow.ResearchWorkflowService),
        store = Context.get(ctx, Ledger.ResearchLedgerService),
        agent = Context.get(ctx, Agent.ResearchAgentService);
      const p = yield* flow.startProject({
        goal: "Test local hillclimb",
        workflow: "hillclimb",
        approvalMode: "autonomous",
        budget: { usd: 0, gpuHours: 0, llmUsdPerWeek: 0 },
      });
      expect(projections.get(p.threadId!)?.thread).toMatchObject({
        providerInstanceId: "codex",
        modelSelection: {
          instanceId: "codex",
          model: "gpt-6.2-astra",
          options: [{ id: "reasoningEffort", value: "high" }],
        },
        runtimeMode: "full-access",
      });
      yield* flow.finishTurn(p.threadId!, false);
      const preflight = store.db
        .prepare("SELECT thread FROM research_sessions WHERE project=? ORDER BY rowid DESC LIMIT 1")
        .get(p.id)!;
      yield* flow.finishTurn(ThreadId.make(String(preflight.thread)), false);
      const branch = store.snapshot(p.id).branches[0]!;
      expect(projections.get(branch.threadId!)?.thread).toMatchObject({
        providerInstanceId: "antigravity",
        modelSelection: {
          instanceId: "antigravity",
          model: "gemini-4-neon",
          options: [{ id: "thought_level", value: "high" }],
        },
        runtimeMode: "full-access",
      });
      const spec: ExperimentSpec = {
        hypothesis: "test",
        metric: "score",
        higherIsBetter: true,
        baseline: 1,
        seeds: [1, 2],
        command: "python3 trial.py",
        resources: { gpus: 0, hours: 0.02 },
        editable: [],
        lockedEval: { path: "trial.py", commit: revision },
      };
      const ids: ResearchRunId[] = [];
      for (const seed of spec.seeds) {
        const id = yield* agent.submit(branch.threadId!, { spec, seed, change: "seed " + seed });
        ids.push(id);
        const job = store.snapshot(p.id).runs.find((r) => r.id === id)!.jobId!;
        yield* Stream.fromAsyncIterable(
          backend.logs(job, { follow: true }),
          () => new ResearchOperationError({ operation: "read test job output" }),
        ).pipe(Stream.runDrain);
        yield* Context.get(ctx, Compute.ResearchComputeService).tick();
      }
      yield* flow.finishTurn(branch.threadId!, false);
      const snapshot = store.snapshot(p.id);
      expect(snapshot.nodes.find((n) => n.key === "review")?.status).toBe("running");
      expect(snapshot.jobs.map((j) => j.runId)).toEqual(ids);
      expect(snapshot.runs.map((r) => [r.id, r.verdict, r.integrity])).toEqual(
        ids.map((id) => [id, "keep", "preliminary"]),
      );
      expect(
        snapshot.metrics.filter((m) => m.name === "score").map((m) => [m.runId, m.value]),
      ).toEqual([
        [ids[0], 11],
        [ids[1], 12],
      ]);
      expect(store.ledger.bestMetric(p.id, branch.id, "score", "holdout", true)).toMatchObject({
        runId: ids[1],
        value: 12,
      });
      const html = yield* Context.get(ctx, Report.ResearchReportService).html(p.id);
      for (const [i, id] of ids.entries()) {
        expect(html).toContain(`data-run-id="${id}" data-metric-name="score">${11 + i}</a>`);
      }
    }).pipe(
      Effect.provide(
        ServerConfig.layerTest(".", { prefix: "research-state-" }).pipe(
          Layer.provideMerge(NodeServices.layer),
        ),
      ),
      Effect.scoped,
    ),
);
