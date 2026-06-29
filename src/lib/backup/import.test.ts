import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db/schema";
import { createWorkspace } from "@/lib/db/workspaces";
import { createSource } from "@/lib/db/sources";
import { bulkAddChunks } from "@/lib/db/chunks";
import { createDeck, createFlashcard } from "@/lib/db/flashcards";
import { createConcept, createEdge } from "@/lib/db/concepts";
import { createQuizSession } from "@/lib/db/quiz-sessions";
import {
  createCurriculum,
  createLessonNote,
  createStudyJournalEntry,
} from "@/lib/db/study";
import type { ArticleAnalysisRecord } from "@/lib/article-analysis/types";
import { exportBackup, type BackupV4 } from "./export";
import {
  BackupIntegrityError,
  BackupSchemaError,
  importBackup,
  previewImport,
} from "./import";

beforeEach(async () => {
  await db.delete();
  await db.open();
});

afterEach(async () => {
  await db.delete();
});

function blobToFile(blob: Blob, name = "backup.tmebak"): File {
  return new File([blob], name, { type: "application/json" });
}

async function sha256HexOf(value: unknown): Promise<string> {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest(
    "SHA-256",
    enc.encode(JSON.stringify(value)),
  );
  const bytes = new Uint8Array(buf);
  let hex = "";
  for (let i = 0; i < bytes.length; i += 1) {
    const b = bytes[i] ?? 0;
    hex += b.toString(16).padStart(2, "0");
  }
  return hex;
}

function buildAnalysis(
  workspaceId: string,
  sourceId: string,
): ArticleAnalysisRecord {
  const now = Date.now();
  return {
    id: "analysis-test",
    workspaceId,
    sourceId,
    title: "p1",
    targetLang: "en",
    status: "draft",
    fallbackReason: "critique stage degraded",
    modelSnapshot: {
      extract: "anthropic::claude-haiku-4-5",
      synthesize: "anthropic::claude-sonnet-4-6",
      critique: "anthropic::claude-opus-4-7",
    },
    usage: { inputTokens: 800, outputTokens: 400 },
    payload: {
      tldr: "Short.",
      ataGlance: {
        paperType: "empirical",
        field: "physics",
        purpose: "Test.",
        headlineFinding: "Works.",
      },
      fiveCs: {
        category: "m",
        context: "c",
        correctness: "s",
        contributions: "n",
        clarity: "c",
      },
      problemMotivation: [
        {
          text: "Problem",
          grounding: "source",
          citations: [{ quote: "alpha", chunkId: "stale-chunk" }],
        },
      ],
      priorWorkGap: [],
      contributions: [],
      keyIdea: "Key.",
      methodWalkthrough: [{ step: "S", why: "W" }],
      howItSolves: [],
      keyResults: [],
      critique: {
        soundness: "ok",
        novelty: "ok",
        significance: "ok",
        clarity: "ok",
        weakestLink: "none",
      },
      assumptionsLimitations: [],
      reproducibility: "high",
      questionsToAsk: ["Why?"],
      soWhat: "Matters.",
      whatToReadNext: [{ title: "T", why: "W" }],
      glossary: [{ term: "alpha", tr: "alfa", en: "alpha" }],
    },
    createdAt: now,
    updatedAt: now,
  };
}

