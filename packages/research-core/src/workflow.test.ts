import { BranchId, type ResearchSnapshot } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";
import {
  advanceWorkflow,
  loadWorkflow,
  parseWorkflow,
  type Workflow,
  type WorkflowEvent,
} from "./workflow.ts";
import { snapshot, branch } from "./fixtures.test-support.ts";

function runner(flow: Workflow, initial: ResearchSnapshot = snapshot) {
  let state = initial;
  return {
    step(...events: WorkflowEvent[]) {
      const { actions, nodes } = advanceWorkflow(flow, state, events);
      const known = new Map(state.nodes.map((n) => [n.id, n]));
      nodes.forEach((n) => known.set(n.id, n));
      state = {
        ...state,
        nodes: [...known.values()],
        gates: [
          ...state.gates,
          ...actions.flatMap((a) =>
            a.type === "open-gate"
              ? [
                  {
                    id: a.gateId,
                    researchProjectId: state.project.id,
                    kind: a.kind,
                    nodeId: a.nodeId,
                    status: "open" as const,
                    title: "",
                    body: "",
                    createdAt: state.project.createdAt,
                    multiSelect: false,
                    options: [],
                  },
                ]
              : [],
          ),
        ],
      };
      return actions;
    },
    gate() {
      return state.gates.at(-1)!.id;
    },
    node(key: string, branchId?: BranchId) {
      return state.nodes.findLast((n) => n.key === key && n.branchId === branchId)!;
    },
  };
}
it("loads all default DAGs and rejects cycles, missing dependencies and misspelled fields", () => {
  for (const name of ["research", "reproduce", "survey", "prove", "hillclimb"] as const)
    expect(loadWorkflow(name).name).toBe(name);
  for (const nodes of [
    "a: {agent: x, needs: [a]}",
    "a: {agent: x, needs: [b]}",
    "a: {agent: x, budget_hors: 4}",
  ])
    expect(() => parseWorkflow("name: bad\nnodes:\n  " + nodes)).toThrow();
});
it("waits for a gate, fans out per branch, joins after k successes and ignores late events", () => {
  const flow = parseWorkflow(
    "name: demo\nnodes:\n  plan: {agent: planner, gate: pick-ideas}\n  test: {agent: runner, mode: fanout, needs: [plan]}\n  review: {agent: critic, mode: join, k: 1, needs: [test]}",
  );
  const b = BranchId.make("B");
  const r = runner(flow, { ...snapshot, branches: [branch, { ...branch, id: b }] });
  expect(r.step()).toMatchObject([{ type: "start-node", agent: "planner" }]);
  const plan = r.node("plan");
  expect(r.step({ type: "node-finished", nodeId: plan.id })).toMatchObject([
    { type: "open-gate", kind: "pick-ideas" },
  ]);
  expect(r.step()).toEqual([]);
  expect(
    r.step({ type: "gate-answered", nodeId: plan.id, gateId: r.gate(), proceed: true }),
  ).toHaveLength(2);
  expect(r.step({ type: "branch-pruned", branchId: b })).toMatchObject([{ type: "prune-branch" }]);
  const a = r.node("test", branch.id);
  expect(r.step({ type: "node-finished", nodeId: a.id })).toMatchObject([{ agent: "critic" }]);
  const firstReview = r.node("review");
  expect(r.step({ type: "edit-node", nodeId: a.id })).toMatchObject([
    { type: "cancel-node", nodeId: firstReview.id },
    { agent: "runner" },
  ]);
  expect(r.node("review").id).not.toEqual(firstReview.id);
  expect(r.node("review").parentIds).toContain(r.node("test", branch.id).id);
  expect(r.node("plan").id).toBe(plan.id);
  expect(r.node("test", b).status).toBe("pruned");
  expect(r.step({ type: "node-finished", nodeId: a.id })).toEqual([]);
});
it("pauses autonomous work at the GPU threshold and creates fresh nodes for a loop-back", () => {
  const flow = parseWorkflow(
    "name: demo\nnodes:\n  plan: {agent: planner, budget_hours: 21}\n  review: {agent: critic, needs: [plan], gate: claims}",
  );
  const r = runner(flow, {
    ...snapshot,
    project: { ...snapshot.project, approvalMode: "autonomous" },
  });
  expect(r.step()).toMatchObject([{ type: "open-gate", kind: "budget" }]);
  const plan = r.node("plan");
  expect(
    r.step({ type: "gate-answered", nodeId: plan.id, gateId: r.gate(), proceed: true }),
  ).toMatchObject([{ agent: "planner" }]);
  const estimateGate = r.gate();
  expect(r.step({ type: "budget-exceeded", nodeId: plan.id, gpuHours: 20 })).toEqual([]);
  expect(r.step({ type: "budget-exceeded", nodeId: plan.id, gpuHours: 21 })).toMatchObject([
    { type: "pause-node" },
    { type: "open-gate" },
  ]);
  expect(
    r.step({ type: "gate-answered", nodeId: plan.id, gateId: estimateGate, proceed: true }),
  ).toEqual([]);
  expect(
    r.step({ type: "gate-answered", nodeId: plan.id, gateId: r.gate(), proceed: true }),
  ).toMatchObject([{ type: "resume-node" }]);
  r.step({ type: "node-finished", nodeId: plan.id });
  const review = r.node("review");
  r.step({ type: "node-finished", nodeId: review.id });
  expect(r.step({ type: "loop-back", fromNodeId: review.id, nodeId: plan.id })).toMatchObject([
    { type: "open-gate", kind: "budget" },
  ]);
  expect(r.node("plan").parentIds).toContain(review.id);
  expect(r.node("review").parentIds).toEqual([r.node("plan").id]);
});
