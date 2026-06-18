// Workspace Chat — context layer entry point.
//
// `gatherContextBlocks` dispatches the toggled non-source / non-web scopes to
// their builders and returns the produced blocks in a STABLE order (notes →
// concepts → roadmap → performance) regardless of the order the chips were
// toggled, so the system prompt stays cache-friendly across turns. Each
// builder reads the live Dexie repos and returns null when there is no data;
// nulls are dropped here. `"sources"` and `"web"` are handled by the runner
// (RAG retrieval + the web-search adapter) and are ignored by this dispatcher.

import { buildConceptsContext } from "./concepts";
import { buildNotesContext } from "./notes";
import { buildPerformanceContext } from "./performance";
import { buildRoadmapContext } from "./roadmap";
import type { ContextBlock, ContextScope } from "./types";

export type { ContextBlock, ContextScope } from "./types";
export { CONTEXT_TOKEN_BUDGETS, clampToBudget } from "./budget";
export { buildNotesContext } from "./notes";
export { buildConceptsContext } from "./concepts";
export { buildRoadmapContext } from "./roadmap";
export { buildPerformanceContext } from "./performance";

// Canonical render order for the prose blocks. Drives both the dispatch loop
// and the prompt assembly so the cached prefix is deterministic.
const BLOCK_ORDER: ReadonlyArray<Exclude<ContextScope, "sources" | "web">> = [
  "notes",
  "concepts",
  "roadmap",
  "performance",
];

const BUILDERS: Record<
  Exclude<ContextScope, "sources" | "web">,
  (workspaceId: string) => Promise<ContextBlock | null>
> = {
  notes: buildNotesContext,
  concepts: buildConceptsContext,
  roadmap: buildRoadmapContext,
  performance: buildPerformanceContext,
};

export async function gatherContextBlocks(
  workspaceId: string,
  scopes: ContextScope[],
): Promise<ContextBlock[]> {
  const active = new Set(scopes);
  const wanted = BLOCK_ORDER.filter((kind) => active.has(kind));
  if (wanted.length === 0) return [];
  // Run the builders concurrently but emit in the canonical order so the
  // prompt prefix is stable turn-to-turn.
  const results = await Promise.all(
    wanted.map((kind) => BUILDERS[kind](workspaceId)),
  );
  return results.filter((b): b is ContextBlock => b !== null);
}
