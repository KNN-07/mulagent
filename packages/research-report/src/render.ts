import type {
  Finding,
  Gate,
  LeanClaim,
  ResearchBranch,
  ResearchSnapshot,
  Run,
  RunMetric,
  WorkflowNode,
} from "@t3tools/contracts";
import { computeBestSoFarSeries, renderBestSoFarSvg } from "./chart.ts";
import {
  escapeAttr,
  escapeHtml,
  formatMetricNumber,
  formatSignedNumber,
  renderLinkedNumber,
  runAnchorId,
} from "./html.ts";
import { resolvePlaceholders, selectMetricForRun } from "./placeholders.ts";
import type { RenderReportOptions, SweepRowSpec, SweepTableSpec } from "./types.ts";

const REPORT_CSS = `
:root {
  --bg: #000000;
  --surface: #0a0a0a;
  --surface-2: #111111;
  --surface-3: #161616;
  --border: #1a1a1a;
  --border-strong: #262626;
  --fg: #ededed;
  --fg-strong: #ffffff;
  --muted: #8a8a8a;
  --muted-2: #a3a3a3;
  --accent: #6ea8fe;
  --green: #3fb950;
  --red: #f85149;
  --amber: #e3b341;
  --purple: #9d8cff;
  --font-sans: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

@media (prefers-color-scheme: light) {
  :root {
    --bg: #ffffff;
    --surface: #fafafa;
    --surface-2: #f4f4f5;
    --surface-3: #ededef;
    --border: #e5e5e7;
    --border-strong: #d4d4d8;
    --fg: #18181b;
    --fg-strong: #09090b;
    --muted: #71717a;
    --muted-2: #52525b;
    --accent: #2563eb;
    --green: #16a34a;
    --red: #dc2626;
    --amber: #b45309;
    --purple: #7c3aed;
  }
}

* { box-sizing: border-box; }
html, body {
  margin: 0;
  padding: 0;
  background: var(--bg);
  color: var(--fg);
  font-family: var(--font-sans);
  font-size: 14px;
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
}
a { color: inherit; text-decoration: none; }
a:hover { color: var(--fg-strong); text-decoration: underline; text-decoration-color: var(--border-strong); }
.mono { font-family: var(--font-mono); font-size: 12px; }
.muted { color: var(--muted); }
.muted-2 { color: var(--muted-2); }

.report-shell {
  max-width: 980px;
  margin: 0 auto;
  padding: 32px 24px 64px;
  display: flex;
  flex-direction: column;
  gap: 32px;
}

.report-header {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding-bottom: 20px;
  border-bottom: 1px solid var(--border);
}
.header-top {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  font-size: 12px;
  color: var(--muted);
}
.project-mark {
  width: 18px;
  height: 18px;
  border-radius: 4px;
  background: var(--surface-3);
  border: 1px solid var(--border-strong);
  color: var(--fg-strong);
  font-size: 9px;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.report-title {
  margin: 0;
  font-size: 24px;
  font-weight: 600;
  color: var(--fg-strong);
  letter-spacing: -0.015em;
}
.report-goal {
  margin: 0;
  color: var(--muted-2);
  font-size: 14px;
}
.meta-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 18px;
  padding: 10px 14px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface);
  font-size: 12px;
  color: var(--muted-2);
}
.meta-item strong { color: var(--fg-strong); font-weight: 500; }

.badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid var(--border-strong);
  background: var(--surface-2);
  font-size: 11px;
  font-weight: 500;
  color: var(--muted-2);
}
.badge-green { color: var(--green); border-color: color-mix(in srgb, var(--green) 35%, transparent); }
.badge-red { color: var(--red); border-color: color-mix(in srgb, var(--red) 35%, transparent); }
.badge-amber { color: var(--amber); border-color: color-mix(in srgb, var(--amber) 35%, transparent); }
.badge-accent { color: var(--accent); border-color: color-mix(in srgb, var(--accent) 35%, transparent); }
.badge-purple { color: var(--purple); border-color: color-mix(in srgb, var(--purple) 35%, transparent); }

.section {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.section-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border);
}
.section-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--fg-strong);
}
.section-sub {
  font-size: 12px;
  color: var(--muted);
}

.metric-ref {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--fg-strong);
  border-bottom: 1px dotted var(--border-strong);
}
.metric-ref:hover { color: var(--accent); border-bottom-color: var(--accent); text-decoration: none; }
.metric-error {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 5px;
  border: 1px solid color-mix(in srgb, var(--red) 45%, transparent);
  background: color-mix(in srgb, var(--red) 12%, transparent);
  color: var(--red);
  font-family: var(--font-mono);
  font-size: 11px;
}

.narrative-card {
  padding: 16px 18px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface);
  white-space: pre-wrap;
}

.finding-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px 18px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface);
}
.finding-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}
.finding-claim {
  margin: 0;
  padding: 2px 0 2px 14px;
  border-left: 2px solid var(--border-strong);
  color: var(--fg-strong);
  font-size: 15px;
  line-height: 1.55;
}
.critic-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: 13px;
  color: var(--muted-2);
}
.critic-item { display: flex; gap: 10px; }
.critic-num { color: var(--muted); width: 16px; flex: none; }
.caveat-line { margin: 0; font-size: 13px; color: var(--amber); }
.evidence-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 14px;
  font-size: 12px;
  color: var(--muted);
}

.branch-card {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px 18px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface);
}
.branch-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
}
.branch-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--fg-strong);
}

.table-wrap { overflow-x: auto; }
table.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
table.data-table th {
  font-weight: 400;
  font-size: 12px;
  color: var(--muted);
  text-align: left;
  padding: 6px 8px 8px 0;
  white-space: nowrap;
}
table.data-table td {
  padding: 8px 8px 8px 0;
  border-top: 1px solid var(--border);
  vertical-align: top;
}
table.data-table th.num,
table.data-table td.num { text-align: right; font-family: var(--font-mono); font-size: 12px; }
table.data-table tr:target { background: var(--surface-3); }

.chart-figure { margin: 4px 0 0; }
.best-chart { display: block; max-width: 600px; height: auto; }
.chart-caption { margin: 6px 0 0; font-size: 12px; color: var(--muted); }

.lineage-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.lineage-item {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  padding: 9px 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface);
  font-size: 13px;
}

.cost-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 10px;
}
.cost-card {
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface);
}
.cost-label { font-size: 12px; color: var(--muted); }
.cost-value { font-size: 18px; font-weight: 600; color: var(--fg-strong); font-family: var(--font-mono); margin-top: 2px; }
.cost-sub { font-size: 12px; color: var(--muted-2); margin-top: 2px; }

.tone-green { color: var(--green); }
.tone-red { color: var(--red); }
.tone-amber { color: var(--amber); }
.tone-accent { color: var(--accent); }
.tone-muted { color: var(--muted); }
`;

