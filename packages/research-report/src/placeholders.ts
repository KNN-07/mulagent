import type { RunMetric } from "@t3tools/contracts";
import { escapeAttr, escapeHtml, formatMetricNumber, renderLinkedNumber } from "./html.ts";

const PLACEHOLDER_REGEX = /\{\{metric:([^:}]+):([^}]+)\}\}/g;

const SPLIT_PRIORITY: Readonly<Record<string, number>> = {
  holdout: 4,
  test: 3,
  val: 2,
  train: 1,
};

export interface MetricPlaceholderToken {
  readonly raw: string;
  readonly runId: string;
  readonly name: string;
  readonly start: number;
  readonly end: number;
}

export interface ResolvedPlaceholder {
  readonly raw: string;
  readonly runId: string;
  readonly name: string;
  readonly metric: RunMetric;
}

export interface MissingPlaceholder {
  readonly raw: string;
  readonly runId: string;
  readonly name: string;
  readonly reason: "missing-run" | "missing-metric" | "non-finite";
}

export interface PlaceholderResolutionResult {
  readonly html: string;
  readonly resolved: ReadonlyArray<ResolvedPlaceholder>;
  readonly missing: ReadonlyArray<MissingPlaceholder>;
}

export interface SelectMetricOptions {
  readonly split?: RunMetric["split"] | undefined;
}

export function selectMetricForRun(
  metrics: ReadonlyArray<RunMetric>,
  runId: string,
  metricName: string,
  opts?: SelectMetricOptions,
): RunMetric | undefined {
  let candidateName = metricName;
  let requestedSplit = opts?.split;

  const colonIdx = metricName.lastIndexOf(":");
  if (colonIdx > 0) {
    const maybeSplit = metricName.slice(colonIdx + 1);
    if (
      maybeSplit === "train" ||
      maybeSplit === "val" ||
      maybeSplit === "holdout" ||
      maybeSplit === "test"
    ) {
      const exactMatch = metrics.some((m) => m.runId === runId && m.name === metricName);
      if (!exactMatch) {
        candidateName = metricName.slice(0, colonIdx);
        requestedSplit = maybeSplit;
      }
    }
  }

  let best: RunMetric | undefined;
  let bestSplitRank = -1;

  for (const row of metrics) {
    if (row.runId !== runId || row.name !== candidateName) {
      continue;
    }
    if (requestedSplit !== undefined && row.split !== requestedSplit) {
      continue;
    }
    const splitRank = row.split !== undefined ? (SPLIT_PRIORITY[row.split] ?? 0) : 0;
    if (
      splitRank > bestSplitRank ||
      (splitRank === bestSplitRank && (row.step ?? -1) >= (best?.step ?? -1))
    ) {
      bestSplitRank = splitRank;
      best = row;
    }
  }

  return best;
}

export function parsePlaceholders(template: string): ReadonlyArray<MetricPlaceholderToken> {
  const tokens: MetricPlaceholderToken[] = [];
  const regex = new RegExp(PLACEHOLDER_REGEX.source, "g");
  let match: RegExpExecArray | null;
  while ((match = regex.exec(template)) !== null) {
    const raw = match[0];
    const runId = match[1]?.trim() ?? "";
    const name = match[2]?.trim() ?? "";
    tokens.push({
      raw,
      runId,
      name,
      start: match.index,
      end: match.index + raw.length,
    });
  }
  return tokens;
}

export interface ResolvePlaceholdersOptions {
  readonly knownRunIds?: ReadonlySet<string> | undefined;
  readonly precision?: number | undefined;
}

export function resolvePlaceholders(
  template: string,
  metrics: ReadonlyArray<RunMetric>,
  opts?: ResolvePlaceholdersOptions,
): PlaceholderResolutionResult {
  const precision = opts?.precision ?? 3;
  const tokens = parsePlaceholders(template);
  const resolved: ResolvedPlaceholder[] = [];
  const missing: MissingPlaceholder[] = [];

  if (tokens.length === 0) {
    return {
      html: escapeHtml(template),
      resolved,
      missing,
    };
  }

  const parts: string[] = [];
  let cursor = 0;

  for (const token of tokens) {
    if (token.start > cursor) {
      parts.push(escapeHtml(template.slice(cursor, token.start)));
    }

    const runExists = opts?.knownRunIds === undefined || opts.knownRunIds.has(token.runId);
    const metric = runExists ? selectMetricForRun(metrics, token.runId, token.name) : undefined;

    if (!runExists) {
      missing.push({
        raw: token.raw,
        runId: token.runId,
        name: token.name,
        reason: "missing-run",
      });
      parts.push(renderMissingPlaceholderError(token.raw, token.runId, token.name, "unknown run"));
    } else if (!metric) {
      missing.push({
        raw: token.raw,
        runId: token.runId,
        name: token.name,
        reason: "missing-metric",
      });
      parts.push(
        renderMissingPlaceholderError(token.raw, token.runId, token.name, "missing metric"),
      );
    } else if (!Number.isFinite(metric.value)) {
      missing.push({
        raw: token.raw,
        runId: token.runId,
        name: token.name,
        reason: "non-finite",
      });
      parts.push(
        renderMissingPlaceholderError(token.raw, token.runId, token.name, "non-finite metric"),
      );
    } else {
      resolved.push({
        raw: token.raw,
        runId: token.runId,
        name: token.name,
        metric,
      });
      parts.push(
        renderLinkedNumber(token.runId, formatMetricNumber(metric.value, precision), metric.name),
      );
    }

    cursor = token.end;
  }

  if (cursor < template.length) {
    parts.push(escapeHtml(template.slice(cursor)));
  }

  return {
    html: parts.join(""),
    resolved,
    missing,
  };
}

function renderMissingPlaceholderError(
  raw: string,
  runId: string,
  name: string,
  reason: string,
): string {
  return `<span class="metric-error" role="alert" data-unresolved-placeholder="${escapeAttr(raw)}" data-run-id="${escapeAttr(runId)}" data-metric-name="${escapeAttr(name)}">[MISSING METRIC (${escapeHtml(reason)}): ${escapeHtml(runId)}:${escapeHtml(name)}]</span>`;
}
