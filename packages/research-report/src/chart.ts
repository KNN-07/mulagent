import type { Run, RunMetric } from "@t3tools/contracts";
import { escapeAttr, escapeHtml, formatMetricNumber, runAnchorId } from "./html.ts";
import { selectMetricForRun } from "./placeholders.ts";

export type ChartPointKind = "keep" | "discard" | "crash" | "pending";

export interface BestSoFarPoint {
  readonly runId: string;
  readonly runNumber: number;
  readonly kind: ChartPointKind;
  readonly value: number | undefined;
  readonly bestSoFar: number | undefined;
}

export interface BestSoFarSeries {
  readonly metric: string;
  readonly higherIsBetter: boolean;
  readonly baseline: number | undefined;
  readonly points: ReadonlyArray<BestSoFarPoint>;
  readonly bestValue: number | undefined;
  readonly bestRunId: string | undefined;
  readonly keptCount: number;
  readonly crashCount: number;
  readonly yMin: number;
  readonly yMax: number;
}

export interface ComputeBestSoFarOptions {
  readonly metric: string;
  readonly higherIsBetter?: boolean | undefined;
  readonly baseline?: number | undefined;
  readonly split?: RunMetric["split"] | undefined;
}

function classifyPointKind(run: Run, metric: RunMetric | undefined): ChartPointKind {
  if (run.verdict === "crash" || (run.status === "failed" && !metric)) {
    return "crash";
  }
  if (run.verdict === "keep" && metric && Number.isFinite(metric.value)) {
    return "keep";
  }
  if (run.verdict === "pending" || run.status === "queued" || run.status === "running") {
    return "pending";
  }
  return "discard";
}

function isImprovement(next: number, current: number, higherIsBetter: boolean): boolean {
  return higherIsBetter ? next > current : next < current;
}

export function computeBestSoFarSeries(
  runs: ReadonlyArray<Run>,
  metrics: ReadonlyArray<RunMetric>,
  opts: ComputeBestSoFarOptions,
): BestSoFarSeries {
  const higherIsBetter = opts.higherIsBetter ?? true;
  const sorted = [...runs].sort((a, b) => a.number - b.number);

  let currentBest: number | undefined = undefined;
  let bestRunId: string | undefined = undefined;
  let keptCount = 0;
  let crashCount = 0;

  const finiteValues: number[] = [];
  if (opts.baseline !== undefined && Number.isFinite(opts.baseline)) {
    finiteValues.push(opts.baseline);
  }

  const points: BestSoFarPoint[] = sorted.map((run) => {
    const metric = selectMetricForRun(metrics, run.id, opts.metric, { split: opts.split });
    const value = metric && Number.isFinite(metric.value) ? metric.value : undefined;
    const kind = classifyPointKind(run, metric);

    if (kind === "crash") {
      crashCount += 1;
    } else if (kind === "keep" && value !== undefined) {
      keptCount += 1;
      if (currentBest === undefined || isImprovement(value, currentBest, higherIsBetter)) {
        currentBest = value;
        bestRunId = run.id;
      }
    }

    if (value !== undefined && kind !== "crash") {
      finiteValues.push(value);
    }

    return {
      runId: run.id,
      runNumber: run.number,
      kind,
      value,
      bestSoFar: currentBest,
    };
  });

  let yMin = 0;
  let yMax = 1;
  if (finiteValues.length > 0) {
    const rawMin = Math.min(...finiteValues);
    const rawMax = Math.max(...finiteValues);
    const span = rawMax - rawMin;
    const pad = span > 0 ? span * 0.16 : Math.max(Math.abs(rawMax) * 0.1, 0.05);
    yMin = rawMin - pad;
    yMax = rawMax + pad;
  }

  return {
    metric: opts.metric,
    higherIsBetter,
    baseline: opts.baseline,
    points,
    bestValue: currentBest,
    bestRunId,
    keptCount,
    crashCount,
    yMin,
    yMax,
  };
}

export interface RenderChartOptions {
  readonly width?: number | undefined;
  readonly height?: number | undefined;
  readonly precision?: number | undefined;
  readonly scopeLabel?: string | undefined;
}

