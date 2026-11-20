import {
  BranchId,
  ResearchProjectId,
  ResearchRunId,
  type Run,
  type RunMetric,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { computeBestSoFarChart, latestMetricValueByRun } from "./chart.logic";
import { createInitialSeedSnapshots, WORLD_MODEL_PROJECT_ID } from "./fixtures/mockSeedData";

const PROJECT_ID = ResearchProjectId.make("p1");
const BRANCH_ID = BranchId.make("b1");

function makeRun(
  number: number,
  verdict: Run["verdict"],
  status: Run["status"] = verdict === "crash"
    ? "failed"
    : verdict === "pending"
      ? "running"
      : "finished",
): Run {
  return {
    id: ResearchRunId.make(`r-${number}`),
    researchProjectId: PROJECT_ID,
    branchId: BRANCH_ID,
    number,
    change: `change ${number}`,
    status,
    verdict,
    integrity: verdict === "crash" ? "unchecked" : "trusted",
    checks: [],
    gpuHours: 0.25,
    llmUsd: 0.1,
    trackerUrls: [],
    createdAt: "2026-11-20T12:00:00.000Z",
  };
}

describe("chart.logic", () => {
  it("picks the highest-step RunMetric value per run for the target metric", () => {
    const r1 = ResearchRunId.make("r-1");
    const r2 = ResearchRunId.make("r-2");
    const metrics: ReadonlyArray<RunMetric> = [
      { runId: r1, name: "success_h32", value: 0.61, step: 100 },
      { runId: r1, name: "success_h32", value: 0.72, step: 500 },
      { runId: r1, name: "acc", split: "holdout", step: 10, value: 0.8 },
      { runId: r1, name: "acc", split: "train", step: 50, value: 1 },
      { runId: r1, name: "other_metric", value: 0.99, step: 900 },
      { runId: r2, name: "success_h32", value: 0.68 },
    ];
    const resolved = latestMetricValueByRun(metrics, "success_h32");
    expect(resolved.get(r1)).toBe(0.72);
    expect(resolved.get(r2)).toBe(0.68);
    expect(latestMetricValueByRun(metrics, "acc:holdout").get(r1)).toBe(0.8);
    expect(latestMetricValueByRun(metrics, "acc").get(r1)).toBe(0.8);
    expect(resolved.size).toBe(2);
  });

  it("computes monotonic step frontier, classifications, and baseline for higher-is-better metrics", () => {
    const runs = [
      makeRun(3, "crash"),
      makeRun(1, "keep"),
      makeRun(2, "discard"),
      makeRun(4, "keep"),
      makeRun(105, "pending"),
    ];
    const metrics: ReadonlyArray<RunMetric> = [
      { runId: ResearchRunId.make("r-1"), name: "acc", value: 0.7 },
      { runId: ResearchRunId.make("r-2"), name: "acc", value: 0.68 },
      { runId: ResearchRunId.make("r-4"), name: "acc", value: 0.78 },
      { runId: ResearchRunId.make("r-105"), name: "acc", value: 0.75 },
    ];
    const model = computeBestSoFarChart(runs, metrics, {
      metric: "acc",
      higherIsBetter: true,
      baseline: 0.65,
    });

    expect(model.points.map((p) => p.runNumber)).toEqual([1, 2, 3, 4, 105]);
    expect(model.ticks.map((tick) => tick.ordinal)).toEqual([1, 2, 3, 4, 5]);
    expect(model.points.map((p) => p.kind)).toEqual([
      "kept",
      "discarded",
      "crash",
      "kept",
      "running",
    ]);
    expect(model.bestValue).toBe(0.78);
    expect(model.bestPoint?.runNumber).toBe(4);
    expect(model.counts).toEqual({ total: 5, kept: 2, discarded: 1, crashed: 1, running: 1 });
    expect(model.baselineY).not.toBeNull();
    // Higher value sits higher on SVG canvas (smaller y) than baseline.
    expect(model.bestPoint!.y).toBeLessThan(model.baselineY!);
    expect(model.stepPath).toContain("M");
    expect(model.stepPath).toContain("V");
  });

  it("inverts improvement direction and canvas elevation for lower-is-better metrics", () => {
    const runs = [makeRun(1, "keep"), makeRun(2, "discard"), makeRun(3, "keep")];
    const metrics: ReadonlyArray<RunMetric> = [
      { runId: ResearchRunId.make("r-1"), name: "val_bpb", value: 0.996 },
      { runId: ResearchRunId.make("r-2"), name: "val_bpb", value: 0.997 },
      { runId: ResearchRunId.make("r-3"), name: "val_bpb", value: 0.992 },
    ];
    const model = computeBestSoFarChart(runs, metrics, {
      metric: "val_bpb",
      higherIsBetter: false,
      baseline: 0.998,
    });

    expect(model.bestValue).toBe(0.992);
    expect(model.bestPoint?.runNumber).toBe(3);
    // For lower-is-better, lower metric maps to a higher visual position (smaller y) than baseline.
    expect(model.bestPoint!.y).toBeLessThan(model.baselineY!);
  });

  it("reconciles the world-model-planning Branch A seed data (16 runs, 7 kept, 2 crashed, 0.776 best)", () => {
    const worldModel = createInitialSeedSnapshots().find(
      (s) => s.project.id === WORLD_MODEL_PROJECT_ID,
    )!;
    const branchA = worldModel.branches.find((b) => b.label === "A")!;
    const spec = branchA.spec!;
    const metricIds = new Set(
      worldModel.metrics.filter((m) => m.name === spec.metric).map((m) => m.runId),
    );
    const hillclimbRuns = worldModel.runs.filter(
      (run) =>
        run.branchId === branchA.id &&
        (metricIds.has(run.id) || run.verdict === "crash" || run.status === "running"),
    );
    const model = computeBestSoFarChart(hillclimbRuns, worldModel.metrics, spec);

    expect(model.counts).toEqual({
      total: 16,
      kept: 7,
      discarded: 6,
      crashed: 2,
      running: 1,
    });
    expect(model.bestValue).toBe(0.776);
    expect(model.baselineValue).toBe(0.654);
  });

  it("handles empty runs cleanly without NaN coordinates", () => {
    const model = computeBestSoFarChart([], [], {
      metric: "loss",
      higherIsBetter: false,
      baseline: undefined,
    });
    expect(model.points).toEqual([]);
    expect(model.stepPath).toBe("");
    expect(model.baselineY).toBeNull();
    expect(model.ticks).toEqual([]);
  });
});