interface MetricStats {
  readonly count: number;
  readonly mean: number;
  readonly ciLow: number | undefined;
  readonly ciHigh: number | undefined;
}

function computeMeanAndCi(values: ReadonlyArray<number>): MetricStats | undefined {
  const finite = values.filter((v) => Number.isFinite(v));
  const n = finite.length;
  if (n === 0) return undefined;
  const mean = finite.reduce((sum, v) => sum + v, 0) / n;
  if (n < 2) {
    return { count: n, mean, ciLow: undefined, ciHigh: undefined };
  }
  const variance = finite.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (n - 1);
  const se = Math.sqrt(variance / n);
  // 95% t-critical approximation for small seed counts, falling back to 1.96 for large n.
  const tCrit = tCritical95(n - 1);
  const half = tCrit * se;
  return { count: n, mean, ciLow: mean - half, ciHigh: mean + half };
}

function tCritical95(df: number): number {
  const table: Readonly<Record<number, number>> = {
    1: 12.706,
    2: 4.303,
    3: 3.182,
    4: 2.776,
    5: 2.571,
    6: 2.447,
    7: 2.365,
    8: 2.306,
    9: 2.262,
    10: 2.228,
  };
  return table[df] ?? 1.96;
}

function toneForVerdict(verdict: Run["verdict"]): string {
  switch (verdict) {
    case "keep":
      return "tone-green";
    case "crash":
    case "checks-failed":
      return "tone-red";
    case "pending":
      return "tone-accent";
    case "discard":
      return "tone-muted";
  }
}

function badgeClassForIntegrity(integrity: Run["integrity"]): string {
  switch (integrity) {
    case "trusted":
      return "badge-green";
    case "preliminary":
      return "badge-amber";
    case "rejected":
      return "badge-red";
    case "unchecked":
      return "";
  }
}

function badgeClassForFindingStatus(status: Finding["status"]): string {
  switch (status) {
    case "approved":
    case "critic-passed":
      return "badge-green";
    case "critic-broken":
    case "rejected":
      return "badge-red";
    case "sent-back":
      return "badge-amber";
    case "draft":
      return "";
  }
}

function badgeClassForLeanStatus(status: LeanClaim["status"]): string {
  switch (status) {
    case "proven":
      return "badge-green";
    case "disproved":
    case "rejected":
      return "badge-red";
    case "open":
      return "badge-amber";
  }
}

function badgeClassForNodeStatus(status: WorkflowNode["status"]): string {
  switch (status) {
    case "done":
      return "badge-green";
    case "running":
      return "badge-accent";
    case "waiting-gate":
    case "waiting-question":
      return "badge-amber";
    case "failed":
    case "pruned":
      return "badge-red";
    case "pending":
    case "skipped":
      return "";
  }
}

function badgeClassForBranchStatus(status: ResearchBranch["status"]): string {
  switch (status) {
    case "promoted":
    case "done":
      return "badge-green";
    case "running":
      return "badge-accent";
    case "pruned":
    case "failed":
      return "badge-red";
  }
}

function projectMonogram(title: string): string {
  const words = title
    .trim()
    .split(/[\s_-]+/)
    .filter(Boolean);
  if (words.length >= 2) {
    return `${words[0]?.[0] ?? ""}${words[1]?.[0] ?? ""}`.toUpperCase();
  }
  return title.trim().slice(0, 2).toUpperCase() || "MR";
}

