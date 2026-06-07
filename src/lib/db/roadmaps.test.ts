import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addSubnodes,
  countRoadmapProgress,
  createRoadmap,
  deleteRoadmap,
  deleteRoadmapNode,
  getRoadmap,
  isRoadmapNodeComplete,
  listRoadmapEdges,
  listRoadmapNodes,
  listRoadmapsByWorkspace,
  moveRoadmapNode,
  replaceRoadmapGraph,
  resetRoadmapLayout,
  setNodeStatus,
  updateRoadmap,
  updateRoadmapNode,
} from "./roadmaps";
import { createDeck, createFlashcard } from "./flashcards";
import { db } from "./schema";
import { createWorkspace } from "./workspaces";

beforeEach(async () => {
  await db.delete();
  await db.open();
});

afterEach(async () => {
  await db.delete();
});

async function seedWorkspace() {
  return createWorkspace({
    name: "NLP",
    color: "#000",
    initials: "NL",
  });
}

describe("roadmaps repo — header CRUD", () => {
  it("creates and retrieves a roadmap with timestamps + ids prefixed", async () => {
    const ws = await seedWorkspace();
    const rmp = await createRoadmap({
      workspaceId: ws.id,
      title: "Backprop temelleri",
      topic: "Neural network backpropagation",
      timeframe: "weekly",
      level: "beginner",
      usedSources: false,
      model: "claude-sonnet-4-6",
    });
    expect(rmp.id.startsWith("rmp_")).toBe(true);
    expect(rmp.createdAt).toBeGreaterThan(0);
    expect(rmp.updatedAt).toBe(rmp.createdAt);
    expect(rmp.usedSources).toBe(false);
    const reread = await getRoadmap(rmp.id);
    expect(reread?.title).toBe("Backprop temelleri");
  });

  it("omits goal when not provided and stores it when present", async () => {
    const ws = await seedWorkspace();
    const noGoal = await createRoadmap({
      workspaceId: ws.id,
      title: "A",
      topic: "A",
      timeframe: "daily",
      level: "beginner",
      usedSources: false,
      model: "claude-haiku-4-5-20251001",
    });
    expect(noGoal.goal).toBeUndefined();
    const withGoal = await createRoadmap({
      workspaceId: ws.id,
      title: "B",
      topic: "B",
      timeframe: "monthly",
      level: "advanced",
      goal: "Pass the exam",
      usedSources: true,
      model: "claude-opus-4-7",
    });
    expect(withGoal.goal).toBe("Pass the exam");
  });

  it("lists roadmaps by workspace ordered newest-first", async () => {
    const ws = await seedWorkspace();
    const first = await createRoadmap({
      workspaceId: ws.id,
      title: "First",
      topic: "x",
      timeframe: "daily",
      level: "beginner",
      usedSources: false,
      model: "m",
    });
    // Force a non-zero gap so the comparator sees a deterministic order.
    await new Promise((r) => setTimeout(r, 4));
    const second = await createRoadmap({
      workspaceId: ws.id,
      title: "Second",
      topic: "x",
      timeframe: "daily",
      level: "beginner",
      usedSources: false,
      model: "m",
    });
    const list = await listRoadmapsByWorkspace(ws.id);
    expect(list[0]?.id).toBe(second.id);
    expect(list[1]?.id).toBe(first.id);
  });

  it("updateRoadmap with goal:null clears the field instead of writing JSON null", async () => {
    const ws = await seedWorkspace();
    const rmp = await createRoadmap({
      workspaceId: ws.id,
      title: "T",
      topic: "T",
      timeframe: "daily",
      level: "beginner",
      goal: "keep",
      usedSources: false,
      model: "m",
    });
    await updateRoadmap(rmp.id, { goal: null });
    const reread = await getRoadmap(rmp.id);
    expect(reread?.goal).toBeUndefined();
  });
});

