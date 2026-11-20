import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { literatureHttp, literatureUrl } from "./literatureHttp.ts";
import type { LiteratureHttpOptions } from "./literatureHttp.ts";
import { mergePapers, normalizeArxivId, normalizeDoi } from "./papers.ts";
import type { Paper } from "./papers.ts";

export { Paper, mergePapers } from "./papers.ts";
export type { LiteratureHttpOptions } from "./literatureHttp.ts";

export interface SearchPage {
  readonly limit?: number;
  readonly offset?: number;
  readonly signal?: AbortSignal | undefined;
}

function page(options: SearchPage, maximum: number) {
  const { limit = 20, offset = 0 } = options;
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > maximum ||
    !Number.isSafeInteger(offset) ||
    offset < 0
  ) {
    throw new Error(`Expected a limit from 1 to ${maximum} and a nonnegative integer offset`);
  }
  return { limit, offset };
}

const nullableText = Schema.optional(Schema.NullOr(Schema.String));
const nullableInt = Schema.optional(Schema.NullOr(Schema.Int));
const semanticPaper = Schema.Struct({
  paperId: Schema.NullOr(Schema.String),
  title: nullableText,
  abstract: nullableText,
  year: nullableInt,
  publicationDate: nullableText,
  url: nullableText,
  authors: Schema.optional(Schema.NullOr(Schema.Array(Schema.Struct({ name: Schema.String })))),
  externalIds: Schema.optional(
    Schema.NullOr(Schema.Struct({ DOI: nullableText, ArXiv: nullableText })),
  ),
  citationStyles: Schema.optional(Schema.NullOr(Schema.Struct({ bibtex: nullableText }))),
});
const semanticFields = "title,abstract,year,publicationDate,url,authors,externalIds,citationStyles";
const graphRoot = "https://api.semanticscholar.org/graph/v1/paper";
const recommendationRoot = "https://api.semanticscholar.org/recommendations/v1/papers";

function fromSemantic(paper: typeof semanticPaper.Type): Paper[] {
  const doi = normalizeDoi(paper.externalIds?.DOI ?? undefined);
  const arxivId = normalizeArxivId(paper.externalIds?.ArXiv ?? undefined);
  const id = paper.paperId
    ? `s2:${paper.paperId}`
    : doi
      ? `doi:${doi}`
      : arxivId
        ? `arxiv:${arxivId}`
        : undefined;
  if (id === undefined || !paper.title) return [];
  return [
    {
      id,
      title: paper.title,
      authors: paper.authors?.map(({ name }) => name) ?? [],
      abstract: paper.abstract ?? undefined,
      year: paper.year ?? undefined,
      published: paper.publicationDate ?? undefined,
      url: paper.url ?? undefined,
      doi,
      arxivId,
      bibtex: paper.citationStyles?.bibtex ?? undefined,
    },
  ];
}

