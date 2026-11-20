import type {
  BranchId,
  ResearchProjectId,
  ResearchRunId,
  Run,
  RunMetric,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { computeBestSoFarSeries, renderBestSoFarSvg } from "./chart.ts";

const projId = "proj-1" as ResearchProjectId;
const branchId = "branch-a" as BranchId;

function makeRun(number: number, verdict: Run["verdict"], status: Run["status"] = "finished"): Run {
  return {
    id: `r-${number}` as ResearchRunId,
    researchProjectId: projId,
    branchId,
    number,
    change: `change ${number}`,
    status,
    verdict,
    integrity: "trusted",
    checks: [],
    gpuHours: 0.5,
    llmUsd: 0.1,
    trackerUrls: [],
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("best-so-far chart math", () => {
  it("computes monotonic best-so-far for higherIsBetter=true across unsorted runs", () => {
    const runs = [
      makeRun(4, "keep"),
      makeRun(2, "discard"),
      makeRun(3, "crash", "failed"),
      makeRun(1, "keep"),
      makeRun(5, "pending", "running"),
    ];
    const metrics: RunMetric[] = [
      { runId: "r-1" as ResearchRunId, name: "acc", value: 0.68, split: "holdout" },
      { runId: "r-2" as ResearchRunId, name: "acc", value: 0.7, split: "holdout" },
      { runId: "r-4" as ResearchRunId, name: "acc", value: 0.776, split: "holdout" },
      { runId: "r-5" as ResearchRunId, name: "acc", value: 0.79, split: "holdout" },
    ];

    const series = computeBestSoFarSeries(runs, metrics, {
      metric: "acc",
      higherIsBetter: true,
      baseline: 0.654,
    });

    expect(series.points.map((p) => p.runNumber)).toEqual([1, 2, 3, 4, 5]);
    expect(series.points.map((p) => p.kind)).toEqual([
      "keep",
      "discard",
      "crash",
      "keep",
      "pending",
    ]);
    // Discarded (0.70) and pending (0.79) must not advance bestSoFar; only kept runs do.
    expect(series.points.map((p) => p.bestSoFar)).toEqual([0.68, 0.68, 0.68, 0.776, 0.776]);
    expect(series.bestValue).toBe(0.776);
    expect(series.bestRunId).toBe("r-4");
    expect(series.keptCount).toBe(2);
    expect(series.crashCount).toBe(1);
    expect(series.yMin).toBeLessThan(0.654);
    expect(series.yMax).toBeGreaterThan(0.79);
  });

  it("computes monotonic non-increasing best-so-far for lowerIsBetter", () => {
    const runs = [makeRun(1, "keep"), makeRun(2, "discard"), makeRun(3, "keep")];
    const metrics: RunMetric[] = [
      { runId: "r-1" as ResearchRunId, name: "val_bpb", value: 1.25 },
      { runId: "r-2" as ResearchRunId, name: "val_bpb", value: 1.28 },
      { runId: "r-3" as ResearchRunId, name: "val_bpb", value: 1.12 },
    ];

    const series = computeBestSoFarSeries(runs, metrics, {
      metric: "val_bpb",
      higherIsBetter: false,
      baseline: 1.3,
    });

    expect(series.points.map((p) => p.bestSoFar)).toEqual([1.25, 1.25, 1.12]);
    expect(series.bestValue).toBe(1.12);
    expect(series.bestRunId).toBe("r-3");
  });

  it("renders inline SVG with baseline, kept filled circles, discarded hollow circles, and crash crosses", () => {
    const runs = [makeRun(1, "keep"), makeRun(2, "discard"), makeRun(3, "crash", "failed")];
    const metrics: RunMetric[] = [
      { runId: "r-1" as ResearchRunId, name: "acc", value: 0.72 },
      { runId: "r-2" as ResearchRunId, name: "acc", value: 0.69 },
    ];
    const series = computeBestSoFarSeries(runs, metrics, {
      metric: "acc",
      higherIsBetter: true,
      baseline: 0.654,
    });
    const svg = renderBestSoFarSvg(series, { scopeLabel: "small scale" });

    expect(svg).toContain("<svg");
    expect(svg).toContain('stroke-dasharray="3 3"');
    expect(svg).toContain("baseline 0.654");
    expect(svg).toContain('fill="var(--accent)"');
    expect(svg).toContain('fill="var(--bg)" stroke="var(--muted)"');
    expect(svg).toContain('stroke="var(--red)"');
    expect(svg).toContain('href="#run-r-1"');
    expect(svg).toContain('data-run-id="r-3"');
    expect(svg).toContain("scope: small scale");
  });
});
