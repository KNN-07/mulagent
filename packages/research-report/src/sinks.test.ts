import type {
  BranchId,
  ResearchBranch,
  ResearchProject,
  ResearchProjectId,
  ResearchRunId,
  Run,
  RunMetric,
  ProjectId,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { mapRunToMlflowPayload, mapRunToWandbPayload } from "./sinks.ts";

const rpId = "rp-1" as ResearchProjectId;
const branchId = "branch-a" as BranchId;
const runId = "r-10" as ResearchRunId;

const project: ResearchProject = {
  id: rpId,
  projectId: "proj-1" as ProjectId,
  title: "world-model-planning",
  goal: "Test goal",
  workflow: "hillclimb",
  approvalMode: "autonomous",
  budget: { gpuHours: 10, usd: 50, llmUsdPerWeek: 10 },
  spent: { gpuHours: 1, usd: 5, llmUsd: 1 },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const branch: ResearchBranch = {
  id: branchId,
  researchProjectId: rpId,
  label: "A",
  title: "latent rollouts",
  kind: "hillclimb",
  status: "running",
  rung: "small",
  budgetGpuHours: 10,
  spentGpuHours: 1,
};

const run: Run = {
  id: runId,
  researchProjectId: rpId,
  branchId,
  number: 10,
  change: "Add cosine schedule",
  seed: 42,
  status: "finished",
  verdict: "keep",
  integrity: "trusted",
  checks: [],
  codeHash: "deadbeef",
  gpuHours: 0.75,
  llmUsd: 0.15,
  trackerUrls: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  endedAt: "2026-01-01T00:30:00.000Z",
};

const metrics: RunMetric[] = [
  { runId, name: "loss", value: 1.5, step: 10, split: "train" },
  { runId, name: "acc", value: 0.776, step: 10, split: "holdout" },
  { runId, name: "loss", value: 1.1, step: 20, split: "train" },
];

describe("tracker sink payload mappers", () => {
  it("maps a run and metrics into a W&B payload", () => {
    const payload = mapRunToWandbPayload(run, metrics, {
      researchProject: project,
      branch,
    });

    expect(payload.project).toBe("world-model-planning");
    expect(payload.group).toBe("A");
    expect(payload.state).toBe("finished");
    expect(payload.config.seed).toBe(42);
    expect(payload.config.code_hash).toBe("deadbeef");
    expect(payload.summary["holdout/acc"]).toBe(0.776);
    expect(payload.summary["train/loss"]).toBe(1.1);
    expect(payload.history).toEqual([
      { _step: 10, "train/loss": 1.5, "holdout/acc": 0.776 },
      { _step: 20, "train/loss": 1.1 },
    ]);
    expect(payload.tags).toContain("verdict:keep");
  });

  it("maps a run and metrics into an MLflow payload", () => {
    const payload = mapRunToMlflowPayload(run, metrics, {
      researchProject: project,
      branch,
    });

    expect(payload.experimentName).toBe("world-model-planning");
    expect(payload.runInfo.status).toBe("FINISHED");
    expect(payload.runInfo.endTimeMs).toBeGreaterThan(payload.runInfo.startTimeMs);
    expect(payload.params).toContainEqual({ key: "seed", value: "42" });
    expect(payload.metrics).toContainEqual({
      key: "holdout.acc",
      value: 0.776,
      step: 10,
      timestamp: payload.runInfo.endTimeMs,
    });
    expect(payload.tags).toContainEqual({ key: "mulagent.verdict", value: "keep" });
  });
});