function inferPrimaryMetricForRuns(
  runs: ReadonlyArray<Run>,
  metrics: ReadonlyArray<RunMetric>,
  fallback?: string,
): string | undefined {
  if (fallback !== undefined) {
    return fallback;
  }
  const runIds = new Set(runs.map((r) => r.id));
  const counts = new Map<string, number>();
  for (const metric of metrics) {
    if (!runIds.has(metric.runId)) continue;
    counts.set(metric.name, (counts.get(metric.name) ?? 0) + 1);
  }
  let topName: string | undefined;
  let topCount = -1;
  for (const [name, count] of counts.entries()) {
    if (count > topCount) {
      topName = name;
      topCount = count;
    }
  }
  return topName;
}

function renderHeader(snapshot: ResearchSnapshot, opts?: RenderReportOptions): string {
  const { project, branches, runs, findings, leanClaims } = snapshot;
  const title = opts?.title ?? project.title;
  const monogram = projectMonogram(title);
  const approvalBadge =
    project.approvalMode === "autonomous"
      ? "badge-accent"
      : project.approvalMode === "ask-always"
        ? "badge-amber"
        : "";

  return `<header class="report-header">
  <div class="header-top">
    <span class="project-mark" aria-hidden="true">${escapeHtml(monogram)}</span>
    <span>${escapeHtml(project.title)}</span>
    <span class="badge">${escapeHtml(project.workflow)}</span>
    <span class="badge ${approvalBadge}">approval: ${escapeHtml(project.approvalMode)}</span>
  </div>
  <h1 class="report-title">${escapeHtml(title)}</h1>
  ${project.goal ? `<p class="report-goal">${escapeHtml(project.goal)}</p>` : ""}
  <div class="meta-strip">
    <span class="meta-item">GPU budget: <strong>${formatMetricNumber(project.spent.gpuHours, 2)} / ${formatMetricNumber(project.budget.gpuHours, 2)} h</strong></span>
    <span class="meta-item">Compute spend: <strong>$${formatMetricNumber(project.spent.usd, 2)} / $${formatMetricNumber(project.budget.usd, 2)}</strong></span>
    <span class="meta-item">LLM spend: <strong>$${formatMetricNumber(project.spent.llmUsd, 2)} / $${formatMetricNumber(project.budget.llmUsdPerWeek, 2)} wk</strong></span>
    <span class="meta-item">Branches: <strong>${branches.length}</strong></span>
    <span class="meta-item">Runs: <strong>${runs.length}</strong></span>
    <span class="meta-item">Findings: <strong>${findings.length}</strong></span>
    <span class="meta-item">Lean claims: <strong>${leanClaims.length}</strong></span>
  </div>
</header>`;
}

function renderNarrativeSection(
  template: string,
  snapshot: ResearchSnapshot,
  metrics: ReadonlyArray<RunMetric>,
  precision: number,
): string {
  const knownRunIds = new Set(snapshot.runs.map((r) => r.id));
  const resolved = resolvePlaceholders(template, metrics, { knownRunIds, precision });
  const statusBadge =
    resolved.missing.length > 0
      ? `<span class="badge badge-red">${resolved.missing.length} unresolved metric${resolved.missing.length === 1 ? "" : "s"}</span>`
      : `<span class="badge badge-green">${resolved.resolved.length} ledger-verified metric${resolved.resolved.length === 1 ? "" : "s"}</span>`;

  return `<section class="section" id="narrative">
  <div class="section-head">
    <h2 class="section-title">Report narrative</h2>
    ${statusBadge}
  </div>
  <div class="narrative-card">${resolved.html}</div>
</section>`;
}

function findingApprovalStatus(finding: Finding, gates: ReadonlyArray<Gate>): string {
  if (finding.status === "approved") return "approved";
  if (finding.status === "rejected") return "rejected";
  if (finding.status === "sent-back") return "sent back";
  const openClaimsGate = gates.find((g) => g.kind === "claims" && g.status === "open");
  if (openClaimsGate) return "awaiting gate approval";
  const answeredClaimsGate = gates.find((g) => g.kind === "claims" && g.status === "answered");
  if (answeredClaimsGate) return "gate answered";
  return finding.status;
}

