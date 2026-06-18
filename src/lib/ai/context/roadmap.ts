// Workspace Chat — Roadmap context builder.
//
// Renders the workspace's most recent roadmap as a compact node list annotated
// with completion status (done / next / todo), so the tutor can suggest "what
// to study next" grounded in the learner's actual plan. "Done" is the same
// activity-derived signal the canvas uses (manual `done` OR linked deck fully
// learned) via `listCompleteRoadmapNodeIds`. Returns null when there is no
// roadmap.

import {
  listCompleteRoadmapNodeIds,
  listRoadmapNodes,
  listRoadmapsByWorkspace,
} from "@/lib/db/roadmaps";
import type { RoadmapNodeRecord } from "@/lib/roadmap/types";
import { CONTEXT_TOKEN_BUDGETS, clampToBudget } from "./budget";
import type { ContextBlock } from "./types";

const MAX_NODES = 40;
const DESCRIPTION_CHARS = 120;

// "Next" = the first not-done node (in creation order) whose every parent /
// prerequisite is already complete. Cheap to compute over the bounded
// per-roadmap node set; if no clean frontier exists, the earliest not-done
// node is flagged so the tutor still has a concrete starting point.
function pickNextNodeId(
  nodes: RoadmapNodeRecord[],
  doneIds: Set<string>,
): string | null {
  const firstUnblocked = nodes.find(
    (n) =>
      !doneIds.has(n.id) &&
      (n.parentId === null || doneIds.has(n.parentId)),
  );
  if (firstUnblocked) return firstUnblocked.id;
  const firstTodo = nodes.find((n) => !doneIds.has(n.id));
  return firstTodo ? firstTodo.id : null;
}

export async function buildRoadmapContext(
  workspaceId: string,
): Promise<ContextBlock | null> {
  const roadmaps = await listRoadmapsByWorkspace(workspaceId);
  // listRoadmapsByWorkspace is newest-first; the active roadmap is index 0.
  const roadmap = roadmaps[0];
  if (!roadmap) return null;

  const [nodes, completeIds] = await Promise.all([
    listRoadmapNodes(roadmap.id),
    listCompleteRoadmapNodeIds(roadmap.id),
  ]);
  if (nodes.length === 0) return null;

  const doneIds = new Set(completeIds);
  const nextId = pickNextNodeId(nodes, doneIds);

  const doneCount = nodes.filter((n) => doneIds.has(n.id)).length;
  const lines: string[] = [
    `Learning roadmap "${roadmap.title}" (${roadmap.timeframe}, ${roadmap.level}) — ${doneCount}/${nodes.length} done:`,
  ];
  for (const node of nodes.slice(0, MAX_NODES)) {
    const status = doneIds.has(node.id)
      ? "done"
      : node.id === nextId
        ? "next"
        : "todo";
    const indent = "  ".repeat(node.depth);
    const desc = node.description.replace(/\s+/g, " ").trim();
    const tail =
      desc.length > 0 ? ` — ${desc.slice(0, DESCRIPTION_CHARS)}` : "";
    lines.push(`${indent}- [${status}] ${node.title}${tail}`);
  }

  const text = clampToBudget(lines.join("\n"), CONTEXT_TOKEN_BUDGETS.roadmap);
  if (text.trim().length === 0) return null;
  return { kind: "roadmap", text };
}
