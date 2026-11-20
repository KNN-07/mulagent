import * as Schema from "effect/Schema";

export const Paper = Schema.Struct({
  id: Schema.String,
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

export type Paper = typeof Paper.Type;

export function normalizeDoi(value: string | undefined): string | undefined {
  return (
    value
      ?.trim()
      .toLowerCase()
      .replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/, "") || undefined
  );
}

export function normalizeArxivId(value: string | undefined): string | undefined {
  return (
    value
      ?.trim()
      .toLowerCase()
      .replace(/^(?:https?:\/\/(?:www\.|export\.)?arxiv\.org\/(?:abs|pdf)\/|arxiv:\s*)/, "")
      .replace(/\.pdf$/, "")
      .replace(/v\d+$/, "") || undefined
  );
}

function paperIdentities(paper: Paper): string[] {
  const doi = normalizeDoi(paper.doi);
  const arxivId = normalizeArxivId(
    paper.arxivId ?? (doi?.startsWith("10.48550/arxiv.") ? doi.slice(15) : undefined),
  );
  return [
    `id:${paper.id}`,
    ...(doi ? [`doi:${doi}`] : []),
    ...(arxivId ? [`arxiv:${arxivId}`] : []),
  ];
}

function mergePaper(first: Paper, next: Paper): Paper {
  return {
    id: first.id,
    title: first.title || next.title,
    authors: first.authors.length ? first.authors : next.authors,
    abstract: first.abstract ?? next.abstract,
    year: first.year ?? next.year,
    published: first.published ?? next.published,
    url: first.url ?? next.url,
    doi: first.doi ?? next.doi,
    arxivId: first.arxivId ?? next.arxivId,
    bibtex: first.bibtex ?? next.bibtex,
  };
}

export function mergePapers(papers: readonly Paper[]): Paper[] {
  const groups = new Map<Paper, Paper>();
  const identities = new Map<string, Paper>();
  const root = (paper: Paper): Paper => {
    let parent = groups.get(paper);
    while (parent !== undefined) {
      paper = parent;
      parent = groups.get(paper);
    }
    return paper;
  };

  for (const paper of papers) {
    const keys = paperIdentities(paper);
    for (const key of keys) {
      const previous = identities.get(key);
      if (previous === undefined) {
        identities.set(key, paper);
        continue;
      }
      const current = root(paper);
      const prior = root(previous);
      if (current !== prior) groups.set(current, prior);
    }
  }

  const merged = new Map<Paper, Paper>();
  for (const paper of papers) {
    const group = root(paper);
    const first = merged.get(group);
    merged.set(group, first ? mergePaper(first, paper) : paper);
  }
  return [...merged.values()];
}
