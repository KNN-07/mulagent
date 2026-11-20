import type { ExperimentSpec, ResearchRunId, Run, RunMetric } from "@t3tools/contracts";

export interface ChartGeometry {
  readonly width: number;
  readonly height: number;
  readonly padLeft: number;
  readonly padRight: number;
  readonly padTop: number;
  readonly padBottom: number;
}

export const DEFAULT_CHART_GEOMETRY: ChartGeometry = {
  width: 400,
  height: 170,
  padLeft: 20,
  padRight: 20,
  padTop: 24,
  padBottom: 26,
};

export type ChartPointKind = "kept" | "discarded" | "running" | "crash";

export interface BestSoFarPoint {
  readonly runId: ResearchRunId;
  readonly runNumber: number;
  readonly change: string;
  readonly value: number | null;
  readonly bestSoFar: number | null;
  readonly kind: ChartPointKind;
  readonly x: number;
  readonly y: number;
}

export interface BestSoFarTick {
  readonly runNumber: number;
  readonly x: number;
}

export interface BestSoFarChartModel {
  readonly points: ReadonlyArray<BestSoFarPoint>;
  readonly stepPath: string;
  readonly baselineY: number | null;
  readonly baselineValue: number | null;
  readonly bestValue: number | null;
  readonly bestPoint: BestSoFarPoint | null;
  readonly xAxisY: number;
  readonly plotLeft: number;
  readonly plotRight: number;
  readonly ticks: ReadonlyArray<BestSoFarTick>;
  readonly minDomain: number;
  readonly maxDomain: number;
  readonly counts: {
    readonly total: number;
    readonly kept: number;
    readonly discarded: number;
    readonly crashed: number;
    readonly running: number;
  };
}

export function latestMetricValueByRun(
  metrics: ReadonlyArray<RunMetric>,
  metricName: string,
): ReadonlyMap<ResearchRunId, number> {
  const byRun = new Map<ResearchRunId, { readonly step: number; readonly value: number }>();
  for (const row of metrics) {
    if (row.name !== metricName || !Number.isFinite(row.value)) continue;
    const step = row.step ?? -1;
    const existing = byRun.get(row.runId);
    if (!existing || step >= existing.step) {
      byRun.set(row.runId, { step, value: row.value });
    }
  }
  const result = new Map<ResearchRunId, number>();
  for (const [runId, entry] of byRun) {
    result.set(runId, entry.value);
  }
  return result;
}

function isImprovement(candidate: number, currentBest: number, higherIsBetter: boolean): boolean {
  return higherIsBetter ? candidate > currentBest : candidate < currentBest;
}

function classifyPoint(run: Run, value: number | null): ChartPointKind {
  if (run.verdict === "crash" || run.status === "failed") return "crash";
  if (run.status === "running" || run.status === "queued" || run.verdict === "pending") {
    return "running";
  }
  if (run.verdict === "keep" && value !== null) return "kept";
  return "discarded";
}

function computeTicks(points: ReadonlyArray<BestSoFarPoint>): ReadonlyArray<BestSoFarTick> {
  if (points.length === 0) return [];
  const step = points.length <= 6 ? 1 : points.length <= 20 ? 5 : Math.ceil(points.length / 4);
  const ticks: BestSoFarTick[] = [];
  for (let i = 0; i < points.length; i += 1) {
    const point = points[i];
    if (!point) continue;
    const isFirst = i === 0;
    const isMultiple = point.runNumber % step === 0;
    if (isFirst || isMultiple) {
      ticks.push({ runNumber: point.runNumber, x: point.x });
    }
  }
  return ticks;
}