function renderFindingsSection(
  snapshot: ResearchSnapshot,
  metrics: ReadonlyArray<RunMetric>,
  opts: RenderReportOptions | undefined,
  precision: number,
): string {
  const { findings, gates, runs } = snapshot;
  const runMap = new Map(runs.map((r) => [r.id, r]));

  if (findings.length === 0) {
    return `<section class="section" id="findings">
  <div class="section-head">
    <h2 class="section-title">Findings</h2>
    <span class="section-sub">0 findings</span>
  </div>
  <p class="muted">No findings recorded in the ledger yet.</p>
</section>`;
  }

  const cards = findings
    .map((finding) => {
      const landedCount = finding.critic.filter((c) => c.landed).length;
      const approvalText = findingApprovalStatus(finding, gates);

      const evidenceChips = finding.evidenceRunIds
        .map((runId) => {
          const run = runMap.get(runId);
          const metricName =
            opts?.primaryMetric ?? inferPrimaryMetricForRuns(run ? [run] : [], metrics);
          const row = metricName ? selectMetricForRun(metrics, runId, metricName) : undefined;
          const numHtml =
            row && Number.isFinite(row.value)
              ? renderLinkedNumber(runId, formatMetricNumber(row.value, precision), row.name)
              : `<a class="metric-ref" href="#${escapeAttr(runAnchorId(runId))}" data-run-id="${escapeAttr(runId)}">run ${escapeHtml(run ? String(run.number) : runId)}</a>`;
          const prefix = run ? `r#${run.number}` : runId;
          return `<span><a href="#${escapeAttr(runAnchorId(runId))}" data-run-id="${escapeAttr(runId)}" class="mono muted-2">${escapeHtml(prefix)}</a>: ${numHtml}</span>`;
        })
        .join("");

      const criticItems = finding.critic
        .map((entry, idx) => {
          const landedTag = entry.landed
            ? `<span class="badge badge-red">landed</span>`
            : `<span class="badge badge-green">defended</span>`;
          return `<li class="critic-item">
  <span class="critic-num">${idx + 1}</span>
  <span><strong style="color:var(--fg);font-weight:500">${escapeHtml(entry.attack)}</strong> ${landedTag} ${escapeHtml(entry.response)}</span>
</li>`;
        })
        .join("");

      const caveatsHtml = finding.caveats
        .map((c) => `<p class="caveat-line">Caveat: ${escapeHtml(c)}</p>`)
        .join("");

      return `<article class="finding-card" id="finding-${escapeAttr(finding.id)}">
  <div class="finding-head">
    <span class="badge">${escapeHtml(finding.label)}</span>
    <span class="badge ${badgeClassForFindingStatus(finding.status)}">${escapeHtml(finding.status)}</span>
    <span class="badge">approval: ${escapeHtml(approvalText)}</span>
    <span class="muted">scope: ${escapeHtml(finding.scope)}</span>
    ${finding.preliminary ? '<span class="badge">Preliminary</span>' : ""}
    ${finding.criticModel ? `<span class="muted">critic: ${escapeHtml(finding.criticModel)}</span>` : ""}
    <span class="muted" style="margin-left:auto">${finding.critic.length} attacks · ${landedCount} landed</span>
  </div>
  <blockquote class="finding-claim">${escapeHtml(finding.claim)}</blockquote>
  ${evidenceChips ? `<div class="evidence-row"><span>Evidence (${finding.evidenceRunIds.length} runs):</span>${evidenceChips}</div>` : ""}
  ${criticItems ? `<ol class="critic-list">${criticItems}</ol>` : ""}
  ${caveatsHtml}
</article>`;
    })
    .join("\n");

  return `<section class="section" id="findings">
  <div class="section-head">
    <h2 class="section-title">Findings</h2>
    <span class="section-sub">${findings.length} finding${findings.length === 1 ? "" : "s"} · critic &amp; approval status</span>
  </div>
  ${cards}
</section>`;
}

function renderRunRow(
  run: Run,
  metrics: ReadonlyArray<RunMetric>,
  primaryMetric: string | undefined,
  precision: number,
): string {
  const rowMetrics = metrics.filter((m) => m.runId === run.id && Number.isFinite(m.value));
  const primary = primaryMetric
    ? selectMetricForRun(metrics, run.id, primaryMetric)
    : rowMetrics[0];

  const metricCell =
    primary && Number.isFinite(primary.value)
      ? renderLinkedNumber(run.id, formatMetricNumber(primary.value, precision), primary.name)
      : `<span class="muted">&mdash;</span>`;

  const secondaryMetrics = rowMetrics
    .filter((m) => !primary || m.name !== primary.name || m.split !== primary.split)
    .slice(0, 3)
    .map((m) => {
      const label = m.split ? `${m.split}/${m.name}` : m.name;
      return `<span class="muted" style="margin-left:8px">${escapeHtml(label)}=${renderLinkedNumber(run.id, formatMetricNumber(m.value, precision), m.name)}</span>`;
    })
    .join("");

  const changeMeta: string[] = [];
  if (run.seed !== undefined) changeMeta.push(`seed ${run.seed}`);
  if (run.scope) changeMeta.push(run.scope);
  if (run.codeHash) changeMeta.push(`code ${run.codeHash.slice(0, 7)}`);
  const changeMetaHtml =
    changeMeta.length > 0
      ? `<div class="muted" style="font-size:11px">${escapeHtml(changeMeta.join(" · "))}</div>`
      : "";

  const failedChecks = run.checks.filter((c) => !c.passed).map((c) => c.name);
  const integrityDetail =
    failedChecks.length > 0
      ? `<div class="muted" style="font-size:11px">failed: ${escapeHtml(failedChecks.join(", "))}</div>`
      : "";

  return `<tr id="${escapeAttr(runAnchorId(run.id))}" data-run-id="${escapeAttr(run.id)}">
  <td class="mono muted"><a href="#${escapeAttr(runAnchorId(run.id))}" data-run-id="${escapeAttr(run.id)}">${run.number}</a></td>
  <td>
    <div>${escapeHtml(run.change)}</div>
    ${changeMetaHtml}
    ${secondaryMetrics ? `<div style="margin-top:2px;font-size:11px">${secondaryMetrics}</div>` : ""}
  </td>
  <td class="num">${metricCell}</td>
  <td class="${toneForVerdict(run.verdict)}" style="text-align:right;white-space:nowrap">${escapeHtml(run.verdict)}</td>
  <td style="text-align:right;white-space:nowrap">
    <span class="badge ${badgeClassForIntegrity(run.integrity)}">${escapeHtml(run.integrity)}</span>
    ${integrityDetail}
  </td>
</tr>`;
}

