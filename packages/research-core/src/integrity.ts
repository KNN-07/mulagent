import type { IntegrityCheck, Run } from "@t3tools/contracts";
import { canonicalJson, specHash, type SpecWithSplit } from "./spec.ts";

export interface SeedObservation {
  seed: number;
  holdout: number;
  baseline: number;
  initialLoss: number;
  finalLoss: number;
}

export interface RunEvidence {
  recordedSpec: SpecWithSplit;
  command: string;
  lockedEvalCommit?: string;
  trainIds: ReadonlySet<string>;
  testIds: ReadonlySet<string>;
  expectedSplitHash?: string;
  recordedSplitHash?: string;
  baselineTolerance: number;
  seeds: readonly SeedObservation[];
  scope: string;
}

function mean(values: readonly number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

// A fixed PRNG makes the percentile interval reproducible when replaying the ledger.
export function seedStatistics(gains: readonly number[]) {
  if (!gains.length || !gains.every(Number.isFinite))
    throw new Error("Expected finite paired gains");
  const effect = mean(gains);
  const seedNoise =
    gains.length > 1
      ? Math.sqrt(gains.reduce((sum, v) => sum + (v - effect) ** 2, 0) / (gains.length - 1))
      : null;
  let state = 4291;
  const means = Array.from({ length: 4000 }, () => {
    let sum = 0;
    for (let i = 0; i < gains.length; i++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      sum += gains[Math.floor((state / 2 ** 32) * gains.length)]!;
    }
    return sum / gains.length;
  }).sort((a, b) => a - b);
  return {
    effect,
    seedNoise,
    effectToSeedNoise: seedNoise !== null && seedNoise > 0 ? effect / seedNoise : null,
    ci95: [means[99]!, means[3899]!] as const,
  };
}

export function checkIntegrity(spec: SpecWithSplit, evidence: RunEvidence) {
  const checks: IntegrityCheck[] = [];
  const record = (name: IntegrityCheck["name"], issues: string[]) =>
    checks.push({ name, passed: issues.length === 0, detail: issues.join(", ") || "passed" });
  const diffs: string[] = [];
  const { specHash: _hash, frozenAt: _time, ...expected } = spec;
  const { specHash: _recordedHash, frozenAt: _recordedTime, ...actual } = evidence.recordedSpec;
  for (const key of new Set([...Object.keys(expected), ...Object.keys(actual)])) {
    const field = key as keyof typeof expected;
    if (canonicalJson(expected[field] ?? null) !== canonicalJson(actual[field] ?? null))
      diffs.push(key);
  }
  if (!spec.specHash || specHash(spec) !== spec.specHash) diffs.push("frozen spec hash");
  if (evidence.command !== spec.command) diffs.push("executed command");
  if (spec.lockedEval?.commit !== evidence.lockedEvalCommit) diffs.push("locked eval commit");
  if ((spec.splitHash ?? evidence.expectedSplitHash) !== evidence.recordedSplitHash)
    diffs.push("split hash");
  record("spec-diff", diffs);
  const overlap = [...evidence.testIds].some((id) => evidence.trainIds.has(id));
  record(
    "leakage",
    !evidence.testIds.size || !evidence.trainIds.size
      ? ["missing split IDs"]
      : overlap
        ? ["train/test overlap"]
        : [],
  );
  const sanity: string[] = [];
  const seeds = evidence.seeds;
  if (!seeds.length) sanity.push("missing observations");
  const observed = new Set(seeds.map((s) => s.seed));
  if (observed.size !== seeds.length || new Set(spec.seeds).size !== spec.seeds.length)
    sanity.push("duplicate seeds");
  if (seeds.some((s) => !spec.seeds.includes(s.seed))) sanity.push("unplanned seed");
  if (seeds.some((s) => !Object.values(s).every(Number.isFinite)))
    sanity.push("non-finite observation");
  if (seeds.some((s) => s.finalLoss >= s.initialLoss)) sanity.push("loss did not decrease");
  if (!(Number.isFinite(evidence.baselineTolerance) && evidence.baselineTolerance >= 0))
    sanity.push("invalid baseline tolerance");
  if (
    spec.baseline !== undefined &&
    seeds.some((s) => Math.abs(s.baseline - spec.baseline!) > evidence.baselineTolerance)
  )
    sanity.push("baseline outside tolerance");
  record("sanity", sanity);
  const rejected = checks.some((c) => !c.passed);
  const gains = seeds.map((s) => (s.holdout - s.baseline) * (spec.higherIsBetter ? 1 : -1));
  const stats = gains.length && gains.every(Number.isFinite) ? seedStatistics(gains) : null;
  const sufficient =
    stats !== null &&
    observed.size >= 3 &&
    spec.seeds.every((s) => observed.has(s)) &&
    (stats.ci95[0] > 0 || stats.ci95[1] < 0);
  checks.push({
    name: "stats",
    passed: sufficient,
    detail: JSON.stringify({ seeds: observed.size, ...stats }),
  });
  const integrity: Run["integrity"] = rejected
    ? "rejected"
    : sufficient
      ? "trusted"
      : "preliminary";
  return { integrity, checks, stats, scope: evidence.scope };
}
