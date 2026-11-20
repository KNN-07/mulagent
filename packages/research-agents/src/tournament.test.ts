import { describe, expect, it } from "vite-plus/test";
import type { IdeaCard } from "./roles.ts";
import { clusterIdeas, rankIdeas, shortlistIdeas, updateElo } from "./tournament.ts";

function idea(id: string, title: string): IdeaCard {
  return {
    id,
    title,
    hypothesis: title,
    rationale: title,
    falsifyingExperiment: "test",
    computeEstimateGpuHours: 1,
    closestPriorWork: [],
  };
}

describe("Elo idea tournament", () => {
  it("moves equal ratings by half K and rewards an upset more than an expected win", () => {
    expect(updateElo(1500, 1500, "left")).toEqual({ left: 1516, right: 1484 });
    expect(updateElo(1500, 1500, "draw")).toEqual({ left: 1500, right: 1500 });
    const expected = updateElo(1700, 1300, "left");
    const upset = updateElo(1700, 1300, "right");
    expect(expected.left - 1700).toBeLessThan(upset.right - 1300);
    expect(upset.left + upset.right).toBeCloseTo(3000);
  });

  it("prefers the highest-ranked representative of each cluster for the top five", () => {
    const first = idea("a", "Koopman spectral projection");
    const similar = idea("b", "Koopman spectral projection estimator");
    const transport = idea("c", "Wasserstein optimal transport");
    const diverse = [
      transport,
      idea("d", "Kernel ridge regression"),
      idea("e", "Token routing compression"),
      idea("f", "Diffusion score matching"),
    ];
    const ranked = rankIdeas(
      [similar, first, ...diverse],
      [
        { leftId: first.id, rightId: transport.id, verdict: "left" },
        { leftId: similar.id, rightId: transport.id, verdict: "left" },
      ],
    );
    expect(
      clusterIdeas([first, similar, ...diverse]).map((group) => group.map(({ id }) => id)),
    ).toEqual([["a", "b"], ["c"], ["d"], ["e"], ["f"]]);
    expect(shortlistIdeas(ranked).map(({ id }) => id)).toEqual(["a", "d", "e", "f", "c"]);
  });
});