function renderBranchSections(
  snapshot: ResearchSnapshot,
  metrics: ReadonlyArray<RunMetric>,
  opts: RenderReportOptions | undefined,
  precision: number,
): string {
  const runsByBranch = new Map<string, Run[]>();
  for (const run of snapshot.runs) {
    const list = runsByBranch.get(run.branchId) ?? [];
    list.push(run);
    runsByBranch.set(run.branchId, list);
  }

  const branchCards: string[] = [];
  const handledBranchIds = new Set<string>();

  for (const branch of snapshot.branches) {
    handledBranchIds.add(branch.id);
    const branchRuns = [...(runsByBranch.get(branch.id) ?? [])].sort((a, b) => a.number - b.number);
    const spec = opts?.branchSpecs?.[branch.id];
    const primaryMetric =
      spec?.metric ?? opts?.primaryMetric ?? inferPrimaryMetricForRuns(branchRuns, metrics);
    const higherIsBetter = spec?.higherIsBetter ?? opts?.higherIsBetter ?? true;
    const baseline = spec?.baseline ?? opts?.baselines?.[branch.id] ?? opts?.baseline;

    const showChart =
      (branch.kind === "hillclimb" || branch.kind === "experiment") &&
      primaryMetric !== undefined &&
      branchRuns.length > 0;

    const chartHtml = showChart
      ? renderBestSoFarSvg(
          computeBestSoFarSeries(branchRuns, metrics, {
            metric: primaryMetric,
            higherIsBetter,
            baseline,
            split: spec?.split,
          }),
          { precision, scopeLabel: `${branch.rung} rung` },
        )
      : "";

    const rowsHtml = branchRuns
      .map((run) => renderRunRow(run, metrics, primaryMetric, precision))
      .join("\n");

    const tableHtml =
      branchRuns.length > 0
        ? `<div class="table-wrap">
  <table class="data-table">
    <thead>
      <tr>
        <th style="width:52px">Run</th>
        <th>Change</th>
        <th class="num">${escapeHtml(primaryMetric ?? "Metric")}</th>
        <th style="text-align:right;width:100px">Verdict</th>
        <th style="text-align:right;width:120px">Integrity</th>
      </tr>
    </thead>
    <tbody>
      ${rowsHtml}
    </tbody>
  </table>
</div>`
        : `<p class="muted">No runs recorded on this branch yet.</p>`;

    branchCards.push(`<article class="branch-card" id="branch-${escapeAttr(branch.id)}">
  <div class="branch-head">
    <h3 class="branch-title">${escapeHtml(branch.label)} · ${escapeHtml(branch.title)}</h3>
    <span class="badge">${escapeHtml(branch.kind)}</span>
    <span class="badge ${badgeClassForBranchStatus(branch.status)}">${escapeHtml(branch.status)}</span>
    <span class="badge">${escapeHtml(branch.rung)}</span>
    ${branch.gitBranch ? `<span class="mono muted">${escapeHtml(branch.gitBranch)}</span>` : ""}
    <span class="muted" style="margin-left:auto">${formatMetricNumber(branch.spentGpuHours, 2)} / ${formatMetricNumber(branch.budgetGpuHours, 2)} GPU-h</span>
  </div>
  ${branch.killRule ? `<div class="muted" style="font-size:12px">Kill rule: ${escapeHtml(branch.killRule)}</div>` : ""}
  ${chartHtml}
  ${tableHtml}
</article>`);
  }

  for (const [branchId, orphanRuns] of runsByBranch.entries()) {
    if (handledBranchIds.has(branchId)) continue;
    const sorted = [...orphanRuns].sort((a, b) => a.number - b.number);
    const primaryMetric = opts?.primaryMetric ?? inferPrimaryMetricForRuns(sorted, metrics);
    const rowsHtml = sorted
      .map((run) => renderRunRow(run, metrics, primaryMetric, precision))
      .join("\n");
    branchCards.push(`<article class="branch-card" id="branch-${escapeAttr(branchId)}">
  <div class="branch-head">
    <h3 class="branch-title">Branch ${escapeHtml(branchId)}</h3>
    <span class="badge">unlisted</span>
  </div>
  <div class="table-wrap">
    <table class="data-table">
      <thead>
        <tr>
          <th style="width:52px">Run</th>
          <th>Change</th>
          <th class="num">${escapeHtml(primaryMetric ?? "Metric")}</th>
          <th style="text-align:right;width:100px">Verdict</th>
          <th style="text-align:right;width:120px">Integrity</th>
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>
  </div>
</article>`);
  }

  return `<section class="section" id="branches">
  <div class="section-head">
    <h2 class="section-title">Branches &amp; runs</h2>
    <span class="section-sub">${snapshot.branches.length} branches · ${snapshot.runs.length} total runs</span>
  </div>
  ${branchCards.length > 0 ? branchCards.join("\n") : `<p class="muted">No branches recorded.</p>`}
</section>`;
}

