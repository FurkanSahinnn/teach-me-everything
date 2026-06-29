import { z } from "zod";

import { extractFirstJsonObject } from "@/lib/roadmap/schema";
import type { ArticleAnalysisPayload } from "@/lib/article-analysis/types";

// Per-stage JSON contracts for the Article Analysis pipeline. Each pipeline
// stage emits ONE JSON object matching the corresponding schema here; the
// orchestrator parses each stage independently (tolerant of prose-wrapped
// output) and assembles the final `ArticleAnalysisPayload` in code — no single
// LLM call ever emits the whole giant object.
//
// Mirrors `lib/roadmap/schema.ts`: same `ParseResult<T>` discriminated union,
// same `extractFirstJsonObject` tolerant slice, same per-stage `parseX(raw)`
// helpers. The Zod field names intentionally match the canonical types in
// `./types.ts` so the assembled payload typechecks against that contract.

// ---------------------------------------------------------------------------
// Leaf schemas (shared building blocks — mirror ./types.ts)
// ---------------------------------------------------------------------------

const GroundingKindSchema = z.enum(["source", "general"]);

// The model emits `{ quote, page? }`; `chunkId` is resolved in code by matching
// the quote back to a source chunk, so it is NOT part of the wire schema.
const AnalysisCitationSchema = z.object({
  quote: z.string().min(1),
  page: z.number().optional(),
});

const AnalysisClaimSchema = z.object({
  text: z.string().min(1),
  grounding: GroundingKindSchema,
  citations: z.array(AnalysisCitationSchema).optional(),
});

const MethodStepSchema = z.object({
  step: z.string().min(1),
  why: z.string().min(1),
});

const GlossaryTermSchema = z.object({
  term: z.string().min(1),
  symbol: z.string().optional(),
  tr: z.string().min(1),
  en: z.string().min(1),
});

const ReadNextSchema = z.object({
  title: z.string().min(1),
  why: z.string().min(1),
});

const AtAGlanceSchema = z.object({
  paperType: z.string(),
  field: z.string(),
  subfield: z.string().optional(),
  authors: z.string().optional(),
  venueYear: z.string().optional(),
  purpose: z.string(),
  methodologyType: z.string().optional(),
  dataSample: z.string().optional(),
  headlineFinding: z.string(),
  maturity: z.string().optional(),
});

const FiveCsSchema = z.object({
  category: z.string(),
  context: z.string(),
  correctness: z.string(),
  contributions: z.string(),
  clarity: z.string(),
});

const CritiqueBlockSchema = z.object({
  soundness: z.string(),
  novelty: z.string(),
  significance: z.string(),
  clarity: z.string(),
  weakestLink: z.string(),
});

// ---------------------------------------------------------------------------
// Per-stage output schemas
// ---------------------------------------------------------------------------

// Stage 1 — MAP: one call per token-budgeted section group.
export const MapStageSchema = z.object({
  sectionTitle: z.string(),
  summary: z.string(),
  keyQuotes: z.array(AnalysisCitationSchema),
});
export type MapStageOutput = z.infer<typeof MapStageSchema>;

// Stage 2 — REDUCE: the Understanding layer, distilled from section summaries.
export const ReduceStageSchema = z.object({
  problemMotivation: z.array(AnalysisClaimSchema),
  priorWorkGap: z.array(AnalysisClaimSchema),
  contributions: z.array(AnalysisClaimSchema),
  methodWalkthrough: z.array(MethodStepSchema),
  howItSolves: z.array(AnalysisClaimSchema),
  keyResults: z.array(AnalysisClaimSchema),
});
export type ReduceStageOutput = z.infer<typeof ReduceStageSchema>;

// Stage 3a — CRITIQUE specialist (senior-reviewer lens).
export const CritiqueStageSchema = z.object({
  critique: CritiqueBlockSchema,
  assumptionsLimitations: z.array(AnalysisClaimSchema),
  reproducibility: z.string(),
});
export type CritiqueStageOutput = z.infer<typeof CritiqueStageSchema>;

// Stage 3b — GLOSSARY specialist (always bilingual TR/EN).
export const GlossaryStageSchema = z.object({
  glossary: z.array(GlossaryTermSchema),
});
export type GlossaryStageOutput = z.infer<typeof GlossaryStageSchema>;

