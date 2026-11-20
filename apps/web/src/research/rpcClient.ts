import { useAtomValue } from "@effect/atom-react";
import { WS_METHODS, type EnvironmentId, type ResearchSnapshot } from "@t3tools/contracts";
import type {
  EnvironmentUnaryRpcTag,
  EnvironmentRpcInput,
  EnvironmentSubscriptionRpcTag,
  EnvironmentRpcStreamValue,
} from "@t3tools/client-runtime/rpc";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcSubscriptionAtomFamily,
  runAtomCommand,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { connectionAtomRuntime } from "../connection/runtime";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { primaryEnvironmentIdAtom } from "../state/primaryEnvironment";
import type { BranchLiveTelemetry, ResearchClient, ResearchWorkspaceSnapshot } from "./client";

function command<Tag extends EnvironmentUnaryRpcTag>(tag: Tag) {
  const cmd = createEnvironmentRpcCommand(connectionAtomRuntime, { label: tag, tag });
  const run = async (input: EnvironmentRpcInput<Tag>) => {
    const environmentId = appAtomRegistry.get(primaryEnvironmentIdAtom);
    if (!environmentId) throw Error("Research environment unavailable.");
    const result = await runAtomCommand(appAtomRegistry, cmd, { environmentId, input });
    if (result._tag === "Failure") throw squashAtomCommandFailure(result);
    return result.value;
  };
  return Object.assign(run, { permissionAtom: cmd.permissionAtom });
}
function subscription<Tag extends EnvironmentSubscriptionRpcTag>(tag: Tag) {
  const family = createEnvironmentRpcSubscriptionAtomFamily(connectionAtomRuntime, {
    label: tag,
    tag,
    idleTtlMs: 0,
  });
  return (
    input: EnvironmentRpcInput<Tag>,
    onValue: (v: EnvironmentRpcStreamValue<Tag>) => void,
  ) => {
    let detach: (() => void) | undefined;
    const stop = appAtomRegistry.subscribe(
      primaryEnvironmentIdAtom,
      (environmentId: EnvironmentId | null) => {
        detach?.();
        if (!environmentId) return;
        detach = appAtomRegistry.subscribe(
          family({ environmentId, input }),
          (state) => {
            if (state._tag === "Success") onValue(state.value);
          },
          { immediate: true },
        );
      },
      { immediate: true },
    );
    return () => {
      stop();
      detach?.();
    };
  };
}
function workspace(s: ResearchSnapshot): ResearchWorkspaceSnapshot {
  const branchLiveTelemetry: Record<string, BranchLiveTelemetry> = {};
  for (const job of s.jobs) {
    if (
      job.state !== "running" ||
      job.step === undefined ||
      job.totalSteps === undefined ||
      job.etaMinutes === undefined
    )
      continue;
    const run = s.runs.find((r) => r.id === job.runId);
    const spec = s.branches.find((b) => b.id === run?.branchId)?.spec;
    if (!run || !spec || run.seed === undefined) continue;
    branchLiveTelemetry[run.branchId] = {
      step: job.step,
      totalSteps: job.totalSteps,
      etaMinutes: job.etaMinutes,
      seedIndex: job.seedIndex ?? spec.seeds.indexOf(run.seed) + 1,
      totalSeeds: job.totalSeeds ?? spec.seeds.length,
      gpus: job.gpus ?? spec.resources.gpus,
      runIndex: run.number,
      elapsedLabel: "",
    };
  }
  const threadEvents: ResearchWorkspaceSnapshot["threadEvents"][number][] = (s.messages ?? []).map(
    (m) => ({ id: m.id, kind: "user-message", text: m.body, createdAt: m.createdAt }),
  );
  for (const node of s.nodes) {
    const createdAt = node.endedAt ?? node.startedAt;
    if (node.summary && createdAt)
      threadEvents.push({ id: node.id, kind: "agent-message", text: node.summary, createdAt });
  }
  for (const run of s.runs) {
    const branch = s.branches.find((b) => b.id === run.branchId);
    if (branch?.spec)
      threadEvents.push({
        id: run.id,
        kind: "command-run",
        command: branch.spec.command,
        createdAt: run.createdAt,
        runId: run.id,
        durationLabel: "",
      });
  }
  threadEvents.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return {
    ...s,
    workedDurationLabel: "",
    threadEvents,
    horizonSummary: [],
    branchLiveTelemetry,
    branchWorkspaces: {},
    venueChecklist: [],
    workflowYaml: s.workflowYaml ?? "",
  };
}
const methods = WS_METHODS;
const listProjects = command(methods.researchListProjects),
  listBackends = command(methods.researchListBackends);