export function computeBestSoFarChart(
  runs: ReadonlyArray<Run>,
  metrics: ReadonlyArray<RunMetric>,
  spec: Pick<ExperimentSpec, "metric" | "higherIsBetter" | "baseline">,
  geometry: ChartGeometry = DEFAULT_CHART_GEOMETRY,
): BestSoFarChartModel {
  const ordered = [...runs].sort((a, b) => a.number - b.number);
  const metricValues = latestMetricValueByRun(metrics, spec.metric);
  const plotLeft = geometry.padLeft;
  const plotRight = geometry.width - geometry.padRight;
  const plotTop = geometry.padTop;
  const xAxisY = geometry.height - geometry.padBottom;
  const crashTrackY = xAxisY - 10;
  const valueBottom = xAxisY - 22;

  const numericValues: number[] = [];
  if (spec.baseline !== undefined && Number.isFinite(spec.baseline)) {
    numericValues.push(spec.baseline);
  }

  let kept = 0;
  let discarded = 0;
  let crashed = 0;
  let running = 0;

  const rawRows = ordered.map((run) => {
    const rawValue = metricValues.get(run.id) ?? null;
    const kind = classifyPoint(run, rawValue);
    if (kind === "kept") kept += 1;
    else if (kind === "crash") crashed += 1;
    else if (kind === "running") running += 1;
    else discarded += 1;

    if (kind !== "crash" && rawValue !== null) {
      numericValues.push(rawValue);
    }
    return { run, rawValue, kind };
  });

  const rawMin = numericValues.length > 0 ? Math.min(...numericValues) : 0;
  const rawMax = numericValues.length > 0 ? Math.max(...numericValues) : 1;
  const span = rawMax - rawMin;
  const pad = span > 0 ? span * 0.12 : Math.max(Math.abs(rawMax) * 0.1, 0.05);
  const minDomain = rawMin - pad;
  const maxDomain = rawMax + pad;
  const domainSpan = maxDomain - minDomain || 1;

  const toX = (index: number): number => {
    if (rawRows.length <= 1) return plotLeft;
    return plotLeft + (index / (rawRows.length - 1)) * (plotRight - plotLeft);
  };

  const toY = (value: number): number => {
    const normalized = (value - minDomain) / domainSpan;
    const vertical = spec.higherIsBetter ? normalized : 1 - normalized;
    return Number((valueBottom - vertical * (valueBottom - plotTop)).toFixed(2));
  };

  let runningBest: number | null = null;
  let bestPoint: BestSoFarPoint | null = null;
  const points: BestSoFarPoint[] = [];

  for (let i = 0; i < rawRows.length; i += 1) {
    const row = rawRows[i];
    if (!row) continue;
    const x = Number(toX(i).toFixed(2));
    if (
      row.kind === "kept" &&
      row.rawValue !== null &&
      (runningBest === null || isImprovement(row.rawValue, runningBest, spec.higherIsBetter))
    ) {
      runningBest = row.rawValue;
    }
    const y =
      row.kind === "crash"
        ? crashTrackY
        : row.rawValue !== null
          ? toY(row.rawValue)
          : runningBest !== null
            ? toY(runningBest)
            : valueBottom;

    const point: BestSoFarPoint = {
      runId: row.run.id,
      runNumber: row.run.number,
      change: row.run.change,
      value: row.rawValue,
      bestSoFar: runningBest,
      kind: row.kind,
      x,
      y,
    };
    points.push(point);
    if (row.kind === "kept" && row.rawValue !== null && runningBest === row.rawValue) {
      bestPoint = point;
    }
  }

  let stepPath = "";
  let prevStepY: number | null = null;
  for (const point of points) {
    if (point.bestSoFar === null) continue;
    const stepY = toY(point.bestSoFar);
    if (prevStepY === null) {
      stepPath = `M${point.x} ${stepY}`;
      prevStepY = stepY;
      continue;
    }
    if (stepY !== prevStepY) {
      stepPath += ` H${point.x} V${stepY}`;
      prevStepY = stepY;
    } else {
      stepPath += ` H${point.x}`;
    }
  }

  const baselineValue =
    spec.baseline !== undefined && Number.isFinite(spec.baseline) ? spec.baseline : null;
  const baselineY = baselineValue !== null ? toY(baselineValue) : null;

  return {
    points,
    stepPath,
    baselineY,
    baselineValue,
    bestValue: runningBest,
    bestPoint,
    xAxisY,
    plotLeft,
    plotRight,
    ticks: computeTicks(points),
    minDomain,
    maxDomain,
    counts: {
      total: ordered.length,
      kept,
      discarded,
      crashed,
      running,
    },
  };
}
