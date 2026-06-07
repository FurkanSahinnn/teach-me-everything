import { newId } from "@/lib/utils/id";
import { db } from "./schema";
import type {
  RoadmapEdgeRecord,
  RoadmapLangMode,
  RoadmapLevel,
  RoadmapNodeDepth,
  RoadmapNodeRecord,
  RoadmapNodeStatus,
  RoadmapRecord,
  RoadmapTimeframe,
} from "@/lib/roadmap/types";

// ---------------------------------------------------------------------------
// Roadmap (header row)
// ---------------------------------------------------------------------------

export type CreateRoadmapInput = {
  workspaceId: string;
  title: string;
  // English title — only for langMode "both".
  titleEn?: string;
  // Optional so legacy/test callers can omit it; the wizard always sets it.
  langMode?: RoadmapLangMode;
  topic: string;
  timeframe: RoadmapTimeframe;
  level: RoadmapLevel;
  goal?: string;
  usedSources: boolean;
  model: string;
};

export async function createRoadmap(
  input: CreateRoadmapInput,
): Promise<RoadmapRecord> {
  const now = Date.now();
  const record: RoadmapRecord = {
    id: newId("rmp"),
    workspaceId: input.workspaceId,
    title: input.title,
    ...(input.titleEn ? { titleEn: input.titleEn } : {}),
    ...(input.langMode ? { langMode: input.langMode } : {}),
    topic: input.topic,
    timeframe: input.timeframe,
    level: input.level,
    ...(input.goal ? { goal: input.goal } : {}),
    usedSources: input.usedSources,
    model: input.model,
    createdAt: now,
    updatedAt: now,
  };
  await db.roadmaps.add(record);
  return record;
}

export async function getRoadmap(
  id: string,
): Promise<RoadmapRecord | undefined> {
  return db.roadmaps.get(id);
}

export type RoadmapPatch = Partial<{
  title: string;
  topic: string;
  timeframe: RoadmapTimeframe;
  level: RoadmapLevel;
  goal: string | null;
  usedSources: boolean;
  model: string;
}>;

export async function updateRoadmap(
  id: string,
  patch: RoadmapPatch,
): Promise<void> {
  const next: Record<string, unknown> = { updatedAt: Date.now() };
  for (const [key, value] of Object.entries(patch)) {
    // `goal: null` is the explicit-clear signal — translate to undefined so
    // Dexie drops the field instead of storing a JSON null.
    if (key === "goal" && value === null) {
      next.goal = undefined;
      continue;
    }
    next[key] = value;
  }
  await db.roadmaps.update(id, next);
}

export async function listRoadmapsByWorkspace(
  workspaceId: string,
): Promise<RoadmapRecord[]> {
  const rows = await db.roadmaps
    .where("workspaceId")
    .equals(workspaceId)
    .toArray();
  return rows.sort((a, b) => b.createdAt - a.createdAt);
}

// Deletes a roadmap plus every node and edge that references it. Single
// transaction so a crash mid-delete can't leave dangling children that
// would haunt later list queries.
export async function deleteRoadmap(id: string): Promise<void> {
  await db.transaction(
    "rw",
    [db.roadmaps, db.roadmapNodes, db.roadmapEdges],
    async () => {
      await db.roadmapEdges.where("roadmapId").equals(id).delete();
      await db.roadmapNodes.where("roadmapId").equals(id).delete();
      await db.roadmaps.delete(id);
    },
  );
}

// ---------------------------------------------------------------------------
// Nodes + edges (graph body)
// ---------------------------------------------------------------------------

// Node + edge inputs the AI runner hands in. Each node carries a `tempId`
// (the AI's "n1" / "c1" string) that edges reference; the repo mints a
// persistent `id` per node and rewrites edge endpoints inside the same
// transaction so the caller never has to know the persisted ids.
export type RoadmapNodeInput = {
  tempId: string;
  parentId: string | null;
  depth: RoadmapNodeDepth;
  title: string;
  description: string;
  // English variants — only for langMode "both".
  titleEn?: string;
  descriptionEn?: string;
  status?: RoadmapNodeStatus;
};

export type RoadmapEdgeInput = {
  fromTempId: string;
  toTempId: string;
};