async function seedDataset() {
  const ws = await createWorkspace({
    name: "QFT",
    color: "#000",
    initials: "Q",
  });
  const src1 = await createSource({
    workspaceId: ws.id,
    type: "pdf",
    title: "p1",
  });
  const src2 = await createSource({
    workspaceId: ws.id,
    type: "md",
    title: "p2",
  });
  const e1 = new Float32Array([0.1, 0.2, 0.3]);
  const e2 = new Float32Array([1.5, -1.5, 0]);
  const e3 = new Float32Array([0, 0, 1]);
  const chunks = await bulkAddChunks([
    {
      workspaceId: ws.id,
      sourceId: src1.id,
      index: 0,
      text: "alpha",
      tokenCount: 1,
      embedding: e1,
      embeddingModel: "m",
    },
    {
      workspaceId: ws.id,
      sourceId: src1.id,
      index: 1,
      text: "beta",
      tokenCount: 1,
      embedding: e2,
      embeddingModel: "m",
    },
    {
      workspaceId: ws.id,
      sourceId: src1.id,
      index: 2,
      text: "gamma",
      tokenCount: 1,
      embedding: e3,
      embeddingModel: "m",
    },
    {
      workspaceId: ws.id,
      sourceId: src2.id,
      index: 0,
      text: "delta",
      tokenCount: 1,
    },
    {
      workspaceId: ws.id,
      sourceId: src2.id,
      index: 1,
      text: "epsilon",
      tokenCount: 1,
    },
  ]);
  const firstChunkId = chunks[0]?.id;
  const secondChunkId = chunks[1]?.id;
  if (!firstChunkId || !secondChunkId) {
    throw new Error("seedDataset expected at least two chunks");
  }
  const deck = await createDeck({
    workspaceId: ws.id,
    name: "D",
    color: "#fff",
  });
  const card1 = await createFlashcard({
    workspaceId: ws.id,
    deckId: deck.id,
    sourceId: src1.id,
    chunkId: firstChunkId,
    question: "Q1",
    answer: "A1",
    citations: [{ sourceId: src1.id, section: "1", quote: "alpha" }],
    generatedFrom: {
      kind: "batch",
      chunkIds: [firstChunkId],
      model: "test-model",
      generatedAt: Date.now(),
    },
  });
  await createFlashcard({
    workspaceId: ws.id,
    deckId: deck.id,
    question: "Q2",
    answer: "A2",
  });
  await createFlashcard({
    workspaceId: ws.id,
    deckId: deck.id,
    question: "Q3",
    answer: "A3",
  });
  await db.reviewLogs.add({
    id: "rl-test",
    flashcardId: card1.id,
    workspaceId: ws.id,
    rating: "good",
    intervalBefore: 0,
    intervalAfter: 1,
    easeBefore: 2.5,
    easeAfter: 2.5,
    reviewedAt: Date.now(),
  });
  const threadId = "thread-test";
  const messageId = "msg-test";
  await db.chatThreads.add({
    id: threadId,
    workspaceId: ws.id,
    sourceId: src1.id,
    title: "Thread",
    pinned: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  await db.chatMessages.add({
    id: messageId,
    threadId,
    workspaceId: ws.id,
    role: "assistant",
    content: "Answer",
    citations: [{ sourceId: src1.id, chunkId: firstChunkId, quote: "alpha" }],
    createdAt: Date.now(),
  });
  await createQuizSession({
    workspaceId: ws.id,
    sourceId: src1.id,
    items: [
      {
        kind: "open",
        q: "Explain alpha",
        rubric: "mentions alpha",
        sourceChunkId: firstChunkId,
      },
    ],
    model: "test-model",
  });
  const conceptA = await createConcept({
    workspaceId: ws.id,
    label: "Alpha",
    labelNorm: "alpha",
    kind: "concept",
    sourceIds: [src1.id],
    chunkRefs: [firstChunkId],
  });
  const conceptB = await createConcept({
    workspaceId: ws.id,
    label: "Beta",
    labelNorm: "beta",
    kind: "term",
    sourceIds: [src1.id],
    chunkRefs: [secondChunkId],
  });
  await createEdge({
    workspaceId: ws.id,
    fromId: conceptA.id,
    toId: conceptB.id,
    kind: "related",
    evidenceChunkIds: [firstChunkId],
  });
  const curriculum = await createCurriculum({
    workspaceId: ws.id,
    title: "Guided path",
    sourceIds: [src1.id],
    items: [
      {
        title: "Alpha topic",
        objective: "Learn alpha.",
        sourceRefs: [{ sourceId: src1.id, chunkIds: [firstChunkId] }],
        prerequisites: [],
        estimatedMinutes: 25,
      },
    ],
  });
  const note = await createLessonNote({
    workspaceId: ws.id,
    curriculumItemId: curriculum.items[0]?.id ?? "",
    title: "Alpha topic",
    contentMarkdown: "Alpha body",
    sourceRefs: [{ sourceId: src1.id, chunkIds: [firstChunkId] }],
    generationPromptVersion: "lesson-note-v1",
    modelId: "test-model",
    status: "ready",
  });
  await createStudyJournalEntry({
    workspaceId: ws.id,
    lessonNoteId: note.id,
    question: "What is alpha?",
    answerMarkdown: "Alpha is first.",
    sourceRefs: [{ sourceId: src1.id, chunkIds: [firstChunkId] }],
    tags: ["alpha"],
  });
  await db.articleAnalyses.put(buildAnalysis(ws.id, src1.id));
  return {
    wsId: ws.id,
    src1Id: src1.id,
    deckId: deck.id,
    chunkIds: chunks.map((c) => c.id),
  };
}

async function exportSnapshotAndWipe(): Promise<File> {
  const blob = await exportBackup();
  const file = blobToFile(blob);
  // Wipe and reopen so the import lands in a clean DB.
  await db.delete();
  await db.open();
  return file;
}

describe("backup/import round-trip", () => {
  it("restores all tables byte-for-byte (including Float32 embeddings)", async () => {
    const { wsId, src1Id, deckId } = await seedDataset();
    const file = await exportSnapshotAndWipe();

    const result = await importBackup(file);
    expect(result.imported).toBeGreaterThan(0);
    expect(result.remapped).toBe(0);

    const ws = await db.workspaces.get(wsId);
    expect(ws?.name).toBe("QFT");
    expect(await db.sources.count()).toBe(2);
    expect(await db.chunks.count()).toBe(5);
    expect(await db.flashcards.count()).toBe(3);
    expect(await db.reviewLogs.count()).toBe(1);
    expect(await db.chatThreads.count()).toBe(1);
    expect(await db.chatMessages.count()).toBe(1);
    expect(await db.quizSessions.count()).toBe(1);
    expect(await db.concepts.count()).toBe(2);
    expect(await db.conceptEdges.count()).toBe(1);
    expect(await db.curricula.count()).toBe(1);
    expect(await db.curriculumItems.count()).toBe(1);
    expect(await db.lessonNotes.count()).toBe(1);
    expect(await db.studyJournalEntries.count()).toBe(1);
    expect(await db.articleAnalyses.count()).toBe(1);
    const restoredAnalysis = await db.articleAnalyses.get("analysis-test");
    expect(restoredAnalysis?.status).toBe("draft");
    expect(restoredAnalysis?.payload?.tldr).toBe("Short.");
    expect(restoredAnalysis?.payload?.glossary).toHaveLength(1);
    expect(await db.decks.get(deckId)).toBeDefined();

    const chunks = await db.chunks
      .where("sourceId")
      .equals(src1Id)
      .sortBy("index");
    expect(chunks).toHaveLength(3);
    const restored = chunks[0]?.embedding;
    expect(restored).toBeInstanceOf(Float32Array);
    // Float32 byte-equal: the source array was already Float32, so the
    // round-trip must preserve the same 4-byte representation per cell.
    const expected = new Float32Array([0.1, 0.2, 0.3]);
    expect(restored?.length).toBe(expected.length);
    for (let i = 0; i < expected.length; i += 1) {
      expect(restored?.[i]).toBe(expected[i]);
    }
  });

  it("remaps conflicting workspace IDs and updates FK chain", async () => {
    const { wsId, src1Id, chunkIds } = await seedDataset();
    const blob = await exportBackup();
    // Do NOT wipe — re-import on top of itself triggers conflict.
    const file = blobToFile(blob);

    const preview = await previewImport(file);
    expect(preview.conflictingWorkspaceIds).toContain(wsId);
    expect(preview.conflictingWorkspaceIds).toHaveLength(1);

    const result = await importBackup(file, { onConflict: "remap" });
    expect(result.remapped).toBeGreaterThan(0);

    // Original workspace + sources still exist with original IDs.
    expect(await db.workspaces.get(wsId)).toBeDefined();
    expect(await db.sources.get(src1Id)).toMatchObject({ workspaceId: wsId });
    for (const chunkId of chunkIds) {
      expect(await db.chunks.get(chunkId)).toMatchObject({ workspaceId: wsId });
    }

    // Total workspaces = 1 original + 1 remapped clone.
    const all = await db.workspaces.toArray();
    expect(all).toHaveLength(2);
    const newWs = all.find((w) => w.id !== wsId);
    expect(newWs).toBeDefined();
    if (!newWs) return;

    // FK chain check: every source for the remapped workspace points to it.
    const remappedSources = await db.sources
      .where("workspaceId")
      .equals(newWs.id)
      .toArray();
    expect(remappedSources).toHaveLength(2);
    const remappedChunks = await db.chunks
      .where("workspaceId")
      .equals(newWs.id)
      .toArray();
    expect(remappedChunks).toHaveLength(5);
    const remappedFlashcards = await db.flashcards
      .where("workspaceId")
      .equals(newWs.id)
      .toArray();
    expect(remappedFlashcards).toHaveLength(3);
    expect(await db.sources.count()).toBe(4);
    expect(await db.chunks.count()).toBe(10);

    const remappedSourceIds = new Set(remappedSources.map((s) => s.id));
    const remappedChunkIds = new Set(remappedChunks.map((c) => c.id));
    const remappedQuiz = await db.quizSessions
      .where("workspaceId")
      .equals(newWs.id)
      .first();
    expect(remappedQuiz?.sourceId).not.toBe(src1Id);
    expect(remappedSourceIds.has(remappedQuiz?.sourceId ?? "")).toBe(true);
    expect(remappedChunkIds.has(remappedQuiz?.items[0]?.sourceChunkId ?? "")).toBe(
      true,
    );

    const remappedConcepts = await db.concepts
      .where("workspaceId")
      .equals(newWs.id)
      .toArray();
    const remappedConceptIds = new Set(remappedConcepts.map((c) => c.id));
    expect(remappedConcepts).toHaveLength(2);
    expect(remappedConcepts.every((c) => remappedSourceIds.has(c.sourceIds[0] ?? "")))
      .toBe(true);
    expect(remappedConcepts.every((c) => remappedChunkIds.has(c.chunkRefs[0] ?? "")))
      .toBe(true);

    const remappedEdge = await db.conceptEdges
      .where("workspaceId")
      .equals(newWs.id)
      .first();
    expect(remappedConceptIds.has(remappedEdge?.fromId ?? "")).toBe(true);
    expect(remappedConceptIds.has(remappedEdge?.toId ?? "")).toBe(true);
    expect(remappedChunkIds.has(remappedEdge?.evidenceChunkIds[0] ?? "")).toBe(
      true,
    );

    const remappedCurriculum = await db.curricula
      .where("workspaceId")
      .equals(newWs.id)
      .first();
    expect(remappedCurriculum?.sourceIds.every((id) => remappedSourceIds.has(id)))
      .toBe(true);
    const remappedItem = await db.curriculumItems
      .where("workspaceId")
      .equals(newWs.id)
      .first();
    expect(remappedItem?.sourceRefs[0]?.sourceId).not.toBe(src1Id);
    expect(remappedSourceIds.has(remappedItem?.sourceRefs[0]?.sourceId ?? ""))
      .toBe(true);
    expect(remappedChunkIds.has(remappedItem?.sourceRefs[0]?.chunkIds?.[0] ?? ""))
      .toBe(true);
    const remappedNote = await db.lessonNotes
      .where("workspaceId")
      .equals(newWs.id)
      .first();
    expect(remappedNote?.curriculumItemId).toBe(remappedItem?.id);
    const remappedJournal = await db.studyJournalEntries
      .where("workspaceId")
      .equals(newWs.id)
      .first();
    expect(remappedJournal?.lessonNoteId).toBe(remappedNote?.id);

    // The original analysis survives untouched; the remapped clone rebinds to
    // the new workspace + one of the remapped source ids.
    expect(await db.articleAnalyses.count()).toBe(2);
    expect(await db.articleAnalyses.get("analysis-test")).toMatchObject({
      workspaceId: wsId,
    });
    const remappedAnalysis = await db.articleAnalyses
      .where("workspaceId")
      .equals(newWs.id)
      .first();
    expect(remappedAnalysis).toBeDefined();
    expect(remappedAnalysis?.id).not.toBe("analysis-test");
    expect(remappedSourceIds.has(remappedAnalysis?.sourceId ?? "")).toBe(true);
    expect(remappedAnalysis?.payload?.tldr).toBe("Short.");
  });

  it("throws BackupSchemaError on schemaVersion mismatch", async () => {
    await seedDataset();
    const blob = await exportBackup();
    const tampered = JSON.parse(await blob.text()) as BackupV4;
    (tampered as unknown as { schemaVersion: number }).schemaVersion = 99;
    // Recompute integrity so we hit the schema check first, not integrity.
    const { integrity: _drop, ...rest } = tampered;
    void _drop;
    const enc = new TextEncoder();
    const buf = await crypto.subtle.digest(
      "SHA-256",
      enc.encode(JSON.stringify(rest)),
    );
    const bytes = new Uint8Array(buf);
    let hex = "";
    for (let i = 0; i < bytes.length; i += 1) {
      const b = bytes[i] ?? 0;
      hex += b.toString(16).padStart(2, "0");
    }
    tampered.integrity = hex;

    const file = blobToFile(
      new Blob([JSON.stringify(tampered)], { type: "application/json" }),
    );
    await expect(importBackup(file)).rejects.toBeInstanceOf(BackupSchemaError);
  });

  it("throws BackupIntegrityError when payload is tampered", async () => {
    await seedDataset();
    const blob = await exportBackup();
    const tampered = JSON.parse(await blob.text()) as BackupV4;
    // Mutate a workspace name without recomputing the hash.
    if (tampered.workspaces[0]) tampered.workspaces[0].name = "tampered";
    const file = blobToFile(
      new Blob([JSON.stringify(tampered)], { type: "application/json" }),
    );
    await expect(importBackup(file)).rejects.toBeInstanceOf(
      BackupIntegrityError,
    );
  });

  it("imports a legacy V9 backup with an empty articleAnalyses array", async () => {
    await seedDataset();
    const blob = await exportBackup();
    // Simulate a pre-v10 (Roadmap-era) backup: drop the analyses table and
    // stamp the older schema version, then re-seal the integrity hash so we
    // exercise the legacy-normalisation path, not an integrity rejection.
    const downgraded = JSON.parse(await blob.text()) as Record<string, unknown>;
    delete downgraded.articleAnalyses;
    downgraded.schemaVersion = 9;
    const { integrity: _drop, ...rest } = downgraded;
    void _drop;
    downgraded.integrity = await sha256HexOf(rest);

    // Land in a clean DB so the restore is unambiguous.
    await db.delete();
    await db.open();

    const file = blobToFile(
      new Blob([JSON.stringify(downgraded)], { type: "application/json" }),
    );
    const preview = await previewImport(file);
    expect(preview.schemaVersion).toBe(9);

    const result = await importBackup(file);
    expect(result.imported).toBeGreaterThan(0);
    // Other tables still round-trip from the older backup...
    expect(await db.sources.count()).toBe(2);
    expect(await db.roadmaps.count()).toBe(0);
    // ...but the v10-only analyses table normalises to empty.
    expect(await db.articleAnalyses.count()).toBe(0);
  });
});