// Stage 3c — REFLECTION specialist (so-what / questions / read-next).
export const ReflectionStageSchema = z.object({
  questionsToAsk: z.array(z.string()),
  soWhat: z.string(),
  whatToReadNext: z.array(ReadNextSchema),
});
export type ReflectionStageOutput = z.infer<typeof ReflectionStageSchema>;

// Stage 4 — SYNTHESIZE: the Orientation layer, reconciling prior stages.
export const SynthesizeStageSchema = z.object({
  tldr: z.string(),
  ataGlance: AtAGlanceSchema,
  fiveCs: FiveCsSchema,
  keyIdea: z.string(),
});
export type SynthesizeStageOutput = z.infer<typeof SynthesizeStageSchema>;

// ---------------------------------------------------------------------------
// Final assembled payload validator (used by backup import / round-trip).
// ---------------------------------------------------------------------------

export const ArticleAnalysisPayloadSchema = z.object({
  tldr: z.string(),
  ataGlance: AtAGlanceSchema,
  fiveCs: FiveCsSchema,
  problemMotivation: z.array(AnalysisClaimSchema),
  priorWorkGap: z.array(AnalysisClaimSchema),
  contributions: z.array(AnalysisClaimSchema),
  keyIdea: z.string(),
  methodWalkthrough: z.array(MethodStepSchema),
  howItSolves: z.array(AnalysisClaimSchema),
  keyResults: z.array(AnalysisClaimSchema),
  critique: CritiqueBlockSchema,
  assumptionsLimitations: z.array(AnalysisClaimSchema),
  reproducibility: z.string(),
  questionsToAsk: z.array(z.string()),
  soWhat: z.string(),
  whatToReadNext: z.array(ReadNextSchema),
  glossary: z.array(GlossaryTermSchema),
});

// ---------------------------------------------------------------------------
// Tolerant text → JSON parsing (mirrors roadmap/schema.ts)
// ---------------------------------------------------------------------------

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: "no_json" | "schema_failed"; detail?: string };

function tryJsonParse(raw: string): unknown | null {
  const slice = extractFirstJsonObject(raw);
  if (!slice) return null;
  try {
    return JSON.parse(slice);
  } catch {
    return null;
  }
}

// Shared parse core: tolerant JSON extract + Zod safeParse. Per-stage helpers
// below are thin wrappers so call sites read `parseMapStage(buffer)`.
function parseStage<T>(raw: string, schema: z.ZodType<T>): ParseResult<T> {
  const json = tryJsonParse(raw);
  if (json === null) return { ok: false, reason: "no_json" };
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "schema_failed",
      detail: parsed.error.issues[0]?.message ?? "schema_failed",
    };
  }
  return { ok: true, value: parsed.data };
}

export function parseMapStage(raw: string): ParseResult<MapStageOutput> {
  return parseStage(raw, MapStageSchema);
}

export function parseReduceStage(raw: string): ParseResult<ReduceStageOutput> {
  return parseStage(raw, ReduceStageSchema);
}

export function parseCritiqueStage(
  raw: string,
): ParseResult<CritiqueStageOutput> {
  return parseStage(raw, CritiqueStageSchema);
}

export function parseGlossaryStage(
  raw: string,
): ParseResult<GlossaryStageOutput> {
  return parseStage(raw, GlossaryStageSchema);
}

export function parseReflectionStage(
  raw: string,
): ParseResult<ReflectionStageOutput> {
  return parseStage(raw, ReflectionStageSchema);
}

export function parseSynthesizeStage(
  raw: string,
): ParseResult<SynthesizeStageOutput> {
  return parseStage(raw, SynthesizeStageSchema);
}

// Validate a fully-assembled payload (e.g. on backup import). Returns the
// typed payload so the caller can persist it without re-casting.
export function validateArticleAnalysisPayload(
  value: unknown,
): ParseResult<ArticleAnalysisPayload> {
  const parsed = ArticleAnalysisPayloadSchema.safeParse(value);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "schema_failed",
      detail: parsed.error.issues[0]?.message ?? "schema_failed",
    };
  }
  return { ok: true, value: parsed.data };
}
