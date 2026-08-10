import { describe, expect, it } from "vitest";

import { buildComparisonMatrix, divergentRows } from "./matrix";
import type { ComparedPaper } from "./types";
import type { ArticleAnalysisPayload } from "@/lib/article-analysis/types";

function paper(n: number): ComparedPaper {
  return { analysisId: `ana-${n}`, sourceId: `src-${n}`, title: `Paper ${n}` };
}

function payload(
  glance: Partial<ArticleAnalysisPayload["ataGlance"]>,
): ArticleAnalysisPayload {
  return { ataGlance: glance } as unknown as ArticleAnalysisPayload;
}

describe("buildComparisonMatrix", () => {
  it("aligns values with the paper order", () => {
    const matrix = buildComparisonMatrix(
      [paper(0), paper(1)],
      [payload({ field: "NLP" }), payload({ field: "Vision" })],
    );
    const row = matrix.rows.find((r) => r.key === "field");
    expect(row?.values).toEqual(["NLP", "Vision"]);
    expect(row?.uniform).toBe(false);
  });

  it("marks a row uniform when every present value agrees", () => {
    const matrix = buildComparisonMatrix(
      [paper(0), paper(1)],
      [payload({ paperType: "empirical" }), payload({ paperType: "Empirical." })],
    );
    expect(matrix.rows.find((r) => r.key === "paperType")?.uniform).toBe(true);
  });

  it("ignores case, whitespace runs and a trailing period when comparing", () => {
    const matrix = buildComparisonMatrix(
      [paper(0), paper(1)],
      [
        payload({ methodologyType: "  Randomized   trial " }),
        payload({ methodologyType: "randomized trial." }),
      ],
    );
    expect(matrix.rows.find((r) => r.key === "methodologyType")?.uniform).toBe(
      true,
    );
  });

  it("does not call a single present value uniform", () => {
    const matrix = buildComparisonMatrix(
      [paper(0), paper(1)],
      [payload({ maturity: "mature" }), payload({})],
    );
    const row = matrix.rows.find((r) => r.key === "maturity");
    expect(row?.values).toEqual(["mature", undefined]);
    expect(row?.uniform).toBe(false);
  });

  it("drops rows no paper filled in", () => {
    const matrix = buildComparisonMatrix(
      [paper(0), paper(1)],
      [payload({ field: "NLP" }), payload({ field: "NLP" })],
    );
    expect(matrix.rows.map((r) => r.key)).toEqual(["field"]);
  });

  it("treats a blank string as absent", () => {
    const matrix = buildComparisonMatrix(
      [paper(0)],
      [payload({ field: "   " })],
    );
    expect(matrix.rows).toEqual([]);
  });

  it("survives a paper whose payload is missing entirely", () => {
    const matrix = buildComparisonMatrix(
      [paper(0), paper(1)],
      [payload({ field: "NLP" }), undefined],
    );
    expect(matrix.rows.find((r) => r.key === "field")?.values).toEqual([
      "NLP",
      undefined,
    ]);
  });

  it("snapshots the paper list onto the matrix", () => {
    const papers = [paper(0), paper(1)];
    expect(buildComparisonMatrix(papers, [undefined, undefined]).papers).toEqual(
      papers,
    );
  });
});

describe("divergentRows", () => {
  it("returns only the rows where papers differ", () => {
    const matrix = buildComparisonMatrix(
      [paper(0), paper(1)],
      [
        payload({ field: "NLP", paperType: "empirical" }),
        payload({ field: "Vision", paperType: "empirical" }),
      ],
    );
    expect(divergentRows(matrix).map((r) => r.key)).toEqual(["field"]);
  });
});
