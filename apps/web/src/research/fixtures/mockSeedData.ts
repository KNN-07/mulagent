import {
  type ApprovalMode,
  type BackendDescription,
  BackendId,
  BranchId,
  type ExperimentSpec,
  type Finding,
  FindingId,
  type Gate,
  GateId,
  JobId,
  type JobStatus,
  type LeanClaim,
  ProjectId,
  type ResearchBranch,
  type ResearchProject,
  ResearchProjectId,
  ResearchRunId,
  type Run,
  type RunMetric,
  type WorkflowNode,
  WorkflowNodeId,
} from "@t3tools/contracts";

import type {
  BranchLiveTelemetry,
  BranchWorkspaceExtras,
  HorizonComparisonRow,
  ResearchProjectBudget,
  ResearchThreadEvent,
  ResearchWorkspaceSnapshot,
  VenueChecklistItem,
} from "../client";

// Fixed reference timestamp so relative durations and "today" metrics stay deterministic.
export const MOCK_NOW_ISO = "2026-11-20T18:00:00.000Z";
const MOCK_NOW_MS = Date.parse(MOCK_NOW_ISO);

function hoursAgoIso(hours: number): string {
  return new Date(MOCK_NOW_MS - Math.round(hours * 3_600_000)).toISOString();
}

function minutesAgoIso(minutes: number): string {
  return new Date(MOCK_NOW_MS - Math.round(minutes * 60_000)).toISOString();
}

export const WORLD_MODEL_PROJECT_ID = ResearchProjectId.make("world-model-planning");
const CREDIT_ASSIGNMENT_PROJECT_ID = ResearchProjectId.make("credit-assignment");
const RULE_WORLDS_PROJECT_ID = ResearchProjectId.make("rule-worlds");

const BACKEND_SLURM_ID = BackendId.make("slurm-taisp");
const BACKEND_MODAL_ID = BackendId.make("cloud-modal");
const BACKEND_LOCAL_ID = BackendId.make("local-laptop");

export function createSeedBackends(): ReadonlyArray<BackendDescription> {
  return [
    {
      id: BACKEND_SLURM_ID,
      kind: "slurm",
      label: "slurm · taisp",
      accelerator: "H100 80GB",
      gpusTotal: 4,
      gpusFree: 0,
      nodes: 1,
      maxWallHours: 24,
      preemptible: false,
      usdPerGpuHour: 3.2,
      queueDepth: 2,
      healthy: true,
    },
    {
      id: BACKEND_MODAL_ID,
      kind: "cloud",
      label: "cloud · modal",
      accelerator: "A100 80GB",
      gpusTotal: 8,
      gpusFree: 6,
      nodes: 2,
      maxWallHours: 12,
      preemptible: true,
      usdPerGpuHour: 2.1,
      queueDepth: 1,
      healthy: true,
    },
    {
      id: BACKEND_LOCAL_ID,
      kind: "local",
      label: "local · laptop",
      accelerator: "RTX 4090",
      gpusTotal: 1,
      gpusFree: 1,
      nodes: 1,
      maxWallHours: 72,
      preemptible: false,
      usdPerGpuHour: 0,
      queueDepth: 0,
      healthy: true,
    },
  ];
}

const WORLD_MODEL_YAML = `name: research
version: 1
nodes:
  - key: survey
    agent: surveyor
    kind: survey
    budget_hours: 1
  - key: ideas
    agent: ideator
    kind: ideas
    needs: [survey]
    mode: tournament
    gate: pick-ideas
  - key: plan
    agent: planner
    kind: plan
    needs: [ideas]
  - key: repro
    agent: experimenter
    kind: repro
    needs: [plan]
    budget_hours: 4
  - key: fanout
    kind: custom
    needs: [repro]
    mode: fanout
    branches: [A, B, C, Lean]
  - key: merge
    agent: analyst
    kind: merge
    needs: [fanout]
    mode: join
    gate: claims
  - key: report
    agent: writer
    kind: report
    needs: [merge]
`;

