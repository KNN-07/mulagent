// @effect-diagnostics-next-line nodeBuiltinImport:off -- Read bundled YAML before entering the synchronous state machine.
import { readFileSync } from "node:fs";
import { parse } from "yaml";
import * as S from "effect/Schema";
import {
  GateKind,
  GateId,
  NodeKind,
  WorkflowNodeId,
  type BranchId,
  type Gate,
  type ResearchSnapshot,
  type WorkflowNode,
} from "@t3tools/contracts";
import { exceedsGpuBudget, needsApproval } from "./gates.ts";
import { evaluateLadder, type KillRule, type RungResult } from "./ladder.ts";

const nonempty = S.String.check(S.isMinLength(1));
const nodeDefinition = S.Struct({
  agent: nonempty,
  needs: S.optional(S.Array(nonempty)),
  gate: S.optional(GateKind),
  mode: S.optional(S.Literals(["fanout", "tournament", "join"])),
  k: S.optional(S.Int),
  budget_hours: S.optional(S.Number),
  out: S.optional(nonempty),
  kind: S.optional(NodeKind),
});
const fileSchema = S.Struct({ name: nonempty, nodes: S.Record(nonempty, nodeDefinition) });
export type Workflow = typeof fileSchema.Type & { readonly order: readonly string[] };
export function parseWorkflow(source: string): Workflow {
  const flow = S.decodeUnknownSync(fileSchema, { onExcessProperty: "error" })(parse(source));
  const ordered = new Map<string, typeof nodeDefinition.Type>();
  const visiting = new Set<string>();
  function visit(key: string) {
    if (ordered.has(key)) return;
    if (visiting.has(key)) throw new Error("Workflow cycle at " + key);
    if (!Object.hasOwn(flow.nodes, key)) throw new Error("Unknown dependency " + key);
    const node = flow.nodes[key]!;
    visiting.add(key);
    const needs = node.needs ?? [];
    if (new Set(needs).size !== needs.length) throw new Error("Duplicate dependency on " + key);
    if (node.k !== undefined && (node.mode !== "join" || node.k < 1 || !needs.length))
      throw new Error("Invalid join threshold on " + key);
    if (
      node.budget_hours !== undefined &&
      (!Number.isFinite(node.budget_hours) || node.budget_hours < 0)
    )
      throw new Error("Invalid GPU-hour budget");
    needs.forEach(visit);
    ordered.set(key, node);
    visiting.delete(key);
  }
  if (!Object.keys(flow.nodes).length) throw new Error("Workflow is empty");
  Object.keys(flow.nodes).forEach(visit);
  return { ...flow, order: [...ordered.keys()] };
}

export type DefaultWorkflow = "research" | "survey" | "prove" | "hillclimb" | "reproduce";
export function loadWorkflow(name: DefaultWorkflow) {
  return parseWorkflow(readFileSync(new URL(`../workflows/${name}.yaml`, import.meta.url), "utf8"));
}

export type WorkflowEvent =
  | { type: "node-finished"; nodeId: WorkflowNodeId; failed?: boolean }
  | { type: "gate-answered"; nodeId: WorkflowNodeId; gateId: GateId; proceed: boolean }
  | { type: "budget-exceeded"; nodeId: WorkflowNodeId; gpuHours: number }
  | { type: "branch-pruned"; branchId: BranchId }
  | { type: "edit-node"; nodeId: WorkflowNodeId }
  | { type: "loop-back"; nodeId: WorkflowNodeId; fromNodeId: WorkflowNodeId }
  | { type: "evaluate-rung"; branchId: BranchId; results: readonly RungResult[]; rule?: KillRule };

export type WorkflowAction =
  | {
      type: "start-node";
      node: WorkflowNode;
      agent: string;
      mode?: "fanout" | "tournament" | "join";
      out?: string;
    }
  | { type: "cancel-node"; nodeId: WorkflowNodeId }
  | { type: "skip-gate"; gateId: GateId }
  | { type: "resume-node"; nodeId: WorkflowNodeId }
  | { type: "pause-node"; nodeId: WorkflowNodeId }
  | { type: "open-gate"; nodeId: WorkflowNodeId; gateId: GateId; kind: Gate["kind"] }
  | { type: "prune-branch"; branchId: BranchId; reason: string }
  | { type: "promote-rung"; branchId: BranchId; rung: "small" | "target" };

const instanceKey = (key: string, branch?: BranchId) => JSON.stringify([key, branch ?? null]);

