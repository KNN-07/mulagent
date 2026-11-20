// @effect-diagnostics-next-line nodeBuiltinImport:off - Load the recorded arXiv response from disk.
import * as NodeFSP from "node:fs/promises";
import * as DateTime from "effect/DateTime";
import { describe, expect, it, vi } from "vite-plus/test";
import {
  createArxiv,
  createOpenAlex,
  createSemanticScholar,
  expandQueries,
  mergePapers,
  searchUntilSaturated,
} from "./literature.ts";
import type { Paper } from "./papers.ts";
import openAlex from "./fixtures/openalex-attention.json" with { type: "json" };
import semanticPaper from "./fixtures/semanticscholar-paper.json" with { type: "json" };
import rateLimit from "./fixtures/semanticscholar-rate-limit.json" with { type: "json" };

const paper = (id: string, metadata: Partial<Paper> = {}): Paper => ({
  id,
  title: id,
  authors: [],
  ...metadata,
});

describe("literature adapters", () => {
  it("deduplicates recorded arXiv and OpenAlex records through the arXiv DOI", async () => {
    const xml = await NodeFSP.readFile(
      new URL("./fixtures/arxiv-attention.xml", import.meta.url),
      "utf8",
    );
    const arxivFetch = vi.fn<typeof fetch>().mockImplementation(async () => new Response(xml));
    const arxiv = createArxiv({
      fetch: arxivFetch,
      intervalMs: 0,
      now: () => DateTime.makeUnsafe("2017-07-01T00:00:00Z"),
    });
    const alex = createOpenAlex({
      fetch: async () => Response.json(openAlex),
      intervalMs: 0,
      apiKey: "",
    });
    const preprints = await arxiv.searchRecent("attention transformers");
    const works = await alex.search("attention transformers");

    expect(preprints).toMatchObject([
      {
        arxivId: "1706.03762",
        title: "Attention Is All You Need",
        authors: expect.arrayContaining(["Ashish Vaswani"]),
      },
    ]);
    expect(mergePapers([...preprints, ...works])).toMatchObject([
      { arxivId: "1706.03762", doi: "10.48550/arxiv.1706.03762" },
    ]);
    expect(String(arxivFetch.mock.calls[0]?.[0])).toContain("submittedDate");
    const later = createArxiv({
      fetch: arxivFetch,
      intervalMs: 0,
      now: () => DateTime.makeUnsafe("2017-10-01T00:00:00Z"),
    });
    expect(await later.searchRecent("attention transformers")).toEqual([]);
  });

  it("decodes paper and graph responses and sends the optional key", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith("/search")) return Response.json({ total: 1, data: [semanticPaper] });
      if (path.endsWith("/citations"))
        return Response.json({ next: 1, data: [{ citingPaper: semanticPaper }] });
      if (path.endsWith("/references"))
        return Response.json({ data: [{ citedPaper: semanticPaper }] });
      if (path.includes("/forpaper/")) return Response.json({ recommendedPapers: [semanticPaper] });
      return Response.json(semanticPaper);
    });
    const client = createSemanticScholar({ fetch: fetcher, intervalMs: 0, apiKey: "fixture-key" });
    const results = await client.search("attention");
    expect(results).toMatchObject([
      { id: "s2:sample-paper", arxivId: "1706.03762", bibtex: semanticPaper.citationStyles.bibtex },
    ]);
    expect(await client.citations("sample-paper")).toEqual({ papers: results, nextOffset: 1 });
    expect(await client.references("sample-paper")).toEqual({
      papers: results,
      nextOffset: undefined,
    });
    expect(await client.recommendations("sample-paper")).toEqual(results);
    expect(await client.bibtex("ARXIV:1706.03762")).toBe(semanticPaper.citationStyles.bibtex);
    expect(
      fetcher.mock.calls.every(
        ([, init]) => new Headers(init?.headers).get("x-api-key") === "fixture-key",
      ),
    ).toBe(true);
  });

  it("propagates rate limiting instead of treating it as an empty page", async () => {
    const client = createSemanticScholar({
      retries: 0,
      apiKey: "",
      fetch: async () => Response.json(rateLimit, { status: 429 }),
    });
    await expect(client.search("attention")).rejects.toThrow("HTTP 429");
  });
});

describe("literature search", () => {
  it("merges duplicate papers transitively through DOI and versioned preprint IDs", () => {
    const initial = paper("semantic", { doi: "https://doi.org/10.1000/EXAMPLE" });
    const preprint = paper("arxiv", {
      arxivId: "2401.00123v3",
      abstract: "abstract",
      authors: ["Author"],
    });
    const bridge = paper("openalex", {
      doi: "10.1000/example",
      arxivId: "arXiv:2401.00123",
      bibtex: "bibtex",
    });
    expect(mergePapers([initial, preprint, bridge, paper("unrelated")])).toEqual([
      {
        ...initial,
        arxivId: "2401.00123v3",
        abstract: "abstract",
        authors: ["Author"],
        bibtex: "bibtex",
      },
      paper("unrelated"),
    ]);
  });

  it("stops after two consecutive rounds with no new work and resets the counter on discoveries", async () => {
    const search = vi.fn(async (_query: string, index: number) => {
      if (index === 0) return [paper("first", { doi: "10.1000/first" })];
      if (index === 1) return [paper("duplicate", { doi: "DOI:10.1000/FIRST" })];
      if (index === 2) return [paper("second")];
      return [];
    });
    const queries = expandQueries("transport", [" wasserstein  flow ", "Wasserstein flow"]);
    expect(queries).toEqual([
      "transport",
      "wasserstein flow",
      "transport benchmarks",
      "transport survey",
    ]);
    expect(await searchUntilSaturated(queries, search)).toEqual({
      saturated: true,
      rounds: 5,
      papers: [paper("first", { doi: "10.1000/first" }), paper("second")],
    });
    expect(search).toHaveBeenCalledTimes(20);
    expect(await searchUntilSaturated(queries, search, { maxRounds: 3 })).toMatchObject({
      saturated: false,
      rounds: 3,
    });
  });
});