export function createSemanticScholar(
  options: LiteratureHttpOptions & { readonly apiKey?: string } = {},
) {
  const request = literatureHttp(options, 1_100);
  const key = options.apiKey ?? process.env.SEMANTIC_SCHOLAR_API_KEY;
  const headers = key ? { "x-api-key": key } : undefined;
  const get = async (
    base: string,
    params: Record<string, string | number>,
    signal?: AbortSignal,
  ): Promise<unknown> =>
    JSON.parse(
      await request(literatureUrl(base, { ...params, fields: semanticFields }), headers, signal),
    );

  async function details(paperId: string): Promise<Paper> {
    const result = fromSemantic(
      Schema.decodeUnknownSync(semanticPaper)(
        await get(`${graphRoot}/${encodeURIComponent(paperId)}`, {}),
      ),
    )[0];
    if (!result) throw new Error("Semantic Scholar returned an incomplete paper");
    return result;
  }

  async function related(
    paperId: string,
    direction: "citations" | "references",
    options: SearchPage,
  ) {
    const key = direction === "citations" ? "citingPaper" : "citedPaper";
    const response = Schema.Struct({
      data: Schema.optional(Schema.Array(Schema.Struct({ [key]: Schema.NullOr(semanticPaper) }))),
      next: nullableInt,
    });
    const result = Schema.decodeUnknownSync(response)(
      await get(
        `${graphRoot}/${encodeURIComponent(paperId)}/${direction}`,
        page(options, 1000),
        options.signal,
      ),
    );
    return {
      papers: result.data?.flatMap((entry) => (entry[key] ? fromSemantic(entry[key]) : [])) ?? [],
      nextOffset: result.next ?? undefined,
    };
  }

  return {
    async search(query: string, options: SearchPage = {}): Promise<Paper[]> {
      const response = Schema.Struct({
        total: Schema.Int,
        data: Schema.optional(Schema.Array(semanticPaper)),
      });
      const result = Schema.decodeUnknownSync(response)(
        await get(`${graphRoot}/search`, { query, ...page(options, 100) }, options.signal),
      );
      return result.data?.flatMap(fromSemantic) ?? [];
    },
    details,
    citations: (paperId: string, options: SearchPage = {}) =>
      related(paperId, "citations", options),
    references: (paperId: string, options: SearchPage = {}) =>
      related(paperId, "references", options),
    async recommendations(
      paperId: string,
      options: { readonly limit?: number; readonly from?: "recent" | "all-cs" } = {},
    ) {
      const response = Schema.Struct({ recommendedPapers: Schema.Array(semanticPaper) });
      const { limit } = page(options, 500);
      const result = Schema.decodeUnknownSync(response)(
        await get(`${recommendationRoot}/forpaper/${encodeURIComponent(paperId)}`, {
          from: options.from ?? "recent",
          limit,
        }),
      );
      return result.recommendedPapers.flatMap(fromSemantic);
    },
    async bibtex(paperId: string) {
      return (await details(paperId)).bibtex;
    },
  };
}

const atomEntry = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  summary: Schema.optional(Schema.String),
  published: Schema.optional(Schema.String),
  author: Schema.optional(Schema.Array(Schema.Struct({ name: Schema.String }))),
  "arxiv:doi": Schema.optional(Schema.String),
});

const atomParser = new XMLParser({
  parseTagValue: false,
  isArray: (_name, path) => path === "feed.entry" || path === "feed.entry.author",
});

function arxivDate(date: DateTime.Utc) {
  return DateTime.formatIso(date).slice(0, 16).replace(/\D/g, "");
}

export function createArxiv(
  options: LiteratureHttpOptions & { readonly now?: () => DateTime.Utc } = {},
) {
  const request = literatureHttp(options, 3_000);
  return {
    async searchRecent(query: string, optionsPage: SearchPage = {}): Promise<Paper[]> {
      const { limit, offset } = page(optionsPage, 2_000);
      const now = options.now?.() ?? DateTime.nowUnsafe();
      const cutoff = DateTime.subtract(now, { months: 3 });
      const terms = query
        .replace(/[^\p{L}\p{N}-]+/gu, " ")
        .trim()
        .split(/\s+/)
        .filter(Boolean);
      if (!terms.length) throw new Error("arXiv query needs at least one search term");
      const searchQuery = terms.map((term) => `all:"${term}"`).join(" AND ");
      const url = literatureUrl("https://export.arxiv.org/api/query", {
        search_query: `(${searchQuery}) AND submittedDate:[${arxivDate(cutoff)} TO ${arxivDate(now)}]`,
        start: offset,
        max_results: limit,
        sortBy: "submittedDate",
        sortOrder: "descending",
      });
      const xml = await request(url, undefined, optionsPage.signal);
      if (/<!DOCTYPE/i.test(xml) || XMLValidator.validate(xml) !== true)
        throw new Error("Invalid arXiv Atom feed");
      const response = Schema.Struct({
        feed: Schema.Struct({ entry: Schema.optional(Schema.Array(atomEntry)) }),
      });
      const { feed } = Schema.decodeUnknownSync(response)(atomParser.parse(xml));
      return (
        feed.entry?.flatMap((entry) => {
          if (entry.title === "Error")
            throw new Error(`arXiv rejected the query: ${entry.summary ?? "unknown error"}`);
          const published = entry.published;
          const time = published === undefined ? NaN : Date.parse(published);
          const arxivId = normalizeArxivId(entry.id);
          if (
            !arxivId ||
            published === undefined ||
            !Number.isFinite(time) ||
            time <= DateTime.toEpochMillis(cutoff) ||
            time > DateTime.toEpochMillis(now)
          )
            return [];
          return [
            {
              id: `arxiv:${arxivId}`,
              arxivId,
              doi: normalizeDoi(entry["arxiv:doi"]),
              title: entry.title.replace(/\s+/g, " ").trim(),
              abstract: entry.summary?.replace(/\s+/g, " ").trim(),
              authors: entry.author?.map(({ name }) => name) ?? [],
              year: DateTime.getPartUtc(DateTime.makeUnsafe(time), "year"),
              published,
              url: `https://arxiv.org/abs/${arxivId}`,
            },
          ];
        }) ?? []
      );
    },
  };
}

