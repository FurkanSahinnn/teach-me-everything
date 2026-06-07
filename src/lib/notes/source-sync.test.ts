import { describe, expect, it } from "vitest";
import {
  computeNoteHash,
  deriveButtonState,
  estimateEmbedCost,
  estimateTokenCount,
  getNoteSourceState,
} from "./source-sync";
import type { NoteRecord, SourceRecord } from "@/lib/db/types";

function noteFixture(): Pick<NoteRecord, "id"> {
  return { id: "note_abc" };
}

function sourceFixture(
  partial: Partial<SourceRecord> = {},
): SourceRecord {
  const now = Date.now();
  return {
    id: "src_xyz",
    workspaceId: "ws_1",
    type: "note",
    title: "Test note source",
    ingestStatus: "ready",
    embeddingStatus: "ready",
    noteId: "note_abc",
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}

describe("computeNoteHash", () => {
  it("returns a 64-char hex string for any input", async () => {
    const hash = await computeNoteHash("hello world");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic — same input twice produces the same digest", async () => {
    const a = await computeNoteHash("# Title\n\nBody.");
    const b = await computeNoteHash("# Title\n\nBody.");
    expect(a).toBe(b);
  });

  it("changes when content changes even by a single character", async () => {
    const a = await computeNoteHash("# Note");
    const b = await computeNoteHash("# Notes");
    expect(a).not.toBe(b);
  });

  it("handles Unicode (Turkish + emoji) without throwing", async () => {
    const hash = await computeNoteHash("# Çoklu İşlemci 🚀\n\n#fizik/qft");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("handles the empty string with a fixed digest", async () => {
    const hash = await computeNoteHash("");
    // sha256("") known value.
    expect(hash).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });
});

describe("getNoteSourceState", () => {
  const note = noteFixture();

  it("returns 'idle' when no SourceRecord is linked yet", () => {
    expect(getNoteSourceState(note, undefined, "anything")).toBe("idle");
    expect(getNoteSourceState(note, undefined, undefined)).toBe("idle");
  });

  it("returns 'synced' when the source's last hash matches the current hash", () => {
    const source = sourceFixture({ lastEmbeddedContentHash: "hash_v1" });
    expect(getNoteSourceState(note, source, "hash_v1")).toBe("synced");
  });

  it("returns 'dirty' when the hashes diverge", () => {
    const source = sourceFixture({ lastEmbeddedContentHash: "hash_v1" });
    expect(getNoteSourceState(note, source, "hash_v2")).toBe("dirty");
  });

  it("returns 'dirty' when the source exists but currentHash is still pending (undefined)", () => {
    const source = sourceFixture({ lastEmbeddedContentHash: "hash_v1" });
    expect(getNoteSourceState(note, source, undefined)).toBe("dirty");
  });

  it("returns 'dirty' when the source has no last hash yet (just created, never embedded)", () => {
    const source = sourceFixture({ lastEmbeddedContentHash: undefined });
    expect(getNoteSourceState(note, source, "any_hash")).toBe("dirty");
  });
});

describe("estimateEmbedCost + estimateTokenCount", () => {
  it("returns 0 cost for empty content", () => {
    expect(estimateEmbedCost("", 0.02)).toBe(0);
  });

  it("returns 0 cost when price is zero (free-tier model)", () => {
    expect(estimateEmbedCost("a".repeat(1000), 0)).toBe(0);
  });

  it("returns 0 cost when price is negative (defensive clamp)", () => {
    expect(estimateEmbedCost("a".repeat(1000), -0.5)).toBe(0);
  });

  it("estimateTokenCount rounds up — 5 chars → 2 tokens not 1.25", () => {
    expect(estimateTokenCount("hello")).toBe(2);
    expect(estimateTokenCount("a".repeat(4))).toBe(1);
    expect(estimateTokenCount("a".repeat(8))).toBe(2);
  });

  it("scales linearly with content length at a typical embed price", () => {
    // OpenAI text-embedding-3-small is $0.02 / 1M tokens.
    // 4000 chars ≈ 1000 tokens → 1000 / 1M × 0.02 = $0.00002
    const cost = estimateEmbedCost("a".repeat(4000), 0.02);
    expect(cost).toBeCloseTo(0.00002, 8);
  });
});

describe("deriveButtonState — Phase 6.9.4 button state matrix", () => {
  const source = sourceFixture({ lastEmbeddedContentHash: "hash_v1" });

  it("transient='embedding' overrides every persistent state", () => {
    expect(
      deriveButtonState({
        source: undefined,
        currentHash: undefined,
        transient: "embedding",
      }),
    ).toBe("embedding");
    expect(
      deriveButtonState({
        source,
        currentHash: "hash_v1",
        transient: "embedding",
      }),
    ).toBe("embedding");
  });

  it("transient='error' overrides every persistent state", () => {
    expect(
      deriveButtonState({
        source: undefined,
        currentHash: undefined,
        transient: "error",
      }),
    ).toBe("error");
  });

  it("returns 'idle' when source is null (live-query resolved → no row)", () => {
    expect(
      deriveButtonState({
        source: null,
        currentHash: "any_hash",
        transient: null,
      }),
    ).toBe("idle");
  });

  it("returns 'idle' when source is undefined (live-query still loading)", () => {
    expect(
      deriveButtonState({
        source: undefined,
        currentHash: "any_hash",
        transient: null,
      }),
    ).toBe("idle");
  });

  it("returns 'synced' when hashes match", () => {
    expect(
      deriveButtonState({
        source,
        currentHash: "hash_v1",
        transient: null,
      }),
    ).toBe("synced");
  });

  it("returns 'dirty' when hashes diverge", () => {
    expect(
      deriveButtonState({
        source,
        currentHash: "hash_v2",
        transient: null,
      }),
    ).toBe("dirty");
  });

  it("returns 'dirty' when source exists but the current hash hasn't been computed yet", () => {
    expect(
      deriveButtonState({
        source,
        currentHash: undefined,
        transient: null,
      }),
    ).toBe("dirty");
  });
});
