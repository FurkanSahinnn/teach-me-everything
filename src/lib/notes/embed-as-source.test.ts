import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  embedNoteAsSource,
  type EmbedderHandle,
} from "./embed-as-source";
import { createNote, deleteNote, updateNote } from "@/lib/db/notes";
import {
  getNoteSourceByNoteId,
  getSource,
} from "@/lib/db/sources";
import { db } from "@/lib/db/schema";
import { createWorkspace } from "@/lib/db/workspaces";

type MockEmbedder = EmbedderHandle & { calls: string[][] };

function makeMockEmbedder(
  overrides: Partial<Pick<EmbedderHandle, "pricePerMillionTokensUsd">> = {},
): MockEmbedder {
  const calls: string[][] = [];
  return {
    providerId: "mock",
    model: "mock-embed",
    pricePerMillionTokensUsd: 0.02,
    ...overrides,
    embed: async (inputs: string[]) => {
      calls.push([...inputs]);
      // Encode text length into vec[0] so test assertions can distinguish
      // "the embedding really came from this text" without hashing.
      return inputs.map(
        (text) => new Float32Array([text.length, 0, 0]),
      );
    },
    calls,
  };
}

beforeEach(async () => {
  await db.delete();
  await db.open();
});

afterEach(async () => {
  await db.delete();
});

