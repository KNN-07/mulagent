import type {
  ResearchBranch,
  ResearchProject,
  ResearchSnapshot,
  Run,
  RunMetric,
} from "@t3tools/contracts";
import type {
  MlflowMetric,
  MlflowParam,
  MlflowRunPayload,
  MlflowTag,
  WandbRunPayload,
} from "./types.ts";

export interface MapRunSinkOptions {
  readonly project?: string | undefined;
  readonly branch?: ResearchBranch | undefined;
  readonly researchProject?: ResearchProject | undefined;
}

function metricKey(metric: RunMetric): string {
  return metric.split !== undefined ? `${metric.split}/${metric.name}` : metric.name;
}

function toEpochMs(iso: string): number {
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function mapRunToWandbPayload(
  run: Run,
  metrics: ReadonlyArray<RunMetric>,
  opts?: MapRunSinkOptions,
): WandbRunPayload {
  const runMetrics = metrics.filter((m) => m.runId === run.id && Number.isFinite(m.value));
  const project = opts?.project ?? opts?.researchProject?.title ?? String(run.researchProjectId);
  const group = opts?.branch?.label ?? String(run.branchId);
  const jobType = opts?.branch?.kind ?? "experiment";

  const state: WandbRunPayload["state"] =
    run.status === "finished"
      ? "finished"
      : run.status === "failed"
        ? "failed"
        : run.status === "cancelled"
          ? "killed"
          : "running";

  const config: Record<string, string | number | boolean | null> = {
    run_id: run.id,
    run_number: run.number,
    branch_id: run.branchId,
    change: run.change,
    seed: run.seed ?? null,
    scope: run.scope ?? null,
    code_hash: run.codeHash ?? null,
    data_hash: run.dataHash ?? null,
    backend_id: run.backendId ?? null,
    job_id: run.jobId ?? null,
    rung: opts?.branch?.rung ?? null,
  };

  const summary: Record<string, string | number | boolean | null> = {
    verdict: run.verdict,
    integrity: run.integrity,
    gpu_hours: run.gpuHours,
    llm_usd: run.llmUsd,
  };

  const byStep = new Map<number, Record<string, number>>();
  for (const metric of runMetrics) {
    const key = metricKey(metric);
    summary[key] = metric.value;
    const step = metric.step ?? 0;
    const existing = byStep.get(step) ?? { _step: step };
    existing[key] = metric.value;
    byStep.set(step, existing);
  }

  const history = [...byStep.entries()].sort((a, b) => a[0] - b[0]).map((entry) => entry[1]);

  const tags = [
    ...(opts?.branch ? [opts.branch.kind, opts.branch.rung] : []),
    `verdict:${run.verdict}`,
    `integrity:${run.integrity}`,
  ];

  return {
    runId: run.id,
    name: `run-${run.number}-${run.id}`,
    project,
    group,
    jobType,
    state,
    notes: run.change,
    tags,
    config,
    summary,
    history,
  };
}

export function mapRunsToWandbPayloads(
  snapshot: ResearchSnapshot,
  metrics: ReadonlyArray<RunMetric>,
): ReadonlyArray<WandbRunPayload> {
  const branchMap = new Map(snapshot.branches.map((branch) => [branch.id, branch]));
  return snapshot.runs.map((run) =>
    mapRunToWandbPayload(run, metrics, {
      project: snapshot.project.title,
      branch: branchMap.get(run.branchId),
      researchProject: snapshot.project,
    }),
  );
}

export function mapRunToMlflowPayload(
  run: Run,
  metrics: ReadonlyArray<RunMetric>,
  opts?: MapRunSinkOptions,
): MlflowRunPayload {
  const runMetrics = metrics.filter((m) => m.runId === run.id && Number.isFinite(m.value));
  const experimentName =
    opts?.project ?? opts?.researchProject?.title ?? String(run.researchProjectId);
  const startTimeMs = toEpochMs(run.createdAt);
  const endTimeMs = run.endedAt !== undefined ? toEpochMs(run.endedAt) : undefined;

  const status: MlflowRunPayload["runInfo"]["status"] =
    run.status === "finished"
      ? "FINISHED"
      : run.status === "failed"
        ? "FAILED"
        : run.status === "cancelled"
          ? "KILLED"
          : run.status === "running"
            ? "RUNNING"
            : "SCHEDULED";

  const params: MlflowParam[] = [
    { key: "run_number", value: String(run.number) },
    { key: "branch_id", value: run.branchId },
    { key: "change", value: run.change },
    ...(run.seed !== undefined ? [{ key: "seed", value: String(run.seed) }] : []),
    ...(run.scope !== undefined ? [{ key: "scope", value: run.scope }] : []),
    ...(run.codeHash !== undefined ? [{ key: "code_hash", value: run.codeHash }] : []),
    ...(run.dataHash !== undefined ? [{ key: "data_hash", value: run.dataHash }] : []),
    ...(opts?.branch ? [{ key: "rung", value: opts.branch.rung }] : []),
  ];

  const mappedMetrics: MlflowMetric[] = runMetrics.map((metric) => ({
    key: metric.split !== undefined ? `${metric.split}.${metric.name}` : metric.name,
    value: metric.value,
    timestamp: endTimeMs ?? startTimeMs,
    step: metric.step ?? 0,
  }));

  const tags: MlflowTag[] = [
    { key: "mulagent.run_id", value: run.id },
    { key: "mulagent.verdict", value: run.verdict },
    { key: "mulagent.integrity", value: run.integrity },
    { key: "mulagent.gpu_hours", value: String(run.gpuHours) },
    { key: "mulagent.llm_usd", value: String(run.llmUsd) },
    ...(opts?.branch ? [{ key: "mulagent.branch_label", value: opts.branch.label }] : []),
    ...(run.backendId !== undefined ? [{ key: "mulagent.backend_id", value: run.backendId }] : []),
  ];

  return {
    runId: run.id,
    experimentName,
    runInfo: {
      runName: `run-${run.number}-${run.id}`,
      status,
      startTimeMs,
      ...(endTimeMs !== undefined ? { endTimeMs } : {}),
    },
    params,
    metrics: mappedMetrics,
    tags,
  };
}

export function mapRunsToMlflowPayloads(
  snapshot: ResearchSnapshot,
  metrics: ReadonlyArray<RunMetric>,
): ReadonlyArray<MlflowRunPayload> {
  const branchMap = new Map(snapshot.branches.map((branch) => [branch.id, branch]));
  return snapshot.runs.map((run) =>
    mapRunToMlflowPayload(run, metrics, {
      project: snapshot.project.title,
      branch: branchMap.get(run.branchId),
      researchProject: snapshot.project,
    }),
  );
}
