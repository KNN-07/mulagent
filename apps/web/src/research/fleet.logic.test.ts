import { describe, expect, it } from "vite-plus/test";

import {
  createInitialSeedSnapshots,
  createSeedBackends,
  MOCK_NOW_ISO,
} from "./fixtures/mockSeedData";
import { computeFleetMetrics, groupFleetSessions } from "./fleet.logic";
import { MockResearchClient } from "./mockClient";

describe("fleet.logic", () => {
  it("groups seeded projects into waiting-question, ready-review, running, and done buckets", () => {
    const snapshots = createInitialSeedSnapshots();
    const grouped = groupFleetSessions(snapshots);

    expect(grouped["waiting-question"]).toHaveLength(1);
    expect(grouped["waiting-question"][0]?.title).toContain("primary endpoint");

    expect(grouped["ready-review"]).toHaveLength(1);
    expect(grouped["ready-review"][0]?.title).toBe("Claim C1");

    expect(grouped.running.map((entry) => entry.title)).toEqual([
      "A · latent rollouts",
      "Lean · error bound",
    ]);

    expect(grouped.done.map((entry) => entry.projectTitle)).toEqual([
      "credit-assignment",
      "rule-worlds",
    ]);
  });

  it("computes experiments per hour, GPU utilization with queue depth, and spend today", () => {
    const snapshots = createInitialSeedSnapshots();
    const backends = createSeedBackends();
    const metrics = computeFleetMetrics(snapshots, backends, Date.parse(MOCK_NOW_ISO));

    expect(metrics.totalGpusInUse).toBe(6);
    expect(metrics.totalGpusCapacity).toBe(13);
    expect(metrics.experimentsPerHour).toBeGreaterThan(0);
    expect(metrics.spendTodayUsd).toBeGreaterThan(0);
    expect(metrics.gpuHoursToday).toBeGreaterThan(0);

    const slurm = metrics.backendUtilization.find((row) => row.kind === "slurm");
    expect(slurm).toMatchObject({
      gpusInUse: 4,
      gpusTotal: 4,
      queueDepth: 2,
      activeJobs: 2,
      healthy: true,
    });
  });

  it("moves items out of waiting and review groups after answering a gate and approving a claim", async () => {
    const client = new MockResearchClient();
    const projects = await client.listProjects();
    const worldModel = await client.getSnapshot(projects[0]!.id);
    const questionGate = worldModel.gates.find((g) => g.kind === "question")!;
    const finding = worldModel.findings[0]!;

    await client.answerGate(questionGate.id, ["both-holm"], "Use Holm correction");
    await client.approveFinding(finding.id, "Include flat maze caveat");

    const updatedSnapshots = await Promise.all(projects.map((p) => client.getSnapshot(p.id)));
    const grouped = groupFleetSessions(updatedSnapshots);
    expect(grouped["waiting-question"]).toHaveLength(0);
    expect(grouped["ready-review"]).toHaveLength(0);
  });
});