describe("embedNoteAsSource", () => {
  it("auto-creates the note-source on first embed, chunks the note, and writes back the hash", async () => {
    const ws = await createWorkspace({
      name: "Physics",
      color: "#000",
      initials: "PH",
    });
    const note = await createNote({
      workspaceId: ws.id,
      content: "# Quantum Theory\n\nBohr model briefly explained.",
    });
    expect(await getNoteSourceByNoteId(note.id)).toBeUndefined();

    const embedder = makeMockEmbedder();
    const result = await embedNoteAsSource(note.id, embedder);

    expect(result.reused).toBe(false);
    expect(result.chunkCount).toBeGreaterThan(0);
    expect(result.embedsRun).toBe(result.chunkCount);
    expect(result.tokensUsed).toBeGreaterThan(0);
    expect(result.costUsd).toBeGreaterThan(0);

    const source = await getNoteSourceByNoteId(note.id);
    expect(source?.id).toBe(result.sourceId);
    expect(source?.type).toBe("note");
    expect(source?.lastEmbeddedContentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(source?.embeddingStatus).toBe("ready");

    // Chunks are persisted with the mock embedder's id/model + dimension.
    const chunks = await db.chunks
      .where("sourceId")
      .equals(result.sourceId)
      .toArray();
    expect(chunks).toHaveLength(result.chunkCount);
    for (const c of chunks) {
      expect(c.embedding).toBeInstanceOf(Float32Array);
      expect(c.embeddingProvider).toBe("mock");
      expect(c.embeddingModel).toBe("mock-embed");
      expect(c.embeddingDim).toBe(3);
    }
  });

  it("re-runs with no edits short-circuit via the content-hash match (reused=true, embedder not called)", async () => {
    const ws = await createWorkspace({
      name: "Physics",
      color: "#000",
      initials: "PH",
    });
    const note = await createNote({
      workspaceId: ws.id,
      content: "# A note\n\nSome body text.",
    });
    const embedder = makeMockEmbedder();

    const first = await embedNoteAsSource(note.id, embedder);
    expect(first.reused).toBe(false);
    const callsAfterFirst = embedder.calls.length;

    const second = await embedNoteAsSource(note.id, embedder);
    expect(second.reused).toBe(true);
    expect(second.sourceId).toBe(first.sourceId);
    expect(second.chunkCount).toBe(first.chunkCount);
    expect(second.embedsRun).toBe(0);
    expect(second.tokensUsed).toBe(0);
    expect(second.costUsd).toBe(0);
    expect(embedder.calls.length).toBe(callsAfterFirst); // no new provider call
  });

  it("editing the note flips the source dirty and re-embeds on next call", async () => {
    const ws = await createWorkspace({
      name: "Physics",
      color: "#000",
      initials: "PH",
    });
    const note = await createNote({
      workspaceId: ws.id,
      content: "# Original\n\nFirst body.",
    });
    const embedder = makeMockEmbedder();

    await embedNoteAsSource(note.id, embedder);
    const callsAfterFirst = embedder.calls.length;

    await updateNote(note.id, {
      content: "# Original\n\nFirst body, plus an extra sentence.",
    });

    const second = await embedNoteAsSource(note.id, embedder);
    expect(second.reused).toBe(false);
    expect(second.embedsRun).toBeGreaterThan(0);
    expect(embedder.calls.length).toBeGreaterThan(callsAfterFirst);
  });

  it("reuses cached embeddings for chunks whose text is unchanged across syncs", async () => {
    const ws = await createWorkspace({
      name: "Physics",
      color: "#000",
      initials: "PH",
    });
    // Long content that the chunker will split into >=2 chunks. Token target
    // is ~750 (~3000 chars); we make two distinct "sections" comfortably
    // longer so the chunker emits at least two outputs.
    const sectionA =
      "# Section A\n\n" + "Lorem ipsum dolor sit amet, ".repeat(200);
    const sectionB =
      "# Section B\n\n" + "Consectetur adipiscing elit, ".repeat(200);
    const note = await createNote({
      workspaceId: ws.id,
      content: `${sectionA}\n\n${sectionB}`,
    });

    const embedder = makeMockEmbedder();
    const first = await embedNoteAsSource(note.id, embedder);
    expect(first.chunkCount).toBeGreaterThanOrEqual(2);
    const firstCalls = embedder.calls.length;
    const firstInputsCount = embedder.calls
      .map((c) => c.length)
      .reduce((a, b) => a + b, 0);

    // Only edit section B — section A's chunk text stays byte-identical.
    await updateNote(note.id, {
      content: `${sectionA}\n\n${sectionB} New trailing edit.`,
    });

    const second = await embedNoteAsSource(note.id, embedder);
    expect(second.reused).toBe(false);
    // At least one chunk should have been reused (section A) — so fewer
    // chunks were re-embedded than the total count.
    expect(second.embedsRun).toBeLessThan(second.chunkCount);
    expect(second.embedsRun).toBeGreaterThan(0);
    // Total inputs the provider has seen across both runs should be less
    // than 2× the chunk count (some reuse happened).
    const totalInputsAfterSecond = embedder.calls
      .map((c) => c.length)
      .reduce((a, b) => a + b, 0);
    expect(totalInputsAfterSecond).toBeLessThan(2 * second.chunkCount);
    expect(embedder.calls.length).toBeGreaterThan(firstCalls);
    expect(firstInputsCount).toBeGreaterThan(0); // sanity
  });

  it("deletes the source-row + chunks when the note is deleted (cascade through deleteNote)", async () => {
    const ws = await createWorkspace({
      name: "Physics",
      color: "#000",
      initials: "PH",
    });
    const note = await createNote({
      workspaceId: ws.id,
      content: "# Doomed\n\nBody.",
    });
    const result = await embedNoteAsSource(note.id, makeMockEmbedder());
    expect(await getSource(result.sourceId)).toBeDefined();
    const chunksBefore = await db.chunks
      .where("sourceId")
      .equals(result.sourceId)
      .count();
    expect(chunksBefore).toBeGreaterThan(0);

    await deleteNote(note.id);

    expect(await getSource(result.sourceId)).toBeUndefined();
    expect(
      await db.chunks.where("sourceId").equals(result.sourceId).count(),
    ).toBe(0);
    expect(await getNoteSourceByNoteId(note.id)).toBeUndefined();
  });

  it("reports costUsd as 0 when the embedder declares a free-tier price (0)", async () => {
    const ws = await createWorkspace({
      name: "Physics",
      color: "#000",
      initials: "PH",
    });
    const note = await createNote({
      workspaceId: ws.id,
      content: "# Note\n\nBody.",
    });
    const embedder = makeMockEmbedder({ pricePerMillionTokensUsd: 0 });
    const result = await embedNoteAsSource(note.id, embedder);
    expect(result.tokensUsed).toBeGreaterThan(0);
    expect(result.costUsd).toBe(0);
  });

  it("throws on missing note id", async () => {
    await expect(
      embedNoteAsSource("note_missing", makeMockEmbedder()),
    ).rejects.toThrow(/note .* not found/);
  });
});
