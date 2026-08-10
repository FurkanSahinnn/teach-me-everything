// Comparison matrix — built entirely in code from each paper's `AtAGlance`.
//
// No model call, no tokens, no failure mode. That matters beyond cost: it means
// a comparison always renders something useful even when every AI stage of the
// run degrades, which is why the payload keeps `matrix` non-optional while
// `contradictions` may legitimately come back empty.
//
// Pure + deterministic → unit-testable with no DB or network.

import type { ArticleAnalysisPayload } from "@/lib/article-analysis/types";
import {
  MATRIX_FIELDS,
  type ComparedPaper,
  type ComparisonMatrix,
  type MatrixFieldKey,
  type MatrixRow,
} from "./types";

// Values are compared for agreement, not for display, so fold away the
// differences that are not substantive: case, surrounding space, internal
// whitespace runs, and a trailing period.
function normalizeForAgreement(value: string): string {
  return value.trim().replace(/\s+/g, " ").replace(/\.$/, "").toLowerCase();
}

function readField(
  payload: ArticleAnalysisPayload | undefined,
  key: MatrixFieldKey,
): string | undefined {
  const raw = payload?.ataGlance?.[key];
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

// A row is uniform when every paper that HAS a value agrees. Requires at least
// two present values — one lone value is not agreement, and marking it uniform
// would dim the only informative cell in the row.
function isUniform(values: (string | undefined)[]): boolean {
  const present = values.filter((v): v is string => v !== undefined);
  if (present.length < 2) return false;
  const first = normalizeForAgreement(present[0] as string);
  return present.every((v) => normalizeForAgreement(v) === first);
}

export function buildComparisonMatrix(
  papers: ComparedPaper[],
  payloads: (ArticleAnalysisPayload | undefined)[],
): ComparisonMatrix {
  const rows: MatrixRow[] = [];
  for (const key of MATRIX_FIELDS) {
    const values = papers.map((_, i) => readField(payloads[i], key));
    // Every paper omitted this field — an all-empty row is pure noise in a
    // table whose job is to make differences visible.
    if (values.every((v) => v === undefined)) continue;
    rows.push({ key, values, uniform: isUniform(values) });
  }
  return { papers, rows };
}

// Rows where the papers actually differ. The UI leads with these; uniform rows
// collapse behind a "same across all" disclosure.
export function divergentRows(matrix: ComparisonMatrix): MatrixRow[] {
  return matrix.rows.filter((r) => !r.uniform);
}
