import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWorkspace, deleteWorkspace, getWorkspace, listWorkspaces } from "./workspaces";
import { createSource, deleteSource, findSourceByHash } from "./sources";
import { bulkAddChunks } from "./chunks";
import {
  applyReview,
  createDeck,
  createFlashcard,
  listFlashcardsByWorkspace,
  listReviewLogs,
} from "./flashcards";
import { createConcept, createEdge } from "./concepts";
import { createQuizSession } from "./quiz-sessions";
import { db } from "./schema";

beforeEach(async () => {
  await db.delete();
  await db.open();
});

afterEach(async () => {
  await db.delete();
});

describe("workspaces repo", () => {
  it("creates and reads back a workspace", async () => {
    const ws = await createWorkspace({ name: "QFT", color: "#000", initials: "QF" });
    const got = await getWorkspace(ws.id);
    expect(got?.id).toBe(ws.id);
    expect(got?.archivedAt).toBeNull();
  });

  it("lists active workspaces sorted by updatedAt desc", async () => {
    await createWorkspace({ name: "A", color: "#000", initials: "A" });
    await new Promise((r) => setTimeout(r, 2));
    const b = await createWorkspace({ name: "B", color: "#000", initials: "B" });
    const list = await listWorkspaces();
    expect(list[0]?.id).toBe(b.id);
  });

  it("deleteWorkspace cascades to all workspace-owned tables", async () => {
    const ws = await createWorkspace({ name: "X", color: "#000", initials: "X" });
    const src = await createSource({ workspaceId: ws.id, type: "pdf", title: "p.pdf" });
    const chunks = await bulkAddChunks([
      { workspaceId: ws.id, sourceId: src.id, index: 0, text: "a", tokenCount: 1 },
      { workspaceId: ws.id, sourceId: src.id, index: 1, text: "b", tokenCount: 1 },
    ]);
    const deck = await createDeck({ workspaceId: ws.id, name: "Notebook", color: "#fff" });
    const card = await createFlashcard({
      workspaceId: ws.id,
      deckId: deck.id,
      sourceId: src.id,
      question: "Q",
      answer: "A",
    });
    await applyReview(card.id, "good", { ease: 2.6, interval: 1, repetitions: 1, dueAt: 0 });
    await createQuizSession({
      workspaceId: ws.id,
      sourceId: src.id,
      items: [{ kind: "mcq", q: "Q", choices: ["A", "B", "C", "D"], correctIndex: 0 }],
    });
    const concept = await createConcept({
      workspaceId: ws.id,
      label: "Alpha",
      labelNorm: "alpha",
      kind: "concept",
      sourceIds: [src.id],
      chunkRefs: [chunks[0]!.id],
    });
    const related = await createConcept({
      workspaceId: ws.id,
      label: "Beta",
      labelNorm: "beta",
      kind: "concept",
      sourceIds: [src.id],
      chunkRefs: [chunks[1]!.id],
    });
    await createEdge({
      workspaceId: ws.id,
      fromId: concept.id,
      toId: related.id,
      kind: "related",
      evidenceChunkIds: [chunks[0]!.id],
    });

    await deleteWorkspace(ws.id);

    expect(await getWorkspace(ws.id)).toBeUndefined();
    expect(await db.sources.where("workspaceId").equals(ws.id).count()).toBe(0);
    expect(await db.chunks.where("workspaceId").equals(ws.id).count()).toBe(0);
    expect(await db.flashcards.where("workspaceId").equals(ws.id).count()).toBe(0);
    expect(await db.reviewLogs.where("workspaceId").equals(ws.id).count()).toBe(0);
    expect(await db.decks.where("workspaceId").equals(ws.id).count()).toBe(0);
    expect(await db.quizSessions.where("workspaceId").equals(ws.id).count()).toBe(0);
    expect(await db.concepts.where("workspaceId").equals(ws.id).count()).toBe(0);
    expect(await db.conceptEdges.where("workspaceId").equals(ws.id).count()).toBe(0);
  });
});

