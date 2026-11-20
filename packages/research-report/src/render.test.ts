import type {
  BackendId,
  BranchId,
  FindingId,
  GateId,
  JobId,
  ProjectId,
  ResearchProjectId,
  ResearchRunId,
  ResearchSnapshot,
  RunMetric,
  WorkflowNodeId,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { renderReport } from "./render.ts";

const rpId = "rp-1" as ResearchProjectId;
const projId = "proj-1" as ProjectId;
const bHill = "branch-a" as BranchId;
const bExp = "branch-b" as BranchId;
const n1 = "node-1" as WorkflowNodeId;
const n2 = "node-2" as WorkflowNodeId;
const r1 = "r-001" as ResearchRunId;
const r2 = "r-002" as ResearchRunId;
const r3 = "r-003" as ResearchRunId;
const r4 = "r-004" as ResearchRunId;

const snapshot: ResearchSnapshot = {
  project: {
    id: rpId,
    projectId: projId,
    title: "world-model-planning",
    goal: "Improve OOD maze planning with latent rollouts",
    workflow: "research",
    approvalMode: "ask-risky",
    budget: { gpuHours: 40, usd: 120, llmUsdPerWeek: 25 },
    spent: { gpuHours: 14.2, usd: 42.6, llmUsd: 4.5 },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T10:00:00.000Z",
  },
  nodes: [
    {
      id: n1,
      researchProjectId: rpId,
      key: "survey",
      kind: "survey",
      agent: "surveyor",
      parentIds: [],
      status: "done",
      title: "Literature survey",
      verdict: "3 baselines identified",
    },
    {
      id: n2,
      researchProjectId: rpId,
      key: "hillclimb-a",
      kind: "hillclimb",
      agent: "planner",
      parentIds: [n1],
      branchId: bHill,
      status: "running",
      title: "Latent rollout hillclimb",
    },
  ],
  branches: [
    {
      id: bHill,
      researchProjectId: rpId,
      label: "A",
      title: "latent rollouts",
      kind: "hillclimb",
      status: "running",
      rung: "small",
      gitBranch: "branch/latent-rollouts",
      killRule: "Prune if delta < 1 pp after 10 runs",
      budgetGpuHours: 20,
      spentGpuHours: 8.5,
    },
    {
      id: bExp,
      researchProjectId: rpId,
      label: "B",
      title: "recurrent baseline",
      kind: "experiment",
      status: "done",
      rung: "small",
      budgetGpuHours: 10,
      spentGpuHours: 5.7,
    },
  ],
  runs: [
    {
      id: r1,
      researchProjectId: rpId,
      branchId: bHill,
      nodeId: n2,
      number: 1,
      change: "Stochastic latent, 2 samples",
      seed: 0,
      status: "finished",
      verdict: "keep",
      integrity: "trusted",
      checks: [{ name: "spec-diff", passed: true, detail: "clean" }],
      scope: "small",
      backendId: "slurm-1" as BackendId,
      jobId: "job-1" as JobId,
      codeHash: "abc1234",
      gpuHours: 2.1,
      llmUsd: 0.4,
      trackerUrls: [],
      createdAt: "2026-01-01T01:00:00.000Z",
      endedAt: "2026-01-01T02:00:00.000Z",
    },
    {
      id: r2,
      researchProjectId: rpId,
      branchId: bHill,
      nodeId: n2,
      number: 2,
      change: "Double latent width",
      seed: 0,
      status: "failed",
      verdict: "crash",
      integrity: "unchecked",
      checks: [],
      scope: "small",
      gpuHours: 0.3,
      llmUsd: 0.1,
      trackerUrls: [],
      createdAt: "2026-01-01T02:00:00.000Z",
    },
    {
      id: r3,
      researchProjectId: rpId,
      branchId: bHill,
      nodeId: n2,
      number: 3,
      change: "Rollout-horizon curriculum",
      seed: 1,
      status: "finished",
      verdict: "keep",
      integrity: "trusted",
      checks: [{ name: "stats", passed: true, detail: "CI excludes 0" }],
      scope: "small",
      gpuHours: 2.4,
      llmUsd: 0.5,
      trackerUrls: [],
      createdAt: "2026-01-01T03:00:00.000Z",
      endedAt: "2026-01-01T04:00:00.000Z",
    },
    {
      id: r4,
      researchProjectId: rpId,
      branchId: bExp,
      number: 1,
      change: "Reproduced recurrent baseline",
      seed: 0,
      status: "finished",
      verdict: "keep",
      integrity: "trusted",
      checks: [],
      scope: "small",
      gpuHours: 1.8,
      llmUsd: 0.2,
      trackerUrls: [],
      createdAt: "2026-01-01T01:00:00.000Z",
    },
  ],
  findings: [
    {
      id: "f-1" as FindingId,
      researchProjectId: rpId,
      label: "C1",
      claim: "Latent rollouts raise OOD maze success at horizon 32.",
      evidenceRunIds: [r1, r3],
      scope: "small scale only",
      status: "critic-passed",
      critic: [
        {
          attack: "Cherry-picked seeds?",
          response: "All seeds reported and worst beats baseline.",
          landed: false,
        },
      ],
      caveats: ["Flat maze family shows no gain."],
      criticModel: "claude-opus",
    },
  ],
  gates: [
    {
      id: "g-1" as GateId,
      researchProjectId: rpId,
      kind: "claims",
      title: "Approve C1",
      body: "Review claim C1",
      options: [{ id: "approve", label: "Approve", recommended: true }],
      multiSelect: false,
      status: "open",
      createdAt: "2026-01-01T05:00:00.000Z",
    },
  ],
  metrics: [],
  backends: [],
  workflowStepTotal: 0,
  workflowStepCompleted: 0,
  leanClaims: [
    {
      name: "rollout_error_le",
      researchProjectId: rpId,
      informal: "Rollout error grows at most linearly under contraction",
      statementApproved: true,
      status: "proven",
      axioms: [],
    },
    {
      name: "main_bound",
      researchProjectId: rpId,
      informal: "Generalization gap bound",
      statementApproved: true,
      status: "open",
      axioms: ["propext"],
    },
  ],
  jobs: [],
};

const metrics: RunMetric[] = [
  { runId: r1, name: "success_32", value: 0.75, split: "holdout" },
  { runId: r3, name: "success_32", value: 0.776, split: "holdout" },
  { runId: r4, name: "success_32", value: 0.654, split: "holdout" },
];

describe("renderReport", () => {
  it("renders a self-contained HTML report with all sections, anchors, themes, and template resolution", () => {
    const html = renderReport(snapshot, metrics, {
      primaryMetric: "success_32",
      higherIsBetter: true,
      baseline: 0.654,
      template:
        "Curriculum reached {{metric:r-003:success_32}} vs baseline {{metric:r-004:success_32}} (bad ref {{metric:r-999:success_32}}).",
      sweeps: [
        {
          title: "Horizon 32 comparison",
          metric: "success_32",
          higherIsBetter: true,
          rows: [
            {
              label: "h = 32",
              treatmentRunIds: [r1, r3],
              baselineRunIds: [r4],
            },
          ],
        },
      ],
    });

    // Self-contained: no external scripts or external stylesheets
    expect(html).toContain("<!doctype html>");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("fonts.googleapis.com");
    expect(html).toContain("@media (prefers-color-scheme: light)");
    expect(html).toContain("JetBrains Mono");

    // Header
    expect(html).toContain("world-model-planning");
    expect(html).toContain("Improve OOD maze planning with latent rollouts");
    expect(html).toContain("ask-risky");
    expect(html).toContain("14.20 / 40 h");

    // Template resolution + error visibility
    expect(html).toContain('data-run-id="r-003"');
    expect(html).toContain('href="#run-r-003"');
    expect(html).toContain("0.776");
    expect(html).toContain('class="metric-error"');
    expect(html).toContain("MISSING METRIC");

    // Findings + critic + caveats + approval status
    expect(html).toContain("C1");
    expect(html).toContain("small scale only");
    expect(html).toContain("Cherry-picked seeds?");
    expect(html).toContain("Flat maze family shows no gain.");
    expect(html).toContain("awaiting gate approval");

    // Branch run tables (including crashed run r-002) and SVG chart
    expect(html).toContain('id="run-r-002"');
    expect(html).toContain("Double latent width");
    expect(html).toContain("crash");
    expect(html).toContain("<svg");
    expect(html).toContain("baseline 0.654");

    // Sweep table with delta and CI
    expect(html).toContain("Horizon 32 comparison");
    expect(html).toContain("+0.109");
    expect(html).toContain("(n=2)");

    // Lineage, Lean claims, Costs
    expect(html).toContain("Literature survey");
    expect(html).toContain("rollout_error_le");
    expect(html).toContain("proven");
    expect(html).toContain("$42.6");
  });
});