function buildWorldModelSnapshot(
  backends: ReadonlyArray<BackendDescription>,
): ResearchWorkspaceSnapshot {
  const projectId = WORLD_MODEL_PROJECT_ID;
  const branchA = BranchId.make("branch-a");
  const branchB = BranchId.make("branch-b");
  const branchC = BranchId.make("branch-c");
  const branchLean = BranchId.make("branch-lean");

  const nodeSurvey = WorkflowNodeId.make("wm-survey");
  const nodeIdeas = WorkflowNodeId.make("wm-ideas");
  const nodePlan = WorkflowNodeId.make("wm-plan");
  const nodeRepro = WorkflowNodeId.make("wm-repro");
  const nodeFanout = WorkflowNodeId.make("wm-fanout");
  const nodeASmall = WorkflowNodeId.make("wm-a-small");
  const nodeCPruned = WorkflowNodeId.make("wm-c-pruned");
  const nodeBDone = WorkflowNodeId.make("wm-b-done");
  const nodeAPromoted = WorkflowNodeId.make("wm-a-promoted");
  const nodeLeanProved = WorkflowNodeId.make("wm-lean-proved");
  const nodeARun15 = WorkflowNodeId.make("wm-a-run15");
  const nodeMerge = WorkflowNodeId.make("wm-merge");

  const project: ResearchProject = {
    id: projectId,
    projectId: ProjectId.make("proj-world-model-planning"),
    title: "world-model-planning",
    goal: "Run the research loop on world-model-planning overnight. Stop at gates.",
    workflow: "research.yaml",
    approvalMode: "ask-risky",
    budget: { gpuHours: 40, usd: 180, llmUsdPerWeek: 45 },
    spent: { gpuHours: 14.2, usd: 64.2, llmUsd: 11.4 },
    createdAt: hoursAgoIso(14),
    updatedAt: minutesAgoIso(1),
  };

  const branches: ReadonlyArray<ResearchBranch> = [
    {
      id: branchA,
      researchProjectId: projectId,
      label: "A",
      title: "latent rollouts",
      kind: "experiment",
      status: "running",
      rung: "target",
      gitBranch: "branch/latent-rollouts",
      killRule: "no gain on 2 rungs",
      budgetGpuHours: 40,
      spentGpuHours: 14.2,
    },
    {
      id: branchB,
      researchProjectId: projectId,
      label: "B",
      title: "value search",
      kind: "experiment",
      status: "done",
      rung: "small",
      gitBranch: "branch/value-search",
      killRule: "no gain on 2 rungs",
      budgetGpuHours: 16,
      spentGpuHours: 9.4,
    },
    {
      id: branchC,
      researchProjectId: projectId,
      label: "C",
      title: "bigger latent",
      kind: "experiment",
      status: "pruned",
      rung: "toy",
      gitBranch: "branch/bigger-latent",
      killRule: "no gain over seed noise",
      budgetGpuHours: 10,
      spentGpuHours: 2.8,
    },
    {
      id: branchLean,
      researchProjectId: projectId,
      label: "Lean",
      title: "error bound",
      kind: "lean",
      status: "running",
      rung: "target",
      gitBranch: "branch/lean-error-bound",
      killRule: "sorry after 3 retries",
      budgetGpuHours: 2,
      spentGpuHours: 0.6,
    },
  ];

  const nodes: ReadonlyArray<WorkflowNode> = [
    {
      id: nodeSurvey,
      researchProjectId: projectId,
      key: "survey",
      kind: "survey",
      agent: "surveyor",
      parentIds: [],
      status: "done",
      title: "Goal, papers, survey",
      summary: "142 papers · 18 baselines · 6 open problems",
      startedAt: hoursAgoIso(14),
      endedAt: hoursAgoIso(13),
    },
    {
      id: nodeIdeas,
      researchProjectId: projectId,
      key: "ideas",
      kind: "ideas",
      agent: "ideator",
      parentIds: [nodeSurvey],
      status: "done",
      title: "Idea tournament",
      summary: "41 ideas · 3 picked by you at Gate 1",
      startedAt: hoursAgoIso(12),
      endedAt: hoursAgoIso(11.3),
    },
    {
      id: nodePlan,
      researchProjectId: projectId,
      key: "plan",
      kind: "plan",
      agent: "planner",
      parentIds: [nodeIdeas],
      status: "done",
      title: "Plan",
      summary: "specs frozen · riskiest test ordered first",
      startedAt: hoursAgoIso(11),
      endedAt: hoursAgoIso(10.2),
    },
    {
      id: nodeRepro,
      researchProjectId: projectId,
      key: "repro",
      kind: "repro",
      agent: "experimenter",
      parentIds: [nodePlan],
      status: "done",
      title: "Reproduce baseline",
      summary: "within 0.5 pp of the paper · preflight passed",
      startedAt: hoursAgoIso(8.5),
      endedAt: hoursAgoIso(8.1),
    },
    {
      id: nodeFanout,
      researchProjectId: projectId,
      key: "fanout",
      kind: "custom",
      parentIds: [nodeRepro],
      status: "done",
      title: "Fan out · 4 branches",
      summary: "3 experiment branches + 1 Lean branch",
      startedAt: hoursAgoIso(8),
      endedAt: hoursAgoIso(7.9),
    },
    {
      id: nodeASmall,
      researchProjectId: projectId,
      key: "a-small",
      kind: "experiment",
      agent: "experimenter",
      parentIds: [nodeFanout],
      branchId: branchA,
      status: "done",
      title: "Small rung · +12.2 pp at h = 32",
      summary: "A · 5 seeds · CI excludes zero",
      verdict: "0.750 keep",
      startedAt: hoursAgoIso(5),
      endedAt: hoursAgoIso(4.3),
    },
    {
      id: nodeCPruned,
      researchProjectId: projectId,
      key: "c-pruned",
      kind: "experiment",
      agent: "experimenter",
      parentIds: [nodeFanout],
      branchId: branchC,
      status: "pruned",
      title: "C pruned at toy rung",
      summary: "C · no gain over seed noise · postmortem saved",
      startedAt: hoursAgoIso(4),
      endedAt: hoursAgoIso(3.9),
    },
    {
      id: nodeBDone,
      researchProjectId: projectId,
      key: "b-done",
      kind: "experiment",
      agent: "experimenter",
      parentIds: [nodeFanout],
      branchId: branchB,
      status: "done",
      title: "B done · weaker than A on 2 rungs",
      summary: "B · kept for the comparison table",
      verdict: "0.712",
      startedAt: hoursAgoIso(3),
      endedAt: hoursAgoIso(2.7),
    },
    {
      id: nodeAPromoted,
      researchProjectId: projectId,
      key: "a-promoted",
      kind: "experiment",
      agent: "planner",
      parentIds: [nodeASmall],
      branchId: branchA,
      status: "done",
      title: "Promoted to target rung",
      summary: "A · gain held on toy and small",
      startedAt: hoursAgoIso(2),
      endedAt: hoursAgoIso(1.95),
    },
    {
      id: nodeLeanProved,
      researchProjectId: projectId,
      key: "lean-proved",
      kind: "prove",
      agent: "prover",
      parentIds: [nodeFanout],
      branchId: branchLean,
      status: "done",
      title: "rollout_error_le proven",
      summary: "Lean · kernel-checked, no sorry",
      startedAt: minutesAgoIso(38),
      endedAt: minutesAgoIso(36),
    },
    {
      id: nodeARun15,
      researchProjectId: projectId,
      key: "a-run15",
      kind: "hillclimb",
      agent: "experimenter",
      parentIds: [nodeAPromoted],
      branchId: branchA,
      status: "running",
      title: "Run 15 · rollout-horizon curriculum",
      summary: "A · target rung · running",
      verdict: "0.776 keep",
      startedAt: minutesAgoIso(6),
    },
    {
      id: nodeMerge,
      researchProjectId: projectId,
      key: "merge",
      kind: "merge",
      agent: "analyst",
      parentIds: [nodeARun15, nodeBDone, nodeLeanProved],
      status: "waiting-gate",
      title: "Merge + analyze",
      summary: "waiting · claim C1 at Gate 3",
      startedAt: minutesAgoIso(2),
    },
  ];

  const runs: Run[] = [];
  const metrics: RunMetric[] = [];

  const passingChecks = [
    { name: "spec-diff" as const, passed: true, detail: "spec hash unchanged" },
    { name: "leakage" as const, passed: true, detail: "test mazes hash-disjoint from train" },
    { name: "sanity" as const, passed: true, detail: "baseline matches paper within 0.5 pp" },
    { name: "stats" as const, passed: true, detail: "5 seeds, bootstrap 95% CI excludes zero" },
  ];

  // 16 hillclimb runs on Branch A (7 kept, 6 discarded, 2 crashed, 1 running).
  const branchAHillclimb: ReadonlyArray<{
    readonly num: number;
    readonly change: string;
    readonly value: number | null;
    readonly verdict: Run["verdict"];
    readonly status: Run["status"];
    readonly hoursAgo: number;
  }> = [
    {
      num: 1,
      change: "Baseline latent transition block",
      value: 0.66,
      verdict: "keep",
      status: "finished",
      hoursAgo: 7.6,
    },
    {
      num: 2,
      change: "Cosine rollout schedule",
      value: 0.681,
      verdict: "keep",
      status: "finished",
      hoursAgo: 7.2,
    },
    {
      num: 3,
      change: "Auxiliary reconstruction loss",
      value: 0.672,
      verdict: "discard",
      status: "finished",
      hoursAgo: 6.8,
    },
    {
      num: 4,
      change: "LayerNorm on latent state",
      value: 0.676,
      verdict: "discard",
      status: "finished",
      hoursAgo: 6.4,
    },
    {
      num: 5,
      change: "Multi-step consistency target",
      value: 0.701,
      verdict: "keep",
      status: "finished",
      hoursAgo: 6.0,
    },
    {
      num: 6,
      change: "Gradient clipping 0.5",
      value: 0.692,
      verdict: "discard",
      status: "finished",
      hoursAgo: 5.6,
    },
    {
      num: 7,
      change: "Residual transition skip",
      value: 0.722,
      verdict: "keep",
      status: "finished",
      hoursAgo: 5.2,
    },
    {
      num: 8,
      change: "Unbounded variance head",
      value: null,
      verdict: "crash",
      status: "failed",
      hoursAgo: 4.9,
    },
    {
      num: 9,
      change: "Dropout 0.1 on transition MLP",
      value: 0.715,
      verdict: "discard",
      status: "finished",
      hoursAgo: 4.5,
    },
    {
      num: 10,
      change: "Horizon-weighted KL beta",
      value: 0.733,
      verdict: "keep",
      status: "finished",
      hoursAgo: 4.1,
    },
    {
      num: 11,
      change: "EMA target encoder 0.99",
      value: 0.729,
      verdict: "discard",
      status: "finished",
      hoursAgo: 3.6,
    },
    {
      num: 12,
      change: "Stochastic latent, 2 samples",
      value: 0.75,
      verdict: "keep",
      status: "finished",
      hoursAgo: 3.1,
    },
    {
      num: 13,
      change: "Double latent width",
      value: null,
      verdict: "crash",
      status: "failed",
      hoursAgo: 2.5,
    },
    {
      num: 14,
      change: "Value head on the latent",
      value: 0.745,
      verdict: "discard",
      status: "finished",
      hoursAgo: 1.9,
    },
    {
      num: 15,
      change: "Rollout-horizon curriculum",
      value: 0.776,
      verdict: "keep",
      status: "finished",
      hoursAgo: 0.7,
    },
    {
      num: 16,
      change: "Adaptive horizon stop penalty",
      value: 0.771,
      verdict: "pending",
      status: "running",
      hoursAgo: 0.1,
    },
  ];

  for (const item of branchAHillclimb) {
    const runId = ResearchRunId.make(`run-a-${String(item.num).padStart(2, "0")}`);
    runs.push({
      id: runId,
      researchProjectId: projectId,
      branchId: branchA,
      nodeId: item.num >= 14 ? nodeARun15 : nodeASmall,
      number: item.num,
      change: item.change,
      seed: item.num % 5,
      status: item.status,
      verdict: item.verdict,
      integrity: item.verdict === "crash" ? "unchecked" : "trusted",
      checks: item.verdict === "crash" ? [] : passingChecks,
      scope: item.num >= 14 ? "target rung" : "small scale",
      backendId: BACKEND_SLURM_ID,
      jobId: JobId.make(`job-a-${item.num}`),
      codeHash: "4e1c9a2",
      dataHash: "8b90f11",
      gpuHours: item.verdict === "crash" ? 0.15 : 0.45,
      llmUsd: 0.22,
      trackerUrls: [],
      createdAt: hoursAgoIso(item.hoursAgo),
      ...(item.status !== "running"
        ? { endedAt: hoursAgoIso(Math.max(0.05, item.hoursAgo - 0.18)) }
        : {}),
    });
    if (item.value !== null) {
      metrics.push({
        runId,
        name: "success_h32",
        value: item.value,
        step: item.status === "running" ? 3120 : 3600,
        split: "holdout",
      });
    }
  }

  // 15 locked OOD evaluation suite runs (5 seeds x 3 horizons) backing Claim C1.
  const evidenceRunSpecs: ReadonlyArray<{
    readonly id: string;
    readonly horizon: number;
    readonly seed: number;
    readonly latent: number;
    readonly baseline: number;
  }> = [
    { id: "r-0215", horizon: 32, seed: 4, latent: 0.781, baseline: 0.658 },
    { id: "r-0214", horizon: 32, seed: 3, latent: 0.769, baseline: 0.651 },
    { id: "r-0213", horizon: 32, seed: 2, latent: 0.774, baseline: 0.655 },
    { id: "r-0212", horizon: 32, seed: 1, latent: 0.779, baseline: 0.652 },
    { id: "r-0211", horizon: 32, seed: 0, latent: 0.777, baseline: 0.654 },
    { id: "r-0210", horizon: 16, seed: 4, latent: 0.746, baseline: 0.681 },
    { id: "r-0209", horizon: 16, seed: 3, latent: 0.739, baseline: 0.677 },
    { id: "r-0208", horizon: 16, seed: 2, latent: 0.742, baseline: 0.679 },
    { id: "r-0207", horizon: 16, seed: 1, latent: 0.744, baseline: 0.68 },
    { id: "r-0206", horizon: 16, seed: 0, latent: 0.739, baseline: 0.678 },
    { id: "r-0205", horizon: 8, seed: 4, latent: 0.712, baseline: 0.703 },
    { id: "r-0204", horizon: 8, seed: 3, latent: 0.708, baseline: 0.701 },
    { id: "r-0203", horizon: 8, seed: 2, latent: 0.706, baseline: 0.699 },
    { id: "r-0202", horizon: 8, seed: 1, latent: 0.71, baseline: 0.702 },
    { id: "r-0201", horizon: 8, seed: 0, latent: 0.708, baseline: 0.7 },
  ];

  const evidenceRunIds: ResearchRunId[] = [];
  evidenceRunSpecs.forEach((ev, idx) => {
    const runId = ResearchRunId.make(ev.id);
    evidenceRunIds.push(runId);
    runs.push({
      id: runId,
      researchProjectId: projectId,
      branchId: branchA,
      nodeId: nodeASmall,
      number: 100 + idx + 1,
      change: `OOD eval suite h = ${ev.horizon} · seed ${ev.seed}`,
      seed: ev.seed,
      status: "finished",
      verdict: "keep",
      integrity: "trusted",
      checks: passingChecks,
      scope: `h = ${ev.horizon} · seed ${ev.seed}`,
      backendId: BACKEND_SLURM_ID,
      codeHash: "4e1c9a2",
      dataHash: "8b90f11",
      gpuHours: 0.25,
      llmUsd: 0.08,
      trackerUrls: [],
      createdAt: hoursAgoIso(1.6 + idx * 0.05),
      endedAt: hoursAgoIso(1.5 + idx * 0.05),
    });
    metrics.push({
      runId,
      name: `ood_success_h${ev.horizon}`,
      value: ev.latent,
      split: "holdout",
    });
    metrics.push({
      runId,
      name: `baseline_success_h${ev.horizon}`,
      value: ev.baseline,
      split: "holdout",
    });
  });

  // 18 runs on Branch B (best 0.712).
  for (let i = 1; i <= 18; i += 1) {
    const runId = ResearchRunId.make(`run-b-${String(i).padStart(2, "0")}`);
    const val = Number((0.665 + Math.min(i, 12) * 0.004 - (i % 3 === 0 ? 0.008 : 0)).toFixed(3));
    const finalVal = i === 18 ? 0.712 : val;
    runs.push({
      id: runId,
      researchProjectId: projectId,
      branchId: branchB,
      nodeId: nodeBDone,
      number: i,
      change: `Value search iteration ${i}`,
      seed: i % 5,
      status: "finished",
      verdict: i === 18 || i % 4 === 0 ? "keep" : "discard",
      integrity: "trusted",
      checks: passingChecks,
      scope: "small scale",
      backendId: BACKEND_MODAL_ID,
      codeHash: "9d3a10c",
      gpuHours: 0.35,
      llmUsd: 0.14,
      trackerUrls: [],
      createdAt: hoursAgoIso(6.5 - i * 0.2),
      endedAt: hoursAgoIso(6.3 - i * 0.2),
    });
    metrics.push({
      runId,
      name: "success_h32",
      value: finalVal,
      split: "holdout",
    });
  }

  // 9 runs on Branch C (pruned at toy rung).
  for (let i = 1; i <= 9; i += 1) {
    const runId = ResearchRunId.make(`run-c-${String(i).padStart(2, "0")}`);
    const crashed = i === 6;
    runs.push({
      id: runId,
      researchProjectId: projectId,
      branchId: branchC,
      nodeId: nodeCPruned,
      number: i,
      change: `Wider latent dim trial ${i}`,
      seed: i % 3,
      status: crashed ? "failed" : "finished",
      verdict: crashed ? "crash" : "discard",
      integrity: "preliminary",
      checks: [],
      scope: "toy rung",
      backendId: BACKEND_MODAL_ID,
      gpuHours: 0.2,
      llmUsd: 0.1,
      trackerUrls: [],
      createdAt: hoursAgoIso(7.2 - i * 0.3),
      endedAt: hoursAgoIso(7.0 - i * 0.3),
    });
    if (!crashed) {
      metrics.push({
        runId,
        name: "success_h32",
        value: Number((0.652 + (i % 3) * 0.002).toFixed(3)),
        split: "holdout",
      });
    }
  }

  // 3 Lean proof verification runs -> 16 + 15 + 18 + 9 + 3 = 61 total runs.
  for (let i = 1; i <= 3; i += 1) {
    const runId = ResearchRunId.make(`run-lean-${String(i).padStart(2, "0")}`);
    runs.push({
      id: runId,
      researchProjectId: projectId,
      branchId: branchLean,
      nodeId: nodeLeanProved,
      number: i,
      change:
        i === 1
          ? "Verify lipschitz_compose"
          : i === 2
            ? "Verify rollout_error_le"
            : "Attempt main_bound induction",
      status: i === 3 ? "running" : "finished",
      verdict: i === 3 ? "pending" : "keep",
      integrity: "trusted",
      checks: [],
      scope: "lean4 kernel",
      backendId: BACKEND_LOCAL_ID,
      gpuHours: 0,
      llmUsd: 0.18,
      trackerUrls: [],
      createdAt: hoursAgoIso(1.5 - i * 0.4),
      ...(i < 3 ? { endedAt: hoursAgoIso(1.4 - i * 0.4) } : {}),
    });
    metrics.push({
      runId,
      name: "axioms_clean",
      value: i === 3 ? 0 : 1,
      split: "test",
    });
  }

  const findingC1: Finding = {
    id: FindingId.make("finding-c1"),
    researchProjectId: projectId,
    label: "C1",
    claim:
      "On out-of-distribution mazes, planning with latent rollouts raises success over a reproduced recurrent baseline, and the gain grows with horizon: +6.3 pp at h = 16 and +12.2 pp at h = 32, with no effect at h = 8.",
    evidenceRunIds,
    scope: "small scale only",
    status: "critic-passed",
    critic: [
      {
        attack: "Cherry-picked seeds?",
        response: "All seeds reported; the worst still beats the baseline mean at h = 32.",
        landed: false,
      },
      {
        attack: "Weak baseline?",
        response: "Same tuning budget; reproduces the paper within 0.5 pp.",
        landed: false,
      },
      {
        attack: "Leakage?",
        response: "Test mazes are hash-disjoint from training.",
        landed: false,
      },
      {
        attack: "Metric shopping?",
        response: "Endpoint frozen in the spec before any run.",
        landed: false,
      },
    ],
    caveats: ["One maze family shows no gain, so the claim should not say the effect is uniform."],
    criticModel: "claude-opus-4-6",
  };

  const leanClaims: ReadonlyArray<LeanClaim> = [
    {
      name: "rollout_error_le",
      researchProjectId: projectId,
      informal: "Bounded one-step transition error grows geometrically with Lipschitz constant.",
      statementApproved: true,
      status: "proven",
      axioms: ["propext", "Quot.sound"],
    },
    {
      name: "lipschitz_compose",
      researchProjectId: projectId,
      informal: "Composition of L-Lipschitz latent transitions preserves the bound.",
      statementApproved: true,
      status: "proven",
      axioms: ["propext", "Classical.choice"],
    },
    {
      name: "main_bound",
      researchProjectId: projectId,
      informal: "will appear as a conjecture",
      statementApproved: true,
      status: "open",
      axioms: [],
    },
  ];

  const gates: ReadonlyArray<Gate> = [
    {
      id: GateId.make("gate-endpoint"),
      researchProjectId: projectId,
      nodeId: nodeAPromoted,
      kind: "question",
      title: "Which behaviour should be the primary endpoint?",
      body: "One decision before spending compute on the target rung.",
      options: [
        { id: "maze-success", label: "Maze success rate", recommended: false },
        { id: "plan-length", label: "Plan length vs shortest path", recommended: false },
        { id: "both-holm", label: "Both, Holm-corrected", recommended: true },
      ],
      multiSelect: false,
      status: "open",
      createdAt: minutesAgoIso(18),
    },
    {
      id: GateId.make("gate-3-claims"),
      researchProjectId: projectId,
      nodeId: nodeMerge,
      kind: "claims",
      title: "Claim C1 review at Gate 3",
      body: "Critic ran 4 attacks with 0 landed. Approve with note, send back, or reject.",
      options: [
        { id: "approve", label: "Approve with note", recommended: true },
        { id: "send-back", label: "Send back for more runs", recommended: false },
        { id: "reject", label: "Reject", recommended: false },
      ],
      multiSelect: false,
      status: "open",
      createdAt: minutesAgoIso(41),
    },
  ];

  const jobs: ReadonlyArray<JobStatus> = [
    {
      id: JobId.make("job-a-16"),
      backendId: BACKEND_SLURM_ID,
      runId: ResearchRunId.make("run-a-16"),
      state: "running",
      nativeId: "slurm-88412",
      nodes: ["taisp-gpu01"],
      startedAt: minutesAgoIso(14),
    },
    {
      id: JobId.make("job-a-17-queued"),
      backendId: BACKEND_SLURM_ID,
      state: "queued",
      nativeId: "slurm-88419",
      queuePosition: 1,
      nodes: [],
    },
  ];

  const specsByBranchId: Record<string, ExperimentSpec> = {
    [branchA]: {
      hypothesis: "Latent rollouts with curriculum horizon improve OOD planning at long horizons.",
      metric: "success_h32",
      higherIsBetter: true,
      baseline: 0.654,
      seeds: [0, 1, 2, 3, 4],
      editable: ["models/latent.py"],
      lockedEval: { path: "eval/ood_suite.py", commit: "4e1c9a2" },
      command: "uv run eval/ood_suite.py --seeds 0-4",
      resources: { gpus: 4, gpuMemGb: 80, hours: 6 },
      stopRule: "Keep a change only if the holdout improves.",
      frozenAt: hoursAgoIso(10.5),
      specHash: "sha256:4e1c9a2f08",
    },
    [branchB]: {
      hypothesis: "Value-guided tree search over recurrent hidden states beats greedy decoding.",
      metric: "success_h32",
      higherIsBetter: true,
      baseline: 0.654,
      seeds: [0, 1, 2, 3, 4],
      editable: ["models/value_search.py"],
      lockedEval: { path: "eval/ood_suite.py", commit: "4e1c9a2" },
      command: "uv run eval/ood_suite.py --seeds 0-4",
      resources: { gpus: 2, gpuMemGb: 80, hours: 4 },
      stopRule: "Prune if weaker than top branch on 2 rungs.",
      frozenAt: hoursAgoIso(10.5),
      specHash: "sha256:9d3a10c441",
    },
    [branchC]: {
      hypothesis: "Doubling latent state dimension reduces compounding transition drift.",
      metric: "success_h32",
      higherIsBetter: true,
      baseline: 0.654,
      seeds: [0, 1, 2],
      editable: ["models/latent_wide.py"],
      lockedEval: { path: "eval/ood_suite.py", commit: "4e1c9a2" },
      command: "uv run eval/ood_suite.py --seeds 0-2",
      resources: { gpus: 2, gpuMemGb: 80, hours: 3 },
      stopRule: "Prune if no gain over seed noise at toy rung.",
      frozenAt: hoursAgoIso(10.5),
      specHash: "sha256:77b21e80aa",
    },
    [branchLean]: {
      hypothesis: "Formalize rollout error upper bound in Lean 4 without sorry.",
      metric: "axioms_clean",
      higherIsBetter: true,
      baseline: 0,
      seeds: [0],
      editable: ["proofs/RolloutError.lean"],
      command: "lake build RolloutError",
      resources: { gpus: 0, cpus: 8, hours: 2 },
      stopRule: "Verify axioms contain only standard Lean foundations.",
      frozenAt: hoursAgoIso(10.5),
      specHash: "sha256:lean04c21",
    },
  };

  const threadEvents: ReadonlyArray<ResearchThreadEvent> = [
    {
      id: "ev-1",
      kind: "user-message",
      text: "Run the research loop on world-model-planning overnight. Stop at gates.",
      createdAt: hoursAgoIso(8.2),
    },
    {
      id: "ev-2",
      kind: "agent-message",
      text: "Baseline reproduced within 0.5 pp of the paper. Branch A (latent rollouts) beat it on the toy and small rungs and is now at target scale. Branch C showed no gain over seed noise, so I pruned it.",
      createdAt: hoursAgoIso(1.5),
    },
    {
      id: "ev-3",
      kind: "file-edit",
      path: "models/latent.py",
      additions: 28,
      deletions: 6,
      createdAt: hoursAgoIso(1.2),
    },
    {
      id: "ev-4",
      kind: "command-run",
      command: "eval/ood_suite.py --seeds 0-4",
      durationLabel: "41m 12s",
      runId: ResearchRunId.make("r-0215"),
      createdAt: hoursAgoIso(1.0),
    },
    {
      id: "ev-5",
      kind: "lean-proved",
      claimName: "rollout_error_le",
      durationLabel: "12s",
      createdAt: minutesAgoIso(38),
    },
    {
      id: "ev-6",
      kind: "branch-pruned",
      branchLabel: "branch C",
      detail: "postmortem saved",
      createdAt: minutesAgoIso(32),
    },
    {
      id: "ev-7",
      kind: "agent-message",
      text: "At horizon 32, latent rollouts reach 77.6% against 65.4% for the baseline (+12.2 pp, 95% CI +7.9 to +16.1). The gain grows with horizon. Scope: small scale only.",
      createdAt: minutesAgoIso(25),
    },
    {
      id: "ev-8",
      kind: "agent-message",
      text: "Claim C1 is ready for you at Gate 3, and the critic could not break it. One decision before spending compute on the target rung:",
      createdAt: minutesAgoIso(18),
      relatedFindingId: findingC1.id,
    },
  ];

  const horizonSummary: ReadonlyArray<HorizonComparisonRow> = [
    {
      horizon: 8,
      latentRunId: ResearchRunId.make("r-0205"),
      baselineRunId: ResearchRunId.make("r-0201"),
      latentValue: 70.9,
      baselineValue: 70.1,
      deltaPp: 0.8,
      significant: false,
    },
    {
      horizon: 16,
      latentRunId: ResearchRunId.make("r-0210"),
      baselineRunId: ResearchRunId.make("r-0206"),
      latentValue: 74.2,
      baselineValue: 67.9,
      deltaPp: 6.3,
      significant: true,
    },
    {
      horizon: 32,
      latentRunId: ResearchRunId.make("r-0215"),
      baselineRunId: ResearchRunId.make("r-0211"),
      latentValue: 77.6,
      baselineValue: 65.4,
      deltaPp: 12.2,
      significant: true,
    },
  ];

  const branchLiveTelemetry: Record<string, BranchLiveTelemetry> = {
    [branchA]: {
      step: 3120,
      totalSteps: 3600,
      seedIndex: 3,
      totalSeeds: 5,
      gpus: 4,
      etaMinutes: 6,
      runIndex: 16,
      totalBudgetRuns: 40,
      elapsedLabel: "02:14:08",
    },
  };

  const branchWorkspaces: Record<string, BranchWorkspaceExtras> = {
    [branchA]: {
      docPath: "results/branch-a.md",
      docUpdatedLabel: "agent · just now",
      agentPrompt:
        "Push success at h = 32 on the target rung. Edit only models/latent.py. Log every run to branch-a.md.",
      thoughtDurationLabel: "9s",
      integritySummary: "Integrity on run 15: spec unchanged, no leakage, CI excludes zero.",
      sessions: [
        {
          id: "sess-target",
          title: "Target rung",
          status: "running",
          detail: "Running · run 16 of 40",
          ageLabel: "2h",
        },
        {
          id: "sess-small",
          title: "Small rung",
          status: "done",
          detail: "Done · +12.2 pp at h = 32",
          ageLabel: "5h",
        },
        {
          id: "sess-repro",
          title: "Baseline repro",
          status: "done",
          detail: "Done · within 0.5 pp of paper",
          ageLabel: "8h",
        },
      ],
      files: [
        {
          path: "results/branch-a.md",
          name: "branch-a.md",
          folder: "results",
        },
        {
          path: "models/latent.py",
          name: "latent.py",
          folder: "models",
          modified: true,
          preview:
            "# models/latent.py (editable under frozen spec 4e1c9a2)\nclass LatentRolloutPlanner:\n    def __init__(self, horizon_schedule=(8, 16, 32), kl_beta=0.04):\n        self.horizon_schedule = horizon_schedule\n        self.kl_beta = kl_beta\n\n    def rollout(self, z0, actions, horizon):\n        # Curriculum horizon rollout with stochastic latent samples (k=2)\n        return self.transition_step(z0, actions, horizon)\n",
        },
        {
          path: "models/recurrent.py",
          name: "recurrent.py",
          folder: "models",
          preview:
            "# models/recurrent.py (reproduced baseline)\nclass RecurrentPlanner:\n    # Matches published baseline within 0.5 pp on held-out mazes.\n    pass\n",
        },
        {
          path: "eval/ood_suite.py",
          name: "ood_suite.py",
          folder: "eval",
          locked: true,
          preview:
            "# eval/ood_suite.py (LOCKED at commit 4e1c9a2)\n# Integrity checker rejects any run whose eval hash differs.\nHORIZONS = (8, 16, 32)\nSEEDS = (0, 1, 2, 3, 4)\n",
        },
        {
          path: "configs/target_rung.yaml",
          name: "target_rung.yaml",
          folder: "configs",
          preview: "rung: target\nseeds: [0, 1, 2, 3, 4]\nbatch_size: 256\nsteps: 3600\n",
        },
        {
          path: "GOAL.md",
          name: "GOAL.md",
          folder: "",
          preview:
            "# World Model Planning\nImprove out-of-distribution maze planning success at horizon 32 over the reproduced recurrent baseline.\n",
        },
      ],
      pendingEdit: {
        filesChanged: 1,
        additions: 9,
        deletions: 2,
        summary: "models/latent.py",
      },
      agentNotes: [],
    },
  };

  const venueChecklist: ReadonlyArray<VenueChecklistItem> = [
    { id: "error-bars", label: "Error bars", status: "yes" },
    { id: "compute-disclosed", label: "Compute disclosed", status: "yes" },
    { id: "limitations", label: "Limitations", status: "yes" },
    { id: "code-released", label: "Code released", status: "user-decision" },
  ];

  return {
    project,
    nodes,
    branches: branches.map((branch) => ({ ...branch, spec: specsByBranchId[branch.id] })),
    runs,
    findings: [findingC1],
    gates,
    leanClaims,
    jobs,
    metrics,
    backends,
    workedDurationLabel: "8h 12m",
    workflowStepCompleted: 5,
    workflowStepTotal: 7,
    threadEvents,
    horizonSummary,
    branchLiveTelemetry,
    branchWorkspaces,
    venueChecklist,
    workflowYaml: WORLD_MODEL_YAML,
  };
}

