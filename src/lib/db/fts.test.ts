import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bulkAddChunks } from "./chunks";
import { createFlashcard } from "./flashcards";
import { searchAll } from "./fts";
import { createHighlight } from "./highlights";
import { db } from "./schema";
import { createSource } from "./sources";
import { createWorkspace } from "./workspaces";

beforeEach(async () => {
  await db.delete();
  await db.open();
});

afterEach(async () => {
  await db.delete();
});

async function seed(): Promise<{ wsA: string; wsB: string; srcId: string }> {
  const wsA = await createWorkspace({
    name: "Kuantum Alan Teorisi",
    color: "#000",
    initials: "KA",
    goal: "Lagranjiyen formülasyonunu öğren",
  });
  const wsB = await createWorkspace({
    name: "Lineer Cebir",
    color: "#000",
    initials: "LC",
  });

  const sources = await Promise.all([
    createSource({ workspaceId: wsA.id, type: "pdf", title: "Peskin & Schroeder" }),
    createSource({
      workspaceId: wsA.id,
      type: "pdf",
      title: "Weinberg QFT Vol 1",
      author: "Steven Weinberg",
    }),
    createSource({ workspaceId: wsB.id, type: "pdf", title: "Strang Linear Algebra" }),
    createSource({ workspaceId: wsB.id, type: "pdf", title: "Axler Notes" }),
  ]);

  await Promise.all([
    createFlashcard({
      workspaceId: wsA.id,
      question: "Spinor alan nedir?",
      answer: "Lorentz grubunun temsiline dönüşen alandır.",
    }),
    createFlashcard({
      workspaceId: wsA.id,
      question: "Klein-Gordon denklemi",
      answer: "Skaler alan için relativistik dalga denklemi.",
    }),
    createFlashcard({
      workspaceId: wsB.id,
      question: "Vektör uzayı",
      answer: "Toplama ve skaler çarpma kapalı küme.",
    }),
  ]);

  await Promise.all([
    createHighlight({
      workspaceId: wsA.id,
      sourceId: sources[0]!.id,
      text: "Eylem prensibi minimum uzaklık ilkesini genişletir",
      color: "yellow",
      spanStart: 0,
      spanEnd: 50,
    }),
    createHighlight({
      workspaceId: wsB.id,
      sourceId: sources[2]!.id,
      text: "Determinant satır işlemleri ile değişmez",
      color: "yellow",
      spanStart: 0,
      spanEnd: 40,
    }),
  ]);

  return { wsA: wsA.id, wsB: wsB.id, srcId: sources[0]!.id };
}

describe("searchAll", () => {
  it("returns empty array for an empty query", async () => {
    await seed();
    expect(await searchAll("")).toEqual([]);
    expect(await searchAll("   ")).toEqual([]);
  });

  it("matches workspaces case-insensitively", async () => {
    await seed();
    const results = await searchAll("kuant");
    const ws = results.filter((r) => r.kind === "workspace");
    expect(ws.length).toBeGreaterThanOrEqual(1);
    expect(ws[0]?.title).toBe("Kuantum Alan Teorisi");
    expect(ws[0]?.href).toMatch(/^\/w\/[^/]+$/);
  });

  it("matches highlights by text fragment", async () => {
    await seed();
    const results = await searchAll("uzaklık");
    const hl = results.filter((r) => r.kind === "highlight");
    expect(hl.length).toBe(1);
    expect(hl[0]?.title).toContain("uzaklık");
    expect(hl[0]?.href).toMatch(/\/w\/[^/]+\/read\/[^/?]+\?h=/);
  });

  it("matches flashcards by question or answer", async () => {
    await seed();
    const byQuestion = await searchAll("klein-gordon");
    expect(byQuestion.find((r) => r.kind === "flashcard")?.title).toContain(
      "Klein-Gordon",
    );
    const byAnswer = await searchAll("relativistik");
    expect(byAnswer.find((r) => r.kind === "flashcard")).toBeDefined();
  });

  it("matches chunks and yields a chunk-anchored href", async () => {
    const { wsA, srcId } = await seed();
    await bulkAddChunks([
      {
        workspaceId: wsA,
        sourceId: srcId,
        index: 0,
        text: "Path integral formülasyonu Feynman tarafından geliştirildi.",
        tokenCount: 12,
      },
    ]);
    const results = await searchAll("path integral");
    const chunk = results.find((r) => r.kind === "chunk");
    expect(chunk).toBeDefined();
    expect(chunk?.href).toMatch(/#chunk-/);
    expect(chunk?.snippet).toContain("Feynman");
  });

  it("caps results to 6 per group", async () => {
    const ws = await createWorkspace({ name: "Bulk", color: "#000", initials: "B" });
    for (let i = 0; i < 10; i += 1) {
      await createFlashcard({
        workspaceId: ws.id,
        question: `bulk question ${i}`,
        answer: `answer`,
      });
    }
    const results = await searchAll("bulk question");
    const cards = results.filter((r) => r.kind === "flashcard");
    expect(cards.length).toBeLessThanOrEqual(6);
  });

  it("orders kinds workspace > source > flashcard > highlight > chunk", async () => {
    const { wsA, srcId } = await seed();
    await bulkAddChunks([
      {
        workspaceId: wsA,
        sourceId: srcId,
        index: 0,
        text: "uzaklık prensibi ve simetri",
        tokenCount: 6,
      },
    ]);
    const results = await searchAll("uzaklık");
    const kinds = results.map((r) => r.kind);
    const order = ["workspace", "source", "flashcard", "highlight", "chunk"];
    let lastSeen = -1;
    for (const k of kinds) {
      const idx = order.indexOf(k);
      expect(idx).toBeGreaterThanOrEqual(lastSeen);
      lastSeen = idx;
    }
  });

  it("respects total limit", async () => {
    await seed();
    const results = await searchAll("a", { limit: 3 });
    expect(results.length).toBeLessThanOrEqual(3);
  });

  it("validates href format per kind", async () => {
    await seed();
    const results = await searchAll("Strang");
    const src = results.find((r) => r.kind === "source");
    expect(src?.href).toMatch(/^\/w\/[^/]+\/read\/[^/]+$/);
  });
});
