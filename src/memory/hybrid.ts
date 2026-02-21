export type HybridSource = string;

export type HybridVectorResult = {
  id: string;
  path: string;
  startLine: number;
  endLine: number;
  source: HybridSource;
  snippet: string;
  vectorScore: number;
};

export type HybridKeywordResult = {
  id: string;
  path: string;
  startLine: number;
  endLine: number;
  source: HybridSource;
  snippet: string;
  textScore: number;
};

export function buildFtsQuery(raw: string): string | null {
  const tokens =
    raw
      .match(/[A-Za-z0-9_]+/g)
      ?.map((t) => t.trim())
      .filter(Boolean) ?? [];
  if (tokens.length === 0) return null;
  const quoted = tokens.map((t) => `"${t.replaceAll('"', "")}"`);
  return quoted.join(" AND ");
}

export function bm25RankToScore(rank: number): number {
  const normalized = Number.isFinite(rank) ? Math.max(0, rank) : 999;
  return 1 / (1 + normalized);
}

/**
 * Reciprocal Rank Fusion constant. Controls how much weight is given to
 * lower-ranked results. Higher k → more uniform weighting across ranks.
 * The standard value from the original RRF paper (Cormack et al.) is 60.
 */
const RRF_K = 60;

export function mergeHybridResults(params: {
  vector: HybridVectorResult[];
  keyword: HybridKeywordResult[];
  vectorWeight: number;
  textWeight: number;
}): Array<{
  path: string;
  startLine: number;
  endLine: number;
  score: number;
  snippet: string;
  source: HybridSource;
}> {
  // Build rank maps: id → 1-based rank position (sorted by score descending)
  const vectorRanks = new Map<string, number>();
  const sortedVector = [...params.vector].sort((a, b) => b.vectorScore - a.vectorScore);
  for (let i = 0; i < sortedVector.length; i++) {
    vectorRanks.set(sortedVector[i].id, i + 1);
  }

  const keywordRanks = new Map<string, number>();
  const sortedKeyword = [...params.keyword].sort((a, b) => b.textScore - a.textScore);
  for (let i = 0; i < sortedKeyword.length; i++) {
    keywordRanks.set(sortedKeyword[i].id, i + 1);
  }

  // Collect all unique results
  const byId = new Map<
    string,
    {
      id: string;
      path: string;
      startLine: number;
      endLine: number;
      source: HybridSource;
      snippet: string;
    }
  >();

  for (const r of params.vector) {
    byId.set(r.id, {
      id: r.id,
      path: r.path,
      startLine: r.startLine,
      endLine: r.endLine,
      source: r.source,
      snippet: r.snippet,
    });
  }

  for (const r of params.keyword) {
    const existing = byId.get(r.id);
    if (existing) {
      if (r.snippet && r.snippet.length > 0) existing.snippet = r.snippet;
    } else {
      byId.set(r.id, {
        id: r.id,
        path: r.path,
        startLine: r.startLine,
        endLine: r.endLine,
        source: r.source,
        snippet: r.snippet,
      });
    }
  }

  // Reciprocal Rank Fusion: score = w_v/(k + rank_v) + w_t/(k + rank_t)
  // Results not present in a ranking get rank = total+1 (worst possible)
  const defaultVectorRank = sortedVector.length + 1;
  const defaultKeywordRank = sortedKeyword.length + 1;

  const merged = Array.from(byId.values()).map((entry) => {
    const vRank = vectorRanks.get(entry.id) ?? defaultVectorRank;
    const kRank = keywordRanks.get(entry.id) ?? defaultKeywordRank;
    const score =
      params.vectorWeight / (RRF_K + vRank) + params.textWeight / (RRF_K + kRank);
    return {
      path: entry.path,
      startLine: entry.startLine,
      endLine: entry.endLine,
      score,
      snippet: entry.snippet,
      source: entry.source,
    };
  });

  return merged.sort((a, b) => b.score - a.score);
}
