import type { RetrievedChunk } from "@/lib/ai/retrieval";
import { listConceptsByWorkspace } from "@/lib/db/concepts";
import { retrieveRelatedChunks, type RetrieveRelatedDeps } from "./related";

// Build the grounding string the roadmap prompt embeds when the user enables
// "Use workspace sources". We DELIBERATELY do not dump whole documents into
// the prompt — that would balloon input tokens, raise cost, and trip provider
// rate limits (e.g. Gemini). Instead we embed the topic and retrieve only the
// top-K most relevant chunk excerpts, hard-capped by token budget + per-
// excerpt length, optionally narrowed to a user-selected subset of documents.
//
// Falls back to the lightweight concept-label list when the workspace has no
// embedded chunks yet, so the toggle still nudges the model.

const MAX_LABELS = 40;
const GROUNDING_K = 8;
const GROUNDING_MAX_TOKENS = 2000;
const EXCERPT_CHARS = 600;

export type RoadmapSourceContextInput = {
  topic: string;
  // Narrow grounding to specific source ids. Empty/undefined = whole workspace.
  sourceIds?: readonly string[];
};

/**
 * Render retrieved chunks as a compact excerpt list. Each excerpt is
 * whitespace-collapsed and hard-capped so a few top matches stand in for whole
 * documents — keeping the prompt (and thus cost / rate-limit exposure)
 * bounded. Pure — unit-tested.
 */
export function formatExcerptContext(
  chunks: RetrievedChunk[],
): string | undefined {
  const lines = [
    "Relevant source excerpts (top matches only — NOT full documents):",
  ];
  for (const r of chunks) {
    const heading =
      (r.chunk.section && r.chunk.section.trim()) ||
      (r.chunk.headings && r.chunk.headings[0]) ||
      "";
    const text = r.chunk.text.replace(/\s+/g, " ").trim().slice(0, EXCERPT_CHARS);
    if (text.length === 0) continue;
    lines.push(heading ? `- [${heading}] ${text}` : `- ${text}`);
  }
  return lines.length > 1 ? lines.join("\n") : undefined;
}

export async function buildRoadmapSourceContext(
  workspaceId: string,
  input: RoadmapSourceContextInput,
  deps: RetrieveRelatedDeps = {},
): Promise<string | undefined> {
  const query = input.topic.trim();
  if (query.length > 0) {
    const res = await retrieveRelatedChunks(workspaceId, query, {
      k: GROUNDING_K,
      maxTokens: GROUNDING_MAX_TOKENS,
      ...(input.sourceIds && input.sourceIds.length > 0
        ? { sourceIds: input.sourceIds }
        : {}),
      ...deps,
    });
    const excerpts = formatExcerptContext(res.chunks);
    if (excerpts) return excerpts;
  }
  // Fallback: workspace not embedded yet (or blank topic) → the lightweight
  // concept-label list so the toggle still steers the model toward the
  // workspace vocabulary.
  return buildConceptLabelContext(workspaceId, input.sourceIds);
}

async function buildConceptLabelContext(
  workspaceId: string,
  sourceIds?: readonly string[],
): Promise<string | undefined> {
  const concepts = await listConceptsByWorkspace(workspaceId);
  if (concepts.length === 0) return undefined;
  let pool = concepts;
  if (sourceIds && sourceIds.length > 0) {
    const sel = new Set(sourceIds);
    const filtered = concepts.filter((c) =>
      (c.sourceIds ?? []).some((id) => sel.has(id)),
    );
    if (filtered.length > 0) pool = filtered;
  }
  const labels = pool
    .map((c) => c.label.trim())
    .filter((s) => s.length > 0)
    .slice(0, MAX_LABELS);
  if (labels.length === 0) return undefined;
  return ["Existing workspace concepts:", ...labels.map((l) => `- ${l}`)].join(
    "\n",
  );
}
