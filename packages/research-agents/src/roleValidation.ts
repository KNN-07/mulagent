import type { Run, RunMetric } from "@t3tools/contracts";
import type { Role, RoleInput, RoleOutput } from "./roles.ts";

type Validator<R extends Role> = (input: RoleInput<R>, output: RoleOutput<R>) => void;
type MetricRef = Pick<RunMetric, "runId" | "name">;

function metricKey({ runId, name }: MetricRef): string {
  return `${runId}:${name}`;
}

function finiteMetricKeys(metrics: readonly RunMetric[]): ReadonlySet<string> {
  const keys = new Set(metrics.map(metricKey));
  for (const metric of metrics) {
    if (!Number.isFinite(metric.value)) keys.delete(metricKey(metric));
  }
  return keys;
}

function verifyProse(
  prose: string,
  metrics: ReadonlySet<string>,
  bibliography: ReadonlySet<string> = new Set(),
) {
  const clean = prose
    .replace(
      /\{\{metric:([^:{}\r\n]+):([^{}\r\n]+)\}\}/g,
      (_placeholder, runId: string, name: string) => {
        const key = `${runId.trim()}:${name.trim()}`;
        if (!metrics.has(key)) throw new Error(`Unknown metric placeholder ${key}`);
        return "";
      },
    )
    .replace(/\[@([^\s[\]@]+)\]/g, (_citation, key: string) => {
      if (!bibliography.has(key)) throw new Error(`Unknown BibTeX citation ${key}`);
      return "";
    });
  if (/\p{N}|\{\{|\[@|https?:\/\/|\]\s*[([]|^\s*\[[^\]]+\]:/mu.test(clean)) {
    throw new Error("Prose requires ledger placeholders for numbers and BibTeX keys for citations");
  }
}

function verifyRunCoverage(
  runs: readonly Run[],
  summaries: readonly { readonly runId: Run["id"] }[],
) {
  const ids = new Set(summaries.map(({ runId }) => runId));
  if (
    ids.size !== summaries.length ||
    ids.size !== runs.length ||
    runs.some(({ id }) => !ids.has(id))
  ) {
    throw new Error("Expected exactly one summary for every supplied run");
  }
}

function verifyPaperIds(paperIds: readonly string[], allowed: ReadonlySet<string>) {
  if (paperIds.some((id) => !allowed.has(id)))
    throw new Error("Output cites a paper outside the supplied literature");
}

export function verifyDistinctQueries(queries: readonly string[]) {
  const normalized = new Set(
    queries.map((query) => query.trim().replace(/\s+/g, " ").toLowerCase()),
  );
  if (normalized.has("") || normalized.size !== queries.length) {
    throw new Error("Expected distinct, nonempty search queries");
  }
}

export const roleValidators: { [R in Role]?: Validator<R> } = {
  scout: (_input, output) => verifyDistinctQueries(output.queries),
  surveyor: (input, output) => {
    const pages = new Map(
      input.papers.map(({ paper, excerpts }) => [
        paper.id,
        new Set(excerpts.map(({ page }) => page)),
      ]),
    );
    const allowed = new Set(pages.keys());
    for (const claim of [
      ...output.taxonomy.flatMap(({ claims }) => claims),
      ...output.openProblems,
    ]) {
      verifyPaperIds(claim.paperIds, allowed);
    }
    for (const { citation } of output.baselines) {
      if (!pages.get(citation.paperId)?.has(citation.page)) {
        throw new Error("Baseline citation requires a supplied excerpt from the cited page");
      }
    }
  },
  ideator: (input, output) => {
    const allowed = new Set(input.papers.map(({ id }) => id));
    if (new Set(output.ideas.map(({ id }) => id)).size !== output.ideas.length)
      throw new Error("Idea IDs must be distinct");
    for (const idea of output.ideas)
      verifyPaperIds(
        idea.closestPriorWork.map(({ paperId }) => paperId),
        allowed,
      );
  },
  noveltySearch: (_input, output) => verifyDistinctQueries(output.queries),
  novelty: (input, output) => {
    verifyDistinctQueries(input.searches.map(({ query }) => query));
    const allowed = new Set(input.searches.flatMap(({ papers }) => papers.map(({ id }) => id)));
    verifyPaperIds(
      output.closestPriorWork.map(({ paperId }) => paperId),
      allowed,
    );
  },
  planner: (input, output) => {
    const ideas = new Set(input.ideas.map(({ id }) => id));
    for (const draft of output.experiments) {
      const { spec } = draft;
      if (
        !ideas.has(draft.ideaId) ||
        !spec.lockedEval ||
        !spec.seeds.length ||
        new Set(spec.seeds).size !== spec.seeds.length
      ) {
        throw new Error(
          "A draft requires a supplied idea, a pinned evaluation, a stop rule, distinct seeds and an evidence-backed baseline protocol",
        );
      }
    }
  },
  analyst: (input, output) => {
    verifyRunCoverage(input.runs, output.runs);
    const allMetrics = new Map(input.metrics.map((metric) => [metricKey(metric), metric.value]));
    const runs = new Map(input.runs.map((run) => [run.id, run]));
    for (const finding of output.findings) {
      const ids = new Set(finding.evidenceRunIds);
      if (ids.size === 0 || [...ids].some((id) => !runs.has(id)))
        throw new Error("Finding evidence must refer to supplied runs");
      const metrics = finiteMetricKeys(input.metrics.filter(({ runId }) => ids.has(runId)));
      for (const prose of [finding.claim, finding.scope, ...finding.caveats])
        verifyProse(prose, metrics);
      let hasInterval = false;
      if (finding.confidenceInterval) {
        const { lower, upper } = finding.confidenceInterval;
        const low = allMetrics.get(metricKey(lower));
        const high = allMetrics.get(metricKey(upper));
        if (
          !metrics.has(metricKey(lower)) ||
          !metrics.has(metricKey(upper)) ||
          low === undefined ||
          high === undefined ||
          !Number.isFinite(low) ||
          !Number.isFinite(high) ||
          low > high
        ) {
          throw new Error(
            "Confidence interval endpoints must be ordered ledger metrics from the finding's evidence",
          );
        }
        hasInterval = true;
      }
      const seeds = new Set(
        finding.evidenceRunIds.flatMap((id) => {
          const run = runs.get(id);
          return run?.status === "finished" && run.integrity === "trusted" && run.seed !== undefined
            ? [run.seed]
            : [];
        }),
      );
      if (!finding.preliminary && (seeds.size < 3 || !hasInterval)) {
        throw new Error(
          "A finding needs three distinct trusted seeds and a confidence interval to leave preliminary status",
        );
      }
    }
    for (const { runId, summary } of output.runs) {
      verifyProse(
        summary,
        finiteMetricKeys(input.metrics.filter((metric) => metric.runId === runId)),
      );
    }
  },
  writer: (input, output) => {
    verifyRunCoverage(input.runs, output.runs);
    const bibliography = new Set<string>();
    for (const { bibtex } of input.bibliography) {
      const entry = /^\s*@([\w]+)\s*[({]\s*([^\s,{}()]+)\s*,/.exec(bibtex);
      const key = entry?.[2];
      if (key && !/^(?:string|comment|preamble)$/i.test(entry?.[1] ?? "")) {
        if (bibliography.has(key)) throw new Error(`Duplicate bibliography key ${key}`);
        bibliography.add(key);
      }
    }
    const runIds = new Set(input.runs.map(({ id }) => id));
    const metrics = finiteMetricKeys(input.metrics.filter(({ runId }) => runIds.has(runId)));
    verifyProse(output.markdown, metrics, bibliography);
    for (const { summary } of output.runs) verifyProse(summary, metrics, bibliography);
  },
  prover: (input, output) => {
    if (!input.claim.statementApproved || input.approvedStatement === undefined) {
      if (output.leanProof !== undefined)
        throw new Error("The exact Lean statement requires approval before drafting a proof");
    } else if (output.leanStatement !== input.approvedStatement) {
      throw new Error("The prover changed the approved Lean statement");
    }
  },
};