function collectRunValues(
  runIds: ReadonlyArray<string>,
  metrics: ReadonlyArray<RunMetric>,
  metricName: string,
  split?: RunMetric["split"],
): Array<{ readonly runId: string; readonly value: number }> {
  const out: Array<{ readonly runId: string; readonly value: number }> = [];
  for (const runId of runIds) {
    const row = selectMetricForRun(metrics, runId, metricName, { split });
    if (row && Number.isFinite(row.value)) {
      out.push({ runId, value: row.value });
    }
  }
  return out;
}

function renderSweepRow(
  row: SweepRowSpec,
  table: SweepTableSpec,
  metrics: ReadonlyArray<RunMetric>,
  precision: number,
): string {
  const metricName = row.metric ?? table.metric;
  const treatmentPoints = collectRunValues(row.treatmentRunIds, metrics, metricName, table.split);
  const baselinePoints = row.baselineRunIds
    ? collectRunValues(row.baselineRunIds, metrics, metricName, table.split)
    : [];

  const treatmentStats = computeMeanAndCi(treatmentPoints.map((p) => p.value));
  const baselineStats = computeMeanAndCi(baselinePoints.map((p) => p.value));

  const treatmentAnchorRun = treatmentPoints[0]?.runId ?? row.treatmentRunIds[0];
  const baselineAnchorRun = baselinePoints[0]?.runId ?? row.baselineRunIds?.[0];

  const treatmentHtml =
    treatmentStats && treatmentAnchorRun
      ? renderLinkedNumber(
          treatmentAnchorRun,
          formatMetricNumber(treatmentStats.mean, precision),
          metricName,
        )
      : `<span class="muted">&mdash;</span>`;

  let baselineMean: number | undefined = baselineStats?.mean;
  let baselineHtml = `<span class="muted">&mdash;</span>`;
  if (baselineStats && baselineAnchorRun) {
    baselineHtml = renderLinkedNumber(
      baselineAnchorRun,
      formatMetricNumber(baselineStats.mean, precision),
      metricName,
    );
  } else if (row.baselineValue !== undefined && Number.isFinite(row.baselineValue)) {
    baselineMean = row.baselineValue;
    baselineHtml = formatMetricNumber(row.baselineValue, precision);
  }

  let deltaHtml = `<span class="muted">&mdash;</span>`;
  if (treatmentStats && baselineMean !== undefined && treatmentAnchorRun) {
    const delta = treatmentStats.mean - baselineMean;
    const higherIsBetter = table.higherIsBetter ?? true;
    const improved = higherIsBetter ? delta > 0 : delta < 0;
    const deltaText = `${formatSignedNumber(delta, precision)}${table.unit ? ` ${table.unit}` : ""}`;
    deltaHtml = `<span class="${improved ? "tone-green" : "tone-muted"}">${renderLinkedNumber(treatmentAnchorRun, deltaText, metricName)}</span>`;
  }

  let ciHtml = `<span class="muted">&mdash;</span>`;
  if (
    treatmentStats &&
    treatmentStats.ciLow !== undefined &&
    treatmentStats.ciHigh !== undefined &&
    treatmentAnchorRun
  ) {
    const lo = formatMetricNumber(treatmentStats.ciLow, precision);
    const hi = formatMetricNumber(treatmentStats.ciHigh, precision);
    ciHtml = renderLinkedNumber(
      treatmentAnchorRun,
      `[${lo}, ${hi}] (n=${treatmentStats.count})`,
      metricName,
    );
  } else if (treatmentStats && treatmentAnchorRun) {
    ciHtml = renderLinkedNumber(
      treatmentAnchorRun,
      `n=${treatmentStats.count} (preliminary)`,
      metricName,
    );
  }

  return `<tr>
  <td>${escapeHtml(row.label)}${row.note ? ` <span class="muted" style="font-size:11px">(${escapeHtml(row.note)})</span>` : ""}</td>
  <td class="num">${treatmentHtml}</td>
  <td class="num">${baselineHtml}</td>
  <td class="num">${deltaHtml}</td>
  <td class="num">${ciHtml}</td>
</tr>`;
}

function synthesizeBranchSweeps(
  snapshot: ResearchSnapshot,
  metrics: ReadonlyArray<RunMetric>,
  opts?: RenderReportOptions,
): ReadonlyArray<SweepTableSpec> {
  const groups = new Map<
    string,
    { label: string; branchId: string; metric: string; runIds: string[] }
  >();
  const branchMap = new Map(snapshot.branches.map((b) => [b.id, b]));

  for (const run of snapshot.runs) {
    if (run.verdict === "crash" || run.seed === undefined) continue;
    const branch = branchMap.get(run.branchId);
    const metric =
      opts?.branchSpecs?.[run.branchId]?.metric ??
      opts?.primaryMetric ??
      inferPrimaryMetricForRuns([run], metrics);
    if (!metric) continue;
    const scopeKey = run.scope ?? branch?.rung ?? "default";
    const key = `${run.branchId}::${scopeKey}::${metric}`;
    const existing = groups.get(key) ?? {
      label: `${branch?.label ?? run.branchId} (${scopeKey})`,
      branchId: run.branchId,
      metric,
      runIds: [],
    };
    existing.runIds.push(run.id);
    groups.set(key, existing);
  }

  const rows: SweepRowSpec[] = [];
  for (const group of groups.values()) {
    if (group.runIds.length < 2) continue;
    const baseline =
      opts?.branchSpecs?.[group.branchId]?.baseline ??
      opts?.baselines?.[group.branchId] ??
      opts?.baseline;
    rows.push({
      label: group.label,
      metric: group.metric,
      treatmentRunIds: group.runIds,
      ...(baseline !== undefined ? { baselineValue: baseline } : {}),
    });
  }

  if (rows.length === 0) return [];
  return [
    {
      title: "Multi-seed sweep summary",
      subtitle: "Aggregated across runs with distinct seeds",
      metric: rows[0]?.metric ?? opts?.primaryMetric ?? "metric",
      higherIsBetter: opts?.higherIsBetter ?? true,
      rows,
    },
  ];
}