const openAlexPaper = Schema.Struct({
  id: Schema.String,
  display_name: nullableText,
  doi: nullableText,
  publication_year: nullableInt,
  publication_date: nullableText,
  locations: Schema.optional(
    Schema.NullOr(
      Schema.Array(Schema.Struct({ landing_page_url: nullableText, pdf_url: nullableText })),
    ),
  ),
  authorships: Schema.optional(
    Schema.Array(
      Schema.Struct({
        author: Schema.Struct({ display_name: nullableText }),
      }),
    ),
  ),
  abstract_inverted_index: Schema.optional(
    Schema.NullOr(Schema.Record(Schema.String, Schema.Array(Schema.Int))),
  ),
});

function reconstructAbstract(index: typeof openAlexPaper.Type.abstract_inverted_index) {
  if (!index) return undefined;
  return Object.entries(index)
    .flatMap(([word, positions]) => positions.map((position) => ({ word, position })))
    .sort((a, b) => a.position - b.position)
    .map(({ word }) => word)
    .join(" ");
}

export function createOpenAlex(options: LiteratureHttpOptions & { readonly apiKey?: string } = {}) {
  const request = literatureHttp(options, 250);
  const key = options.apiKey ?? process.env.OPENALEX_API_KEY;
  return {
    async search(
      query: string,
      options: {
        readonly limit?: number;
        readonly page?: number;
        readonly signal?: AbortSignal | undefined;
      } = {},
    ): Promise<Paper[]> {
      const { page: pageNumber = 1 } = options;
      const { limit } = page(options, 200);
      if (!Number.isSafeInteger(pageNumber) || pageNumber < 1)
        throw new Error("Expected a positive OpenAlex page");
      const url = literatureUrl("https://api.openalex.org/works", {
        search: query,
        per_page: limit,
        page: pageNumber,
        select:
          "id,display_name,doi,publication_year,publication_date,locations,authorships,abstract_inverted_index",
        ...(key ? { api_key: key } : {}),
      });
      const response = Schema.Struct({ results: Schema.Array(openAlexPaper) });
      const { results } = Schema.decodeUnknownSync(response)(
        JSON.parse(await request(url, undefined, options.signal)),
      );
      return results.flatMap((paper) => {
        if (!paper.display_name) return [];
        const arxivUrl = paper.locations
          ?.flatMap(({ landing_page_url, pdf_url }) => [landing_page_url, pdf_url])
          .find(
            (url) => url && /^https?:\/\/(?:www\.|export\.)?arxiv\.org\/(?:abs|pdf)\//i.test(url),
          );
        return [
          {
            id: paper.id,
            title: paper.display_name,
            authors:
              paper.authorships?.flatMap(({ author }) =>
                author.display_name ? [author.display_name] : [],
              ) ?? [],
            abstract: reconstructAbstract(paper.abstract_inverted_index),
            doi: normalizeDoi(paper.doi ?? undefined),
            arxivId: normalizeArxivId(arxivUrl ?? undefined),
            published: paper.publication_date ?? undefined,
            year: paper.publication_year ?? undefined,
            url: paper.locations?.[0]?.landing_page_url ?? paper.id,
          },
        ];
      });
    },
  };
}

