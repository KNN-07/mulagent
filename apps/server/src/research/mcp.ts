import { Paper } from "@t3tools/research-agents/papers";
import {
  Finding,
  FindingId,
  Gate,
  ResearchRunId,
  RunMetric,
  ResearchSnapshot,
  OrchestratorMcpFailure,
} from "@t3tools/contracts";
import { Tool, Toolkit, McpSchema } from "effect/ai";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Access from "../mcp/McpToolAccess.ts";
import * as Invocation from "../mcp/McpInvocationContext.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as Agent from "./ResearchAgentService.ts";
const base = {
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  dependencies: [
    Invocation.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    Agent.ResearchAgentService,
  ],
};
export const toolkit = Toolkit.make(
  Tool.make("research_snapshot", {
    ...base,
    description: "Read the ledger for the current research thread.",
    parameters: Schema.Record(Schema.String, Schema.Never),
    success: ResearchSnapshot,
  })
    .annotate(Tool.Readonly, true)
    .annotate(McpSchema.EnabledWhen, Invocation.hiddenFromOutsideClients),
  Tool.make("research_metrics", {
    ...base,
    description: "Read job-reported metric values for one run in this research project.",
    parameters: Schema.Struct({ runId: ResearchRunId, name: Schema.optional(Schema.String) }),
    success: Schema.Array(RunMetric),
  })
    .annotate(Tool.Readonly, true)
    .annotate(McpSchema.EnabledWhen, Invocation.hiddenFromOutsideClients),
  Tool.make("research_log_finding", {
    ...base,
    description:
      "Record a draft finding citing checked runs. Reference ledger metrics in the claim.",
    parameters: Agent.FindingDraft,
    success: Finding,
  }).annotate(McpSchema.EnabledWhen, Invocation.hiddenFromOutsideClients),
  Tool.make("research_open_question", {
    ...base,
    description: "Request a human decision about this workflow step.",
    parameters: Agent.DecisionQuestion,
    success: Gate,
  }).annotate(McpSchema.EnabledWhen, Invocation.hiddenFromOutsideClients),
  Tool.make("research_critique", {
    ...base,
    description: "Record an independent critic's attacks on a finding.",
    parameters: Schema.Struct({ findingId: FindingId, critic: Finding.fields.critic }),
    success: Finding,
  }).annotate(McpSchema.EnabledWhen, Invocation.hiddenFromOutsideClients),
  Tool.make("research_record_papers", {
    ...base,
    description: "Save paper metadata and BibTeX entries for this project.",
    parameters: Schema.Struct({ papers: Schema.Array(Paper) }),
    success: Schema.Void,
  }).annotate(McpSchema.EnabledWhen, Invocation.hiddenFromOutsideClients),
  Tool.make("research_submit_job", {
    ...base,
    description:
      "Stage this experiment branch's workspace and queue the frozen command. Log results with the Python SDK.",
    parameters: Agent.JobRequest,
    success: ResearchRunId,
  }).annotate(McpSchema.EnabledWhen, Invocation.hiddenFromOutsideClients),
);
const caller = Effect.gen(function* () {
  const scope = yield* Invocation.McpInvocationContext;
  return (yield* Invocation.requireThreadScope(scope, "Research")).thread.threadId;
});
const failure = () =>
  new OrchestratorMcpFailure({
    code: "invalid_request",
    message: "Research operation unavailable for this thread or run.",
  });
export const handlers = Access.toLayer(
  toolkit,
  Effect.gen(function* () {
    const agent = yield* Agent.ResearchAgentService;
    return {
      research_snapshot: Access.readsAsCaller(() =>
        caller.pipe(Effect.flatMap(agent.snapshot), Effect.mapError(failure)),
      ),
      research_metrics: Access.readsAsCaller((i) =>
        caller.pipe(
          Effect.flatMap((t) => agent.metrics(t, i.runId, i.name)),
          Effect.mapError(failure),
        ),
      ),
      research_log_finding: Access.actsAsCaller((i) =>
        caller.pipe(
          Effect.flatMap((t) => agent.finding(t, i)),
          Effect.mapError(failure),
        ),
      ),
      research_open_question: Access.actsAsCaller((i) =>
        caller.pipe(
          Effect.flatMap((t) => agent.question(t, i)),
          Effect.mapError(failure),
        ),
      ),
      research_critique: Access.actsAsCaller((i) =>
        caller.pipe(
          Effect.flatMap((t) => agent.critique(t, i.findingId, i.critic)),
          Effect.mapError(failure),
        ),
      ),
      research_record_papers: Access.actsAsCaller((i) =>
        caller.pipe(
          Effect.flatMap((t) => agent.papers(t, i.papers)),
          Effect.mapError(failure),
        ),
      ),
      research_submit_job: Access.actsAsCaller((i) =>
        caller.pipe(
          Effect.flatMap((t) => agent.submit(t, i)),
          Effect.mapError(failure),
        ),
      ),
    } satisfies Access.Handlers<typeof toolkit.tools>;
  }),
);