function buildCreditAssignmentSnapshot(
  backends: ReadonlyArray<BackendDescription>,
): ResearchWorkspaceSnapshot {
  const projectId = CREDIT_ASSIGNMENT_PROJECT_ID;
  const branchMain = BranchId.make("ca-branch-survey");
  const nodeSurvey = WorkflowNodeId.make("ca-survey");
  const nodeReport = WorkflowNodeId.make("ca-report");

  const runs: Run[] = [];
  const metrics: RunMetric[] = [];
  for (let i = 1; i <= 12; i += 1) {
    const runId = ResearchRunId.make(`ca-run-${String(i).padStart(2, "0")}`);
    runs.push({
      id: runId,
      researchProjectId: projectId,
      branchId: branchMain,
      nodeId: nodeSurvey,
      number: i,
      change: `Reproduce credit-assignment baseline ${i}`,
      seed: i % 3,
      status: "finished",
      verdict: i % 3 === 0 ? "keep" : "discard",
      integrity: "trusted",
      checks: [],
      scope: "toy benchmark",
      backendId: BACKEND_LOCAL_ID,
      gpuHours: 0.12,
      llmUsd: 0.26,
      trackerUrls: [],
      createdAt: hoursAgoIso(18 - i * 0.8),
      endedAt: hoursAgoIso(17.8 - i * 0.8),
    });
    metrics.push({
      runId,
      name: "return_norm",
      value: Number((0.52 + i * 0.014).toFixed(3)),
      split: "holdout",
    });
  }

  return {
    project: {
      id: projectId,
      projectId: ProjectId.make("proj-credit-assignment"),
      title: "credit-assignment",
      goal: "Survey temporal credit assignment methods under delayed sparse rewards and verify key toy benchmarks.",
      workflow: "survey.yaml",
      approvalMode: "ask-risky",
      budget: { gpuHours: 8, usd: 40, llmUsdPerWeek: 25 },
      spent: { gpuHours: 1.4, usd: 0, llmUsd: 3.2 },
      createdAt: hoursAgoIso(20),
      updatedAt: hoursAgoIso(3),
    },
    nodes: [
      {
        id: nodeSurvey,
        researchProjectId: projectId,
        key: "survey",
        kind: "survey",
        agent: "surveyor",
        parentIds: [],
        branchId: branchMain,
        status: "done",
        title: "Sparse-reward literature synthesis",
        summary: "84 papers indexed · 6 taxonomy clusters",
        startedAt: hoursAgoIso(20),
        endedAt: hoursAgoIso(6),
      },
      {
        id: nodeReport,
        researchProjectId: projectId,
        key: "report",
        kind: "report",
        agent: "writer",
        parentIds: [nodeSurvey],
        status: "done",
        title: "Survey report compiled",
        summary: "All 12 baseline reproductions verified",
        startedAt: hoursAgoIso(5),
        endedAt: hoursAgoIso(3),
      },
    ],
    branches: [
      {
        spec: {
          hypothesis:
            "Compare sparse-reward credit assignment baselines on delayed chain benchmarks.",
          metric: "return_norm",
          higherIsBetter: true,
          baseline: 0.54,
          seeds: [0, 1, 2],
          editable: ["experiments/chain_eval.py"],
          command: "uv run experiments/chain_eval.py",
          resources: { gpus: 1, hours: 2 },
          stopRule: "Complete all 12 benchmark reproductions.",
        },
        id: branchMain,
        researchProjectId: projectId,
        label: "A",
        title: "sparse-reward survey",
        kind: "experiment",
        status: "done",
        rung: "small",
        gitBranch: "branch/sparse-reward-survey",
        killRule: "stop after taxonomy convergence",
        budgetGpuHours: 8,
        spentGpuHours: 1.4,
      },
    ],
    runs,
    findings: [
      {
        id: FindingId.make("finding-ca-1"),
        researchProjectId: projectId,
        label: "CA1",
        claim:
          "Hindsight relabeling outperforms eligibility traces once reward delay exceeds 40 steps.",
        evidenceRunIds: runs.slice(0, 6).map((run) => run.id),
        scope: "toy delayed-chain suite",
        status: "approved",
        critic: [
          {
            attack: "Sensitivity to discount factor?",
            response: "Swept gamma across 0.95 to 0.999 with identical ranking.",
            landed: false,
          },
        ],
        caveats: ["Tested only on discrete state spaces."],
        criticModel: "gpt-5.4",
      },
    ],
    gates: [],
    leanClaims: [],
    jobs: [],
    metrics,
    backends,
    workedDurationLabel: "3h 18m",
    workflowStepCompleted: 4,
    workflowStepTotal: 4,
    threadEvents: [
      {
        id: "ca-ev-1",
        kind: "user-message",
        text: "Survey sparse-reward credit assignment methods and reproduce the core toy benchmarks.",
        createdAt: hoursAgoIso(20),
      },
      {
        id: "ca-ev-2",
        kind: "agent-message",
        text: "Survey complete across 84 papers and 12 local benchmark runs. Report compiled and claim CA1 approved.",
        createdAt: hoursAgoIso(3),
      },
    ],
    horizonSummary: [],
    branchLiveTelemetry: {},
    branchWorkspaces: {},
    venueChecklist: [
      { id: "error-bars", label: "Error bars", status: "yes" },
      { id: "compute-disclosed", label: "Compute disclosed", status: "yes" },
      { id: "limitations", label: "Limitations", status: "yes" },
      { id: "code-released", label: "Code released", status: "yes" },
    ],
    workflowYaml:
      "name: survey\nversion: 1\nnodes:\n  - key: survey\n    agent: surveyor\n  - key: report\n    agent: writer\n    needs: [survey]\n",
  };
}

