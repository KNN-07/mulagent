import { BranchId, ResearchProjectId, ResearchRunId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { defaultModelRouterConfig, ModelRouter } from "./modelRouter.ts";
import type { Complete } from "./modelRouter.ts";
import { createRoleRunner } from "./runner.ts";
import type { RoleInput } from "./roles.ts";

const frozenSpec = {
  hypothesis: "The intervention improves the holdout metric",
  metric: "accuracy",
  higherIsBetter: true,
  seeds: [12, 34, 56],
  editable: ["model.py"],
  command: "python train.py",
  resources: { gpus: 0, hours: 1 },
};

describe("research model router", () => {
  it("routes cheap and strong roles and switches families for the critic", () => {
    const router = new ModelRouter();
    expect(router.select("scout").model.id).toBe("gpt-6.2-sol");
    expect(router.select("debug").model.id).toBe("gpt-6.2-sol");
    expect(router.select("noveltySearch").model.id).toBe("gemini-4-hydrogen");
    expect(router.select("planner").model.id).toBe("gpt-6.2-astra");
    expect(router.select("critic", "openai").model.id).toBe("claude-fable-5-2");
    expect(router.select("critic", "anthropic").model.id).toBe("gpt-6.2-astra");
    expect(() => router.select("critic")).toThrow("author's model family");
  });

  it("honors configured routes and rejects same-family critics", () => {
    const config = defaultModelRouterConfig;
    const route = config.roles.noveltySearch;
    expect(
      new ModelRouter({ ...config, roles: { ...config.roles, scout: route } }).select("scout"),
    ).toEqual(route);
    expect(
      () =>
        new ModelRouter({
          ...config,
          critics: { ...config.critics, openai: config.roles.planner },
        }),
    ).toThrow("different model family");
  });

  it("runs the critic with only the allowed evidence and rejects leaked context", async () => {
    const complete = vi.fn<Complete>().mockResolvedValue({
      text: '{"critic":[{"attack":"Leakage","response":"The split is absent","landed":true}],"caveats":[]}',
    });
    const run = createRoleRunner({ complete });
    const input = { spec: frozenSpec, rawLogs: "raw logs", claim: "The intervention helps" };
    const extra = { ...input, transcript: "prior reasoning" };
    await expect(run("critic", extra, { authorFamily: "openai" })).rejects.toThrow();
    expect(complete).not.toHaveBeenCalled();

    const result = await run("critic", input, { authorFamily: "openai" });
    expect(result.model).toEqual({ id: "claude-fable-5-2", family: "anthropic" });
    expect(result.output.critic[0]?.landed).toBe(true);
    expect(JSON.parse(complete.mock.calls[0]?.[0].userPrompt ?? "")).toEqual(input);
  });

  it("rejects writer numbers and citations absent from the ledger or bibliography", async () => {
    const input: RoleInput<"writer"> = {
      runs: [
        {
          id: ResearchRunId.make("run"),
          researchProjectId: ResearchProjectId.make("project"),
          branchId: BranchId.make("branch"),
          number: 1,
          change: "train",
          status: "finished",
          verdict: "keep",
          integrity: "trusted",
          checks: [],
          gpuHours: 1,
          llmUsd: 0,
          trackerUrls: [],
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      metrics: [],
      findings: [],
      bibliography: [
        { id: "attention", bibtex: "@inproceedings{vaswani2017attention, title={Attention}}" },
      ],
    };
    const runId = input.runs[0]?.id;
    const supplied = {
      ...input,
      metrics: input.runs.map(({ id }) => ({ runId: id, name: "accuracy", value: 0.91 })),
    };
    const complete = vi.fn<Complete>().mockImplementation(async () => ({
      text: JSON.stringify({
        markdown: "Reported {{metric:run:accuracy}} [@vaswani2017attention].",
        runs: [{ runId, summary: "Finished." }],
      }),
    }));
    const run = createRoleRunner({ complete });
    await expect(run("writer", input)).rejects.toThrow("Unknown metric placeholder");
    await expect(run("writer", { ...supplied, bibliography: [] })).rejects.toThrow(
      "Unknown BibTeX citation",
    );
    await expect(run("writer", supplied)).resolves.toMatchObject({
      output: { runs: [{ runId, summary: "Finished." }] },
    });
    complete.mockResolvedValueOnce({
      text: JSON.stringify({ markdown: "Reported 0.91.", runs: [{ runId, summary: "Finished." }] }),
    });
    await expect(run("writer", supplied)).rejects.toThrow("requires ledger placeholders");
  });
});