function renderSweepsSection(
  snapshot: ResearchSnapshot,
  metrics: ReadonlyArray<RunMetric>,
  opts: RenderReportOptions | undefined,
  precision: number,
): string {
  const sweeps =
    opts?.sweeps && opts.sweeps.length > 0
      ? opts.sweeps
      : synthesizeBranchSweeps(snapshot, metrics, opts);

  if (sweeps.length === 0) {
    return "";
  }

  const tablesHtml = sweeps
    .map((table) => {
      const rowsHtml = table.rows
        .map((row) => renderSweepRow(row, table, metrics, precision))
        .join("\n");
      return `<article class="branch-card">
  <div class="branch-head">
    <h3 class="branch-title">${escapeHtml(table.title)}</h3>
    <span class="badge">${escapeHtml(table.metric)}</span>
    ${table.subtitle ? `<span class="muted" style="font-size:12px">${escapeHtml(table.subtitle)}</span>` : ""}
  </div>
  <div class="table-wrap">
    <table class="data-table">
      <thead>
        <tr>
          <th>Condition</th>
          <th class="num">Treatment</th>
          <th class="num">Baseline</th>
          <th class="num">Delta</th>
          <th class="num">95% CI</th>
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>
  </div>
</article>`;
    })
    .join("\n");

  return `<section class="section" id="sweeps">
  <div class="section-head">
    <h2 class="section-title">Horizon &amp; sweep tables</h2>
    <span class="section-sub">${sweeps.length} table${sweeps.length === 1 ? "" : "s"}</span>
  </div>
  ${tablesHtml}
</section>`;
}

function renderLineageSection(snapshot: ResearchSnapshot): string {
  const nodeMap = new Map(snapshot.nodes.map((n) => [n.id, n]));
  const branchMap = new Map(snapshot.branches.map((b) => [b.id, b]));

  const items = snapshot.nodes
    .map((node) => {
      const parents = node.parentIds
        .map((pid) => {
          const parent = nodeMap.get(pid);
          return `<a href="#node-${escapeAttr(pid)}" class="mono muted-2">${escapeHtml(parent?.key ?? pid)}</a>`;
        })
        .join(", ");
      const branch = node.branchId ? branchMap.get(node.branchId) : undefined;
      const branchHtml = branch
        ? `<a href="#branch-${escapeAttr(branch.id)}" class="badge">${escapeHtml(branch.label)}</a>`
        : node.branchId
          ? `<a href="#branch-${escapeAttr(node.branchId)}" class="badge">${escapeHtml(node.branchId)}</a>`
          : "";

      return `<li class="lineage-item" id="node-${escapeAttr(node.id)}">
  <span class="mono muted">${escapeHtml(node.key)}</span>
  <span class="badge">${escapeHtml(node.kind)}</span>
  <span class="badge ${badgeClassForNodeStatus(node.status)}">${escapeHtml(node.status)}</span>
  <strong style="color:var(--fg-strong);font-weight:500">${escapeHtml(node.title)}</strong>
  ${branchHtml}
  ${node.agent ? `<span class="muted">agent: ${escapeHtml(node.agent)}</span>` : ""}
  ${parents ? `<span class="muted">needs: ${parents}</span>` : ""}
  ${node.verdict ? `<span class="muted" style="margin-left:auto">verdict: ${escapeHtml(node.verdict)}</span>` : ""}
</li>`;
    })
    .join("\n");

  return `<section class="section" id="lineage">
  <div class="section-head">
    <h2 class="section-title">Lineage</h2>
    <span class="section-sub">${snapshot.nodes.length} workflow node${snapshot.nodes.length === 1 ? "" : "s"}</span>
  </div>
  ${items ? `<ol class="lineage-list">${items}</ol>` : `<p class="muted">No workflow lineage nodes recorded.</p>`}
</section>`;
}

