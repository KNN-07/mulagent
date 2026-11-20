import type { IdeaCard, RoleOutput } from "./roles.ts";

export type Verdict = RoleOutput<"tournament">["verdict"];

export function updateElo(left: number, right: number, verdict: Verdict, k = 32) {
  if (![left, right, k].every(Number.isFinite) || k <= 0)
    throw new Error("Elo requires finite ratings and positive K");
  const expected = 1 / (1 + 10 ** ((right - left) / 400));
  const actual = verdict === "left" ? 1 : verdict === "right" ? 0 : 0.5;
  const change = k * (actual - expected);
  return { left: left + change, right: right - change };
}

const commonWords = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "this",
  "that",
  "than",
  "will",
  "would",
  "can",
  "are",
  "using",
  "use",
]);

function tokens(idea: IdeaCard): ReadonlySet<string> {
  return new Set(
    (`${idea.title} ${idea.hypothesis}`.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []).filter(
      (word) => !commonWords.has(word),
    ),
  );
}

function similarity(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
  const common = left.intersection(right).size;
  const total = left.size + right.size - common;
  return total === 0 ? 0 : common / total;
}

export function clusterIdeas<T extends IdeaCard>(ideas: readonly T[], threshold = 0.45): T[][] {
  if (!(threshold > 0 && threshold <= 1)) throw new Error("Clustering threshold must be in (0, 1]");
  const clusters: { idea: T; terms: ReadonlySet<string> }[][] = [];
  for (const idea of ideas) {
    const member = { idea, terms: tokens(idea) };
    const cluster = clusters.find((members) =>
      members.every(({ terms }) => similarity(member.terms, terms) >= threshold),
    );
    if (cluster) cluster.push(member);
    else clusters.push([member]);
  }
  return clusters.map((cluster) => cluster.map(({ idea }) => idea));
}

export interface Match {
  readonly leftId: string;
  readonly rightId: string;
  readonly verdict: Verdict;
}

export function rankIdeas(ideas: readonly IdeaCard[], matches: readonly Match[]) {
  const ratings = new Map(ideas.map(({ id }) => [id, 1500]));
  if (ratings.size !== ideas.length) throw new Error("Tournament requires unique idea IDs");
  for (const { leftId, rightId, verdict } of matches) {
    const left = ratings.get(leftId);
    const right = ratings.get(rightId);
    if (left === undefined || right === undefined || leftId === rightId) {
      throw new Error("A match requires two different ideas from the tournament");
    }
    const updated = updateElo(left, right, verdict);
    ratings.set(leftId, updated.left);
    ratings.set(rightId, updated.right);
  }
  return ideas
    .map((idea) => ({ ...idea, elo: ratings.get(idea.id) ?? 1500 }))
    .sort((a, b) => b.elo - a.elo || (a.id < b.id ? -1 : 1));
}

export function shortlistIdeas<T extends IdeaCard>(ranked: readonly T[], threshold?: number): T[] {
  const clusters = clusterIdeas(ranked, threshold);
  const representatives = new Set(clusters.flatMap((cluster) => cluster.slice(0, 1)));
  const shortlist = ranked.filter((idea) => representatives.has(idea));
  if (shortlist.length < 5) shortlist.push(...ranked.filter((idea) => !representatives.has(idea)));
  return shortlist.slice(0, 5);
}