function buildTempToReal(
  inputs: RoadmapNodeInput[],
  records: RoadmapNodeRecord[],
): Map<string, string> {
  const map = new Map<string, string>();
  for (let i = 0; i < inputs.length; i += 1) {
    const input = inputs[i];
    const record = records[i];
    if (!input || !record) continue;
    map.set(input.tempId, record.id);
  }
  return map;
}

function mintNodeRecords(
  roadmapId: string,
  inputs: RoadmapNodeInput[],
  now: number,
): RoadmapNodeRecord[] {
  return inputs.map((n) => ({
    id: newId("rmn"),
    roadmapId,
    parentId: n.parentId,
    depth: n.depth,
    title: n.title,
    description: n.description,
    ...(n.titleEn ? { titleEn: n.titleEn } : {}),
    ...(n.descriptionEn ? { descriptionEn: n.descriptionEn } : {}),
    status: n.status ?? "todo",
    createdAt: now,
    updatedAt: now,
  }));
}

function mintEdgeRecords(
  roadmapId: string,
  edges: RoadmapEdgeInput[],
  tempToReal: Map<string, string>,
  now: number,
): RoadmapEdgeRecord[] {
  const out: RoadmapEdgeRecord[] = [];
  for (const e of edges) {
    const from = tempToReal.get(e.fromTempId);
    const to = tempToReal.get(e.toTempId);
    if (!from || !to || from === to) continue;
    out.push({
      id: newId("rme"),
      roadmapId,
      fromNodeId: from,
      toNodeId: to,
      createdAt: now,
    });
  }
  return out;
}

/**
 * Replace the entire graph attached to a roadmap. Used by the initial AI
 * call (the wizard hands us a fresh `{nodes, edges}` payload). Wipes any
 * existing graph and re-seeds inside a single transaction so the renderer
 * can't observe a half-replaced state.
 */
export async function replaceRoadmapGraph(
  roadmapId: string,
  nodes: RoadmapNodeInput[],
  edges: RoadmapEdgeInput[],
): Promise<{ nodes: RoadmapNodeRecord[]; edges: RoadmapEdgeRecord[] }> {
  const now = Date.now();
  const nodeRecords = mintNodeRecords(roadmapId, nodes, now);
  const tempToReal = buildTempToReal(nodes, nodeRecords);
  const edgeRecords = mintEdgeRecords(roadmapId, edges, tempToReal, now);
  await db.transaction(
    "rw",
    [db.roadmaps, db.roadmapNodes, db.roadmapEdges],
    async () => {
      await db.roadmapEdges.where("roadmapId").equals(roadmapId).delete();
      await db.roadmapNodes.where("roadmapId").equals(roadmapId).delete();
      if (nodeRecords.length > 0) await db.roadmapNodes.bulkAdd(nodeRecords);
      if (edgeRecords.length > 0) await db.roadmapEdges.bulkAdd(edgeRecords);
      await db.roadmaps.update(roadmapId, { updatedAt: now });
    },
  );
  return { nodes: nodeRecords, edges: edgeRecords };
}

/**
 * Insert subnodes underneath a parent. Used by "Create subtasks". The
 * parent's depth must be < `MAX_ROADMAP_DEPTH`; callers gate the UI. Cross-
 * sibling edges produced by the AI are stitched in via the same temp-id
 * mapping as the initial seed.
 */
