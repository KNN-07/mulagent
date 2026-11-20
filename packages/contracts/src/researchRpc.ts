import * as S from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as R from "./research.ts";
import { EnvironmentAuthorizationError } from "./auth.ts";
export class ResearchOperationError extends S.TaggedError<ResearchOperationError>()(
  "ResearchOperationError",
  { operation: S.String },
) {
  override get message() {
    return `Research operation failed (${this.operation}).`;
  }
}
const error = S.Union([ResearchOperationError, EnvironmentAuthorizationError]);
const optionalText = S.optional(S.String);
export const RESEARCH_METHODS = {
  researchListProjects: "research.listProjects",
  researchListBackends: "research.listBackends",
  researchGetSnapshot: "research.getSnapshot",
  researchSubscribeSnapshot: "research.subscribeSnapshot",
  researchSubscribeProjects: "research.subscribeProjects",
  researchGetReportHtml: "research.getReportHtml",
  researchStartProject: "research.startProject",
  researchAnswerGate: "research.answerGate",
  researchSkipGate: "research.skipGate",
  researchApproveFinding: "research.approveFinding",
  researchSendBackFinding: "research.sendBackFinding",
  researchRejectFinding: "research.rejectFinding",
  researchPruneBranch: "research.pruneBranch",
  researchForkBranch: "research.forkBranch",
  researchPostMessage: "research.postMessage",
  researchResolvePendingEdit: "research.resolvePendingEdit",
} as const;
export const researchRpcs = [
  Rpc.make(RESEARCH_METHODS.researchListProjects, {
    payload: S.Struct({}),
    success: S.Array(R.ResearchProject),
    error,
  }),
  Rpc.make(RESEARCH_METHODS.researchListBackends, {
    payload: S.Struct({}),
    success: S.Array(R.BackendDescription),
    error,
  }),
  Rpc.make(RESEARCH_METHODS.researchGetSnapshot, {
    payload: S.Struct({ researchProjectId: R.ResearchProjectId }),
    success: R.ResearchSnapshot,
    error,
  }),
  Rpc.make(RESEARCH_METHODS.researchSubscribeSnapshot, {
    payload: S.Struct({ researchProjectId: R.ResearchProjectId }),
    success: R.ResearchSnapshot,
    error,
    stream: true,
  }),
  Rpc.make(RESEARCH_METHODS.researchSubscribeProjects, {
    payload: S.Struct({}),
    success: S.Array(R.ResearchProject),
    error,
    stream: true,
  }),
  Rpc.make(RESEARCH_METHODS.researchGetReportHtml, {
    payload: S.Struct({ researchProjectId: R.ResearchProjectId }),
    success: S.String,
    error,
  }),
  Rpc.make(RESEARCH_METHODS.researchStartProject, {
    payload: S.Struct({
      goal: S.NonEmptyString,
      title: optionalText,
      workflow: S.Literals(["hillclimb", "research", "survey", "reproduce", "prove"]),
      approvalMode: R.ApprovalMode,
      budget: R.ResearchProject.fields.budget,
    }),
    success: R.ResearchProject,
    error,
  }),
  Rpc.make(RESEARCH_METHODS.researchAnswerGate, {
    payload: S.Struct({ gateId: R.GateId, optionIds: S.Array(S.String), note: optionalText }),
    success: R.Gate,
    error,
  }),
  Rpc.make(RESEARCH_METHODS.researchSkipGate, {
    payload: S.Struct({ gateId: R.GateId }),
    success: R.Gate,
    error,
  }),
  Rpc.make(RESEARCH_METHODS.researchApproveFinding, {
    payload: S.Struct({ findingId: R.FindingId, note: optionalText }),
    success: R.Finding,
    error,
  }),
  Rpc.make(RESEARCH_METHODS.researchSendBackFinding, {
    payload: S.Struct({ findingId: R.FindingId, note: optionalText }),
    success: R.Finding,
    error,
  }),
  Rpc.make(RESEARCH_METHODS.researchRejectFinding, {
    payload: S.Struct({ findingId: R.FindingId, note: optionalText }),
    success: R.Finding,
    error,
  }),
  Rpc.make(RESEARCH_METHODS.researchPruneBranch, {
    payload: S.Struct({ branchId: R.BranchId, reason: optionalText }),
    success: R.ResearchBranch,
    error,
  }),
  Rpc.make(RESEARCH_METHODS.researchForkBranch, {
    payload: S.Struct({ branchId: R.BranchId, title: optionalText }),
    success: R.ResearchBranch,
    error,
  }),
  Rpc.make(RESEARCH_METHODS.researchPostMessage, {
    payload: S.Struct({
      researchProjectId: R.ResearchProjectId,
      body: S.NonEmptyString,
      branchId: S.optional(R.BranchId),
    }),
    success: S.Void,
    error,
  }),
  Rpc.make(RESEARCH_METHODS.researchResolvePendingEdit, {
    payload: S.Struct({
      researchProjectId: R.ResearchProjectId,
      branchId: R.BranchId,
      action: S.Literals(["keep", "undo"]),
    }),
    success: S.Void,
    error,
  }),
] as const;
