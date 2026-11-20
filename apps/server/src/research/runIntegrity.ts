import { ExperimentSpec, type Run, type RunMetric } from "@t3tools/contracts";
import { checkIntegrity, hillclimbHistory, type SeedObservation } from "@t3tools/research-core";
import * as Schema from "effect/Schema";

const decodeSpec = Schema.decodeUnknownOption(ExperimentSpec);

export function seedObservation(
  run: Run,
  spec: ExperimentSpec,
  metrics: readonly RunMetric[],
): SeedObservation | undefined {
  const holdout = metrics.findLast((m) => m.name === spec.metric && m.split === "holdout")?.value;
  const baseline = metrics.findLast((m) => m.name === "baseline" && m.split === "holdout")?.value;
  const losses = metrics.filter((m) => m.name === "loss" && m.split === "train");
  if (
    run.seed === undefined ||
    holdout === undefined ||
    baseline === undefined ||
    losses.length < 2
  )
    return;
  return {
    seed: run.seed,
    holdout,
    baseline,
    initialLoss: losses[0]!.value,
    finalLoss: losses.at(-1)!.value,
  };
}

export function evaluateFinishedRun(
  spec: ExperimentSpec,
  run: Run,
  metrics: readonly RunMetric[],
  params: Record<string, unknown>,
  best: number | undefined,
  peers: readonly SeedObservation[],
) {
  const strings = (v: unknown) =>
    new Set(Array.isArray(v) ? v.filter((id): id is string => typeof id === "string") : []);
  const observation = seedObservation(run, spec, metrics);
  const recorded = decodeSpec(params.recordedSpec);
  const evidence = checkIntegrity(spec, {
    recordedSpec: recorded._tag === "Some" ? recorded.value : spec,
    command: typeof params.command === "string" ? params.command : spec.command,
    ...(typeof params.lockedEvalCommit === "string"
      ? { lockedEvalCommit: params.lockedEvalCommit }
      : {}),
    ...(typeof params.splitHash === "string" ? { recordedSplitHash: params.splitHash } : {}),
    trainIds: strings(params.trainIds),
    testIds: strings(params.testIds),
    baselineTolerance: 0,
    scope: run.scope ?? "single run",
    seeds: observation ? [...peers, observation] : [],
  });
  if (params.recordedSpec !== undefined && recorded._tag === "None") {
    evidence.checks[0] = { name: "spec-diff", passed: false, detail: "invalid recorded spec" };
    evidence.integrity = "rejected";
  }
  const [trial] = hillclimbHistory(
    [
      {
        runId: run.id,
        crashed: run.status !== "finished",
        checksPassed: evidence.integrity !== "rejected",
        ...(observation ? { holdout: observation.holdout } : {}),
      },
    ],
    best ?? spec.baseline ?? observation?.baseline ?? 0,
    spec.higherIsBetter,
    0,
  );
  return {
    run: {
      ...run,
      integrity: evidence.integrity,
      checks: evidence.checks,
      scope: evidence.scope,
      verdict: trial!.verdict,
    },
    stats: evidence.stats,
  };
}