export function renderBestSoFarSvg(series: BestSoFarSeries, opts?: RenderChartOptions): string {
  const width = opts?.width ?? 560;
  const height = opts?.height ?? 190;
  const precision = opts?.precision ?? 3;

  const padLeft = 24;
  const padRight = 24;
  const padTop = 26;
  const axisY = height - 30;
  const crashY = axisY - 9;
  const plotTop = padTop;
  const plotBottom = axisY - 22;
  const plotWidth = Math.max(40, width - padLeft - padRight);
  const plotHeight = Math.max(40, plotBottom - plotTop);

  const count = series.points.length;
  const xAt = (idx: number): number => {
    if (count <= 1) {
      return padLeft + plotWidth / 2;
    }
    return padLeft + (idx / (count - 1)) * plotWidth;
  };

  const ySpan = series.yMax - series.yMin || 1;
  const yAt = (value: number): number => {
    const ratio = (value - series.yMin) / ySpan;
    const oriented = series.higherIsBetter ? ratio : 1 - ratio;
    return plotBottom - oriented * plotHeight;
  };

  const fmt = (n: number): string => n.toFixed(1);

  const elements: string[] = [];

  // Baseline axis at bottom
  elements.push(
    `<line x1="${padLeft}" y1="${axisY}" x2="${width - padRight}" y2="${axisY}" stroke="var(--border-strong)" stroke-width="1" />`,
  );

  // Dashed baseline line
  if (series.baseline !== undefined && Number.isFinite(series.baseline)) {
    const by = yAt(series.baseline);
    elements.push(
      `<line x1="${padLeft}" y1="${fmt(by)}" x2="${width - padRight}" y2="${fmt(by)}" stroke="var(--muted)" stroke-width="1" stroke-dasharray="3 3" />`,
      `<text x="${width - padRight}" y="${fmt(by - 5)}" text-anchor="end" font-size="10" fill="var(--muted)" font-family="var(--font-sans)">baseline ${escapeHtml(formatMetricNumber(series.baseline, precision))}</text>`,
    );
  }

  // Best-so-far step path
  const stepSegments: string[] = [];
  let prevX: number | undefined;
  let prevY: number | undefined;
  for (let i = 0; i < series.points.length; i += 1) {
    const point = series.points[i];
    if (!point || point.bestSoFar === undefined) {
      continue;
    }
    const px = xAt(i);
    const py = yAt(point.bestSoFar);
    if (prevX === undefined || prevY === undefined) {
      stepSegments.push(`M${fmt(px)} ${fmt(py)}`);
    } else {
      stepSegments.push(`H${fmt(px)}`);
      if (Math.abs(py - prevY) > 0.01) {
        stepSegments.push(`V${fmt(py)}`);
      }
    }
    prevX = px;
    prevY = py;
  }
  if (prevX !== undefined && count > 0) {
    const lastX = xAt(count - 1);
    if (lastX > prevX) {
      stepSegments.push(`H${fmt(lastX)}`);
    }
  }
  if (stepSegments.length > 0) {
    elements.push(
      `<path d="${stepSegments.join(" ")}" fill="none" stroke="var(--accent)" stroke-width="1.6" />`,
    );
  }

  // Individual points linked to run rows
  for (let i = 0; i < series.points.length; i += 1) {
    const point = series.points[i];
    if (!point) {
      continue;
    }
    const px = xAt(i);
    const href = `#${escapeAttr(runAnchorId(point.runId))}`;
    const runAttr = `data-run-id="${escapeAttr(point.runId)}" data-run-number="${point.runNumber}"`;

    if (point.kind === "crash") {
      const s = 3.2;
      elements.push(
        `<a href="${href}" ${runAttr} aria-label="Run ${point.runNumber}: crash">` +
          `<g stroke="var(--red)" stroke-width="1.5">` +
          `<path d="M${fmt(px - s)} ${fmt(crashY - s)} L${fmt(px + s)} ${fmt(crashY + s)} M${fmt(px + s)} ${fmt(crashY - s)} L${fmt(px - s)} ${fmt(crashY + s)}" />` +
          `</g></a>`,
      );
      continue;
    }

    if (point.value === undefined) {
      continue;
    }
    const py = yAt(point.value);
    const valStr = formatMetricNumber(point.value, precision);

    if (point.kind === "keep") {
      elements.push(
        `<a href="${href}" ${runAttr} aria-label="Run ${point.runNumber}: keep ${escapeAttr(valStr)}">` +
          `<circle cx="${fmt(px)}" cy="${fmt(py)}" r="3.2" fill="var(--accent)" />` +
          `</a>`,
      );
    } else if (point.kind === "pending") {
      elements.push(
        `<a href="${href}" ${runAttr} aria-label="Run ${point.runNumber}: pending ${escapeAttr(valStr)}">` +
          `<circle cx="${fmt(px)}" cy="${fmt(py)}" r="3" fill="var(--bg)" stroke="var(--muted)" stroke-width="1.3" stroke-dasharray="1.5 1.5" />` +
          `</a>`,
      );
    } else {
      elements.push(
        `<a href="${href}" ${runAttr} aria-label="Run ${point.runNumber}: discard ${escapeAttr(valStr)}">` +
          `<circle cx="${fmt(px)}" cy="${fmt(py)}" r="3" fill="var(--bg)" stroke="var(--muted)" stroke-width="1.3" />` +
          `</a>`,
      );
    }
  }

  // Best value annotation linked to its run
  if (series.bestValue !== undefined && series.bestRunId !== undefined) {
    const bestIdx = series.points.findIndex((p) => p.runId === series.bestRunId);
    if (bestIdx >= 0) {
      const bx = xAt(bestIdx);
      const by = yAt(series.bestValue);
      const bestText = formatMetricNumber(series.bestValue, precision);
      elements.push(
        `<a href="#${escapeAttr(runAnchorId(series.bestRunId))}" data-run-id="${escapeAttr(series.bestRunId)}">` +
          `<text x="${fmt(bx)}" y="${fmt(Math.max(12, by - 8))}" text-anchor="middle" font-size="10" font-weight="500" fill="var(--fg-strong)" font-family="var(--font-mono)">${escapeHtml(bestText)}</text>` +
          `</a>`,
      );
    }
  }

  // X-axis tick labels
  const tickIndices = selectTickIndices(count);
  const ticks = tickIndices
    .map((idx) => {
      const pt = series.points[idx];
      if (!pt) return "";
      return `<text x="${fmt(xAt(idx))}" y="${axisY + 16}" text-anchor="middle" font-size="10" fill="var(--muted)" font-family="var(--font-sans)">${pt.runNumber}</text>`;
    })
    .join("");

  const ariaLabel = buildChartAriaLabel(series);
  const captionParts = [
    `Best ${series.metric} after each run`,
    `${series.points.length} runs, ${series.keptCount} kept, ${series.crashCount} crashed`,
  ];
  if (opts?.scopeLabel) {
    captionParts.push(`scope: ${opts.scopeLabel}`);
  }

  return (
    `<figure class="chart-figure">` +
    `<svg viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="${escapeAttr(ariaLabel)}" class="best-chart">` +
    elements.join("") +
    ticks +
    `</svg>` +
    `<figcaption class="chart-caption">${escapeHtml(captionParts.join(" · "))}</figcaption>` +
    `</figure>`
  );
}

function selectTickIndices(count: number): number[] {
  if (count <= 0) return [];
  if (count <= 5) {
    return Array.from({ length: count }, (_, i) => i);
  }
  const indices = new Set<number>([0, count - 1]);
  const steps = 4;
  for (let s = 1; s < steps; s += 1) {
    indices.add(Math.round((s / steps) * (count - 1)));
  }
  return [...indices].sort((a, b) => a - b);
}

function buildChartAriaLabel(series: BestSoFarSeries): string {
  const bestPart =
    series.bestValue !== undefined
      ? `best ${series.metric} is ${formatMetricNumber(series.bestValue)}`
      : `no kept runs yet for ${series.metric}`;
  const baselinePart =
    series.baseline !== undefined ? `, baseline ${formatMetricNumber(series.baseline)}` : "";
  return `Best so far chart for ${series.metric}: ${bestPart} across ${series.points.length} runs${baselinePart}`;
}
