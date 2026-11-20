import {
  ExperimentSpec,
  Finding,
  LeanClaim,
  ResearchRunId,
  Run,
  RunMetric,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";
import { Paper } from "./papers.ts";

const text = Schema.NonEmptyString;
const texts = Schema.Array(text);
const nonemptyTexts = texts.check(Schema.isMinLength(1));
const nonnegative = Schema.Number.check(Schema.isGreaterThanOrEqualTo(0), Schema.isFinite());
const overlap = nonnegative.check(Schema.isLessThanOrEqualTo(1));
const metricRef = RunMetric.mapFields(Struct.pick(["runId", "name"]));

export const IdeaCard = Schema.Struct({
  id: text,
  title: text,
  hypothesis: text,
  rationale: text,
  falsifyingExperiment: text,
  computeEstimateGpuHours: nonnegative,
  closestPriorWork: Schema.Array(Schema.Struct({ paperId: text, difference: text })),
});

export type IdeaCard = typeof IdeaCard.Type;

const citedClaim = Schema.Struct({ claim: text, paperIds: nonemptyTexts });
const excerpt = Schema.Struct({ page: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)), text });
const literature = Schema.Array(Paper);
const paperWithExcerpts = Schema.Struct({ paper: Paper, excerpts: Schema.Array(excerpt) });
const experimentDraft = Schema.Struct({
  ideaId: text,
  spec: ExperimentSpec.mapFields((fields) => ({
    ...Struct.omit(fields, ["frozenAt", "specHash", "baseline"]),
    stopRule: text,
  })),
  dataSplit: text,
  baselineProtocol: text,
  risk: text,
  orderingRationale: text,
});
const evidence = Schema.Struct({ runs: Schema.Array(Run), metrics: Schema.Array(RunMetric) });
const findingDraft = Finding.mapFields((fields) => ({
  ...Struct.pick(fields, ["label", "claim", "evidenceRunIds", "scope", "caveats"]),
  preliminary: Schema.Boolean,
  confidenceInterval: Schema.optional(Schema.Struct({ lower: metricRef, upper: metricRef })),
}));
const critique = Finding.mapFields(Struct.pick(["critic", "caveats"]));
const priorWork = Schema.Array(Schema.Struct({ paperId: text, overlap, evidence: text }));
const noveltyInput = Schema.Struct({ idea: IdeaCard });

export const roleSchemas = {
  scout: {
    input: Schema.Struct({ goal: text, knownTerms: Schema.optional(texts) }),
    output: Schema.Struct({ queries: texts.check(Schema.isMinLength(2), Schema.isMaxLength(4)) }),
  },
  surveyor: {
    input: Schema.Struct({ goal: text, papers: Schema.Array(paperWithExcerpts) }),
    output: Schema.Struct({
      taxonomy: Schema.Array(
        Schema.Struct({
          label: text,
          claims: Schema.Array(citedClaim).check(Schema.isMinLength(1)),
        }),
      ),
      baselines: Schema.Array(
        Schema.Struct({
          method: text,
          dataset: text,
          metric: text,
          result: text,
          citation: Schema.Struct({ paperId: text, page: excerpt.fields.page }),
        }),
      ),
      openProblems: Schema.Array(citedClaim),
    }),
  },
  ideator: {
    input: Schema.Struct({
      goal: text,
      papers: literature,
      gaps: Schema.Array(citedClaim),
      budgetGpuHours: nonnegative,
    }),
    output: Schema.Struct({ ideas: Schema.Array(IdeaCard).check(Schema.isMinLength(1)) }),
  },
  tournament: {
    input: Schema.Struct({ goal: text, left: IdeaCard, right: IdeaCard }),
    output: Schema.Struct({
      leftArgument: text,
      rightArgument: text,
      verdict: Schema.Literals(["left", "right", "draw"]),
      rationale: text,
    }),
  },
  noveltySearch: {
    input: noveltyInput,
    output: Schema.Struct({ queries: texts.check(Schema.isMinLength(10)) }),
  },
  novelty: {
    input: Schema.Struct({
      idea: IdeaCard,
      searches: Schema.Array(Schema.Struct({ query: text, papers: literature })).check(
        Schema.isMinLength(10),
      ),
    }),
    output: Schema.Struct({ overlap, closestPriorWork: priorWork, caveats: texts }),
  },
  planner: {
    input: Schema.Struct({
      goal: text,
      ideas: Schema.Array(IdeaCard),
      budgetGpuHours: nonnegative,
    }),
    output: Schema.Struct({
      experiments: Schema.Array(experimentDraft),
      informalTheorems: Schema.Array(
        Schema.Struct({ name: text, assumptions: texts, conclusion: text }),
      ),
    }),
  },
  analyst: {
    input: Schema.Struct({ spec: ExperimentSpec, ...evidence.fields }),
    output: Schema.Struct({
      findings: Schema.Array(findingDraft),
      runs: Schema.Array(Schema.Struct({ runId: ResearchRunId, summary: text })),
    }),
  },
  critic: {
    input: Schema.Struct({
      spec: ExperimentSpec,
      rawLogs: Schema.String,
      claim: Finding.fields.claim,
    }),
    output: critique,
  },
  writer: {
    input: Schema.Struct({
      ...evidence.fields,
      findings: Schema.Array(Finding),
      bibliography: Schema.Array(Schema.Struct({ id: Paper.fields.id, bibtex: text })),
    }),
    output: Schema.Struct({
      markdown: text,
      runs: Schema.Array(Schema.Struct({ runId: ResearchRunId, summary: text })),
    }),
  },
  prover: {
    input: Schema.Struct({
      claim: LeanClaim,
      approvedStatement: Schema.optional(text),
      diagnostics: Schema.optional(Schema.String),
    }),
    output: Schema.Struct({
      leanStatement: text,
      assumptions: texts,
      backTranslation: text,
      mismatches: texts,
      leanProof: Schema.optional(text),
    }),
  },
  backTranslation: {
    input: Schema.Struct({ name: text, leanStatement: text }),
    output: Schema.Struct({ backTranslation: text, assumptions: texts, vacuityRisks: texts }),
  },
  debug: {
    input: Schema.Struct({ task: text, rawLogs: Schema.String }),
    output: Schema.Struct({ diagnosis: text, proposedFix: text }),
  },
};

export type Role = keyof typeof roleSchemas;
export type RoleInput<R extends Role> = (typeof roleSchemas)[R]["input"]["Type"];
export type RoleOutput<R extends Role> = (typeof roleSchemas)[R]["output"]["Type"];
