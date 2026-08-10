// Cross-Analysis — compare N already-analyzed papers and surface where they
// actually disagree.
//
// The whole feature runs over persisted `ArticleAnalysisPayload` rows, NOT over
// the PDFs again. That is the design's central economy: each payload is an
// already-distilled ~2k-token summary carrying claims with verified citations,
// so comparing four papers costs one mid-size call instead of four full
// Map/Reduce pipelines. `AtAGlance` was shaped as a normalized, machine-
// comparable header card for exactly this purpose (see article-analysis/types).
//
// Two outputs from one run:
//   matrix         — built in CODE from AtAGlance. No model, no tokens.
//   contradictions — the model's job, but it may only point AT claims we
//                    handed it (by ref), never author new ones. See ./refs.

import type {
  AnalysisCitation,
  AnalysisTargetLang,
  AnalysisUsage,
} from "@/lib/article-analysis/types";

export type { AnalysisTargetLang, AnalysisUsage };

// Mirrors AnalysisStatus. `draft` means one stage degraded but the run still
// produced something worth showing — the matrix alone is useful even if the
// contradiction stage returned garbage, because the matrix costs nothing.
export type CrossAnalysisStatus = "generating" | "ready" | "draft" | "error";

// A participating paper, snapshotted at generation time so the comparison still
// renders after its analysis or source is deleted.
export type ComparedPaper = {
  analysisId: string;
  sourceId: string;
  title: string;
};

// The AtAGlance fields worth putting in a comparison matrix. Deliberately a
// subset: `purpose` and `headlineFinding` are prose and get their own rows,
// while `authors` is provenance rather than something you compare.
export const MATRIX_FIELDS = [
  "paperType",
  "field",
  "subfield",
  "venueYear",
  "methodologyType",
  "dataSample",
  "maturity",
  "purpose",
  "headlineFinding",
] as const;

export type MatrixFieldKey = (typeof MATRIX_FIELDS)[number];

// One row of the comparison table. `values` is index-aligned with
// `ComparisonMatrix.papers`; a paper missing that field contributes undefined.
//
// No label fields — labels are i18n's job at render time, and baking Turkish
// strings into a persisted row would freeze them at generation time.
export type MatrixRow = {
  key: MatrixFieldKey;
  values: (string | undefined)[];
  // True when every present value is identical after normalization. Lets the UI
  // dim agreement and foreground the rows where the papers actually differ —
  // which is the only reason to look at a comparison matrix at all.
  uniform: boolean;
};

export type ComparisonMatrix = {
  papers: ComparedPaper[];
  rows: MatrixRow[];
};

// How two claims conflict. `direct` is the only one that means "these cannot
// both be true"; the others are softer and the UI tones them differently so a
// framing difference never reads as a factual contradiction.
export type ContradictionKind =
  | "direct"
  | "methodological"
  | "scope"
  | "terminological";

export const CONTRADICTION_KINDS: readonly ContradictionKind[] = [
  "direct",
  "methodological",
  "scope",
  "terminological",
] as const;

// One half of a contradiction, resolved in code from the model's claim ref.
// `text` and `citation` are copied from the ORIGINAL analysis claim, never from
// model output — so a contradiction can only ever quote what the paper's own
// analysis already established.
export type ContradictionSide = {
  paperIndex: number;
  ref: string;
  text: string;
  citation?: AnalysisCitation | undefined;
};

export type Contradiction = {
  a: ContradictionSide;
  b: ContradictionSide;
  kind: ContradictionKind;
  explanation: string;
  // Code-assigned, NEVER part of a wire schema. True only when BOTH sides
  // resolved to a real claim AND both carry a citation that was verified
  // (exact/fuzzy) against real chunk text back when the source analysis ran.
  //
  // Without this gate "these two papers disagree" is a model assertion, and a
  // wrong one poisons trust in every other contradiction on the page. Ungrounded
  // pairs still render, but demoted and labelled.
  grounded: boolean;
};

// A suggested reading order across the compared set.
export type ReadingStep = {
  analysisId: string;
  why: string;
};

export type CrossAnalysisPayload = {
  // Code-built. Present even when every AI stage fails.
  matrix: ComparisonMatrix;
  // Model-found, code-verified. Empty array is a legitimate result: papers in
  // the same lineage often genuinely do not contradict each other.
  contradictions: Contradiction[];
  // Points of agreement across ALL compared papers.
  consensus: string[];
  // Differences that are not contradictions — different framing, scope, or
  // method choice where both can hold.
  divergences: string[];
  readingOrder: ReadingStep[];
  // The cross-paper "so what" — what the set collectively tells you.
  synthesis: string;
};

// Which model ran each AI stage, as `provider::modelId` (mirrors
// AnalysisModelSnapshot) so cost reports roll up by model.
//
// Reuses the EXISTING analysisCritique / analysisSynthesize prefs bindings
// rather than introducing a fourth: finding where two papers disagree is a
// critique task, and the cross-paper write-up is a synthesis task. No prefs
// migration, and the user's opt-up-to-Opus choice already applies.
export type CrossAnalysisModelSnapshot = {
  contradiction: string;
  synthesis: string;
};

export type CrossAnalysisRecord = {
  id: string;
  workspaceId: string;
  // User-editable label; defaults to a generated "A vs B" style title.
  title: string;
  targetLang: AnalysisTargetLang;
  status: CrossAnalysisStatus;
  // Indexed via multiEntry so deleting an analysis can find the comparisons
  // that referenced it. Order is authoritative — it defines paperIndex.
  analysisIds: string[];
  papers: ComparedPaper[];
  fallbackReason?: string | undefined;
  errorMessage?: string | undefined;
  modelSnapshot: CrossAnalysisModelSnapshot;
  usage: AnalysisUsage;
  payload?: CrossAnalysisPayload | undefined;
  createdAt: number;
  updatedAt: number;
};

// Comparing one paper is meaningless and the prompt degrades badly past a
// handful — beyond this the claim table stops fitting a sane context budget and
// the model starts finding spurious pairings.
export const MIN_COMPARE_PAPERS = 2;
export const MAX_COMPARE_PAPERS = 4;
