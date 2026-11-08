import { afterEach, describe, expect, it } from "vitest";

import {
  countConceptsByWorkspace,
  countEdgesByWorkspace,
  createConcept,
  createEdge,
} from "./concepts";
import { db } from "./schema";

async function addConcept(workspaceId: string, label: string) {
  return createConcept({
    workspaceId,
    label,
    labelNorm: label.toLowerCase(),
    kind: "concept",
    sourceIds: [],
    chunkRefs: [],
  });
}

describe("concept graph counts", () => {
  afterEach(async () => {
    await db.concepts.clear();
    await db.conceptEdges.clear();
  });

  it("returns zero for a workspace with no graph", async () => {
    expect(await countConceptsByWorkspace("ws-empty")).toBe(0);
    expect(await countEdgesByWorkspace("ws-empty")).toBe(0);
  });

  it("counts only the concepts and edges of the given workspace", async () => {
    const a = await addConcept("ws-1", "Entropy");
    const b = await addConcept("ws-1", "Temperature");
    const c = await addConcept("ws-1", "Heat");
    await addConcept("ws-2", "Unrelated");
    await createEdge({ workspaceId: "ws-1", fromId: a.id, toId: b.id, kind: "related", evidenceChunkIds: [] });
    await createEdge({ workspaceId: "ws-1", fromId: b.id, toId: c.id, kind: "depends-on", evidenceChunkIds: [] });

    expect(await countConceptsByWorkspace("ws-1")).toBe(3);
    expect(await countEdgesByWorkspace("ws-1")).toBe(2);
    expect(await countConceptsByWorkspace("ws-2")).toBe(1);
    expect(await countEdgesByWorkspace("ws-2")).toBe(0);
  });
});