describe("sources repo", () => {
  it("findSourceByHash dedups by content hash within a workspace", async () => {
    const ws = await createWorkspace({ name: "X", color: "#000", initials: "X" });
    const a = await createSource({
      workspaceId: ws.id,
      type: "pdf",
      title: "doc.pdf",
      contentHash: "abc",
    });
    const found = await findSourceByHash(ws.id, "abc");
    expect(found?.id).toBe(a.id);
    const miss = await findSourceByHash(ws.id, "missing");
    expect(miss).toBeUndefined();
  });

  it("does not match a hash from another workspace", async () => {
    const a = await createWorkspace({ name: "A", color: "#000", initials: "A" });
    const b = await createWorkspace({ name: "B", color: "#000", initials: "B" });
    await createSource({
      workspaceId: a.id,
      type: "pdf",
      title: "doc.pdf",
      contentHash: "abc",
    });
    expect(await findSourceByHash(b.id, "abc")).toBeUndefined();
  });

  it("deleteSource removes source-owned sessions and prunes concept graph references", async () => {
    const ws = await createWorkspace({ name: "X", color: "#000", initials: "X" });
    const sourceA = await createSource({ workspaceId: ws.id, type: "pdf", title: "a.pdf" });
    const sourceB = await createSource({ workspaceId: ws.id, type: "pdf", title: "b.pdf" });
    const [chunkA, chunkB] = await bulkAddChunks([
      { workspaceId: ws.id, sourceId: sourceA.id, index: 0, text: "a", tokenCount: 1 },
      { workspaceId: ws.id, sourceId: sourceB.id, index: 0, text: "b", tokenCount: 1 },
    ]);
    await createQuizSession({
      workspaceId: ws.id,
      sourceId: sourceA.id,
      items: [{ kind: "mcq", q: "Q", choices: ["A", "B", "C", "D"], correctIndex: 0 }],
    });
    const shared = await createConcept({
      workspaceId: ws.id,
      label: "Shared",
      labelNorm: "shared",
      kind: "concept",
      sourceIds: [sourceA.id, sourceB.id],
      chunkRefs: [chunkA!.id, chunkB!.id],
    });
    const onlyA = await createConcept({
      workspaceId: ws.id,
      label: "Only A",
      labelNorm: "only a",
      kind: "concept",
      sourceIds: [sourceA.id],
      chunkRefs: [chunkA!.id],
    });
    await createEdge({
      workspaceId: ws.id,
      fromId: shared.id,
      toId: onlyA.id,
      kind: "related",
      evidenceChunkIds: [chunkA!.id],
    });

    await deleteSource(sourceA.id);

    expect(await db.quizSessions.where("sourceId").equals(sourceA.id).count()).toBe(0);
    expect(await db.chunks.where("sourceId").equals(sourceA.id).count()).toBe(0);
    const kept = await db.concepts.get(shared.id);
    expect(kept?.sourceIds).toEqual([sourceB.id]);
    expect(kept?.chunkRefs).toEqual([chunkB!.id]);
    expect(await db.concepts.get(onlyA.id)).toBeUndefined();
    expect(await db.conceptEdges.where("workspaceId").equals(ws.id).count()).toBe(0);
  });
});

describe("flashcards.applyReview", () => {
  it("updates card state and inserts a review log atomically", async () => {
    const ws = await createWorkspace({ name: "X", color: "#000", initials: "X" });
    const card = await createFlashcard({
      workspaceId: ws.id,
      question: "Q",
      answer: "A",
    });

    await applyReview(card.id, "good", {
      ease: 2.6,
      interval: 1,
      repetitions: 1,
      dueAt: 1234,
    });

    const updated = await db.flashcards.get(card.id);
    expect(updated?.ease).toBe(2.6);
    expect(updated?.interval).toBe(1);
    expect(updated?.reviewCount).toBe(1);
    expect(updated?.successCount).toBe(1);
    expect(updated?.lastRating).toBe("good");
    const logs = await listReviewLogs(card.id);
    expect(logs).toHaveLength(1);
    expect(logs[0]?.rating).toBe("good");
  });

  it("flags a leech after 8 consecutive 'again' reviews", async () => {
    const ws = await createWorkspace({ name: "X", color: "#000", initials: "X" });
    const card = await createFlashcard({
      workspaceId: ws.id,
      question: "Q",
      answer: "A",
    });
    for (let i = 0; i < 8; i += 1) {
      await applyReview(card.id, "again", {
        ease: 1.3,
        interval: 0,
        repetitions: 0,
        dueAt: 0,
      });
    }
    const updated = await db.flashcards.get(card.id);
    expect(updated?.leech).toBe(true);
    expect(updated?.againCount).toBe(8);
    const all = await listFlashcardsByWorkspace(ws.id);
    expect(all.filter((c) => c.leech)).toHaveLength(1);
  });
});
