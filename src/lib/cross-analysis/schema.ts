import { z } from "zod";

import { extractFirstJsonObject } from "@/lib/roadmap/schema";
import type { ParseResult } from "@/lib/article-analysis/schema";
import { CONTRADICTION_KINDS, type CrossAnalysisPayload } from "./types";

// Literal tuple rather than a cast over CONTRADICTION_KINDS: z.enum needs the
// literals to infer the union, and a widened `string` would silently defeat the
// ContradictionKind typing all the way down to groundContradictions.
const ContradictionKindSchema = z.enum([
  "direct",
  "methodological",
  "scope",
  "terminological",
]);

// Keeps the runtime list and the schema from drifting apart: this stops
// compiling the moment one gains a member the other lacks.
const _kindsInSync: readonly ContradictionKindSchemaType[] = CONTRADICTION_KINDS;
type ContradictionKindSchemaType = z.infer<typeof ContradictionKindSchema>;
void _kindsInSync;

// Per-stage JSON contracts for the Cross-Analysis pipeline, mirroring
// `article-analysis/schema.ts`: same tolerant `extractFirstJsonObject` slice,
// same `ParseResult<T>` union (imported, not redeclared), same per-stage
// `parseX(raw)` helpers.
//
// The defining constraint here: the model emits REFERENCES, never content it
// could have fabricated.
//   - a contradiction side is a claim ref ("p0.kr2"), resolved in ./refs
//   - a reading-order entry is a paperIndex, mapped to an analysisId in code
// Neither claim text, nor quotes, nor `grounded` appear in any wire schema.

export type { ParseResult };

// ---------------------------------------------------------------------------
// Stage A — CONTRADICTIONS
// ---------------------------------------------------------------------------

// Refs are code-generated and matched exactly against the claim table, so the
// pattern is a cheap first filter — a ref that doesn't even look like one can
// never resolve.
const ClaimRefSchema = z
  .string()
  .regex(/^p\d+\.[a-z]{2}\d+$/, "claim ref must look like p0.kr2");

export const ContradictionStageSchema = z.object({
  contradictions: z.array(
    z.object({
      aRef: ClaimRefSchema,
      bRef: ClaimRefSchema,
      kind: ContradictionKindSchema,
      explanation: z.string().min(1),
    }),
  ),
});
export type ContradictionStageOutput = z.infer<typeof ContradictionStageSchema>;

// ---------------------------------------------------------------------------
// Stage B — SYNTHESIS
// ---------------------------------------------------------------------------

export const SynthesisStageSchema = z.object({
  consensus: z.array(z.string()),
  divergences: z.array(z.string()),
  // paperIndex, not analysisId — the model is never shown internal ids, and
  // could not be trusted to echo them back intact if it were.
  readingOrder: z.array(
    z.object({ paperIndex: z.number().int().min(0), why: z.string().min(1) }),
  ),
  synthesis: z.string(),
});
export type SynthesisStageOutput = z.infer<typeof SynthesisStageSchema>;

// ---------------------------------------------------------------------------
// Persisted payload validator (backup import / round-trip)
// ---------------------------------------------------------------------------

const StoredCitationSchema = z.object({
  quote: z.string(),
  page: z.number().optional(),
  chunkId: z.string().optional(),
  verification: z.enum(["exact", "fuzzy", "unverified"]).optional(),
});

const ContradictionSideSchema = z.object({
  paperIndex: z.number().int().min(0),
  ref: z.string(),
  text: z.string(),
  citation: StoredCitationSchema.optional(),
});

const ComparedPaperSchema = z.object({
  analysisId: z.string(),
  sourceId: z.string(),
  title: z.string(),
});

const MatrixRowSchema = z.object({
  key: z.string(),
  values: z.array(z.string().optional()),
  uniform: z.boolean(),
});

export const CrossAnalysisPayloadSchema = z.object({
  matrix: z.object({
    papers: z.array(ComparedPaperSchema),
    rows: z.array(MatrixRowSchema),
  }),
  contradictions: z.array(
    z.object({
      a: ContradictionSideSchema,
      b: ContradictionSideSchema,
      kind: ContradictionKindSchema,
      explanation: z.string(),
      grounded: z.boolean(),
    }),
  ),
  consensus: z.array(z.string()),
  divergences: z.array(z.string()),
  readingOrder: z.array(z.object({ analysisId: z.string(), why: z.string() })),
  synthesis: z.string(),
});

// ---------------------------------------------------------------------------
// Tolerant text → JSON parsing
// ---------------------------------------------------------------------------

function parseStage<T>(raw: string, schema: z.ZodType<T>): ParseResult<T> {
  const slice = extractFirstJsonObject(raw);
  if (!slice) return { ok: false, reason: "no_json" };
  let json: unknown;
  try {
    json = JSON.parse(slice);
  } catch {
    return { ok: false, reason: "no_json" };
  }
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

export function parseContradictionStage(
  raw: string,
): ParseResult<ContradictionStageOutput> {
  return parseStage(raw, ContradictionStageSchema);
}

export function parseSynthesisStage(
  raw: string,
): ParseResult<SynthesisStageOutput> {
  return parseStage(raw, SynthesisStageSchema);
}

export function validateCrossAnalysisPayload(
  value: unknown,
): ParseResult<CrossAnalysisPayload> {
  const parsed = CrossAnalysisPayloadSchema.safeParse(value);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "schema_failed",
      detail: parsed.error.issues[0]?.message ?? "schema_failed",
    };
  }
  return { ok: true, value: parsed.data as CrossAnalysisPayload };
}
