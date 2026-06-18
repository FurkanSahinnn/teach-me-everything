// Workspace Chat — Kavramlar context builder.
//
// Renders the mind-map graph as a compact text block: a concept list (label +
// optional short definition) followed by the relations between them. Reads the
// concepts + edges repos; returns null when the workspace has no concept graph
// yet. Token-budgeted so a large graph degrades to the most relevant slice
// rather than blowing the window.

import {
  listConceptsByWorkspace,
  listEdgesByWorkspace,
} from "@/lib/db/concepts";
import type {
  ConceptEdgeKind,
  ConceptRecord,
} from "@/lib/concepts/types";
import { CONTEXT_TOKEN_BUDGETS, clampToBudget } from "./budget";
import type { ContextBlock } from "./types";

const MAX_CONCEPTS = 60;
const MAX_RELATIONS = 60;
const DEFINITION_CHARS = 120;

// Human-readable verb for each edge kind so the relation list reads as prose
// rather than enum soup. Direction matches the stored edge (from → to).
const EDGE_PHRASE: Record<ConceptEdgeKind, string> = {
  "is-a": "is a",
  "part-of": "is part of",
  related: "is related to",
  "depends-on": "depends on",
};

function conceptLine(c: ConceptRecord): string {
  const def = c.definition?.replace(/\s+/g, " ").trim();
  if (def && def.length > 0) {
    return `- ${c.label} (${c.kind}): ${def.slice(0, DEFINITION_CHARS)}`;
  }
  return `- ${c.label} (${c.kind})`;
}

export async function buildConceptsContext(
  workspaceId: string,
): Promise<ContextBlock | null> {
  const [concepts, edges] = await Promise.all([
    listConceptsByWorkspace(workspaceId),
    listEdgesByWorkspace(workspaceId),
  ]);
  if (concepts.length === 0) return null;

  const labelById = new Map<string, string>();
  for (const c of concepts) labelById.set(c.id, c.label);

  const lines: string[] = ["Concept map for this workspace.", "", "Concepts:"];
  for (const c of concepts.slice(0, MAX_CONCEPTS)) {
    lines.push(conceptLine(c));
  }

  // Only emit relations whose endpoints are both in the (possibly truncated)
  // concept slice so the model never sees a dangling reference. Within the
  // first MAX_RELATIONS resolvable edges.
  const renderedConcepts = new Set(
    concepts.slice(0, MAX_CONCEPTS).map((c) => c.id),
  );
  const relationLines: string[] = [];
  for (const e of edges) {
    if (relationLines.length >= MAX_RELATIONS) break;
    if (!renderedConcepts.has(e.fromId) || !renderedConcepts.has(e.toId)) {
      continue;
    }
    const from = labelById.get(e.fromId);
    const to = labelById.get(e.toId);
    if (!from || !to) continue;
    relationLines.push(`- ${from} ${EDGE_PHRASE[e.kind]} ${to}`);
  }
  if (relationLines.length > 0) {
    lines.push("", "Relations:", ...relationLines);
  }

  const text = clampToBudget(lines.join("\n"), CONTEXT_TOKEN_BUDGETS.concepts);
  if (text.trim().length === 0) return null;
  return { kind: "concepts", text };
}