function renderLeanSection(snapshot: ResearchSnapshot): string {
  const { leanClaims } = snapshot;
  if (leanClaims.length === 0) {
    return `<section class="section" id="lean">
  <div class="section-head">
    <h2 class="section-title">Lean formalization</h2>
    <span class="section-sub">0 claims</span>
  </div>
  <p class="muted">No Lean claims recorded.</p>
</section>`;
  }

  const rows = leanClaims
    .map((claim) => {
      const axiomsText =
        claim.axioms.length > 0 ? claim.axioms.map(escapeHtml).join(", ") : "none (kernel clean)";
      const hasSorry = claim.axioms.some((a) => a.toLowerCase().includes("sorry"));
      return `<tr>
  <td class="mono">${escapeHtml(claim.name)}</td>
  <td>${escapeHtml(claim.informal)}</td>
  <td>${claim.statementApproved ? `<span class="tone-green">approved</span>` : `<span class="muted">pending</span>`}</td>
  <td><span class="badge ${badgeClassForLeanStatus(claim.status)}">${escapeHtml(claim.status)}</span></td>
  <td class="mono ${hasSorry ? "tone-red" : "muted-2"}">${axiomsText}</td>
</tr>`;
    })
    .join("\n");

  return `<section class="section" id="lean">
  <div class="section-head">
    <h2 class="section-title">Lean formalization</h2>
    <span class="section-sub">${leanClaims.length} claim${leanClaims.length === 1 ? "" : "s"}</span>
  </div>
  <div class="table-wrap">
    <table class="data-table">
      <thead>
        <tr>
          <th>Theorem</th>
          <th>Informal statement</th>
          <th>Statement</th>
          <th>Status</th>
          <th>Axioms</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
</section>`;
}

function renderCostsSection(snapshot: ResearchSnapshot): string {
  const { project, runs, branches, jobs } = snapshot;
  const runGpuTotal = runs.reduce((sum, r) => sum + r.gpuHours, 0);
  const runLlmTotal = runs.reduce((sum, r) => sum + r.llmUsd, 0);

  const branchCosts = branches
    .map(
      (b) => `<tr>
  <td><a href="#branch-${escapeAttr(b.id)}">${escapeHtml(b.label)} · ${escapeHtml(b.title)}</a></td>
  <td><span class="badge">${escapeHtml(b.rung)}</span></td>
  <td class="num">${formatMetricNumber(b.spentGpuHours, 2)}</td>
  <td class="num">${formatMetricNumber(b.budgetGpuHours, 2)}</td>
</tr>`,
    )
    .join("\n");

  return `<section class="section" id="costs">
  <div class="section-head">
    <h2 class="section-title">Costs &amp; compute</h2>
    <span class="section-sub">${jobs.length} job${jobs.length === 1 ? "" : "s"} tracked</span>
  </div>
  <div class="cost-grid">
    <div class="cost-card">
      <div class="cost-label">Project GPU hours</div>
      <div class="cost-value">${formatMetricNumber(project.spent.gpuHours, 2)} h</div>
      <div class="cost-sub">of ${formatMetricNumber(project.budget.gpuHours, 2)} h budget · ${formatMetricNumber(runGpuTotal, 2)} h across runs</div>
    </div>
    <div class="cost-card">
      <div class="cost-label">Compute spend</div>
      <div class="cost-value">$${formatMetricNumber(project.spent.usd, 2)}</div>
      <div class="cost-sub">of $${formatMetricNumber(project.budget.usd, 2)} USD budget</div>
    </div>
    <div class="cost-card">
      <div class="cost-label">LLM spend</div>
      <div class="cost-value">$${formatMetricNumber(project.spent.llmUsd, 2)}</div>
      <div class="cost-sub">of $${formatMetricNumber(project.budget.llmUsdPerWeek, 2)} / week · $${formatMetricNumber(runLlmTotal, 2)} on runs</div>
    </div>
  </div>
  ${
    branches.length > 0
      ? `<div class="table-wrap">
  <table class="data-table">
    <thead>
      <tr>
        <th>Branch</th>
        <th>Rung</th>
        <th class="num">Spent GPU-h</th>
        <th class="num">Budget GPU-h</th>
      </tr>
    </thead>
    <tbody>${branchCosts}</tbody>
  </table>
</div>`
      : ""
  }
</section>`;
}

export function renderReport(
  snapshot: ResearchSnapshot,
  metrics: ReadonlyArray<RunMetric>,
  opts?: RenderReportOptions,
): string {
  const precision = opts?.precision ?? 3;
  const title = opts?.title ?? snapshot.project.title;

  const sections = [
    renderHeader(snapshot, opts),
    opts?.template !== undefined
      ? renderNarrativeSection(opts.template, snapshot, metrics, precision)
      : "",
    renderFindingsSection(snapshot, metrics, opts, precision),
    renderBranchSections(snapshot, metrics, opts, precision),
    renderSweepsSection(snapshot, metrics, opts, precision),
    renderLineageSection(snapshot),
    renderLeanSection(snapshot),
    renderCostsSection(snapshot),
  ]
    .filter(Boolean)
    .join("\n");

  const footer = opts?.generatedAt
    ? `<footer class="muted" style="font-size:12px;border-top:1px solid var(--border);padding-top:16px">Generated at ${escapeHtml(opts.generatedAt)} · every number sourced from ledger RunMetric rows</footer>`
    : `<footer class="muted" style="font-size:12px;border-top:1px solid var(--border);padding-top:16px">Every number sourced from ledger RunMetric rows</footer>`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)} &mdash; MulAgent Research Report</title>
  <style>${REPORT_CSS}</style>
</head>
<body>
  <main class="report-shell">
    ${sections}
    ${footer}
  </main>
</body>
</html>`;
}
