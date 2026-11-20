import type { Run, ScaleRung } from "@t3tools/contracts";

export interface RungResult {
  rung: ScaleRung;
  lowerGain95: number;
  integrity: Run["integrity"];
}
export interface KillRule {
  maxGpuHours?: number;
  minGain?: number;
}

export function evaluateLadder(
  rung: ScaleRung,
  results: readonly RungResult[],
  spentGpuHours: number,
  rule: KillRule = {},
) {
  if (
    ![spentGpuHours, rule.maxGpuHours ?? 0].every((v) => Number.isFinite(v) && v >= 0) ||
    !Number.isFinite(rule.minGain ?? 0)
  )
    throw new Error("Invalid ladder limits");
  const latest = (scale: ScaleRung) => results.findLast((r) => r.rung === scale);
  const current = latest(rung);
  if (rule.maxGpuHours !== undefined && spentGpuHours >= rule.maxGpuHours)
    return { type: "prune", reason: "GPU-hour limit" } as const;
  if (
    current?.integrity === "trusted" &&
    rule.minGain !== undefined &&
    current.lowerGain95 < rule.minGain
  )
    return { type: "prune", reason: "gain below threshold" } as const;
  const held = (scale: ScaleRung) => {
    const result = latest(scale);
    return (
      result?.integrity === "trusted" &&
      Number.isFinite(result.lowerGain95) &&
      result.lowerGain95 > 0
    );
  };
  if (rung === "toy" && held("toy")) return { type: "promote", rung: "small" } as const;
  if (rung === "small" && held("toy") && held("small"))
    return { type: "promote", rung: "target" } as const;
  return { type: "hold" } as const;
}

export interface HillclimbTrial {
  runId: Run["id"];
  crashed: boolean;
  checksPassed: boolean;
  holdout?: number;
}

export function hillclimbHistory(
  trials: readonly HillclimbTrial[],
  baseline: number,
  higherIsBetter: boolean,
  noiseFloor: number,
) {
  if (!Number.isFinite(baseline) || !Number.isFinite(noiseFloor) || noiseFloor < 0)
    throw new Error("Invalid baseline or noise floor");
  let best = baseline;
  return trials.map((trial) => {
    const gain = ((trial.holdout ?? NaN) - best) * (higherIsBetter ? 1 : -1);
    const verdict = trial.crashed
      ? "crash"
      : !trial.checksPassed || !Number.isFinite(gain)
        ? "checks-failed"
        : gain > 0
          ? "keep"
          : "discard";
    if (verdict === "keep") best = trial.holdout!;
    return {
      runId: trial.runId,
      verdict,
      best,
      aboveNoiseFloor: verdict === "keep" && gain > noiseFloor,
    } as const;
  });
}