describe("roadmaps repo — graph body", () => {
  it("replaceRoadmapGraph wipes any existing graph and re-seeds", async () => {
    const ws = await seedWorkspace();
    const rmp = await createRoadmap({
      workspaceId: ws.id,
      title: "T",
      topic: "T",
      timeframe: "weekly",
      level: "intermediate",
      usedSources: false,
      model: "m",
    });
    const { nodes: firstNodes } = await replaceRoadmapGraph(
      rmp.id,
      [
        { tempId: "n1", parentId: null, depth: 0, title: "n1", description: "" },
        { tempId: "n2", parentId: null, depth: 0, title: "n2", description: "" },
      ],
      [{ fromTempId: "n1", toTempId: "n2" }],
    );
    expect(firstNodes).toHaveLength(2);
    const firstEdges = await listRoadmapEdges(rmp.id);
    expect(firstEdges).toHaveLength(1);
    expect(firstEdges[0]?.fromNodeId).toBe(firstNodes[0]?.id);

    const { nodes: secondNodes } = await replaceRoadmapGraph(
      rmp.id,
      [{ tempId: "n3", parentId: null, depth: 0, title: "n3", description: "" }],
      [],
    );
    expect(secondNodes).toHaveLength(1);
    const live = await listRoadmapNodes(rmp.id);
    expect(live.map((n) => n.title)).toEqual(["n3"]);
    // Old edges must be wiped along with the old nodes.
    expect(await listRoadmapEdges(rmp.id)).toEqual([]);
  });

  it("drops self-loops and edges to unknown temp ids", async () => {
    const ws = await seedWorkspace();
    const rmp = await createRoadmap({
      workspaceId: ws.id,
      title: "T",
      topic: "T",
      timeframe: "weekly",
      level: "beginner",
      usedSources: false,
      model: "m",
    });
    const { nodes: root } = await replaceRoadmapGraph(
      rmp.id,
      [{ tempId: "r1", parentId: null, depth: 0, title: "root", description: "" }],
      [],
    );
    const rootNode = root[0];
    if (!rootNode) throw new Error("root not created");
    const result = await addSubnodes(
      rmp.id,
      rootNode.id,
      1,
      [
        { tempId: "c1", parentId: null, depth: 0, title: "c1", description: "" },
        { tempId: "c2", parentId: null, depth: 0, title: "c2", description: "" },
      ],
      [
        { fromTempId: "c1", toTempId: "c2" },
        // self-loop and unknown temp ids must be dropped.
        { fromTempId: "c1", toTempId: "c1" },
        { fromTempId: "c1", toTempId: "ghost" },
      ],
    );
    // Two edges survive: the valid AI edge c1->c2, plus a synthesized
    // parent->c1 edge (c1 has no incoming edge among the new children, so it
    // is the subtree root and gets wired to the parent so the expansion isn't
    // a disconnected cluster). The self-loop and ghost edges are still dropped.
    expect(result.edges).toHaveLength(2);
    const aiEdge = result.edges.find(
      (e) => e.fromNodeId === result.nodes[0]?.id,
    );
    expect(aiEdge?.toNodeId).toBe(result.nodes[1]?.id);
    const parentEdge = result.edges.find((e) => e.fromNodeId === rootNode.id);
    expect(parentEdge?.toNodeId).toBe(result.nodes[0]?.id);
    // No surviving edge is a self-loop or points at an unknown endpoint.
    const validIds = [rootNode.id, result.nodes[0]?.id, result.nodes[1]?.id];
    expect(
      result.edges.every(
        (e) => e.fromNodeId !== e.toNodeId && validIds.includes(e.toNodeId),
      ),
    ).toBe(true);
    // addSubnodes forces parent + depth onto its children regardless of
    // what the caller passed in the input — surface that explicitly.
    expect(result.nodes[0]?.parentId).toBe(rootNode.id);
    expect(result.nodes[0]?.depth).toBe(1);
  });

  it("deleteRoadmapNode removes descendants and prunes referencing edges", async () => {
    const ws = await seedWorkspace();
    const rmp = await createRoadmap({
      workspaceId: ws.id,
      title: "T",
      topic: "T",
      timeframe: "monthly",
      level: "intermediate",
      usedSources: false,
      model: "m",
    });
    const { nodes } = await replaceRoadmapGraph(
      rmp.id,
      [
        { tempId: "a", parentId: null, depth: 0, title: "a", description: "" },
        { tempId: "b", parentId: null, depth: 0, title: "b", description: "" },
      ],
      [],
    );
    const a = nodes[0];
    const b = nodes[1];
    if (!a || !b) throw new Error("roots missing");
    // Build a 2-level subtree under `a`.
    const { nodes: kids } = await addSubnodes(
      rmp.id,
      a.id,
      1,
      [{ tempId: "a1", parentId: null, depth: 0, title: "a1", description: "" }],
      [],
    );
    const a1 = kids[0];
    if (!a1) throw new Error("child missing");
    await addSubnodes(
      rmp.id,
      a1.id,
      2,
      [{ tempId: "a1a", parentId: null, depth: 0, title: "a1a", description: "" }],
      [],
    );
    // Edge that references the doomed subtree must be deleted.
    await db.roadmapEdges.add({
      id: "rme_test",
      roadmapId: rmp.id,
      fromNodeId: a.id,
      toNodeId: b.id,
      createdAt: Date.now(),
    });
    await deleteRoadmapNode(a.id);
    const survivors = await listRoadmapNodes(rmp.id);
    expect(survivors.map((n) => n.title)).toEqual(["b"]);
    const edges = await listRoadmapEdges(rmp.id);
    expect(edges).toEqual([]);
  });

  it("persists langMode + bilingual title/node fields for a 'both' roadmap", async () => {
    const ws = await seedWorkspace();
    const rmp = await createRoadmap({
      workspaceId: ws.id,
      title: "Türkçe başlık",
      titleEn: "English title",
      langMode: "both",
      topic: "T",
      timeframe: "weekly",
      level: "beginner",
      usedSources: false,
      model: "m",
    });
    expect(rmp.langMode).toBe("both");
    expect(rmp.titleEn).toBe("English title");
    const { nodes } = await replaceRoadmapGraph(
      rmp.id,
      [
        {
          tempId: "n1",
          parentId: null,
          depth: 0,
          title: "Gradyan",
          description: "Türev kavramı.",
          titleEn: "Gradient",
          descriptionEn: "Concept of a derivative.",
        },
      ],
      [],
    );
    const stored = await db.roadmapNodes.get(nodes[0]!.id);
    expect(stored?.title).toBe("Gradyan");
    expect(stored?.titleEn).toBe("Gradient");
    expect(stored?.descriptionEn).toBe("Concept of a derivative.");
  });

  it("omits langMode + bilingual fields for single-language roadmaps", async () => {
    const ws = await seedWorkspace();
    const rmp = await createRoadmap({
      workspaceId: ws.id,
      title: "Tek dil",
      langMode: "tr",
      topic: "T",
      timeframe: "daily",
      level: "beginner",
      usedSources: false,
      model: "m",
    });
    expect(rmp.langMode).toBe("tr");
    expect(rmp.titleEn).toBeUndefined();
    const { nodes } = await replaceRoadmapGraph(
      rmp.id,
      [{ tempId: "n1", parentId: null, depth: 0, title: "a", description: "b" }],
      [],
    );
    const stored = await db.roadmapNodes.get(nodes[0]!.id);
    expect(stored?.titleEn).toBeUndefined();
    expect(stored?.descriptionEn).toBeUndefined();
  });

  it("moveRoadmapNode persists x/y + pins, resetRoadmapLayout clears them", async () => {
    const ws = await seedWorkspace();
    const rmp = await createRoadmap({
      workspaceId: ws.id,
      title: "T",
      topic: "T",
      timeframe: "weekly",
      level: "beginner",
      usedSources: false,
      model: "m",
    });
    const { nodes } = await replaceRoadmapGraph(
      rmp.id,
      [
        { tempId: "a", parentId: null, depth: 0, title: "a", description: "" },
        { tempId: "b", parentId: null, depth: 0, title: "b", description: "" },
      ],
      [],
    );
    const [a, b] = nodes;
    if (!a || !b) throw new Error("nodes missing");
    await moveRoadmapNode(a.id, 321, 654);
    const moved = await db.roadmapNodes.get(a.id);
    expect(moved?.x).toBe(321);
    expect(moved?.y).toBe(654);
    expect(moved?.pinned).toBe(true);
    // The other node stays un-pinned.
    expect((await db.roadmapNodes.get(b.id))?.pinned).toBeUndefined();

    await resetRoadmapLayout(rmp.id);
    const cleared = await db.roadmapNodes.get(a.id);
    expect(cleared?.x).toBeUndefined();
    expect(cleared?.y).toBeUndefined();
    expect(cleared?.pinned).toBeUndefined();
  });

  it("deleteRoadmap cascades to nodes and edges", async () => {
    const ws = await seedWorkspace();
    const rmp = await createRoadmap({
      workspaceId: ws.id,
      title: "T",
      topic: "T",
      timeframe: "daily",
      level: "beginner",
      usedSources: false,
      model: "m",
    });
    await replaceRoadmapGraph(
      rmp.id,
      [
        { tempId: "x", parentId: null, depth: 0, title: "x", description: "" },
        { tempId: "y", parentId: null, depth: 0, title: "y", description: "" },
      ],
      [],
    );
    await deleteRoadmap(rmp.id);
    expect(await listRoadmapNodes(rmp.id)).toEqual([]);
    expect(await listRoadmapEdges(rmp.id)).toEqual([]);
    expect(await getRoadmap(rmp.id)).toBeUndefined();
  });
});

