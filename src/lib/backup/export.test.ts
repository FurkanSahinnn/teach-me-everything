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
import type {
  ArticleAnalysisPayload,
  ArticleAnalysisRecord,
} from "@/lib/article-analysis/types";
import { exportBackup, type BackupV10 } from "./export";

beforeEach(async () => {
  await db.delete();
  await db.open();
});

afterEach(async () => {
  await db.delete();
});

async function readPayload(blob: Blob): Promise<BackupV10> {
  return JSON.parse(await blob.text()) as BackupV10;
}

function buildAnalysisPayload(): ArticleAnalysisPayload {
  const claim = (text: string): ArticleAnalysisPayload["contributions"][number] => ({
    text,
    grounding: "source",
    citations: [{ quote: text, chunkId: "chunk-x" }],
  });
  return {
    tldr: "Short summary.",
    ataGlance: {
      paperType: "empirical",
      field: "physics",
      purpose: "Test alpha.",
      headlineFinding: "Alpha works.",
    },
    fiveCs: {
      category: "method",
      context: "context",
      correctness: "sound",
      contributions: "novel",
      clarity: "clear",
    },
    problemMotivation: [claim("Problem")],
    priorWorkGap: [claim("Gap")],
    contributions: [claim("Contribution")],
    keyIdea: "Key idea.",
    methodWalkthrough: [{ step: "Step 1", why: "Because." }],
    howItSolves: [claim("Solves")],
    keyResults: [claim("Result")],
    critique: {
      soundness: "ok",
      novelty: "ok",
      significance: "ok",
      clarity: "ok",
      weakestLink: "none",
    },
    assumptionsLimitations: [{ text: "Assumes X", grounding: "general" }],
    reproducibility: "high",
    questionsToAsk: ["Why?"],
    soWhat: "It matters.",
    whatToReadNext: [{ title: "Next paper", why: "Background." }],
    glossary: [{ term: "alpha", tr: "alfa", en: "alpha" }],
  };
}

function buildAnalysis(
  workspaceId: string,
  sourceId: string,
): ArticleAnalysisRecord {
  const now = Date.now();
  return {
    id: "analysis-1",
    workspaceId,
    sourceId,
    title: "p.pdf",
    targetLang: "en",
    status: "ready",
    modelSnapshot: {
      extract: "anthropic::claude-haiku-4-5",
      synthesize: "anthropic::claude-sonnet-4-6",
      critique: "anthropic::claude-opus-4-7",
    },
    usage: { inputTokens: 1200, outputTokens: 600, costUsd: 0.01 },
    payload: buildAnalysisPayload(),
    createdAt: now,
    updatedAt: now,
  };
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
    await db.articleAnalyses.put(buildAnalysis(ws.id, src.id));
    const blob = await exportBackup();
    expect(blob.type).toBe("application/json");
    const parsed = await readPayload(blob);

    expect(parsed.schemaVersion).toBe(10);
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
    expect(parsed.articleAnalyses).toHaveLength(1);
    expect(parsed.articleAnalyses[0]?.id).toBe("analysis-1");
    expect(parsed.articleAnalyses[0]?.payload?.tldr).toBe("Short summary.");
    expect(parsed.articleAnalyses[0]?.payload?.glossary).toHaveLength(1);
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
