import { expect, it } from "vite-plus/test";
import { spec } from "./fixtures.test-support.ts";
import { checkIntegrity, seedStatistics, type RunEvidence } from "./integrity.ts";
import { freezeSpec } from "./spec.ts";
const frozen = freezeSpec(spec, "2026-01-01");
const evidence: RunEvidence = {
  recordedSpec: spec,
  command: spec.command,
  lockedEvalCommit: "abc",
  trainIds: new Set(["train"]),
  testIds: new Set(["test"]),
  baselineTolerance: 0.1,
  scope: "toy, held-out loss",
  seeds: spec.seeds.map((seed) => ({
    seed,
    holdout: 4,
    baseline: 5,
    initialLoss: 9,
    finalLoss: 4,
  })),
};
it("bootstraps direction-adjusted paired gains and downgrades inconclusive claims", () => {
  const result = checkIntegrity(frozen, evidence);
  expect(result).toMatchObject({
    integrity: "trusted",
    stats: { effect: 1, seedNoise: 0, ci95: [1, 1] },
    scope: evidence.scope,
  });
  expect(checkIntegrity(frozen, { ...evidence, seeds: evidence.seeds.slice(1) }).integrity).toBe(
    "preliminary",
  );
  expect(
    checkIntegrity(frozen, {
      ...evidence,
      seeds: evidence.seeds.map((s) => ({ ...s, holdout: 3 + s.seed })),
    }).integrity,
  ).toBe("preliminary");
  expect(seedStatistics([-1, 0, 1])).toMatchObject({ effect: 0, seedNoise: 1 });
});
it.each<Partial<RunEvidence>>([
  { recordedSpec: { ...spec, seeds: [1] } },
  { command: "other" },
  { lockedEvalCommit: "changed" },
  { testIds: evidence.trainIds },
  { expectedSplitHash: "a", recordedSplitHash: "b" },
  { seeds: [evidence.seeds[0]!, evidence.seeds[0]!] },
  ...[{ holdout: NaN }, { finalLoss: 11 }, { baseline: 6 }].map((patch) => ({
    seeds: [{ ...evidence.seeds[0]!, ...patch }],
  })),
])("rejects invalid provenance or observations %#", (change) => {
  expect(checkIntegrity(frozen, { ...evidence, ...change }).integrity).toBe("rejected");
});
