import { describe, expect, it } from "vitest";

import {
  bm25RankToScore,
  buildFtsQuery,
  mergeHybridResults,
  type HybridKeywordResult,
  type HybridVectorResult,
} from "./hybrid.js";

describe("memory hybrid helpers", () => {
  it("buildFtsQuery tokenizes and AND-joins", () => {
    expect(buildFtsQuery("hello world")).toBe('"hello" AND "world"');
    expect(buildFtsQuery("FOO_bar baz-1")).toBe('"FOO_bar" AND "baz" AND "1"');
    expect(buildFtsQuery("   ")).toBeNull();
  });

  it("bm25RankToScore is monotonic and clamped", () => {
    expect(bm25RankToScore(0)).toBeCloseTo(1);
    expect(bm25RankToScore(1)).toBeCloseTo(0.5);
    expect(bm25RankToScore(10)).toBeLessThan(bm25RankToScore(1));
    expect(bm25RankToScore(-100)).toBeCloseTo(1);
  });

  it("mergeHybridResults unions by id and computes RRF scores", () => {
    const merged = mergeHybridResults({
      vectorWeight: 0.7,
      textWeight: 0.3,
      vector: [
        {
          id: "a",
          path: "memory/a.md",
          startLine: 1,
          endLine: 2,
          source: "memory",
          snippet: "vec-a",
          vectorScore: 0.9,
        },
      ],
      keyword: [
        {
          id: "b",
          path: "memory/b.md",
          startLine: 3,
          endLine: 4,
          source: "memory",
          snippet: "kw-b",
          textScore: 1.0,
        },
      ],
    });

    expect(merged).toHaveLength(2);
    const a = merged.find((r) => r.path === "memory/a.md");
    const b = merged.find((r) => r.path === "memory/b.md");
    // RRF: a has vectorRank=1, keywordRank=2(default). b has vectorRank=2(default), keywordRank=1.
    expect(a?.score).toBeCloseTo(0.7 / 61 + 0.3 / 62, 6);
    expect(b?.score).toBeCloseTo(0.7 / 62 + 0.3 / 61, 6);
  });

  it("mergeHybridResults prefers keyword snippet when ids overlap", () => {
    const merged = mergeHybridResults({
      vectorWeight: 0.5,
      textWeight: 0.5,
      vector: [
        {
          id: "a",
          path: "memory/a.md",
          startLine: 1,
          endLine: 2,
          source: "memory",
          snippet: "vec-a",
          vectorScore: 0.2,
        },
      ],
      keyword: [
        {
          id: "a",
          path: "memory/a.md",
          startLine: 1,
          endLine: 2,
          source: "memory",
          snippet: "kw-a",
          textScore: 1.0,
        },
      ],
    });

    expect(merged).toHaveLength(1);
    expect(merged[0]?.snippet).toBe("kw-a");
    // Both rank 1 in their list: 0.5/(60+1) + 0.5/(60+1) = 1.0/61
    expect(merged[0]?.score).toBeCloseTo(1.0 / 61, 6);
  });
});

describe("RRF merge — PR1 tests", () => {
  const makeVector = (id: string, score: number): HybridVectorResult => ({
    id,
    path: `memory/${id}.md`,
    startLine: 1,
    endLine: 10,
    source: "workspace",
    snippet: `snippet-${id}`,
    vectorScore: score,
  });

  const makeKeyword = (id: string, score: number): HybridKeywordResult => ({
    id,
    path: `memory/${id}.md`,
    startLine: 1,
    endLine: 10,
    source: "workspace",
    snippet: `snippet-${id}`,
    textScore: score,
  });

  it("computes RRF scores with k=60 for multiple ranked results", () => {
    // doc-a: vector rank 1, keyword rank 1
    // doc-b: vector rank 2, keyword rank 2
    const vector = [makeVector("doc-a", 0.95), makeVector("doc-b", 0.80)];
    const keyword = [makeKeyword("doc-a", 5.0), makeKeyword("doc-b", 3.0)];

    const result = mergeHybridResults({
      vector,
      keyword,
      vectorWeight: 0.7,
      textWeight: 0.3,
    });

    expect(result).toHaveLength(2);
    // doc-a: 0.7/(60+1) + 0.3/(60+1) = 1.0/61
    expect(result[0].path).toBe("memory/doc-a.md");
    expect(result[0].score).toBeCloseTo(0.7 / 61 + 0.3 / 61, 6);

    // doc-b: 0.7/(60+2) + 0.3/(60+2) = 1.0/62
    expect(result[1].score).toBeCloseTo(0.7 / 62 + 0.3 / 62, 6);
  });

  it("RRF is robust to different score scales (rank-based, not score-based)", () => {
    // Even with wildly different raw scores, RRF uses rank position
    const vector = [makeVector("a", 0.001), makeVector("b", 0.0001)];
    const keyword = [makeKeyword("a", 999.0), makeKeyword("b", 1.0)];

    const result = mergeHybridResults({
      vector,
      keyword,
      vectorWeight: 0.5,
      textWeight: 0.5,
    });

    // Both have same relative ranking, so scores should be identical to any other case
    // with the same rank positions
    expect(result[0].path).toBe("memory/a.md");
    expect(result[0].score).toBeCloseTo(0.5 / 61 + 0.5 / 61, 6);
    expect(result[1].score).toBeCloseTo(0.5 / 62 + 0.5 / 62, 6);
  });

  it("results sorted by score descending", () => {
    const vector = [makeVector("c", 0.3), makeVector("a", 0.9), makeVector("b", 0.6)];
    const keyword = [makeKeyword("b", 5.0), makeKeyword("a", 3.0), makeKeyword("c", 1.0)];

    const result = mergeHybridResults({
      vector,
      keyword,
      vectorWeight: 0.7,
      textWeight: 0.3,
    });

    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1].score).toBeGreaterThanOrEqual(result[i].score);
    }
  });

  it("handles empty inputs", () => {
    expect(
      mergeHybridResults({ vector: [], keyword: [], vectorWeight: 0.7, textWeight: 0.3 }),
    ).toEqual([]);
  });

  it("handles vector-only results", () => {
    const vector = [makeVector("only", 0.8)];
    const result = mergeHybridResults({
      vector,
      keyword: [],
      vectorWeight: 0.7,
      textWeight: 0.3,
    });
    expect(result).toHaveLength(1);
    // vectorRank=1, keywordRank=1 (default for empty list = 0+1=1)
    expect(result[0].score).toBeCloseTo(0.7 / 61 + 0.3 / 61, 6);
  });

  it("handles keyword-only results", () => {
    const keyword = [makeKeyword("only", 3.0)];
    const result = mergeHybridResults({
      vector: [],
      keyword,
      vectorWeight: 0.7,
      textWeight: 0.3,
    });
    expect(result).toHaveLength(1);
    expect(result[0].score).toBeCloseTo(0.7 / 61 + 0.3 / 61, 6);
  });
});
