import { describe, expect, it } from "vite-plus/test";

import { createInitialSeedSnapshots, WORLD_MODEL_PROJECT_ID } from "./fixtures/mockSeedData";
import { buildLineageGraph, computeBranchStats } from "./lineage.logic";

describe("lineage.logic", () => {
  it("builds main + A/B/C/Lean lanes, fan-out/merge bridges, and terminates pruned lanes before merge", () => {
    const snapshot = createInitialSeedSnapshots().find(
      (s) => s.project.id === WORLD_MODEL_PROJECT_ID,
    )!;
    const { lanes, rows } = buildLineageGraph(snapshot.nodes, snapshot.branches);

    expect(lanes.map((lane) => lane.label)).toEqual(["main", "A", "B", "C", "Lean"]);
    expect(lanes.map((lane) => lane.tone)).toEqual(["main", "info", "guest", "muted", "success"]);

    // Top row is the waiting merge node, bottom row is initial survey.
    expect(rows[0]?.node.key).toBe("merge");
    expect(rows[0]?.marker).toBe("warning");
    expect(rows[0]?.bridgeSpan?.kind).toBe("merge");

    // Pruned lane C (index 3) does not reach the merge row at row 0.
    expect(rows[0]?.activeLanes.some((seg) => seg.laneIndex === 3)).toBe(false);
    // Active/done lanes A (1), B (2), and Lean (4) connect into merge.
    expect(rows[0]?.activeLanes.map((seg) => seg.laneIndex)).toEqual([0, 1, 2, 4]);

    const fanoutRow = rows.find((row) => row.node.key === "fanout");
    expect(fanoutRow?.bridgeSpan).toEqual({ fromLane: 0, toLane: 4, kind: "fanout" });
    expect(rows.at(-1)?.node.key).toBe("survey");
  });

  it("computes branch best metric, run counts, and scale-ladder rungs for each branch status", () => {
    const snapshot = createInitialSeedSnapshots().find(
      (s) => s.project.id === WORLD_MODEL_PROJECT_ID,
    )!;
    const branchA = snapshot.branches.find((b) => b.label === "A")!;
    const branchC = snapshot.branches.find((b) => b.label === "C")!;

    const statsA = computeBranchStats(
      branchA,
      snapshot.runs,
      snapshot.metrics,
      branchA.spec,
      snapshot.backends,
    );
    expect(statsA.bestMetric).toBe(0.776);
    expect(statsA.totalRuns).toBe(16);
    expect(statsA.keptRuns).toBe(7);
    expect(statsA.crashedRuns).toBe(2);
    expect(statsA.backendLabel).toBe("slurm · taisp");
    expect(statsA.rungs).toEqual([
      { rung: "toy", state: "passed" },
      { rung: "small", state: "passed" },
      { rung: "target", state: "active" },
    ]);

    const statsC = computeBranchStats(
      branchC,
      snapshot.runs,
      snapshot.metrics,
      branchC.spec,
      snapshot.backends,
    );
    expect(statsC.rungs).toEqual([
      { rung: "toy", state: "pruned" },
      { rung: "small", state: "pending" },
      { rung: "target", state: "pending" },
    ]);
  });
});