function buildRuleWorldsSnapshot(
  backends: ReadonlyArray<BackendDescription>,
): ResearchWorkspaceSnapshot {
  const projectId = RULE_WORLDS_PROJECT_ID;
  const branchHill = BranchId.make("rw-branch-hillclimb");
  const nodeHill = WorkflowNodeId.make("rw-hillclimb");

  const runs: Run[] = [];
  const metrics: RunMetric[] = [];
  for (let i = 1; i <= 24; i += 1) {
    const runId = ResearchRunId.make(`rw-run-${String(i).padStart(2, "0")}`);
    const crashed = i === 11 || i === 19;
    const val = Number((0.998 - i * 0.00025 + (i % 4 === 0 ? 0.0004 : 0)).toFixed(4));
    runs.push({
      id: runId,
      researchProjectId: projectId,
      branchId: branchHill,
      nodeId: nodeHill,
      number: i,
      change: `Autoresearch tweak ${i}`,
      seed: 0,
      status: crashed ? "failed" : "finished",
      verdict: crashed ? "crash" : i % 3 === 0 ? "keep" : "discard",
      integrity: crashed ? "unchecked" : "trusted",
      checks: [],
      scope: "5-minute holdout",
      backendId: BACKEND_MODAL_ID,
      gpuHours: 0.48,
      llmUsd: 0.28,
      trackerUrls: [],
      createdAt: hoursAgoIso(28 - i * 0.5),
      endedAt: hoursAgoIso(27.8 - i * 0.5),
    });
    if (!crashed) {
      metrics.push({
        runId,
        name: "val_bpb",
        value: val,
        split: "holdout",
      });
    }
  }

  return {
    project: {
      id: projectId,
      projectId: ProjectId.make("proj-rule-worlds"),
      title: "rule-worlds",
      goal: "Hillclimb val_bpb on a fixed 12h Modal compute budget.",
      workflow: "hillclimb.yaml",
      approvalMode: "autonomous",
      budget: { gpuHours: 12, usd: 50, llmUsdPerWeek: 20 },
      spent: { gpuHours: 11.8, usd: 42.5, llmUsd: 6.8 },
      createdAt: hoursAgoIso(30),
      updatedAt: hoursAgoIso(14),
    },
    nodes: [
      {
        id: nodeHill,
        researchProjectId: projectId,
        key: "hillclimb",
        kind: "hillclimb",
        agent: "experimenter",
        parentIds: [],
        branchId: branchHill,
        status: "done",
        title: "Hillclimb · 12h budget",
        summary: "24 runs · 8 kept · val_bpb 0.9929",
        verdict: "0.9929 keep",
        startedAt: hoursAgoIso(28),
        endedAt: hoursAgoIso(14),
      },
    ],
    branches: [
      {
        spec: {
          hypothesis: "Lower val_bpb within a fixed 5-minute training budget.",
          metric: "val_bpb",
          higherIsBetter: false,
          baseline: 0.9979,
          seeds: [0],
          editable: ["train.py"],
          lockedEval: { path: "eval.py", commit: "91c3a0f" },
          command: "uv run train.py",
          resources: { gpus: 1, hours: 0.1 },
          stopRule: "Keep a change only if holdout val_bpb is lower.",
        },
        id: branchHill,
        researchProjectId: projectId,
        label: "A",
        title: "overnight hillclimb",
        kind: "hillclimb",
        status: "done",
        rung: "target",
        gitBranch: "branch/hillclimb-12h",
        killRule: "stop at 12 GPU-h budget",
        budgetGpuHours: 12,
        spentGpuHours: 11.8,
      },
    ],
    runs,
    findings: [],
    gates: [],
    leanClaims: [],
    jobs: [],
    metrics,
    backends,
    workedDurationLabel: "11h 48m",
    workflowStepCompleted: 3,
    workflowStepTotal: 3,
    threadEvents: [
      {
        id: "rw-ev-1",
        kind: "user-message",
        text: "Improve val_bpb on a 12h Modal budget. Edit only train.py.",
        createdAt: hoursAgoIso(28),
      },
      {
        id: "rw-ev-2",
        kind: "agent-message",
        text: "Budget exhausted cleanly after 24 runs (8 kept, 2 crashed). Best val_bpb improved from 0.9979 to 0.9929.",
        createdAt: hoursAgoIso(14),
      },
    ],
    horizonSummary: [],
    branchLiveTelemetry: {},
    branchWorkspaces: {},
    venueChecklist: [
      { id: "error-bars", label: "Error bars", status: "missing" },
      { id: "compute-disclosed", label: "Compute disclosed", status: "yes" },
      { id: "limitations", label: "Limitations", status: "yes" },
      { id: "code-released", label: "Code released", status: "user-decision" },
    ],
    workflowYaml:
      "name: hillclimb\nversion: 1\nnodes:\n  - key: hillclimb\n    agent: experimenter\n    budget_hours: 12\n",
  };
}

