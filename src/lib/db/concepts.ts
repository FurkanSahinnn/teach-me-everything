import { newId } from "@/lib/utils/id";
import { db } from "./schema";
import type {
  ConceptEdgeRecord,
  ConceptKind,
  ConceptEdgeKind,
  ConceptRecord,
} from "@/lib/concepts/types";

export type CreateConceptInput = {
  workspaceId: string;
  label: string;
  labelNorm: string;
  kind: ConceptKind;
  definition?: string;
  // English companions for "both"-mode extraction; base label/definition stay
  // Turkish. Optional → omitted entirely for single-language extraction.
  labelEn?: string;
  definitionEn?: string;
  sourceIds: string[];
  chunkRefs: string[];
};

export async function createConcept(
  input: CreateConceptInput,
): Promise<ConceptRecord> {
  const now = Date.now();
  const record: ConceptRecord = {
    id: newId("cpt"),
    workspaceId: input.workspaceId,
    label: input.label,
    labelNorm: input.labelNorm,
    kind: input.kind,
    sourceIds: input.sourceIds,
    chunkRefs: input.chunkRefs,
    ...(input.definition ? { definition: input.definition } : {}),
    ...(input.labelEn ? { labelEn: input.labelEn } : {}),
    ...(input.definitionEn ? { definitionEn: input.definitionEn } : {}),
    createdAt: now,
    updatedAt: now,
  };
  await db.concepts.add(record);
  return record;
}

export async function listConceptsByWorkspace(
  workspaceId: string,
): Promise<ConceptRecord[]> {
  return db.concepts.where("workspaceId").equals(workspaceId).toArray();
}

export async function deleteConceptsByWorkspace(
  workspaceId: string,
): Promise<void> {
  await db.concepts.where("workspaceId").equals(workspaceId).delete();
}

export type CreateEdgeInput = {
  workspaceId: string;
  fromId: string;
  toId: string;
  kind: ConceptEdgeKind;
  evidenceChunkIds: string[];
};

export async function createEdge(
  input: CreateEdgeInput,
): Promise<ConceptEdgeRecord> {
  const record: ConceptEdgeRecord = {
    id: newId("cedge"),
    workspaceId: input.workspaceId,
    fromId: input.fromId,
    toId: input.toId,
    kind: input.kind,
    evidenceChunkIds: input.evidenceChunkIds,
    createdAt: Date.now(),
  };
  await db.conceptEdges.add(record);
  return record;
}

export async function listEdgesByWorkspace(
  workspaceId: string,
): Promise<ConceptEdgeRecord[]> {
  return db.conceptEdges.where("workspaceId").equals(workspaceId).toArray();
}

export async function deleteEdgesByWorkspace(
  workspaceId: string,
): Promise<void> {
  await db.conceptEdges.where("workspaceId").equals(workspaceId).delete();
}

/**
 * Atomically replace a workspace's entire graph. Used by the extractor when
 * the user re-runs concept extraction — we wipe the previous concepts +
 * edges and rewrite from scratch so stale links can't dangle.
 *
 * Concepts must already have stable ids; the extractor mints them after
 * dedupe, so by the time we get here the input is the authoritative graph.
 */
export async function replaceWorkspaceGraph(
  workspaceId: string,
  concepts: ConceptRecord[],
  edges: ConceptEdgeRecord[],
): Promise<void> {
  await db.transaction(
    "rw",
    [db.concepts, db.conceptEdges],
    async () => {
      await db.concepts.where("workspaceId").equals(workspaceId).delete();
      await db.conceptEdges
        .where("workspaceId")
        .equals(workspaceId)
        .delete();
      if (concepts.length > 0) await db.concepts.bulkAdd(concepts);
      if (edges.length > 0) await db.conceptEdges.bulkAdd(edges);
    },
  );
}