export type LiteratureSource = (
  query: string,
  pageIndex: number,
  signal?: AbortSignal,
) => Promise<readonly Paper[]>;

export type LiteratureProvider = "semanticScholar" | "arxiv" | "openAlex";

export function createLiteratureSearch(
  options: LiteratureHttpOptions & {
    readonly semanticScholarApiKey?: string;
    readonly openAlexApiKey?: string;
    readonly pageSize?: number;
    readonly sources?: readonly LiteratureProvider[];
  } = {},
): LiteratureSource {
  const semantic = createSemanticScholar({
    ...options,
    ...(options.semanticScholarApiKey === undefined
      ? {}
      : { apiKey: options.semanticScholarApiKey }),
  });
  const arxiv = createArxiv(options);
  const alex = createOpenAlex({
    ...options,
    ...(options.openAlexApiKey === undefined ? {} : { apiKey: options.openAlexApiKey }),
  });
  const limit = page({ limit: options.pageSize ?? 20 }, 100).limit;
  const sources: Record<LiteratureProvider, LiteratureSource> = {
    semanticScholar: (query, index, signal) =>
      semantic.search(query, { limit, offset: index * limit, signal }),
    arxiv: (query, index, signal) =>
      arxiv.searchRecent(query, { limit, offset: index * limit, signal }),
    openAlex: (query, index, signal) => alex.search(query, { limit, page: index + 1, signal }),
  };
  const selected = [
    ...new Set(options.sources ?? (["semanticScholar", "arxiv", "openAlex"] as const)),
  ];
  if (!selected.length) throw new Error("Select at least one literature source");
  return async (query, pageIndex, signal) => {
    const results = await Promise.all(
      selected.map((source) => sources[source](query, pageIndex, signal)),
    );
    return results.flat();
  };
}

export function expandQueries(topic: string, variants: readonly string[] = []): string[] {
  if (!topic.trim()) throw new Error("A literature topic is required");
  const queries = new Map<string, string>();
  for (const term of [topic, ...variants, `${topic} benchmarks`, `${topic} survey`]) {
    const query = term.trim().replace(/\s+/g, " ");
    if (query && !queries.has(query.toLowerCase())) queries.set(query.toLowerCase(), query);
  }
  return [...queries.values()].slice(0, variants.length ? 4 : 3);
}

export async function searchUntilSaturated(
  queries: readonly string[],
  search: LiteratureSource,
  { maxRounds = 8, signal }: { readonly maxRounds?: number; readonly signal?: AbortSignal } = {},
) {
  const normalizedQueries = new Set(
    queries.map((query) => query.trim().replace(/\s+/g, " ").toLowerCase()),
  );
  if (
    queries.length < 2 ||
    queries.length > 4 ||
    normalizedQueries.has("") ||
    normalizedQueries.size !== queries.length
  ) {
    throw new Error("Literature search requires two to four distinct queries");
  }
  if (!Number.isSafeInteger(maxRounds) || maxRounds < 2)
    throw new Error("Expected at least two search rounds");
  let emptyRounds = 0;
  let papers: Paper[] = [];
  const all: Paper[] = [];
  for (let round = 0; round < maxRounds; round += 1) {
    signal?.throwIfAborted();
    const previousIds = new Set(papers.map(({ id }) => id));
    const results = await Promise.all(queries.map((query) => search(query, round, signal)));
    for (const result of results) all.push(...result);
    papers = mergePapers(all);
    emptyRounds = papers.some(({ id }) => !previousIds.has(id)) ? 0 : emptyRounds + 1;
    if (emptyRounds === 2) return { papers, rounds: round + 1, saturated: true };
  }
  return { papers, rounds: maxRounds, saturated: false };
}
