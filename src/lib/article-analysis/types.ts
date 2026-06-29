// Article Analysis feature — locked design 2026-06-29
// (docs/ARTICLE_ANALYSIS_SPEC.md). A deep, PhD-level AI analysis of a single
// PDF source so a non-native reader can understand a hard paper fast: what it
// says, the problem it tackles, how it solves it, plus a senior-reviewer-grade
// critique and a bilingual jargon glossary.
//
// Built by a hand-rolled multi-stage pipeline (map → reduce → specialist
// fan-out → synthesis) over the existing provider/credential/retrieval layers
// — NOT LangGraph. Types live next to the feature folder (mirroring
// roadmap/types.ts and concepts/types.ts) because the AI runner, repo, hooks,
// backup, and components all read this canonical shape.

// Output language captured per analysis at generation time. User-selectable
// (default = app locale); the glossary is ALWAYS bilingual TR/EN regardless.
export type AnalysisTargetLang = "tr" | "en";

// Lifecycle of a single analysis row.
//   generating → pipeline in flight (payload undefined / partial)
//   ready      → all stages succeeded, full payload present
//   draft      → at least one stage degraded (malformed JSON / partial
//                failure); payload present but incomplete + fallbackReason set
//   error      → fatal failure before any usable payload (credential / abort /
//                empty source); errorMessage set
export type AnalysisStatus = "generating" | "ready" | "draft" | "error";

// Hybrid grounding tag (workspace-chat precedent): [S] vs [G].
//   source  → backed by the paper; should carry a verbatim quote citation
//   general → model world-knowledge (analogy, critique, what-to-read-next);
//             must be visually flagged so the reader knows it isn't in the paper
export type GroundingKind = "source" | "general";

// A verbatim span lifted from the paper. `chunkId` is resolved best-effort in
// code (by matching the quote back to a source chunk) so the detail page can
// render a CitationChip that jumps to the passage; when it can't be resolved
// the chip still shows the quote text.
export type AnalysisCitation = {
  quote: string;
  chunkId?: string | undefined;
  page?: number | undefined;
};

// A single analytical statement carrying its grounding provenance. Source
// claims should include at least one citation; general claims carry none.
export type AnalysisClaim = {
  text: string;
  grounding: GroundingKind;
  citations?: AnalysisCitation[] | undefined;
};

// One domain term / acronym / symbol with a plain-language definition in BOTH
// languages — the single highest-leverage field for a non-native reader.
export type GlossaryTerm = {
  term: string;
  symbol?: string | undefined;
  tr: string;
  en: string;
};

// One step of the method walkthrough: what happens + WHY that design choice
// answers the paper's question (QALMRI "logic" note).
export type MethodStep = {
  step: string;
  why: string;
};

// A prerequisite / follow-up reading suggestion (general knowledge, flagged).
export type ReadNext = {
  title: string;
  why: string;
};

// Layer-1 normalized, machine-comparable header card (= future synthesis-matrix
// columns, so a later "compare papers" view stays cheap to add).
export type AtAGlance = {
  paperType: string;
  field: string;
  subfield?: string | undefined;
  authors?: string | undefined;
  venueYear?: string | undefined;
  purpose: string;
  methodologyType?: string | undefined;
  dataSample?: string | undefined;
  headlineFinding: string;
  maturity?: string | undefined;
};

// 5 C's strip. category/context/contributions are source-grounded;
// correctness/clarity are model assessments (flagged in the UI).
export type FiveCs = {
  category: string;
  context: string;
  correctness: string;
  contributions: string;
  clarity: string;
};

// Senior-reviewer-lens evaluation (NeurIPS axes) + the single weakest link.
export type CritiqueBlock = {
  soundness: string;
  novelty: string;
  significance: string;
  clarity: string;
  weakestLink: string;
};

// The full structured analysis payload, layered by depth so the UI can render
// collapsible sections (Orientation expanded; Understanding + Critique
// collapsed). Persisted as a JSON blob on the row — read whole.
export type ArticleAnalysisPayload = {
  // ---- Layer 1 — Orientation -------------------------------------------
  tldr: string;
  ataGlance: AtAGlance;
  fiveCs: FiveCs;
  // ---- Layer 2 — Understanding -----------------------------------------
  problemMotivation: AnalysisClaim[];
  priorWorkGap: AnalysisClaim[];
  contributions: AnalysisClaim[];
  keyIdea: string;
  methodWalkthrough: MethodStep[];
  howItSolves: AnalysisClaim[];
  keyResults: AnalysisClaim[];
  // ---- Layer 3 — Critique ----------------------------------------------
  critique: CritiqueBlock;
  assumptionsLimitations: AnalysisClaim[];
  reproducibility: string;
  questionsToAsk: string[];
  soWhat: string;
  whatToReadNext: ReadNext[];
  // ---- Cross-cutting ----------------------------------------------------
  glossary: GlossaryTerm[];
};

// Which model ran each pipeline stage, captured at generation time as
// `provider::modelId` strings (mirrors how chatMessages.model is stored) so
// cost reports roll up by model and the detail page can show provenance.
export type AnalysisModelSnapshot = {
  extract: string;
  synthesize: string;
  critique: string;
};

// Merged token usage across every stage call, summed for the BYOK cost chip.
export type AnalysisUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number | undefined;
  cacheCreationTokens?: number | undefined;
  costUsd?: number | undefined;
};

// One analysis row. Mandatory `sourceId` binds it to exactly one paper; the
// list page lists all analyses in a workspace and the detail page renders the
// payload.
export type ArticleAnalysisRecord = {
  id: string;
  workspaceId: string;
  sourceId: string;
  // Source title snapshot at generation time (so the list renders without a
  // join and survives source rename/delete).
  title: string;
  targetLang: AnalysisTargetLang;
  status: AnalysisStatus;
  // Set when status degrades to "draft" — names the stage / reason so the UI
  // can explain the partial result (mirrors the Phase 4.5.H draft-first copy).
  fallbackReason?: string | undefined;
  // Set when status is "error".
  errorMessage?: string | undefined;
  modelSnapshot: AnalysisModelSnapshot;
  usage: AnalysisUsage;
  // Undefined while generating; partial allowed on "draft"; complete on "ready".
  payload?: ArticleAnalysisPayload | undefined;
  createdAt: number;
  updatedAt: number;
};