const snapshot = command(methods.researchGetSnapshot),
  streamSnapshot = subscription(methods.researchSubscribeSnapshot),
  projects = subscription(methods.researchSubscribeProjects);
const report = command(methods.researchGetReportHtml),
  start = command(methods.researchStartProject),
  answer = command(methods.researchAnswerGate),
  skip = command(methods.researchSkipGate);
const approve = command(methods.researchApproveFinding),
  sendBack = command(methods.researchSendBackFinding),
  reject = command(methods.researchRejectFinding);
const prune = command(methods.researchPruneBranch),
  fork = command(methods.researchForkBranch),
  message = command(methods.researchPostMessage),
  edit = command(methods.researchResolvePendingEdit);

export function useCanOperateResearch() {
  const environmentId = useAtomValue(primaryEnvironmentIdAtom);
  return useAtomValue(start.permissionAtom(environmentId));
}

export class RpcResearchClient implements ResearchClient {
  listProjects = () => listProjects({});
  listBackends = () => listBackends({});
  getSnapshot: ResearchClient["getSnapshot"] = async (researchProjectId) =>
    workspace(await snapshot({ researchProjectId }));
  subscribe: ResearchClient["subscribe"] = (researchProjectId, fn) =>
    streamSnapshot({ researchProjectId }, (s) => fn(workspace(s)));
  subscribeProjects: ResearchClient["subscribeProjects"] = (fn) => projects({}, fn);
  getReportHtml: ResearchClient["getReportHtml"] = (researchProjectId) =>
    report({ researchProjectId });
  startProject: ResearchClient["startProject"] = async (
    goal,
    name,
    approvalMode,
    budget,
    title,
  ) => {
    const workflow = name.replace(/\.yaml$/, "");
    if (
      workflow !== "hillclimb" &&
      workflow !== "research" &&
      workflow !== "survey" &&
      workflow !== "prove" &&
      workflow !== "reproduce"
    )
      throw Error("Unknown research workflow");
    return start({ goal, workflow, approvalMode, budget, title });
  };
  answerGate: ResearchClient["answerGate"] = (gateId, optionIds, note) =>
    answer({ gateId, optionIds, note });
  skipGate: ResearchClient["skipGate"] = (gateId) => skip({ gateId });
  approveFinding: ResearchClient["approveFinding"] = (findingId, note) =>
    approve({ findingId, note });
  sendBack: ResearchClient["sendBack"] = (findingId, note) => sendBack({ findingId, note });
  reject: ResearchClient["reject"] = (findingId, note) => reject({ findingId, note });
  pruneBranch: ResearchClient["pruneBranch"] = (branchId, reason) => prune({ branchId, reason });
  forkBranch: ResearchClient["forkBranch"] = (branchId, title) => fork({ branchId, title });
  postMessage: ResearchClient["postMessage"] = (researchProjectId, body, branchId) =>
    message({ researchProjectId, body, branchId });
  resolvePendingEdit: ResearchClient["resolvePendingEdit"] = (
    researchProjectId,
    branchId,
    action,
  ) => edit({ researchProjectId, branchId, action });
}
