import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createNoteSource,
  createSource,
  getNoteSourceByNoteId,
  getSource,
  markNoteSourceDirty,
  markNoteSourceSynced,
} from "./sources";
import { createNote } from "./notes";
import { db } from "./schema";
import { createWorkspace } from "./workspaces";

beforeEach(async () => {
  await db.delete();
  await db.open();
});

afterEach(async () => {
  await db.delete();
});

describe("sources repo — Phase 6.9 note-source API", () => {
  it("createNoteSource creates a type=note source linked back to the note via noteId, copying the note's title", async () => {
    const ws = await createWorkspace({
      name: "Physics",
      color: "#000",
      initials: "PH",
    });
    const note = await createNote({
      workspaceId: ws.id,
      content: "# Quantum Field Theory\n\nBody.",
    });

    const source = await createNoteSource({
      noteId: note.id,
      workspaceId: ws.id,
    });

    expect(source.id).toMatch(/^src_/);
    expect(source.type).toBe("note");
    expect(source.noteId).toBe(note.id);
    expect(source.title).toBe("Quantum Field Theory");
    expect(source.workspaceId).toBe(ws.id);
    expect(source.ingestStatus).toBe("ready");
    expect(source.embeddingStatus).toBe("missing");
    expect(source.lastEmbeddedContentHash).toBeUndefined();
    expect(source.lastEmbeddedAt).toBeUndefined();
  });

  it("createNoteSource throws when the linked note is missing", async () => {
    const ws = await createWorkspace({
      name: "Physics",
      color: "#000",
      initials: "PH",
    });
    await expect(
      createNoteSource({ noteId: "note_does_not_exist", workspaceId: ws.id }),
    ).rejects.toThrow(/note .* not found/);
  });

  it("getNoteSourceByNoteId returns the linked source via the noteId index, ignores other sources", async () => {
    const ws = await createWorkspace({
      name: "Physics",
      color: "#000",
      initials: "PH",
    });
    const note = await createNote({
      workspaceId: ws.id,
      content: "# A",
    });
    // Unrelated PDF source — must not be confused with a note-source lookup.
    await createSource({
      workspaceId: ws.id,
      type: "pdf",
      title: "A textbook",
      ingestStatus: "ready",
    });
    const noteSource = await createNoteSource({
      noteId: note.id,
      workspaceId: ws.id,
    });

    const found = await getNoteSourceByNoteId(note.id);
    expect(found?.id).toBe(noteSource.id);
    expect(found?.noteId).toBe(note.id);

    const missing = await getNoteSourceByNoteId("note_never_embedded");
    expect(missing).toBeUndefined();
  });

  it("markNoteSourceSynced writes hash + lastEmbeddedAt and flips embeddingStatus to ready", async () => {
    const ws = await createWorkspace({
      name: "Physics",
      color: "#000",
      initials: "PH",
    });
    const note = await createNote({
      workspaceId: ws.id,
      content: "# Note",
    });
    const source = await createNoteSource({
      noteId: note.id,
      workspaceId: ws.id,
    });

    const before = Date.now();
    await markNoteSourceSynced(source.id, "sha256:abcdef");
    const after = await getSource(source.id);

    expect(after?.lastEmbeddedContentHash).toBe("sha256:abcdef");
    expect(after?.embeddingStatus).toBe("ready");
    expect(after?.lastEmbeddedAt).toBeGreaterThanOrEqual(before);
  });

  it("markNoteSourceDirty clears lastEmbeddedContentHash so the toolbar button flips to dirty", async () => {
    const ws = await createWorkspace({
      name: "Physics",
      color: "#000",
      initials: "PH",
    });
    const note = await createNote({
      workspaceId: ws.id,
      content: "# Note",
    });
    const source = await createNoteSource({
      noteId: note.id,
      workspaceId: ws.id,
    });
    await markNoteSourceSynced(source.id, "sha256:abcdef");
    const synced = await getSource(source.id);
    expect(synced?.lastEmbeddedContentHash).toBe("sha256:abcdef");

    await markNoteSourceDirty(source.id);
    const dirty = await getSource(source.id);
    expect(dirty?.lastEmbeddedContentHash).toBeUndefined();
    // lastEmbeddedAt is intentionally preserved so the "last synced X ago"
    // tooltip can still tell the user when the previous good sync happened.
    expect(dirty?.lastEmbeddedAt).toBeDefined();
  });
});
