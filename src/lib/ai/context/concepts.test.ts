import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ConceptEdgeRecord,
  ConceptRecord,
} from "@/lib/concepts/types";

const listConceptsByWorkspace =
  vi.fn<(ws: string) => Promise<ConceptRecord[]>>();
const listEdgesByWorkspace =
  vi.fn<(ws: string) => Promise<ConceptEdgeRecord[]>>();

vi.mock("@/lib/db/concepts", () => ({
  listConceptsByWorkspace: (ws: string) => listConceptsByWorkspace(ws),
  listEdgesByWorkspace: (ws: string) => listEdgesByWorkspace(ws),
}));

const { buildConceptsContext } = await import("./concepts");

function concept(partial: Partial<ConceptRecord>): ConceptRecord {
  return {
    id: partial.id ?? "cpt_1",
    workspaceId: "ws_1",
    label: partial.label ?? "Concept",
    labelNorm: (partial.label ?? "concept").toLowerCase(),
    kind: partial.kind ?? "concept",
    sourceIds: [],
    chunkRefs: [],
    createdAt: 1,
    updatedAt: 1,
    ...partial,
  };
}

beforeEach(() => {
  listConceptsByWorkspace.mockReset();
  listEdgesByWorkspace.mockReset();
});

describe("buildConceptsContext", () => {
  it("returns null when there are no concepts", async () => {
    listConceptsByWorkspace.mockResolvedValue([]);
    listEdgesByWorkspace.mockResolvedValue([]);
    await expect(buildConceptsContext("ws_1")).resolves.toBeNull();
  });

  it("renders concept list + human-readable relations", async () => {
    listConceptsByWorkspace.mockResolvedValue([
      concept({ id: "a", label: "Backpropagation", kind: "method", definition: "Gradient computation via chain rule." }),
      concept({ id: "b", label: "Gradient Descent", kind: "concept" }),
    ]);
    listEdgesByWorkspace.mockResolvedValue([
      {
        id: "e1",
        workspaceId: "ws_1",
        fromId: "a",
        toId: "b",
        kind: "depends-on",
        evidenceChunkIds: [],
        createdAt: 1,
      },
    ]);
    const block = await buildConceptsContext("ws_1");
    expect(block?.kind).toBe("concepts");
    expect(block?.text).toContain("Backpropagation (method)");
    expect(block?.text).toContain("Gradient computation via chain rule.");
    expect(block?.text).toContain("Backpropagation depends on Gradient Descent");
  });

  it("omits relations whose endpoints are not both present", async () => {
    listConceptsByWorkspace.mockResolvedValue([
      concept({ id: "a", label: "Alpha" }),
    ]);
    listEdgesByWorkspace.mockResolvedValue([
      {
        id: "e1",
        workspaceId: "ws_1",
        fromId: "a",
        toId: "ghost",
        kind: "related",
        evidenceChunkIds: [],
        createdAt: 1,
      },
    ]);
    const block = await buildConceptsContext("ws_1");
    expect(block?.text).toContain("Alpha");
    expect(block?.text).not.toContain("Relations:");
  });
});
