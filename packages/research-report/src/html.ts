export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function escapeAttr(value: string): string {
  return escapeHtml(value);
}

export function formatMetricNumber(value: number, precision = 3): string {
  if (!Number.isFinite(value)) {
    return "NaN";
  }
  const abs = Math.abs(value);
  if (abs === 0) {
    return "0";
  }
  if (abs >= 1000 || abs < 0.0001) {
    return value.toExponential(Math.max(1, precision - 1));
  }
  if (Number.isInteger(value)) {
    return String(value);
  }
  return value.toFixed(precision);
}

export function formatSignedNumber(value: number, precision = 3): string {
  if (!Number.isFinite(value)) {
    return "NaN";
  }
  const formatted = formatMetricNumber(value, precision);
  return value > 0 ? `+${formatted}` : formatted;
}

export function runAnchorId(runId: string): string {
  return `run-${runId}`;
}

export function renderLinkedNumber(runId: string, text: string, metricName?: string): string {
  const metricAttr =
    metricName !== undefined ? ` data-metric-name="${escapeAttr(metricName)}"` : "";
  return `<a class="metric-ref" href="#${escapeAttr(runAnchorId(runId))}" data-run-id="${escapeAttr(runId)}"${metricAttr}>${escapeHtml(text)}</a>`;
}
