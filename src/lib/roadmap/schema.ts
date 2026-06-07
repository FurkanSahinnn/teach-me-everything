import { z } from "zod";

// JSON contracts the AI must produce. Two shapes:
//   - `RoadmapAiResponse` for the wizard's initial single-shot generation.
//   - `SubtaskAiResponse` for "Create subtasks" expansion under a parent.
//
// The wire format uses ephemeral temp ids (`n1`..`nN` / `c1`..`cN`); the
// repo converts them into persistent ids at insert time. We validate
// shapes with Zod *and* enforce structural invariants (no orphan refs, no
// self-loops, no missing root) in `validateRoadmapStructure` /
// `validateSubtaskStructure` below — Zod can't express the
// node↔edge consistency cleanly enough.

const NodeSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
});

const EdgeSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
});

export const RoadmapAiResponseSchema = z.object({
  title: z.string().min(1),
  nodes: z.array(NodeSchema).min(1),
  edges: z.array(EdgeSchema),
});

export type RoadmapAiResponse = z.infer<typeof RoadmapAiResponseSchema>;

export const SubtaskAiResponseSchema = z.object({
  children: z.array(NodeSchema).min(1),
  edges: z.array(EdgeSchema),
});

export type SubtaskAiResponse = z.infer<typeof SubtaskAiResponseSchema>;

// Translation pass (langMode "both"): the model echoes each node id with the
// translated title/description. No edges — structure is fixed by the original.
const TranslateItemSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
});

export const RoadmapTranslateResponseSchema = z.object({
  items: z.array(TranslateItemSchema),
});

export type RoadmapTranslateResponse = z.infer<
  typeof RoadmapTranslateResponseSchema
>;

// ---------------------------------------------------------------------------
// Tolerant text → JSON extraction
// ---------------------------------------------------------------------------

function stripCodeFence(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  return trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
}

// Extract the JSON object out of arbitrary model output. Some smaller models
// wrap the JSON in prose ("Here you go: { ... }"), others leak a trailing
// "Hope this helps!" after the closing brace. A naive first-`{`/last-`}`
// slice corrupts valid JSON when the trailing prose itself contains a `}`
// (or a description string contains braces). We instead walk from the first
// `{` tracking brace depth + string/escape state and return the slice at the
// matching depth-0 `}`. Returns null when no balanced object is present.
export function extractFirstJsonObject(raw: string): string | null {
  const cleaned = stripCodeFence(raw);
  const open = cleaned.indexOf("{");
  if (open === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = open; i < cleaned.length; i += 1) {
    const ch = cleaned[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return cleaned.slice(open, i + 1);
    }
  }
  return null;
}

function tryJsonParse(raw: string): unknown | null {
  const slice = extractFirstJsonObject(raw);
  if (!slice) return null;
  try {
    return JSON.parse(slice);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Structural validation (post-Zod)
// ---------------------------------------------------------------------------

export type ValidationError =
  | { kind: "duplicate_id"; id: string }
  | { kind: "self_loop"; id: string }
  | { kind: "unknown_edge_endpoint"; endpoint: string }
  | { kind: "cycle" }
  | { kind: "no_nodes" };

function validateGraph(
  ids: string[],
  edges: Array<{ from: string; to: string }>,
): ValidationError | null {
  if (ids.length === 0) return { kind: "no_nodes" };
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) return { kind: "duplicate_id", id };
    seen.add(id);
  }
  for (const e of edges) {
    if (!seen.has(e.from)) return { kind: "unknown_edge_endpoint", endpoint: e.from };
    if (!seen.has(e.to)) return { kind: "unknown_edge_endpoint", endpoint: e.to };
    if (e.from === e.to) return { kind: "self_loop", id: e.from };
  }
  // Cycle detection (Kahn's algorithm). The contract is a *prerequisite DAG*;
  // a cyclic "learn A before B before A" is logically impossible and renders
  // as a misleading arrow loop, so reject it rather than persist it.
  const indeg = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const id of ids) {
    indeg.set(id, 0);
    adj.set(id, []);
  }
  for (const e of edges) {
    adj.get(e.from)?.push(e.to);
    indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
  }
  const queue: string[] = [];
  for (const [id, d] of indeg) if (d === 0) queue.push(id);
  let head = 0;
  let visited = 0;
  while (head < queue.length) {
    const cur = queue[head];
    head += 1;
    if (cur === undefined) continue;
    visited += 1;
    for (const next of adj.get(cur) ?? []) {
      const nd = (indeg.get(next) ?? 0) - 1;
      indeg.set(next, nd);
      if (nd === 0) queue.push(next);
    }
  }
  if (visited < ids.length) return { kind: "cycle" };
  return null;
}

export function validateRoadmapStructure(
  payload: RoadmapAiResponse,
): ValidationError | null {
  return validateGraph(
    payload.nodes.map((n) => n.id),
    payload.edges,
  );
}

export function validateSubtaskStructure(
  payload: SubtaskAiResponse,
): ValidationError | null {
  return validateGraph(
    payload.children.map((n) => n.id),
    payload.edges,
  );
}

// ---------------------------------------------------------------------------
// One-shot helpers — call Zod + structural validator together.
// ---------------------------------------------------------------------------

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: "no_json" | "schema_failed" | "structure_failed"; detail?: string };

export function parseRoadmapResponse(
  raw: string,
): ParseResult<RoadmapAiResponse> {
  const json = tryJsonParse(raw);
  if (json === null) return { ok: false, reason: "no_json" };
  const parsed = RoadmapAiResponseSchema.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "schema_failed",
      detail: parsed.error.issues[0]?.message ?? "schema_failed",
    };
  }
  const structural = validateRoadmapStructure(parsed.data);
  if (structural) {
    return { ok: false, reason: "structure_failed", detail: structural.kind };
  }
  return { ok: true, value: parsed.data };
}

export function parseSubtaskResponse(
  raw: string,
): ParseResult<SubtaskAiResponse> {
  const json = tryJsonParse(raw);
  if (json === null) return { ok: false, reason: "no_json" };
  const parsed = SubtaskAiResponseSchema.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "schema_failed",
      detail: parsed.error.issues[0]?.message ?? "schema_failed",
    };
  }
  const structural = validateSubtaskStructure(parsed.data);
  if (structural) {
    return { ok: false, reason: "structure_failed", detail: structural.kind };
  }
  return { ok: true, value: parsed.data };
}

export function parseRoadmapTranslateResponse(
  raw: string,
): ParseResult<RoadmapTranslateResponse> {
  const json = tryJsonParse(raw);
  if (json === null) return { ok: false, reason: "no_json" };
  const parsed = RoadmapTranslateResponseSchema.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "schema_failed",
      detail: parsed.error.issues[0]?.message ?? "schema_failed",
    };
  }
  return { ok: true, value: parsed.data };
}
