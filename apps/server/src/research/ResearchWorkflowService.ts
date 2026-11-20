import * as Compute from "./ResearchComputeService.ts";
// @effect-diagnostics-next-line nodeBuiltinImport:off -- Workflow session identifiers are allocated inside synchronous ledger transactions.
import * as NodeCrypto from "node:crypto";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import {
  BranchId,
  CommandId,
  FindingId,
  GateId,
  MessageId,
  ProviderInstanceId,
  ResearchOperationError,
  ResearchProjectId,
  ThreadId,
  WorkflowNodeId,
  type RunId,
  type ApprovalMode,
  type Gate,
  type ResearchBranch,
  type ResearchProject,
} from "@t3tools/contracts";
import { rolePrompt } from "@t3tools/research-agents/prompt";
import { ModelRouter } from "@t3tools/research-agents/modelRouter";
import { roleSchemas, type Role } from "@t3tools/research-agents/roles";
import {
  advanceWorkflow,
  canonicalJson,
  parseWorkflow,
  workflowSource,
  type DefaultWorkflow,
  type WorkflowEvent,
} from "@t3tools/research-core";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as ResearchLedgerService from "./ResearchLedgerService.ts";
import * as ThreadLaunchService from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ManagedProjectFolders from "../project/ManagedProjectFolders.ts";
import * as OrchestrationEventStore from "../persistence/OrchestrationEventStore.ts";

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const clock = yield* Clock.Clock;
  const timestamp = () => DateTime.formatIso(DateTime.makeUnsafe(clock.currentTimeMillisUnsafe()));
  const store = yield* ResearchLedgerService.ResearchLedgerService;
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const launcher = yield* ThreadLaunchService.ThreadLaunchService;
  const folders = yield* ManagedProjectFolders.ManagedProjectFolders;
  const events = yield* OrchestrationEventStore.OrchestrationEventStore;
  const router = new ModelRouter();
  const cache = new Map<string, ReturnType<typeof parseWorkflow>>();
  const compute = yield* Compute.ResearchComputeService;
  const ledger = store.ledger,
    db = store.db;
  db.exec(
    "CREATE TABLE IF NOT EXISTS research_cursor(seq INTEGER NOT NULL); INSERT INTO research_cursor SELECT 0 WHERE NOT EXISTS(SELECT 1 FROM research_cursor)",
  );
  const find = (table: "gates" | "branches" | "findings", id: string) => {
    const row = db.prepare(`SELECT project FROM ${table} WHERE id=?`).get(id);
    if (!row) throw Error("Unknown research entity");
    return ResearchProjectId.make(String(row.project));
  };
  const advance = (id: ResearchProjectId, inputs: readonly WorkflowEvent[]) => {
    const snapshot = ledger.snapshot(id);
    const flow =
      cache.get(id) ??
      parseWorkflow(
        String(
          db.prepare("SELECT source FROM research_workflows WHERE project=?").get(id)?.source ??
            workflowSource(snapshot.project.workflow as DefaultWorkflow),
        ),
      );
    cache.set(id, flow);
    const result = advanceWorkflow(flow, snapshot, inputs);
    const queueControl = (nodeId: WorkflowNodeId, action: string) =>
      db
        .prepare(
          "INSERT INTO research_controls SELECT ?,node,? FROM research_sessions WHERE node=? AND launched=1",
        )
        .run(NodeCrypto.randomUUID(), action, nodeId);
    for (const n of result.nodes) {
      const previous = snapshot.nodes.find((old) => old.id === n.id);
      if (n.status === "pruned" && previous?.status === "running")
        queueControl(n.id, "cancel-node");
      ledger.putNode({
        ...n,
        startedAt: n.startedAt ?? (n.status === "running" ? timestamp() : undefined),
        endedAt:
          n.endedAt ??
          (["done", "pruned", "failed", "skipped"].includes(n.status) ? timestamp() : undefined),
      });
    }
    for (const action of result.actions) {
      switch (action.type) {
        case "pause-node":
        case "resume-node":
        case "cancel-node":
          queueControl(action.nodeId, action.type);
          break;
        case "start-node":
          db.prepare(
            "INSERT OR IGNORE INTO research_sessions(node,project,thread) VALUES(?,?,?)",
          ).run(action.node.id, id, NodeCrypto.randomUUID());
          break;
        case "open-gate":
          ledger.openGate({
            id: action.gateId,
            researchProjectId: id,
            nodeId: action.nodeId,
            kind: action.kind,
            title: snapshot.project.title,
            body: `Review ${action.kind} before continuing.`,
            multiSelect: false,
            options: [
              { id: "proceed", label: "Proceed", recommended: true },
              { id: "stop", label: "Stop", recommended: false },
            ],
            createdAt: timestamp(),
          });
          break;
        case "skip-gate":
          ledger.answerGate(id, action.gateId, "skip", timestamp());
          break;
        case "prune-branch":
        case "promote-rung": {
          const b = snapshot.branches.find((b) => b.id === action.branchId)!;
          if (action.type === "prune-branch") compute.cancelBranch(action.branchId);
          ledger.putBranch(
            action.type === "prune-branch"
              ? { ...b, status: "pruned" }
              : { ...b, status: "promoted", rung: action.rung },
          );
          break;
        }
      }
    }
  };
  const dispatchLock = yield* Semaphore.make(1);
  const launchPending = Effect.fn("ResearchWorkflowService.launchPending")(function* (
    id: ResearchProjectId,
  ) {
    for (const row of db
      .prepare(
        "SELECT c.id,c.action,c.node,s.thread FROM research_controls c JOIN research_sessions s USING(node) WHERE s.project=? ORDER BY c.rowid",
      )
      .all(id)) {
      const snapshot = ledger.snapshot(id),
        threadId = ThreadId.make(String(row.thread));
      const commandId = CommandId.make(String(row.id)),
        projectId = snapshot.project.projectId;
      if (row.action === "resume-node") {
        const gate = snapshot.gates.findLast((g) => g.nodeId === row.node && g.answer);
        const sent = yield* threads.sendToThread({
          projectId,
          threadId,
          commandId,
          messageId: MessageId.make(String(row.id)),
          text:
            "Continue the research step with the recorded gate decision: " +
            canonicalJson(gate?.answer ?? null),
          attachments: [],
          mode: "auto",
          createdBy: "agent",
          creationSource: "mcp",
        });
        db.prepare("INSERT OR REPLACE INTO research_resumed_runs VALUES(?,?)").run(
          threadId,
          sent.run.id,
        );
      } else {
        yield* threads.interruptThread({
          projectId,
          threadId,
          commandId,
          reason: "Research workflow " + String(row.action),
        });
      }
      db.prepare("DELETE FROM research_controls WHERE id=?").run(row.id!);
    }
    for (const row of db
      .prepare(
        "SELECT node,thread FROM research_sessions WHERE project=? AND launched=0 ORDER BY rowid",
      )
      .all(id)) {
      const snapshot = ledger.snapshot(id);
      const node = snapshot.nodes.find((n) => n.id === row.node);
      if (node?.status !== "running") continue;
      const branch =
        snapshot.branches.find((b) => b.id === node.branchId) ??
        (node.agent === "experimenter" ? snapshot.branches[0] : undefined);
      const role = node.agent === "experimenter" ? "debug" : node.agent;
      if (!role || !Object.hasOwn(roleSchemas, role)) throw Error("Unknown workflow agent");
      const author = snapshot.findings.at(-1)?.authorModelFamily ?? "openai";
      const route = router.select(role as Role, author);
      const instructions =
        node.agent === "experimenter"
          ? "Run the frozen experiment in the branch worktree. Submit the job with research_submit_job. The job must log its holdout score, matched baseline, training loss and split evidence through the Python SDK."
          : yield* Effect.tryPromise({
              try: () => rolePrompt(role as Role),
              catch: () => new ResearchOperationError({ operation: "load role prompt" }),
            });
      const threadId = ThreadId.make(String(row.thread));
      db.prepare("INSERT OR REPLACE INTO research_routes VALUES(?,?,?)").run(
        threadId,
        route.family,
        route.model.id,
      );
      const prior =
        branch &&
        db
          .prepare("SELECT workspace FROM research_sessions WHERE thread=?")
          .get(branch.threadId ?? "");
      const existingWorkspace =
        prior?.workspace ??
        (branch?.threadId
          ? (yield* threads.getThreadRecords(branch.threadId, [])).thread.worktreePath
          : null);
      const result = yield* launcher.launch({
        projectId: snapshot.project.projectId,
        commandId: CommandId.make("research-" + threadId),
        threadId,
        title: node.title,
        modelSelection: {
          instanceId: ProviderInstanceId.make(
            { openai: "codex", anthropic: "claudeAgent", google: "antigravity" }[route.family],
          ),
          model: route.model.id,
          ...(route.family !== "google"
            ? { options: [{ id: "effort", value: route.reasoning }] }
            : {}),
        },
        runtimeMode: "approval-required",
        interactionMode: "default",
        workspaceStrategy: existingWorkspace
          ? { type: "existing_worktree", worktreePath: String(existingWorkspace) }
          : branch
            ? {
                type: "worktree",
                baseRef:
                  snapshot.branches.find((b) => b.id === branch.parentBranchId)?.gitBranch ??
                  "HEAD",
                branch: "research/" + branch.id,
              }
            : { type: "root" },
        createdBy: "agent",
        creationSource: "mcp",
        initialMessage: {
          text: `${instructions}\n\nResearch role: ${node.agent}. Goal: ${snapshot.project.goal}. Complete workflow step ${node.key}. Use research_snapshot to read the ledger. Submit experiments via research_submit_job and cite run IDs for every result.`,
          attachments: [],
        },
      });
      yield* store.write(
        "record launch",
        id,
        () => {
          db.prepare("UPDATE research_sessions SET launched=1, workspace=? WHERE node=?").run(
            result.projection.thread.worktreePath,
            node.id,
          );
          if (branch)
            ledger.putBranch({
              ...ledger.snapshot(id).branches.find((b) => b.id === branch.id)!,
              threadId,
              gitBranch: result.projection.thread.branch ?? undefined,
            });
          const project = ledger.snapshot(id).project;
          if (!project.threadId) ledger.putProject({ ...project, threadId });
        },
        !snapshot.project.threadId,
      );
    }
  }, dispatchLock.withPermits(1));
  const startProject = Effect.fn("ResearchWorkflowService.startProject")(function* (input: {
    goal: string;
    workflow: DefaultWorkflow;
    approvalMode: ApprovalMode;
    budget: ResearchProject["budget"];
    title?: string | undefined;
  }) {
    const id = ResearchProjectId.make(NodeCrypto.randomUUID()),
      now = timestamp(),
      title = input.title?.trim() || input.goal.trim().slice(0, 80);
    const folder = yield* folders.createNamedProject({ name: title });
    const workflowPath = path.join(folder.workspaceRoot, "workflows", input.workflow + ".yaml");
    const source = (yield* fs.exists(workflowPath))
      ? yield* fs.readFileString(workflowPath)
      : workflowSource(input.workflow);
    yield* store.write(
      "start project",
      id,
      () => {
        ledger.putProject({
          id,
          projectId: folder.projectId,
          ...input,
          title,
          spent: { usd: 0, gpuHours: 0, llmUsd: 0 },
          createdAt: now,
          updatedAt: now,
        });
        db.prepare("INSERT INTO research_workflows VALUES(?,?)").run(id, source);
        ledger.putBranch({
          id: BranchId.make(NodeCrypto.randomUUID()),
          researchProjectId: id,
          label: "A",
          title,
          kind:
            input.workflow === "prove"
              ? "lean"
              : input.workflow === "hillclimb"
                ? "hillclimb"
                : "experiment",
          budgetGpuHours: input.budget.gpuHours,
          spentGpuHours: 0,
          status: "running",
          rung: "toy",
        });
        advance(id, []);
      },
      true,
    );
    yield* launchPending(id).pipe(Effect.tapError(Effect.logWarning), Effect.ignore);
    return ledger.snapshot(id).project;
  });
  const answer = Effect.fn("ResearchWorkflowService.answer")(function* (
    gateId: GateId,
    response: NonNullable<Gate["answer"]> | "skip",
  ) {
    const gate = yield* store.write(
      "answer gate",
      () => find("gates", gateId),
      () => {
        const id = find("gates", gateId);
        const gate = ledger.answerGate(id, gateId, response, timestamp());
        compute.resolveGate(gateId, response !== "skip" && response.optionIds.includes("proceed"));
        if (gate.nodeId)
          advance(id, [
            {
              type: "gate-answered",
              nodeId: gate.nodeId,
              gateId,
              proceed: response !== "skip" && !response.optionIds.includes("stop"),
            },
          ]);
        return gate;
      },
    );
    yield* launchPending(gate.researchProjectId);
    return gate;
  });
  const finding = Effect.fn("ResearchWorkflowService.reviewFinding")(function* (
    findingId: FindingId,
    status: "approved" | "sent-back" | "rejected",
    note?: string,
  ) {
    return yield* store.write(
      "review finding",
      () => find("findings", findingId),
      () => {
        const id = find("findings", findingId),
          s = ledger.snapshot(id),
          f = s.findings.find((f) => f.id === findingId)!;
        if (
          status === "approved" &&
          (f.status !== "critic-passed" ||
            !f.evidenceRunIds.length ||
            f.evidenceRunIds.some(
              (id) =>
                !s.runs.some(
                  (r) =>
                    r.id === id &&
                    r.status === "finished" &&
                    ["trusted", "preliminary"].includes(r.integrity),
                ),
            ))
        )
          throw Error("Finding lacks checked evidence");
        const updated = { ...f, status };
        ledger.putFinding(updated);
        if (note) ledger.recordCorrection(id, f.id, note, timestamp());
        return updated;
      },
    );
  });
  const branch = Effect.fn("ResearchWorkflowService.branch")(function* (
    branchId: BranchId,
    action: "prune" | "fork",
    text?: string,
  ) {
    const updated = yield* store.write(
      "update branch",
      () => find("branches", branchId),
      () => {
        const id = find("branches", branchId),
          s = ledger.snapshot(id),
          b = s.branches.find((b) => b.id === branchId)!;
        if (action === "fork") {
          const next: ResearchBranch = {
            ...b,
            id: BranchId.make(NodeCrypto.randomUUID()),
            parentBranchId: b.id,
            threadId: undefined,
            gitBranch: undefined,
            status: "running",
            spentGpuHours: 0,
            label: String(s.branches.length + 1),
            title: text ?? b.title,
          };
          ledger.putBranch(next);
          if (next.spec) ledger.putSpec(id, next.id, next.spec, next.spec.frozenAt!);
          const source = s.nodes.findLast((n) => n.branchId === b.id);
          if (source) {
            const node = {
              ...source,
              id: WorkflowNodeId.make(NodeCrypto.randomUUID()),
              parentIds: [source.id],
              branchId: next.id,
              status: "running" as const,
            };
            ledger.putNode(node);
            db.prepare("INSERT INTO research_sessions(node,project,thread) VALUES(?,?,?)").run(
              node.id,
              id,
              NodeCrypto.randomUUID(),
            );
          }
          advance(id, []);
          return next;
        }
        advance(id, [{ type: "branch-pruned", branchId }]);
        if (text) ledger.recordCorrection(id, b.id, text, timestamp());
        return ledger.snapshot(id).branches.find((b) => b.id === branchId)!;
      },
    );
    yield* launchPending(updated.researchProjectId);
    return updated;
  });
  const postMessage = Effect.fn("ResearchWorkflowService.postMessage")(function* (
    id: ResearchProjectId,
    body: string,
    branchId?: BranchId,
  ) {
    const s = ledger.snapshot(id),
      threadId = branchId
        ? s.branches.find((b) => b.id === branchId)?.threadId
        : (() => {
            const active = s.nodes.findLast((n) => n.status === "running");
            const session =
              active &&
              db
                .prepare("SELECT thread FROM research_sessions WHERE node=? AND launched=1")
                .get(active.id);
            return session ? ThreadId.make(String(session.thread)) : s.project.threadId;
          })();
    if (!threadId)
      return yield* new ResearchOperationError({ operation: "locate research thread" });
    const key = NodeCrypto.randomUUID();
    yield* threads.sendToThread({
      threadId,
      projectId: s.project.projectId,
      commandId: CommandId.make(key),
      messageId: MessageId.make(key),
      text: body,
      attachments: [],
      mode: "auto",
      createdBy: "user",
      creationSource: "web",
    });
    yield* store.write("record message", id, () =>
      db
        .prepare("INSERT INTO research_messages VALUES(?,?,?,?,?)")
        .run(key, id, branchId ?? null, body, timestamp()),
    );
  });
  const resolvePendingEdit = Effect.fn("ResearchWorkflowService.resolvePendingEdit")(function* (
    id: ResearchProjectId,
    branchId: BranchId,
    action: "keep" | "undo",
  ) {
    const row = db
      .prepare("SELECT * FROM research_edits WHERE project=? AND branch=?")
      .get(id, branchId);
    if (!row) return yield* new ResearchOperationError({ operation: "no pending workspace edit" });
    if (action === "undo") {
      const threadId = ThreadId.make(String(row.thread));
      const ctx = yield* threads.getThreadProjection(threadId);
      const parent = ctx.checkpoints.find((c) => c.id === row.parent && c.status === "ready");
      if (!parent || ctx.checkpoints.at(-1)?.id !== row.checkpoint)
        return yield* new ResearchOperationError({ operation: "workspace checkpoint changed" });
      yield* threads.dispatch({
        type: "checkpoint.rollback",
        threadId,
        scopeId: parent.scopeId,
        checkpointId: parent.id,
        commandId: CommandId.make("research-undo-" + row.checkpoint),
        restoreFiles: true,
      });
    }
    yield* store.write("resolve edit", id, () =>
      db
        .prepare("DELETE FROM research_edits WHERE branch=? AND checkpoint=?")
        .run(branchId, String(row.checkpoint)),
    );
  });
  const finishTurn = Effect.fn("ResearchWorkflowService.finishTurn")(function* (
    threadId: ThreadId,
    failed: boolean,
    sequence?: number,
    runId?: RunId,
  ) {
    const row = db
      .prepare("SELECT project,node FROM research_sessions WHERE thread=?")
      .get(threadId);
    if (!row) return;
    const id = ResearchProjectId.make(String(row.project));
    const summary = runId
      ? (yield* threads.getThreadRecords(threadId, ["messages"])).messages.findLast(
          (m) => m.runId === runId && m.role === "assistant" && !m.streaming,
        )?.text
      : undefined;
    yield* store.write("advance workflow", id, () => {
      const nodeId = WorkflowNodeId.make(String(row.node));
      if (summary) {
        const node = ledger.snapshot(id).nodes.find((n) => n.id === nodeId);
        if (node) ledger.putNode({ ...node, summary: summary.slice(0, 4096) });
      }
      if (ledger.snapshot(id).runs.some((r) => r.nodeId === nodeId && !r.endedAt))
        db.prepare("INSERT OR REPLACE INTO research_finished_turns VALUES(?,?)").run(
          nodeId,
          Number(failed),
        );
      else {
        db.prepare("DELETE FROM research_finished_turns WHERE node=?").run(nodeId);
        advance(id, [{ type: "node-finished", nodeId, failed }]);
      }
      if (sequence !== undefined) db.prepare("UPDATE research_cursor SET seq=?").run(sequence);
    });
    yield* launchPending(id);
  });
  const retryPending = Effect.fn("ResearchWorkflowService.retryPending")(function* () {
    const rows = db
      .prepare(`SELECT project FROM research_sessions s WHERE launched=0 AND EXISTS(SELECT 1 FROM workflow_nodes n WHERE n.id=s.node AND json_extract(n.payload,'$.status')='running')
      UNION SELECT project FROM research_controls JOIN research_sessions USING(node)`)
      .all();
    for (const row of rows)
      yield* launchPending(ResearchProjectId.make(String(row.project))).pipe(
        Effect.tapError(Effect.logWarning),
        Effect.ignore,
      );
  });
  const follow = Effect.gen(function* () {
    if (!db.prepare("SELECT 1 FROM research_sessions LIMIT 1").get()) {
      const latest = yield* events.latestApplicationSequence;
      db.prepare("UPDATE research_cursor SET seq=max(seq,?)").run(latest);
    }
    yield* retryPending();
    yield* store.changes.pipe(
      Stream.runForEach(() =>
        Effect.gen(function* () {
          for (const row of db
            .prepare("SELECT DISTINCT project,branch FROM research_rungs WHERE applied=0")
            .all()) {
            const id = ResearchProjectId.make(String(row.project)),
              branchId = BranchId.make(String(row.branch));
            yield* store.write("evaluate rung", id, () => {
              const results = db
                .prepare("SELECT rung,lower FROM research_rungs WHERE branch=? ORDER BY rowid")
                .all(branchId)
                .map((r) => ({
                  rung: r.rung as ResearchBranch["rung"],
                  lowerGain95: Number(r.lower),
                  integrity: "trusted" as const,
                }));
              advance(id, [{ type: "evaluate-rung", branchId, results }]);
              db.prepare("UPDATE research_rungs SET applied=1 WHERE branch=?").run(branchId);
            });
          }
          for (const row of db
            .prepare(
              "SELECT thread,failed FROM research_finished_turns JOIN research_sessions USING(node) WHERE NOT EXISTS(SELECT 1 FROM runs r WHERE r.node=research_finished_turns.node AND json_extract(r.payload,'$.endedAt') IS NULL)",
            )
            .all()) {
            yield* finishTurn(ThreadId.make(String(row.thread)), Boolean(row.failed));
          }
        }),
      ),
      Effect.forkScoped,
    );
    const cursor = Number(db.prepare("SELECT seq FROM research_cursor").get()!.seq);
    yield* events
      .streamProjectedApplicationEvents({
        afterSequence: cursor,
        project: (e) => e,
        filter: (e) =>
          "event" in e &&
          (e.event.type === "run.updated" || e.event.type === "checkpoint.captured"),
      })
      .pipe(
        Stream.runForEach((stored) =>
          Effect.gen(function* () {
            if (!("event" in stored)) return;
            if (stored.event.type === "checkpoint.captured") {
              const c = stored.event.payload;
              if (c.parentCheckpointId && c.status === "ready" && c.files.length) {
                const row = db
                  .prepare(
                    "SELECT n.branch,n.project FROM workflow_nodes n JOIN research_sessions s ON n.id=s.node WHERE s.thread=? AND n.branch IS NOT NULL",
                  )
                  .get(c.threadId);
                if (row)
                  yield* store.write(
                    "record workspace edit",
                    ResearchProjectId.make(String(row.project)),
                    () => {
                      const summary = {
                        checkpointId: c.id,
                        filesChanged: c.filesTotal?.count ?? c.files.length,
                        additions:
                          c.filesTotal?.additions ?? c.files.reduce((n, f) => n + f.additions, 0),
                        deletions:
                          c.filesTotal?.deletions ?? c.files.reduce((n, f) => n + f.deletions, 0),
                        summary: c.files.map((f) => f.path).join(", "),
                      };
                      db.prepare("INSERT OR REPLACE INTO research_edits VALUES(?,?,?,?,?,?)").run(
                        row.branch!,
                        row.project!,
                        c.threadId,
                        c.id,
                        c.parentCheckpointId!,
                        JSON.stringify(summary),
                      );
                      db.prepare("UPDATE research_cursor SET seq=?").run(stored.sequence);
                    },
                  );
              }
              db.prepare("UPDATE research_cursor SET seq=?").run(stored.sequence);
              return;
            }
            if (stored.event.type !== "run.updated") return;
            const run = stored.event.payload;
            if (
              !["completed", "failed", "interrupted", "cancelled", "rolled_back"].includes(
                run.status,
              )
            )
              return;
            const resumed = db
              .prepare("SELECT run FROM research_resumed_runs WHERE thread=?")
              .get(run.threadId);
            if (resumed ? run.id === resumed.run : run.ordinal === 1)
              yield* finishTurn(run.threadId, run.status !== "completed", stored.sequence, run.id);
            db.prepare("UPDATE research_cursor SET seq=?").run(stored.sequence);
          }),
        ),
      );
  });
  return {
    startProject,
    answer,
    finding,
    branch,
    postMessage,
    resolvePendingEdit,
    finishTurn,
    follow,
    retryPending,
  };
});
export class ResearchWorkflowService extends Context.Service<
  ResearchWorkflowService,
  Effect.Success<typeof make>
>()("t3/research/ResearchWorkflowService") {}
export const layer = Layer.effect(ResearchWorkflowService, make);