export function createInitialSeedSnapshots(): ReadonlyArray<ResearchWorkspaceSnapshot> {
  const backends = createSeedBackends();
  return [
    buildWorldModelSnapshot(backends),
    buildCreditAssignmentSnapshot(backends),
    buildRuleWorldsSnapshot(backends),
  ];
}

export function createStartedProjectSnapshot(
  input: {
    readonly id: ResearchProjectId;
    readonly title: string;
    readonly goal: string;
    readonly workflow: string;
    readonly approvalMode: ApprovalMode;
    readonly budget: ResearchProjectBudget;
  },
  backends: ReadonlyArray<BackendDescription>,
): ResearchWorkspaceSnapshot {
  const nowIso = new Date().toISOString();
  const branchId = BranchId.make(`${input.id}-branch-a`);
  const surveyNodeId = WorkflowNodeId.make(`${input.id}-survey`);
  return {
    project: {
      id: input.id,
      projectId: ProjectId.make(`proj-${input.id}`),
      title: input.title,
      goal: input.goal,
      workflow: input.workflow,
      approvalMode: input.approvalMode,
      budget: { ...input.budget },
      spent: { gpuHours: 0, usd: 0, llmUsd: 0 },
      createdAt: nowIso,
      updatedAt: nowIso,
    },
    nodes: [
      {
        id: surveyNodeId,
        researchProjectId: input.id,
        key: "survey",
        kind: "survey",
        agent: "surveyor",
        parentIds: [],
        branchId,
        status: "running",
        title: "Goal, papers, survey",
        summary: `Initialized ${input.workflow} loop`,
        startedAt: nowIso,
      },
    ],
    branches: [
      {
        spec: {
          hypothesis: input.goal,
          metric: "primary_metric",
          higherIsBetter: true,
          seeds: [0, 1, 2],
          editable: ["models/main.py"],
          command: "uv run eval/run.py",
          resources: { gpus: 1, hours: Math.min(4, input.budget.gpuHours) },
          stopRule: "Keep a change only if holdout improves.",
        },
        id: branchId,
        researchProjectId: input.id,
        label: "A",
        title: "initial hypothesis",
        kind: input.workflow.includes("prove")
          ? "lean"
          : input.workflow.includes("hillclimb")
            ? "hillclimb"
            : "experiment",
        status: "running",
        rung: "toy",
        gitBranch: `branch/${input.id}-a`,
        killRule: "no gain on 2 rungs",
        budgetGpuHours: input.budget.gpuHours,
        spentGpuHours: 0,
      },
    ],
    runs: [],
    findings: [],
    gates: [],
    leanClaims: [],
    jobs: [],
    metrics: [],
    backends,
    workedDurationLabel: "0m",
    workflowStepCompleted: 0,
    workflowStepTotal: 7,
    threadEvents: [
      {
        id: `${input.id}-ev-1`,
        kind: "user-message",
        text: input.goal,
        createdAt: nowIso,
      },
      {
        id: `${input.id}-ev-2`,
        kind: "agent-message",
        text: `Started ${input.workflow} (${input.approvalMode}). Surveying literature and preparing frozen experiment specs.`,
        createdAt: nowIso,
      },
    ],
    horizonSummary: [],
    branchLiveTelemetry: {},
    branchWorkspaces: {},
    venueChecklist: [
      { id: "error-bars", label: "Error bars", status: "missing" },
      { id: "compute-disclosed", label: "Compute disclosed", status: "yes" },
      { id: "limitations", label: "Limitations", status: "missing" },
      { id: "code-released", label: "Code released", status: "user-decision" },
    ],
    workflowYaml: `name: ${input.workflow.replace(/\.yaml$/, "")}\nversion: 1\nnodes:\n  - key: survey\n    agent: surveyor\n`,
  };
}

