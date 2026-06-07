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
import { createPodcast } from "@/lib/db/podcasts";
import { exportBackup, type BackupV9 } from "./export";

beforeEach(async () => {
  await db.delete();
  await db.open();
});

afterEach(async () => {
  await db.delete();
});

async function readPayload(blob: Blob): Promise<BackupV9> {
  return JSON.parse(await blob.text()) as BackupV9;
}

describe("backup/export", () => {
  it("serializes all backup tables with stable shape", async () => {
    const ws = await createWorkspace({
      name: "QFT",
      color: "#000",
      initials: "Q",
    });
    const src = await createSource({
      workspaceId: ws.id,
      type: "pdf",
      title: "p.pdf",
    });
    const chunks = await bulkAddChunks([
      {
        workspaceId: ws.id,
        sourceId: src.id,
        index: 0,
        text: "alpha",
        tokenCount: 1,
        embedding: new Float32Array([0.1, 0.2, 0.3]),
        embeddingModel: "text-embedding-3-small",
      },
      {
        workspaceId: ws.id,
        sourceId: src.id,
        index: 1,
        text: "beta",
        tokenCount: 1,
      },
    ]);
    await createQuizSession({
      workspaceId: ws.id,
      sourceId: src.id,
      items: [
        {
          kind: "mcq",
          q: "Q?",
          choices: ["A", "B", "C", "D"],
          correctIndex: 0,
          sourceChunkId: chunks[0]?.id,
        },
      ],
      model: "test-model",
    });
    const conceptA = await createConcept({
      workspaceId: ws.id,
      label: "Alpha",
      labelNorm: "alpha",
      kind: "concept",
      sourceIds: [src.id],
      chunkRefs: [chunks[0]?.id ?? ""],
    });
    const conceptB = await createConcept({
      workspaceId: ws.id,
      label: "Beta",
      labelNorm: "beta",
      kind: "term",
      sourceIds: [src.id],
      chunkRefs: [chunks[1]?.id ?? ""],
    });
    await createEdge({
      workspaceId: ws.id,
      fromId: conceptA.id,
      toId: conceptB.id,
      kind: "related",
      evidenceChunkIds: [chunks[0]?.id ?? ""],
    });
    const curriculum = await createCurriculum({
      workspaceId: ws.id,
      title: "Guided path",
      sourceIds: [src.id],
      items: [
        {
          title: "Alpha topic",
          objective: "Learn alpha.",
          sourceRefs: [{ sourceId: src.id, chunkIds: [chunks[0]?.id ?? ""] }],
          prerequisites: [],
          estimatedMinutes: 20,
        },
      ],
    });
    const note = await createLessonNote({
      workspaceId: ws.id,
      curriculumItemId: curriculum.items[0]?.id ?? "",
      title: "Alpha topic",
      contentMarkdown: "Alpha body",
      sourceRefs: [{ sourceId: src.id, chunkIds: [chunks[0]?.id ?? ""] }],
      generationPromptVersion: "lesson-note-v1",
      modelId: "test-model",
      status: "ready",
    });
    await createStudyJournalEntry({
      workspaceId: ws.id,
      lessonNoteId: note.id,
      question: "Q",
      answerMarkdown: "A",
      sourceRefs: [{ sourceId: src.id }],
      tags: ["alpha"],
    });
    const deck = await createDeck({
      workspaceId: ws.id,
      name: "D",
      color: "#fff",
    });
    await createFlashcard({
      workspaceId: ws.id,
      deckId: deck.id,
      question: "Q",
      answer: "A",
    });
    await createPodcast({
      workspaceId: ws.id,
      title: "Pilot",
      locale: "tr",
      sourceIds: [src.id],
      segments: [
        { speaker: "alev", text: "Soru" },
        { speaker: "deniz", text: "Cevap" },
      ],
      chapters: [{ title: "Açılış", segmentIndex: 0, startMs: 0 }],
      voices: [
        { speaker: "alev", name: "Alev", voiceId: "v_a" },
        { speaker: "deniz", name: "Deniz", voiceId: "v_d" },
      ],
      modelId: "test-model",
      generationPromptVersion: "podcast-script@1",
    });
    const blob = await exportBackup();
    expect(blob.type).toBe("application/json");
    const parsed = await readPayload(blob);

    expect(parsed.schemaVersion).toBe(9);
    expect(parsed.app).toBe("tme");
    expect(parsed.workspaces).toHaveLength(1);
    expect(parsed.sources).toHaveLength(1);
    expect(parsed.chunks).toHaveLength(2);
    expect(parsed.decks).toHaveLength(1);
    expect(parsed.flashcards).toHaveLength(1);
    expect(parsed.quizSessions).toHaveLength(1);
    expect(parsed.concepts).toHaveLength(2);
    expect(parsed.conceptEdges).toHaveLength(1);
    expect(parsed.curricula).toHaveLength(1);
    expect(parsed.curriculumItems).toHaveLength(1);
    expect(parsed.lessonNotes).toHaveLength(1);
    expect(parsed.studyJournalEntries).toHaveLength(1);
    expect(parsed.podcasts).toHaveLength(1);
    expect(parsed.podcasts[0]?.segments).toHaveLength(2);
    expect(Array.isArray(parsed.notes)).toBe(true);
    expect(Array.isArray(parsed.noteFolders)).toBe(true);
    expect(parsed.integrity).toMatch(/^[0-9a-f]{64}$/);
  });

  it("encodes Float32 embeddings as base64 and leaves missing ones null", async () => {
    const ws = await createWorkspace({
      name: "X",
      color: "#000",
      initials: "X",
    });
    const src = await createSource({
      workspaceId: ws.id,
      type: "pdf",
      title: "p",
    });
    await bulkAddChunks([
      {
        workspaceId: ws.id,
        sourceId: src.id,
        index: 0,
        text: "with",
        tokenCount: 1,
        embedding: new Float32Array([1, 2, 3, 4]),
        embeddingModel: "m",
      },
      {
        workspaceId: ws.id,
        sourceId: src.id,
        index: 1,
        text: "without",
        tokenCount: 1,
      },
    ]);

    const parsed = await readPayload(await exportBackup());
    const sorted = [...parsed.chunks].sort((a, b) => a.index - b.index);
    expect(typeof sorted[0]?.embedding).toBe("string");
    expect(sorted[0]?.embeddingModel).toBe("m");
    expect(sorted[1]?.embedding).toBeNull();
    expect(sorted[1]?.embeddingModel).toBeNull();
  });

  it("excludes apiKeys table (security invariant)", async () => {
    // Plant a sentinel apiKey row so we can assert it never appears in the
    // payload. The `vault` table was dropped entirely in Phase 9 (v24
    // schema), so we only test the apiKeys exclusion now.
    await db.apiKeys.put({
      provider: "anthropic",
      plaintext: "deadbeef-secret-key",
      updatedAt: Date.now(),
    });

    expect(await db.apiKeys.count()).toBeGreaterThan(0);

    const parsed = await readPayload(await exportBackup());
    expect(Object.keys(parsed)).not.toContain("apiKeys");
    expect(Object.keys(parsed)).not.toContain("vault");
    // Belt-and-suspenders: the literal value must not appear anywhere.
    const raw = JSON.stringify(parsed);
    expect(raw).not.toContain("deadbeef-secret-key");
  });

  it("integrity hash matches recompute over payload (without integrity field)", async () => {
    const ws = await createWorkspace({
      name: "H",
      color: "#000",
      initials: "H",
    });
    await createSource({ workspaceId: ws.id, type: "pdf", title: "x" });
    const parsed = await readPayload(await exportBackup());

    // Recompute
    const { integrity, ...rest } = parsed;
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
    expect(integrity).toBe(hex);
  });
});
