import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  runAddFlashcard,
  runOpenCitation,
  runSimplifyExplanation,
  summarizeToolResult,
  type ToolHandlerContext,
} from "./tool-handlers";
import { db } from "@/lib/db/schema";
import { listDecksByWorkspace } from "@/lib/db/flashcards";
import type { ChunkRecord } from "@/lib/db/types";

function chunk(partial: Partial<ChunkRecord> & { id: string; index: number }): ChunkRecord {
  return {
    sourceId: "src1",
    workspaceId: "ws1",
    text: "body",
    tokenCount: 50,
    createdAt: 0,
    ...partial,
  };
}

const baseChunks: ChunkRecord[] = [
  chunk({ id: "ck1", index: 0, section: "1.1 Introduction", headings: ["1.1 Introduction"] }),
  chunk({ id: "ck2", index: 1, section: "1.2 Methods", headings: ["1.2 Methods"] }),
];

const ctx: ToolHandlerContext = {
  workspaceId: "ws1",
  sourceId: "src1",
  chunks: baseChunks,
  locale: "tr",
};

beforeEach(async () => {
  await db.delete();
  await db.open();
});

afterEach(async () => {
  await db.delete();
});

describe("runAddFlashcard", () => {
  it("rejects empty question/answer", async () => {
    const r = await runAddFlashcard({ question: "", answer: "" }, ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("missing_fields");
  });

  it("creates a default deck and inserts the flashcard with SM-2 defaults", async () => {
    const r = await runAddFlashcard(
      { question: "What is QFT?", answer: "Quantum Field Theory" },
      ctx,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.deckName).toBe("Notebook");
    expect(r.record.ease).toBe(2.5);
    expect(r.record.interval).toBe(0);
    expect(r.record.repetitions).toBe(0);

    const decks = await listDecksByWorkspace("ws1");
    expect(decks).toHaveLength(1);
  });

  it("reuses the existing 'Notebook' deck on a second invocation", async () => {
    await runAddFlashcard({ question: "Q1", answer: "A1" }, ctx);
    await runAddFlashcard({ question: "Q2", answer: "A2" }, ctx);
    const decks = await listDecksByWorkspace("ws1");
    expect(decks).toHaveLength(1);
    const all = await db.flashcards.toArray();
    expect(all).toHaveLength(2);
  });

  it("anchors the card to a chunk when sourceChunkId matches", async () => {
    const r = await runAddFlashcard(
      { question: "Q", answer: "A", sourceChunkId: "ck2" },
      ctx,
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.record.chunkId).toBe("ck2");
  });

  it("falls back to section-based chunk lookup when only sourceSection is provided", async () => {
    const r = await runAddFlashcard(
      { question: "Q", answer: "A", sourceSection: "1.2 Methods" },
      ctx,
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.record.chunkId).toBe("ck2");
  });
});

describe("runOpenCitation", () => {
  it("returns missing_ref for blank input", () => {
    const r = runOpenCitation({ sectionRef: "" }, ctx, () => {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("missing_ref");
  });

  it("returns not_found when no chunk matches", () => {
    const r = runOpenCitation({ sectionRef: "nonexistent" }, ctx, () => {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("not_found");
  });

  it("invokes jumpToChunk and returns the matched chunk id", () => {
    const jump = vi.fn();
    const r = runOpenCitation({ sectionRef: "Introduction" }, ctx, jump);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.chunkId).toBe("ck1");
    expect(jump).toHaveBeenCalledOnce();
  });
});

describe("runSimplifyExplanation", () => {
  it("prefixes the previous user message in Turkish", () => {
    const r = runSimplifyExplanation({}, "Bose-Einstein nedir?", "tr");
    expect(r.requeue.startsWith("Bunu çok daha basit")).toBe(true);
    expect(r.requeue.endsWith("Bose-Einstein nedir?")).toBe(true);
  });

  it("prefixes the previous user message in English", () => {
    const r = runSimplifyExplanation({}, "What is gauge symmetry?", "en");
    expect(r.requeue.startsWith("Explain this much more simply")).toBe(true);
  });
});

describe("summarizeToolResult", () => {
  it("summarises add_flashcard success", () => {
    const out = summarizeToolResult("add_flashcard", {
      ok: true,
      flashcardId: "card_x",
      deckName: "Notebook",
      record: { id: "card_x" } as never,
    });
    const parsed = JSON.parse(out);
    expect(parsed).toEqual({ ok: true, flashcardId: "card_x", deckName: "Notebook" });
  });

  it("summarises open_citation success", () => {
    const out = summarizeToolResult("open_citation", {
      ok: true,
      chunkId: "ck2",
      section: "1.2 Methods",
    });
    expect(JSON.parse(out)).toEqual({
      ok: true,
      chunkId: "ck2",
      section: "1.2 Methods",
    });
  });

  it("summarises simplify_explanation success without echoing the requeue text", () => {
    const out = summarizeToolResult("simplify_explanation", {
      ok: true,
      requeue: "Explain this much more simply, ...",
    });
    expect(JSON.parse(out)).toEqual({ ok: true, queued: true });
  });

  it("summarises a generic error", () => {
    const out = summarizeToolResult("add_flashcard", {
      ok: false,
      error: "missing_fields",
    });
    expect(JSON.parse(out)).toEqual({ ok: false, error: "missing_fields" });
  });
});
