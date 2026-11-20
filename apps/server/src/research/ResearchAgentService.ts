import { validateFindingEvidence } from "@t3tools/research-agents/roleValidation";
import { Paper, mergePapers } from "@t3tools/research-agents/papers";
import {
  ExperimentSpec,
  Finding,
  FindingId,
  Gate,
  GateId,
  ResearchOperationError,
  ResearchProjectId,
  type ResearchRunId,
  type ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as DateTime from "effect/DateTime";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { randomUuidV4 } from "@t3tools/provider-core/server/randomUuid";
import { ThreadManagementService } from "../orchestration-v2/ThreadManagementService.ts";
import * as ResearchLedgerService from "./ResearchLedgerService.ts";
import * as ResearchComputeService from "./ResearchComputeService.ts";

export const FindingDraft = Schema.Struct({
  preliminary: Schema.optional(Schema.Boolean),
  label: Finding.fields.label,
  claim: Finding.fields.claim,
  evidenceRunIds: Finding.fields.evidenceRunIds,
  scope: Finding.fields.scope,
  caveats: Finding.fields.caveats,
  ciMetricRefs: Finding.fields.ciMetricRefs,
});
export const DecisionQuestion = Schema.Struct({
  title: Gate.fields.title,
  body: Gate.fields.body,
  options: Gate.fields.options,
  multiSelect: Gate.fields.multiSelect,
});
export const JobRequest = Schema.Struct({
  spec: ExperimentSpec,
  seed: Schema.Int,
  change: Schema.String,
});
const decodeFamily = Schema.decodeUnknownEffect(Schema.Literals(["openai", "anthropic", "google"]));
const make = Effect.gen(function* () {
  const store = yield* ResearchLedgerService.ResearchLedgerService;
  const threads = yield* ThreadManagementService;
  const compute = yield* ResearchComputeService.ResearchComputeService;
  const context = Effect.fn("ResearchAgentService.context")(function* (thread: ThreadId) {
    const row = store.db
      .prepare(
        "SELECT node,project,workspace,model,family FROM research_sessions JOIN research_routes USING(thread) WHERE thread=?",
      )
      .get(thread);
    if (!row) return yield* new ResearchOperationError({ operation: "identify research thread" });
    const project = ResearchProjectId.make(String(row.project)),
      snapshot = store.snapshot(project);
    const node = snapshot.nodes.find((n) => n.id === row.node);
    if (!node || node.status !== "running")
      return yield* new ResearchOperationError({ operation: "resolve active research node" });
    const family = yield* decodeFamily(row.family).pipe(
      Effect.mapError(() => new ResearchOperationError({ operation: "read model route" })),
    );
    return { snapshot, node, workspace: row.workspace, project, family, model: String(row.model) };
  });
  const snapshot = Effect.fn("ResearchAgentService.snapshot")(function* (thread: ThreadId) {
    const ctx = yield* context(thread);
    return { ...ctx.snapshot, backends: compute.descriptions() };
  });
  const metrics = Effect.fn("ResearchAgentService.metrics")(function* (
    thread: ThreadId,
    id: ResearchRunId,
    name?: string,
  ) {
    const ctx = yield* context(thread);
    if (!ctx.snapshot.runs.some((r) => r.id === id))
      return yield* new ResearchOperationError({ operation: "read run metrics" });
    return store.ledger.metricSeries(id, name);
  });
  const finding = Effect.fn("ResearchAgentService.finding")(function* (
    thread: ThreadId,
    draft: typeof FindingDraft.Type,
  ) {
    const ctx = yield* context(thread),
      id = FindingId.make(yield* randomUuidV4);
    return yield* store.write("log finding", ctx.project, () => {
      if (
        !draft.evidenceRunIds.length ||
        !draft.evidenceRunIds.every((id) =>
          ctx.snapshot.runs.some(
            (r) =>
              r.id === id &&
              r.status === "finished" &&
              ["preliminary", "trusted"].includes(r.integrity),
          ),
        )
      )
        throw Error("Unverified evidence");
      validateFindingEvidence(
        {
          ...draft,
          preliminary: draft.preliminary ?? true,
          confidenceInterval: draft.ciMetricRefs,
        },
        ctx.snapshot.runs,
        ctx.snapshot.metrics,
      );
      const record: Finding = {
        ...draft,
        id,
        researchProjectId: ctx.project,
        preliminary: draft.preliminary ?? true,
        authorModelFamily: ctx.family,
        status: "draft",
        critic: [],
      };
      store.ledger.putFinding(record);
      return record;
    });
  });
  const question = Effect.fn("ResearchAgentService.question")(function* (
    thread: ThreadId,
    draft: typeof DecisionQuestion.Type,
  ) {
    const ctx = yield* context(thread),
      id = GateId.make(yield* randomUuidV4),
      createdAt = DateTime.formatIso(yield* DateTime.now);
    return yield* store.write("open question", ctx.project, () => {
      store.ledger.putNode({ ...ctx.node, status: "waiting-question" });
      return store.ledger.openGate({
        ...draft,
        id,
        researchProjectId: ctx.project,
        nodeId: ctx.node.id,
        kind: "question",
        createdAt,
      });
    });
  });
  const submit = Effect.fn("ResearchAgentService.submit")(function* (
    thread: ThreadId,
    input: typeof JobRequest.Type,
  ) {
    const ctx = yield* context(thread);
    const branchId = ctx.node.branchId ?? ctx.snapshot.branches[0]?.id;
    if (ctx.node.agent !== "experimenter" || !branchId)
      return yield* new ResearchOperationError({ operation: "resolve experiment workspace" });
    let workspace = ctx.workspace;
    if (typeof workspace !== "string") {
      const prepared = (yield* threads.getThreadRecords(thread, [])).thread;
      if (!prepared.worktreePath)
        return yield* new ResearchOperationError({ operation: "wait for research worktree" });
      workspace = prepared.worktreePath;
      yield* store.write("record prepared worktree", ctx.project, () => {
        store.db
          .prepare("UPDATE research_sessions SET workspace=? WHERE thread=?")
          .run(prepared.worktreePath, thread);
        const b = store.ledger.snapshot(ctx.project).branches.find((b) => b.id === branchId);
        if (b?.threadId === thread && prepared.branch)
          store.ledger.putBranch({ ...b, gitBranch: prepared.branch });
      });
    }
    return yield* compute.submit(
      ctx.project,
      branchId,
      workspace,
      input.spec,
      input.seed,
      input.change,
      ctx.node.id,
    );
  });
  const critique = Effect.fn("ResearchAgentService.critique")(function* (
    thread: ThreadId,
    id: FindingId,
    critic: Finding["critic"],
  ) {
    const ctx = yield* context(thread);
    return yield* store.write("review evidence", ctx.project, () => {
      const f = ctx.snapshot.findings.find((f) => f.id === id);
      if (
        !f ||
        !f.authorModelFamily ||
        ctx.node.agent !== "critic" ||
        ctx.family === f.authorModelFamily ||
        !critic.length
      )
        throw Error("Independent critic required");
      const reviewed: Finding = {
        ...f,
        critic,
        criticModel: ctx.model,
        status: critic.some((c) => c.landed) ? "critic-broken" : "critic-passed",
      };
      store.ledger.putFinding(reviewed);
      return reviewed;
    });
  });
  const papers = Effect.fn("ResearchAgentService.papers")(function* (
    thread: ThreadId,
    papers: readonly Paper[],
  ) {
    const ctx = yield* context(thread);
    yield* store.write("record literature", ctx.project, () => {
      const merged = mergePapers([...(ctx.snapshot.literature ?? []), ...papers]);
      store.db.prepare("DELETE FROM research_papers WHERE project=?").run(ctx.project);
      for (const paper of merged)
        store.db
          .prepare("INSERT INTO research_papers VALUES(?,?,?)")
          .run(ctx.project, paper.id, JSON.stringify(paper));
    });
  });
  return { snapshot, metrics, question, finding, submit, critique, papers };
});
export class ResearchAgentService extends Context.Service<
  ResearchAgentService,
  Effect.Success<typeof make>
>()("t3/research/ResearchAgentService") {}
export const layer = Layer.effect(ResearchAgentService, make);