export async function addSubnodes(
  roadmapId: string,
  parentId: string,
  childDepth: RoadmapNodeDepth,
  children: RoadmapNodeInput[],
  edges: RoadmapEdgeInput[],
): Promise<{ nodes: RoadmapNodeRecord[]; edges: RoadmapEdgeRecord[] }> {
  const now = Date.now();
  // Force the parent + depth onto every child input so callers can't smuggle
  // a deeper structure past the wizard's depth-cap gate.
  const sanitized: RoadmapNodeInput[] = children.map((c) => ({
    ...c,
    parentId,
    depth: childDepth,
  }));
  const childRecords = mintNodeRecords(roadmapId, sanitized, now);
  const tempToReal = buildTempToReal(sanitized, childRecords);
  const edgeRecords = mintEdgeRecords(roadmapId, edges, tempToReal, now);
  // The AI only returns cross-sibling edges (child→child); a parent→child
  // edge is structurally impossible in SubtaskAiResponse. Without it the new
  // subtree would float free of its parent on the canvas (only held by the
  // weak parent-pull force, no drawn arrow). Synthesize a parent→child edge
  // for every child that has no incoming edge among the new AI edges, so the
  // prerequisite "parent topic precedes its subtasks" link is visible.
  const childRealIds = new Set(childRecords.map((c) => c.id));
  const hasIncoming = new Set<string>();
  for (const er of edgeRecords) {
    if (childRealIds.has(er.toNodeId)) hasIncoming.add(er.toNodeId);
  }
  for (const c of childRecords) {
    if (!hasIncoming.has(c.id)) {
      edgeRecords.push({
        id: newId("rme"),
        roadmapId,
        fromNodeId: parentId,
        toNodeId: c.id,
        createdAt: now,
      });
    }
  }
  await db.transaction(
    "rw",
    [db.roadmaps, db.roadmapNodes, db.roadmapEdges],
    async () => {
      if (childRecords.length > 0) await db.roadmapNodes.bulkAdd(childRecords);
      if (edgeRecords.length > 0) await db.roadmapEdges.bulkAdd(edgeRecords);
      await db.roadmaps.update(roadmapId, { updatedAt: now });
    },
  );
  return { nodes: childRecords, edges: edgeRecords };
}

export async function listRoadmapNodes(
  roadmapId: string,
): Promise<RoadmapNodeRecord[]> {
  const rows = await db.roadmapNodes
    .where("roadmapId")
    .equals(roadmapId)
    .toArray();
  return rows.sort((a, b) => a.createdAt - b.createdAt);
}

export async function listRoadmapEdges(
  roadmapId: string,
): Promise<RoadmapEdgeRecord[]> {
  return db.roadmapEdges.where("roadmapId").equals(roadmapId).toArray();
}

export async function getRoadmapNode(
  id: string,
): Promise<RoadmapNodeRecord | undefined> {
  return db.roadmapNodes.get(id);
}

export type RoadmapNodePatch = Partial<{
  title: string;
  description: string;
  status: RoadmapNodeStatus;
  x: number;
  y: number;
  pinned: boolean;
  noteId: string;
  deckId: string;
}>;

export async function updateRoadmapNode(
  id: string,
  patch: RoadmapNodePatch,
): Promise<void> {
  await db.roadmapNodes.update(id, { ...patch, updatedAt: Date.now() });
}

/**
 * Persist a hand-dragged node position. Stamps `pinned` so the auto layered
 * layout leaves the coordinates alone on the next render / reload.
 */
export async function moveRoadmapNode(
  id: string,
  x: number,
  y: number,
): Promise<void> {
  await db.roadmapNodes.update(id, {
    x,
    y,
    pinned: true,
    updatedAt: Date.now(),
  });
}

/**
 * Clear every hand-placed position in a roadmap so the canvas reverts to the
 * deterministic auto layout. Uses `modify` + `delete` so the cached fields are
 * actually removed (not stored as JSON nulls that would re-pin the node).
 */
export async function resetRoadmapLayout(roadmapId: string): Promise<void> {
  const now = Date.now();
  await db.transaction("rw", db.roadmapNodes, async () => {
    await db.roadmapNodes
      .where("roadmapId")
      .equals(roadmapId)
      .modify((n) => {
        const row = n as Partial<RoadmapNodeRecord>;
        delete row.x;
        delete row.y;
        delete row.pinned;
        n.updatedAt = now;
      });
  });
}

export async function setNodeStatus(
  id: string,
  status: RoadmapNodeStatus,
): Promise<void> {
  await db.roadmapNodes.update(id, { status, updatedAt: Date.now() });
}

/**
 * Delete a node and every descendant. Edges that reference any of the
 * removed nodes are pruned in the same transaction so the renderer can't
 * draw a dangling arrowhead after the cascade.
 *
 * Descendants are resolved by walking `parentId` levels — cheap because the
 * depth cap is 2.
 */