export function advanceWorkflow(
  flow: Workflow,
  snapshot: ResearchSnapshot,
  events: readonly WorkflowEvent[] = [],
  gpuThreshold = 20,
) {
  const project = snapshot.project;
  const latest = new Map<string, WorkflowNode>();
  const byId = new Map(snapshot.nodes.map((n) => [n.id, n]));
  for (const n of snapshot.nodes) latest.set(instanceKey(n.key, n.branchId), n);
  const actions: WorkflowAction[] = [];
  const changed = new Map<WorkflowNodeId, WorkflowNode>();
  const save = (n: WorkflowNode) => {
    latest.set(instanceKey(n.key, n.branchId), n);
    byId.set(n.id, n);
    changed.set(n.id, n);
  };
  const nextId = (key: string, branch?: BranchId, revision = 1) =>
    WorkflowNodeId.make(JSON.stringify([project.id, key, branch ?? null, revision]));
  const pruned = new Set(snapshot.branches.filter((b) => b.status === "pruned").map((b) => b.id));
  const closePendingGates = (node: WorkflowNode) => {
    const ids = new Set(
      snapshot.gates.filter((g) => g.nodeId === node.id && g.status === "open").map((g) => g.id),
    );
    for (const a of actions) if (a.type === "open-gate" && a.nodeId === node.id) ids.add(a.gateId);
    for (const id of ids) actions.push({ type: "skip-gate", gateId: id });
  };
  const prune = (branch: BranchId, reason: string) => {
    if (!pruned.has(branch)) actions.push({ type: "prune-branch", branchId: branch, reason });
    pruned.add(branch);
    for (const n of latest.values())
      if (n.branchId === branch && !["done", "skipped", "failed", "pruned"].includes(n.status)) {
        if (n.status === "waiting-gate" || n.status === "waiting-question") closePendingGates(n);
        save({ ...n, status: "pruned" });
      }
  };
  // Materialize only after every dependency has instances. Branches can be chosen at a prior gate.
  const materialize = (key: string) => {
    const def = flow.nodes[key]!;
    if (def.mode === "fanout") {
      const needs = def.needs ?? [];
      // Freeze the cohort once upstream work has selected branches, so joins have immutable ancestry.
      if ([...latest.values()].some((n) => n.key === key)) return;
      if (
        needs.some(
          (need) =>
            ![...latest.values()].some(
              (n) => n.key === need && ["done", "skipped", "failed", "pruned"].includes(n.status),
            ),
        )
      )
        return;
    }
    const branches = def.mode === "fanout" ? snapshot.branches.map((b) => b.id) : [undefined];
    for (const branchId of branches) {
      if (latest.has(instanceKey(key, branchId))) continue;
      const parents = (def.needs ?? []).map((need) =>
        [...latest.values()].filter(
          (n) => n.key === need && (!branchId || !n.branchId || n.branchId === branchId),
        ),
      );
      if (parents.some((p) => p.length === 0)) continue;
      const parentIds = parents.flat().map((p) => p.id);
      if (def.k !== undefined && def.k > parentIds.length)
        throw new Error("Join threshold exceeds parent count for " + key);
      const kind = def.kind ?? (S.is(NodeKind)(key) ? key : "custom");
      save({
        id: nextId(key, branchId),
        researchProjectId: project.id,
        key,
        kind,
        agent: def.agent,
        title: key,
        status: branchId && pruned.has(branchId) ? "pruned" : "pending",
        parentIds,
        ...(branchId ? { branchId } : {}),
      });
    }
  };
  const gateId = (node: WorkflowNode, purpose: string) =>
    GateId.make(JSON.stringify([node.id, purpose]));
  const open = (n: WorkflowNode, kind: Gate["kind"], purpose: string = kind) => {
    save({ ...n, status: kind === "question" ? "waiting-question" : "waiting-gate" });
    actions.push({ type: "open-gate", nodeId: n.id, gateId: gateId(n, purpose), kind });
  };
  const start = (n: WorkflowNode) => {
    const def = flow.nodes[n.key]!;
    const node: WorkflowNode = { ...n, status: "running" };
    save(node);
    actions.push({
      type: "start-node",
      node,
      agent: def.agent,
      ...(def.mode ? { mode: def.mode } : {}),
      ...(def.out ? { out: def.out } : {}),
    });
  };
  for (const event of events) {
    if (event.type === "branch-pruned") {
      prune(event.branchId, "branch pruned");
      continue;
    }
    if (event.type === "evaluate-rung") {
      const branch = snapshot.branches.find((b) => b.id === event.branchId);
      if (!branch || pruned.has(branch.id) || !["promoted", "running"].includes(branch.status))
        continue;
      const decision = evaluateLadder(branch.rung, event.results, branch.spentGpuHours, event.rule);
      if (decision.type === "prune") prune(branch.id, decision.reason);
      if (decision.type === "promote")
        actions.push({ type: "promote-rung", branchId: branch.id, rung: decision.rung });
      continue;
    }
    const n = byId.get(event.nodeId);
    if (!n || latest.get(instanceKey(n.key, n.branchId))?.id !== n.id) continue;
    const def = flow.nodes[n.key]!;
    switch (event.type) {
      case "loop-back":
      case "edit-node": {
        const origin = event.type === "loop-back" ? byId.get(event.fromNodeId) : undefined;
        if (event.type === "loop-back" && (!origin || origin.status !== "done"))
          throw new Error("Loop origin must be a completed node");
        const replacements = new Map<WorkflowNodeId, WorkflowNodeId>();
        const replace = (old: WorkflowNode) => {
          const id = nextId(
            old.key,
            old.branchId,
            1 +
              [...byId.values()].filter((v) => v.key === old.key && v.branchId === old.branchId)
                .length,
          );
          if (old.status === "running") actions.push({ type: "cancel-node", nodeId: old.id });
          if (old.status === "waiting-gate" || old.status === "waiting-question")
            closePendingGates(old);
          if (!["done", "failed", "pruned", "skipped"].includes(old.status))
            save({ ...old, status: "skipped" });
          replacements.set(old.id, id);
          const { summary: _s, verdict: _v, startedAt: _start, endedAt: _end, ...base } = old;
          save({
            ...base,
            id,
            status: "pending",
            parentIds: old.parentIds.map((p) => replacements.get(p) ?? p),
          });
        };
        const beforeEdit = [...latest.values()].filter((old) => old.id !== n.id);
        replace(n);
        if (origin) {
          const first = byId.get(replacements.get(n.id)!)!;
          save({ ...first, parentIds: [...new Set([...first.parentIds, origin.id])] });
        }
        for (const key of flow.order)
          for (const old of beforeEdit) {
            if (old.key === key && old.parentIds.some((p) => replacements.has(p))) replace(old);
          }
        break;
      }
      case "node-finished":
        if (n.status !== "running") break;
        if (
          !event.failed &&
          def.gate &&
          def.gate !== "budget" &&
          needsApproval(project.approvalMode, def.gate)
        )
          open(n, def.gate);
        else save({ ...n, status: event.failed ? "failed" : "done" });
        break;
      case "budget-exceeded":
        if (
          n.status === "running" &&
          exceedsGpuBudget(event.gpuHours, gpuThreshold) &&
          !snapshot.gates.some((g) => g.id === gateId(n, "overrun")) &&
          !actions.some((a) => a.type === "open-gate" && a.gateId === gateId(n, "overrun"))
        ) {
          actions.push({ type: "pause-node", nodeId: n.id });
          open(n, "budget", "overrun");
        }
        break;
      case "gate-answered": {
        if (n.status !== "waiting-gate" && n.status !== "waiting-question") break;
        const staged = actions.findLast((a) => a.type === "open-gate" && a.nodeId === n.id);
        const stored = snapshot.gates.findLast((g) => g.nodeId === n.id);
        const current = staged?.type === "open-gate" ? staged.gateId : stored?.id;
        if (current !== event.gateId) break;
        if (event.proceed && current === gateId(n, "overrun")) {
          save({ ...n, status: "running" });
          actions.push({ type: "resume-node", nodeId: n.id });
        } else if (event.proceed && current === gateId(n, "budget")) start(n);
        else {
          if (current === gateId(n, "overrun")) actions.push({ type: "cancel-node", nodeId: n.id });
          save({ ...n, status: event.proceed ? "done" : "pruned" });
        }
        break;
      }
    }
  }
  for (const key of flow.order) {
    materialize(key);
    for (const n of latest.values()) {
      if (n.key !== key || n.status !== "pending") continue;
      if (n.branchId && pruned.has(n.branchId)) {
        save({ ...n, status: "pruned" });
        continue;
      }
      const def = flow.nodes[n.key]!;
      const statuses = n.parentIds.map((id) => byId.get(id)?.status);
      const required = def.k ?? statuses.length;
      const done = statuses.filter((s) => s === "done" || s === "skipped").length;
      const lost = statuses.filter((s) => s === "failed" || s === "pruned").length;
      if (statuses.length - lost < required) save({ ...n, status: "pruned" });
      else if (done >= required) {
        if (def.gate === "budget" || exceedsGpuBudget(def.budget_hours ?? 0, gpuThreshold))
          open(n, "budget");
        else start(n);
      }
    }
  }
  return { nodes: [...changed.values()], actions };
}