describe("roadmaps repo — status + progress", () => {
  it("setNodeStatus toggles done and progress aggregates count it", async () => {
    const ws = await seedWorkspace();
    const rmp = await createRoadmap({
      workspaceId: ws.id,
      title: "T",
      topic: "T",
      timeframe: "weekly",
      level: "beginner",
      usedSources: false,
      model: "m",
    });
    const { nodes } = await replaceRoadmapGraph(
      rmp.id,
      [
        { tempId: "a", parentId: null, depth: 0, title: "a", description: "" },
        { tempId: "b", parentId: null, depth: 0, title: "b", description: "" },
        { tempId: "c", parentId: null, depth: 0, title: "c", description: "" },
      ],
      [],
    );
    expect(await countRoadmapProgress(rmp.id)).toEqual({ total: 3, done: 0 });
    const target = nodes[0];
    if (!target) throw new Error("node missing");
    await setNodeStatus(target.id, "done");
    expect(await countRoadmapProgress(rmp.id)).toEqual({ total: 3, done: 1 });
    await updateRoadmapNode(target.id, { description: "Updated" });
    const reread = await db.roadmapNodes.get(target.id);
    expect(reread?.description).toBe("Updated");
    expect(reread?.status).toBe("done");
  });

  it("counts a node done when its linked deck is fully learned (activity-derived)", async () => {
    const ws = await seedWorkspace();
    const rmp = await createRoadmap({
      workspaceId: ws.id,
      title: "T",
      topic: "T",
      timeframe: "weekly",
      level: "beginner",
      usedSources: false,
      model: "m",
    });
    const { nodes } = await replaceRoadmapGraph(
      rmp.id,
      [
        { tempId: "a", parentId: null, depth: 0, title: "a", description: "" },
        { tempId: "b", parentId: null, depth: 0, title: "b", description: "" },
        { tempId: "c", parentId: null, depth: 0, title: "c", description: "" },
      ],
      [],
    );
    const [a, b, c] = nodes;
    if (!a || !b || !c) throw new Error("nodes missing");
    // a: manually marked done.
    await setNodeStatus(a.id, "done");
    // b: linked deck, every card learned (repetitions >= 1).
    const deckB = await createDeck({ workspaceId: ws.id, name: "b", color: "#000" });
    await updateRoadmapNode(b.id, { deckId: deckB.id });
    const b1 = await createFlashcard({ workspaceId: ws.id, deckId: deckB.id, question: "q", answer: "a" });
    const b2 = await createFlashcard({ workspaceId: ws.id, deckId: deckB.id, question: "q", answer: "a" });
    await db.flashcards.update(b1.id, { repetitions: 2 });
    await db.flashcards.update(b2.id, { repetitions: 1 });
    // c: linked deck, only one of two cards learned → NOT complete.
    const deckC = await createDeck({ workspaceId: ws.id, name: "c", color: "#000" });
    await updateRoadmapNode(c.id, { deckId: deckC.id });
    const c1 = await createFlashcard({ workspaceId: ws.id, deckId: deckC.id, question: "q", answer: "a" });
    await createFlashcard({ workspaceId: ws.id, deckId: deckC.id, question: "q", answer: "a" });
    await db.flashcards.update(c1.id, { repetitions: 3 });

    expect(await countRoadmapProgress(rmp.id)).toEqual({ total: 3, done: 2 });
  });
});

describe("isRoadmapNodeComplete (pure)", () => {
  it("true when the node is manually done", () => {
    expect(isRoadmapNodeComplete({ status: "done" }, () => false)).toBe(true);
  });
  it("true when a linked deck is fully learned", () => {
    expect(
      isRoadmapNodeComplete({ status: "todo", deckId: "d1" }, (id) => id === "d1"),
    ).toBe(true);
  });
  it("false when todo with no deck, or a not-yet-learned deck", () => {
    expect(isRoadmapNodeComplete({ status: "todo" }, () => true)).toBe(false);
    expect(
      isRoadmapNodeComplete({ status: "todo", deckId: "d1" }, () => false),
    ).toBe(false);
  });
});
