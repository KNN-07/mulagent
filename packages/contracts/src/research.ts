import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import {
  IsoDateTime,
  NonNegativeInt,
  PositiveInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";

// Shared research-harness domain. The ledger is the source of truth; every
// number a report shows is read from a RunMetric row with its runId attached.

export const ResearchProjectId = TrimmedNonEmptyString.pipe(Schema.brand("ResearchProjectId"));
export type ResearchProjectId = typeof ResearchProjectId.Type;
export const WorkflowNodeId = TrimmedNonEmptyString.pipe(Schema.brand("WorkflowNodeId"));
export type WorkflowNodeId = typeof WorkflowNodeId.Type;
export const BranchId = TrimmedNonEmptyString.pipe(Schema.brand("BranchId"));
export type BranchId = typeof BranchId.Type;
export const ResearchRunId = TrimmedNonEmptyString.pipe(Schema.brand("ResearchRunId"));
export type ResearchRunId = typeof ResearchRunId.Type;
export const FindingId = TrimmedNonEmptyString.pipe(Schema.brand("FindingId"));
export type FindingId = typeof FindingId.Type;
export const GateId = TrimmedNonEmptyString.pipe(Schema.brand("GateId"));
export type GateId = typeof GateId.Type;
export const BackendId = TrimmedNonEmptyString.pipe(Schema.brand("BackendId"));
export type BackendId = typeof BackendId.Type;
export const JobId = TrimmedNonEmptyString.pipe(Schema.brand("JobId"));
export type JobId = typeof JobId.Type;

export const ApprovalMode = Schema.Literals(["ask-always", "ask-risky", "autonomous"]);
export type ApprovalMode = typeof ApprovalMode.Type;

export const ResearchProject = Schema.Struct({
  id: ResearchProjectId,
  projectId: ProjectId,
  threadId: Schema.optional(ThreadId),
  title: TrimmedNonEmptyString,
  goal: Schema.String,
  workflow: TrimmedNonEmptyString,
  approvalMode: ApprovalMode,
  budget: Schema.Struct({
    gpuHours: Schema.Number,
    usd: Schema.Number,
    llmUsdPerWeek: Schema.Number,
  }),
  spent: Schema.Struct({ gpuHours: Schema.Number, usd: Schema.Number, llmUsd: Schema.Number }),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type ResearchProject = typeof ResearchProject.Type;

export const NodeStatus = Schema.Literals([
  "pending",
  "running",
  "waiting-gate",
  "waiting-question",
  "done",
  "failed",
  "pruned",
  "skipped",
]);
export type NodeStatus = typeof NodeStatus.Type;

export const NodeKind = Schema.Literals([
  "search",
  "survey",
  "ideas",
  "plan",
  "preflight",
  "repro",
  "experiment",
  "hillclimb",
  "prove",
  "merge",
  "review",
  "report",
  "custom",
]);
export type NodeKind = typeof NodeKind.Type;

export const WorkflowNode = Schema.Struct({
  id: WorkflowNodeId,
  researchProjectId: ResearchProjectId,
  key: TrimmedNonEmptyString,
  kind: NodeKind,
  agent: Schema.optional(TrimmedNonEmptyString),
  parentIds: Schema.Array(WorkflowNodeId),
  branchId: Schema.optional(BranchId),
  status: NodeStatus,
  title: Schema.String,
  summary: Schema.optional(Schema.String),
  verdict: Schema.optional(Schema.String),
  startedAt: Schema.optional(IsoDateTime),
  endedAt: Schema.optional(IsoDateTime),
});
export type WorkflowNode = typeof WorkflowNode.Type;

export const ScaleRung = Schema.Literals(["toy", "small", "target"]);
export type ScaleRung = typeof ScaleRung.Type;

export const BranchStatus = Schema.Literals(["running", "promoted", "done", "pruned", "failed"]);
export type BranchStatus = typeof BranchStatus.Type;

export const ResearchBranch = Schema.Struct({
  id: BranchId,
  researchProjectId: ResearchProjectId,
  label: TrimmedNonEmptyString,
  title: Schema.String,
  kind: Schema.Literals(["experiment", "lean", "hillclimb"]),
  status: BranchStatus,
  rung: ScaleRung,
  spec: Schema.optional(Schema.suspend(() => ExperimentSpec)),
  parentBranchId: Schema.optional(BranchId),
  gitBranch: Schema.optional(TrimmedNonEmptyString),
  threadId: Schema.optional(ThreadId),
  killRule: Schema.optional(Schema.String),
  budgetGpuHours: Schema.Number,
  spentGpuHours: Schema.Number,
});
export type ResearchBranch = typeof ResearchBranch.Type;

export const ExperimentSpec = Schema.Struct({
  hypothesis: Schema.String,
  metric: TrimmedNonEmptyString,
  higherIsBetter: Schema.Boolean,
  baseline: Schema.optional(Schema.Number),
  seeds: Schema.Array(Schema.Int),
  editable: Schema.Array(TrimmedNonEmptyString),
  lockedEval: Schema.optional(
    Schema.Struct({ path: TrimmedNonEmptyString, commit: TrimmedNonEmptyString }),
  ),
  command: TrimmedNonEmptyString,
  resources: Schema.suspend(() => ResourceRequest),
  stopRule: Schema.optional(Schema.String),
  splitHash: Schema.optional(TrimmedNonEmptyString),
  splitId: Schema.optional(TrimmedNonEmptyString),
  baselineProtocol: Schema.optional(TrimmedNonEmptyString),
  frozenAt: Schema.optional(IsoDateTime),
  specHash: Schema.optional(TrimmedNonEmptyString),
});
export type ExperimentSpec = typeof ExperimentSpec.Type;

export const RunVerdict = Schema.Literals(["keep", "discard", "crash", "checks-failed", "pending"]);
export type RunVerdict = typeof RunVerdict.Type;

export const IntegrityVerdict = Schema.Literals([
  "trusted",
  "preliminary",
  "rejected",
  "unchecked",
]);
export type IntegrityVerdict = typeof IntegrityVerdict.Type;

export const IntegrityCheck = Schema.Struct({
  name: Schema.Literals(["spec-diff", "leakage", "sanity", "stats"]),
  passed: Schema.Boolean,
  detail: Schema.String,
});
export type IntegrityCheck = typeof IntegrityCheck.Type;

export const Run = Schema.Struct({
  id: ResearchRunId,
  researchProjectId: ResearchProjectId,
  branchId: BranchId,
  nodeId: Schema.optional(WorkflowNodeId),
  number: PositiveInt,
  change: Schema.String,
  seed: Schema.optional(Schema.Int),
  status: Schema.Literals(["queued", "running", "finished", "failed", "cancelled"]),
  verdict: RunVerdict,
  integrity: IntegrityVerdict,
  checks: Schema.Array(IntegrityCheck),
  scope: Schema.optional(Schema.String),
  backendId: Schema.optional(BackendId),
  jobId: Schema.optional(JobId),
  codeHash: Schema.optional(TrimmedNonEmptyString),
  dataHash: Schema.optional(TrimmedNonEmptyString),
  gpuHours: Schema.Number,
  llmUsd: Schema.Number,
  trackerUrls: Schema.Array(
    Schema.Struct({ sink: Schema.Literals(["wandb", "mlflow"]), url: Schema.String }),
  ),
  createdAt: IsoDateTime,
  endedAt: Schema.optional(IsoDateTime),
});
export type Run = typeof Run.Type;

export const RunMetric = Schema.Struct({
  runId: ResearchRunId,
  name: TrimmedNonEmptyString,
  value: Schema.Number,
  step: Schema.optional(NonNegativeInt),
  split: Schema.optional(Schema.Literals(["train", "val", "holdout", "test"])),
});
export type RunMetric = typeof RunMetric.Type;

const MetricReference = Schema.Struct({ runId: ResearchRunId, name: TrimmedNonEmptyString });

export const Finding = Schema.Struct({
  id: FindingId,
  researchProjectId: ResearchProjectId,
  label: TrimmedNonEmptyString,
  claim: Schema.String,
  evidenceRunIds: Schema.Array(ResearchRunId),
  scope: Schema.String,
  status: Schema.Literals([
    "draft",
    "critic-passed",
    "critic-broken",
    "approved",
    "rejected",
    "sent-back",
  ]),
  critic: Schema.Array(
    Schema.Struct({ attack: Schema.String, response: Schema.String, landed: Schema.Boolean }),
  ),
  caveats: Schema.Array(Schema.String),
  preliminary: Schema.optional(Schema.Boolean),
  authorModelFamily: Schema.optional(Schema.Literals(["openai", "anthropic", "google"])),
  ciMetricRefs: Schema.optional(Schema.Struct({ lower: MetricReference, upper: MetricReference })),
  criticModel: Schema.optional(TrimmedNonEmptyString),
});
export type Finding = typeof Finding.Type;

export const LeanClaim = Schema.Struct({
  name: TrimmedNonEmptyString,
  researchProjectId: ResearchProjectId,
  formalStatement: Schema.optional(Schema.String),
  informal: Schema.String,
  statementApproved: Schema.Boolean,
  status: Schema.Literals(["open", "proven", "disproved", "rejected"]),
  axioms: Schema.Array(Schema.String),
});
export type LeanClaim = typeof LeanClaim.Type;

export const GateKind = Schema.Literals([
  "pick-ideas",
  "budget",
  "claims",
  "lean-statement",
  "question",
]);
export type GateKind = typeof GateKind.Type;

export const Gate = Schema.Struct({
  id: GateId,
  researchProjectId: ResearchProjectId,
  nodeId: Schema.optional(WorkflowNodeId),
  kind: GateKind,
  title: Schema.String,
  body: Schema.String,
  options: Schema.Array(
    Schema.Struct({ id: TrimmedNonEmptyString, label: Schema.String, recommended: Schema.Boolean }),
  ),
  multiSelect: Schema.Boolean,
  status: Schema.Literals(["open", "answered", "skipped"]),
  answer: Schema.optional(
    Schema.Struct({
      optionIds: Schema.Array(TrimmedNonEmptyString),
      note: Schema.optional(Schema.String),
    }),
  ),
  createdAt: IsoDateTime,
  answeredAt: Schema.optional(IsoDateTime),
});
export type Gate = typeof Gate.Type;

export const ResourceRequest = Schema.Struct({
  gpus: NonNegativeInt,
  gpuMemGb: Schema.optional(Schema.Number),
  cpus: Schema.optional(PositiveInt),
  memGb: Schema.optional(Schema.Number),
  nodes: Schema.optional(PositiveInt),
  hours: Schema.Number,
  preemptibleOk: Schema.optional(Schema.Boolean),
  image: Schema.optional(TrimmedNonEmptyString),
});
export type ResourceRequest = typeof ResourceRequest.Type;

export const BackendKind = Schema.Literals(["local", "ssh", "slurm", "pbs", "kubernetes", "cloud"]);
export type BackendKind = typeof BackendKind.Type;

export const BackendDescription = Schema.Struct({
  id: BackendId,
  kind: BackendKind,
  label: Schema.String,
  accelerator: Schema.optional(Schema.String),
  gpusTotal: NonNegativeInt,
  gpusFree: Schema.optional(NonNegativeInt),
  nodes: Schema.optional(PositiveInt),
  maxWallHours: Schema.optional(Schema.Number),
  preemptible: Schema.Boolean,
  usdPerGpuHour: Schema.Number,
  queueDepth: Schema.optional(NonNegativeInt),
  healthy: Schema.Boolean,
});
export type BackendDescription = typeof BackendDescription.Type;

export const JobState = Schema.Literals([
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
  "unknown",
]);
export type JobState = typeof JobState.Type;

export const JobStatus = Schema.Struct({
  id: JobId,
  backendId: BackendId,
  runId: Schema.optional(ResearchRunId),
  state: JobState,
  nativeId: Schema.optional(Schema.String),
  estimatedStart: Schema.optional(Schema.String),
  preempted: Schema.optional(Schema.Boolean),
  step: Schema.optional(NonNegativeInt),
  totalSteps: Schema.optional(NonNegativeInt),
  seedIndex: Schema.optional(NonNegativeInt),
  totalSeeds: Schema.optional(NonNegativeInt),
  gpus: Schema.optional(NonNegativeInt),
  etaMinutes: Schema.optional(NonNegativeInt),
  queuePosition: Schema.optional(NonNegativeInt),
  nodes: Schema.Array(Schema.String),
  startedAt: Schema.optional(IsoDateTime),
  endedAt: Schema.optional(IsoDateTime),
  exitCode: Schema.optional(Schema.Int),
});
export type JobStatus = typeof JobStatus.Type;

const ResearchPaper = Schema.Struct({
  id: TrimmedNonEmptyString,
  title: Schema.String,
  authors: Schema.Array(Schema.String),
  abstract: Schema.optional(Schema.String),
  year: Schema.optional(Schema.Int),
  published: Schema.optional(Schema.String),
  url: Schema.optional(Schema.String),
  doi: Schema.optional(Schema.String),
  arxivId: Schema.optional(Schema.String),
  bibtex: Schema.optional(Schema.String),
});
const ResearchSweep = Schema.Struct({
  title: Schema.String,
  subtitle: Schema.optional(Schema.String),
  metric: TrimmedNonEmptyString,
  split: RunMetric.fields.split,
  higherIsBetter: Schema.optional(Schema.Boolean),
  unit: Schema.optional(Schema.String),
  rows: Schema.Array(
    Schema.Struct({
      label: Schema.String,
      metric: Schema.optional(TrimmedNonEmptyString),
      treatmentRunIds: Schema.Array(ResearchRunId),
      baselineRunIds: Schema.optional(Schema.Array(ResearchRunId)),
      baselineValue: Schema.optional(Schema.Finite),
      note: Schema.optional(Schema.String),
    }),
  ),
});
export const ResearchSnapshot = Schema.Struct({
  project: ResearchProject,
  nodes: Schema.Array(WorkflowNode),
  branches: Schema.Array(ResearchBranch),
  runs: Schema.Array(Run),
  findings: Schema.Array(Finding),
  gates: Schema.Array(Gate),
  leanClaims: Schema.Array(LeanClaim),
  pendingEdits: Schema.optional(
    Schema.Record(
      Schema.String,
      Schema.Struct({
        checkpointId: Schema.String,
        filesChanged: NonNegativeInt,
        additions: NonNegativeInt,
        deletions: NonNegativeInt,
        summary: Schema.String,
      }),
    ),
  ),
  workflowYaml: Schema.optional(Schema.String),
  messages: Schema.optional(
    Schema.Array(
      Schema.Struct({
        id: Schema.String,
        body: Schema.String,
        createdAt: IsoDateTime,
        branchId: Schema.optional(Schema.String),
      }),
    ),
  ),
  metrics: Schema.Array(RunMetric).pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
  backends: Schema.Array(BackendDescription).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed([])),
  ),
  workflowStepCompleted: NonNegativeInt.pipe(Schema.withDecodingDefaultKey(Effect.succeed(0))),
  workflowStepTotal: NonNegativeInt.pipe(Schema.withDecodingDefaultKey(Effect.succeed(0))),
  literature: Schema.optional(Schema.Array(ResearchPaper)),
  sweeps: Schema.optional(Schema.Array(ResearchSweep)),
  jobs: Schema.Array(JobStatus),
});
export type ResearchSnapshot = typeof ResearchSnapshot.Type;

export const ResearchMetricsBody = Schema.Struct({
  batchId: Schema.optional(TrimmedNonEmptyString),
  metrics: Schema.Array(
    Schema.Struct({
      name: RunMetric.fields.name,
      value: Schema.Finite,
      step: RunMetric.fields.step,
      split: RunMetric.fields.split,
    }),
  ),
});
export const ResearchParamsBody = Schema.Struct({
  params: Schema.Record(Schema.String, Schema.Json),
});
export const ResearchArtifactsBody = Schema.Struct({
  artifact: Schema.Struct({
    path: Schema.String,
    name: Schema.String,
    type: Schema.String,
    sizeBytes: Schema.optional(NonNegativeInt),
    sha256: Schema.optional(TrimmedNonEmptyString),
  }),
});
export const ResearchFinishBody = Schema.Struct({
  status: Schema.Literals(["finished", "failed", "cancelled"]),
  trackerUrls: Schema.optional(Run.fields.trackerUrls),
  exitCode: Schema.optional(Schema.Int),
  codeHash: Run.fields.codeHash,
  dataHash: Run.fields.dataHash,
  error: Schema.optional(Schema.String),
});
export const ResearchStatusBody = Schema.Struct({
  status: Schema.Literals(["running"]),
  step: JobStatus.fields.step,
  totalSteps: JobStatus.fields.totalSteps,
  seedIndex: JobStatus.fields.seedIndex,
  totalSeeds: JobStatus.fields.totalSeeds,
  gpus: JobStatus.fields.gpus,
  etaMinutes: JobStatus.fields.etaMinutes,
  codeHash: Run.fields.codeHash,
  dataHash: Run.fields.dataHash,
});
