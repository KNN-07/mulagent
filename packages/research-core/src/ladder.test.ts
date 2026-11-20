import { it, expect } from "vite-plus/test";
import { evaluateLadder, hillclimbHistory, type RungResult } from "./ladder.ts";
import { ResearchRunId } from "@t3tools/contracts";
it("requires two distinct supported rungs to reach target and evaluates kill rules first", () => {
  const toy: RungResult = { rung: "toy", integrity: "trusted", lowerGain95: 0.5 };
  const small: RungResult = { ...toy, rung: "small" };
  expect(evaluateLadder("toy", [toy], 0)).toEqual({ type: "promote", rung: "small" });
  expect(evaluateLadder("small", [small, small], 0).type).toBe("hold");
  expect(evaluateLadder("small", [toy, { ...small, integrity: "preliminary" }], 0).type).toBe(
    "hold",
  );
  expect(evaluateLadder("small", [toy, small], 0)).toEqual({ type: "promote", rung: "target" });
  expect(evaluateLadder("small", [toy, small], 5, { maxGpuHours: 5 }).type).toBe("prune");
  expect(evaluateLadder("small", [toy, small], 0, { minGain: 1 }).type).toBe("prune");
});
it("tracks every trial against the previous valid best on the holdout", () => {
  const series = hillclimbHistory(
    [4, 1, 2, 4.5, 3.9].map((holdout, i) => ({
      runId: ResearchRunId.make(String(i)),
      holdout,
      crashed: i === 1,
      checksPassed: i !== 2,
    })),
    5,
    false,
    0.25,
  );
  expect(series.map((r) => [r.verdict, r.best, r.aboveNoiseFloor])).toEqual([
    ["keep", 4, true],
    ["crash", 4, false],
    ["checks-failed", 4, false],
    ["discard", 4, false],
    ["keep", 3.9, false],
  ]);
});