export function createForkedBranchRecord(
  source: ResearchBranch,
  existingCount: number,
  customTitle?: string,
): { readonly branch: ResearchBranch; readonly node: WorkflowNode } {
  const alphabet = "DEFGHIJKLMNOPQRSTUVWXYZ";
  const label =
    alphabet[Math.max(0, existingCount - 4) % alphabet.length] ?? `B${existingCount + 1}`;
  const nowIso = new Date().toISOString();
  const branchId = BranchId.make(
    `${source.researchProjectId}-fork-${label.toLowerCase()}-${existingCount + 1}`,
  );
  const title = customTitle?.trim() || `fork of ${source.title}`;
  const branch: ResearchBranch = {
    id: branchId,
    researchProjectId: source.researchProjectId,
    label,
    title,
    kind: source.kind,
    status: "running",
    rung: source.rung,
    gitBranch: `branch/${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    ...(source.killRule ? { killRule: source.killRule } : {}),
    budgetGpuHours: Math.max(4, Math.round(source.budgetGpuHours / 2)),
    spentGpuHours: 0,
  };
  const node: WorkflowNode = {
    id: WorkflowNodeId.make(`node-fork-${branchId}`),
    researchProjectId: source.researchProjectId,
    key: `fork-${label.toLowerCase()}`,
    kind: "experiment",
    agent: "experimenter",
    parentIds: [],
    branchId,
    status: "running",
    title: `Forked ${label} from ${source.label}`,
    summary: `${label} · ${source.rung} rung · running`,
    startedAt: nowIso,
  };
  return { branch, node };
}

export function createPrunedNodeRecord(branch: ResearchBranch, reason?: string): WorkflowNode {
  const nowIso = new Date().toISOString();
  return {
    id: WorkflowNodeId.make(`node-pruned-${branch.id}-${Date.now()}`),
    researchProjectId: branch.researchProjectId,
    key: `prune-${branch.label.toLowerCase()}`,
    kind: "experiment",
    parentIds: [],
    branchId: branch.id,
    status: "pruned",
    title: `${branch.label} pruned at ${branch.rung} rung`,
    summary: reason?.trim()
      ? `${branch.label} · ${reason.trim()}`
      : `${branch.label} · pruned by reviewer`,
    startedAt: nowIso,
    endedAt: nowIso,
  };
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function buildPlaceholderReportHtml(snapshot: ResearchWorkspaceSnapshot): string {
  const findingRows =
    snapshot.findings.length > 0
      ? snapshot.findings
          .map(
            (finding) => `
          <section class="card">
            <div class="meta">Claim ${escapeHtml(finding.label)} · ${escapeHtml(finding.status)} · ${finding.evidenceRunIds.length} ledger runs</div>
            <blockquote>${escapeHtml(finding.claim)}</blockquote>
            <p class="muted">Scope: ${escapeHtml(finding.scope)}. Critic attacks: ${finding.critic.length} (${finding.critic.filter((a) => a.landed).length} landed).</p>
            ${
              finding.caveats.length > 0
                ? `<p class="caveat">Caveat: ${escapeHtml(finding.caveats.join(" "))}</p>`
                : ""
            }
          </section>`,
          )
          .join("")
      : `<section class="card"><p class="muted">No formal findings promoted yet. All ${snapshot.runs.length} runs remain recorded in the ledger.</p></section>`;

  const branchRows = snapshot.branches
    .map((branch) => {
      const count = snapshot.runs.filter((run) => run.branchId === branch.id).length;
      return `<tr>
        <td><strong>${escapeHtml(branch.label)}</strong> · ${escapeHtml(branch.title)}</td>
        <td>${escapeHtml(branch.rung)}</td>
        <td>${escapeHtml(branch.status)}</td>
        <td class="num">${count}</td>
        <td class="num">${branch.spentGpuHours.toFixed(1)} / ${branch.budgetGpuHours} GPU-h</td>
      </tr>`;
    })
    .join("");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(snapshot.project.title)} report</title>
    <style>
      :root { color-scheme: dark; }
      body {
        margin: 0;
        padding: 28px 32px 48px;
        font-family: -apple-system, BlinkMacSystemFont, "Inter", system-ui, sans-serif;
        background: #09090b;
        color: #e4e4e7;
        line-height: 1.6;
        max-width: 820px;
        margin-inline: auto;
      }
      h1 { font-size: 24px; margin: 0 0 6px; color: #fafafa; }
      h2 { font-size: 15px; margin: 28px 0 10px; color: #fafafa; border-bottom: 1px solid #27272a; padding-bottom: 6px; }
      .meta { font-size: 12px; color: #a1a1aa; margin-bottom: 8px; }
      .muted { color: #a1a1aa; font-size: 13px; margin: 6px 0; }
      .caveat { color: #fbbf24; font-size: 13px; margin: 8px 0 0; }
      .card { background: #111114; border: 1px solid #27272a; border-radius: 10px; padding: 16px 18px; margin: 12px 0; }
      blockquote { margin: 8px 0; padding-left: 14px; border-left: 2px solid #52525b; color: #fafafa; font-size: 15px; }
      table { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 8px; }
      th, td { text-align: left; padding: 8px 6px; border-bottom: 1px solid #27272a; }
      th { color: #a1a1aa; font-weight: 500; }
      .num { text-align: right; font-variant-numeric: tabular-nums; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
      .pill { display: inline-block; padding: 2px 8px; border-radius: 999px; background: #18181b; border: 1px solid #27272a; font-size: 11px; color: #a1a1aa; margin-right: 6px; }
    </style>
  </head>
  <body>
    <header>
      <div class="meta">MulAgent Provenance Report · Generated from ResearchSnapshot ledger</div>
      <h1>${escapeHtml(snapshot.project.title)}</h1>
      <p class="muted">${escapeHtml(snapshot.project.goal)}</p>
      <div>
        <span class="pill">Workflow: ${escapeHtml(snapshot.project.workflow)}</span>
        <span class="pill">Runs: ${snapshot.runs.length}</span>
        <span class="pill">Compute: ${snapshot.project.spent.gpuHours.toFixed(1)} / ${snapshot.project.budget.gpuHours} GPU-h</span>
        <span class="pill">Spend: $${snapshot.project.spent.usd.toFixed(2)}</span>
      </div>
    </header>
    <h2>Findings</h2>
    ${findingRows}
    <h2>Branch Summary</h2>
    <table>
      <thead>
        <tr>
          <th>Branch</th>
          <th>Rung</th>
          <th>Status</th>
          <th class="num">Runs</th>
          <th class="num">Budget</th>
        </tr>
      </thead>
      <tbody>
        ${branchRows}
      </tbody>
    </table>
    <p class="muted" style="margin-top: 24px">Every numeric entry in this placeholder HTML report is rendered directly from ledger RunMetric and ResearchSnapshot state.</p>
  </body>
</html>`;
}