export async function deleteRoadmapNode(id: string): Promise<void> {
  await db.transaction(
    "rw",
    [db.roadmaps, db.roadmapNodes, db.roadmapEdges],
    async () => {
      const target = await db.roadmapNodes.get(id);
      if (!target) return;
      const roadmapId = target.roadmapId;
      const all = await db.roadmapNodes
        .where("roadmapId")
        .equals(roadmapId)
        .toArray();
      const toRemove = new Set<string>([id]);
      // Two passes are sufficient at depth cap 2 but a fixed-point loop
      // future-proofs the cap bump without recursive ts complaints.
      let grew = true;
      while (grew) {
        grew = false;
        for (const n of all) {
          if (!toRemove.has(n.id) && n.parentId && toRemove.has(n.parentId)) {
            toRemove.add(n.id);
            grew = true;
          }
        }
      }
      const idsArr = Array.from(toRemove);
      const edges = await db.roadmapEdges
        .where("roadmapId")
        .equals(roadmapId)
        .toArray();
      const edgeIds = edges
        .filter((e) => toRemove.has(e.fromNodeId) || toRemove.has(e.toNodeId))
        .map((e) => e.id);
      await db.roadmapNodes.bulkDelete(idsArr);
      if (edgeIds.length > 0) await db.roadmapEdges.bulkDelete(edgeIds);
      await db.roadmaps.update(roadmapId, { updatedAt: Date.now() });
    },
  );
}

// ---------------------------------------------------------------------------
// Progress aggregations
// ---------------------------------------------------------------------------

export type RoadmapProgress = {
  total: number;
  done: number;
};

// A flashcard counts as "learned" once it has passed at least one SM-2
// repetition (repetitions resets to 0 on a lapse, so this tracks current
// mastery, not lifetime reviews).
function isCardLearned(card: { repetitions: number }): boolean {
  return card.repetitions >= 1;
}

/**
 * Decide whether a node counts as complete. A node is done when the user
 * manually marked it OR its linked flashcard deck is fully learned — so
 * progress flows from real study activity, not just the manual toggle. Pure
 * for testability; `deckFullyLearned` answers per linked deck id.
 */
export function isRoadmapNodeComplete(
  node: Pick<RoadmapNodeRecord, "status" | "deckId">,
  deckFullyLearned: (deckId: string) => boolean,
): boolean {
  if (node.status === "done") return true;
  if (node.deckId && deckFullyLearned(node.deckId)) return true;
  return false;
}

// Decks whose every flashcard is learned — derived from the linked decks'
// SRS state so completion measures learning, not self-reported clicks.
async function fullyLearnedDeckIds(
  nodes: Pick<RoadmapNodeRecord, "deckId">[],
): Promise<Set<string>> {
  const fullyLearned = new Set<string>();
  const deckIds = Array.from(
    new Set(
      nodes
        .map((n) => n.deckId)
        .filter((d): d is string => typeof d === "string" && d.length > 0),
    ),
  );
  if (deckIds.length === 0) return fullyLearned;
  const cards = await db.flashcards.where("deckId").anyOf(deckIds).toArray();
  const agg = new Map<string, { total: number; learned: number }>();
  for (const c of cards) {
    if (!c.deckId) continue;
    const a = agg.get(c.deckId) ?? { total: 0, learned: 0 };
    a.total += 1;
    if (isCardLearned(c)) a.learned += 1;
    agg.set(c.deckId, a);
  }
  for (const [deckId, a] of agg) {
    if (a.total > 0 && a.learned === a.total) fullyLearned.add(deckId);
  }
  return fullyLearned;
}

export async function countRoadmapProgress(
  roadmapId: string,
): Promise<RoadmapProgress> {
  const nodes = await db.roadmapNodes
    .where("roadmapId")
    .equals(roadmapId)
    .toArray();
  const fullyLearned = await fullyLearnedDeckIds(nodes);
  let done = 0;
  for (const n of nodes) {
    if (isRoadmapNodeComplete(n, (deckId) => fullyLearned.has(deckId))) {
      done += 1;
    }
  }
  return { total: nodes.length, done };
}

// Node ids that count as complete (manual `done` OR deck fully learned). Used
// by the graph canvas so the dimmed/checkmark visual matches the progress bar.
export async function listCompleteRoadmapNodeIds(
  roadmapId: string,
): Promise<string[]> {
  const nodes = await db.roadmapNodes
    .where("roadmapId")
    .equals(roadmapId)
    .toArray();
  const fullyLearned = await fullyLearnedDeckIds(nodes);
  return nodes
    .filter((n) => isRoadmapNodeComplete(n, (d) => fullyLearned.has(d)))
    .map((n) => n.id);
}
