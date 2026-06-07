import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createNote,
  deleteNote,
  deleteNotesByWorkspace,
  getNote,
  listBacklinks,
  listNotesByFolder,
  listNotesByTag,
  listNotesByWorkspace,
  moveNote,
  updateNote,
} from "./notes";
import { createNoteFolder } from "./note-folders";
import {
  createNoteSource,
  getNoteSourceByNoteId,
  getSource,
} from "./sources";
import { db } from "./schema";
import { createWorkspace } from "./workspaces";

beforeEach(async () => {
  await db.delete();
  await db.open();
});

afterEach(async () => {
  await db.delete();
});

describe("notes repo", () => {
  it("creates a note with generated id, derives title + tags + wikilinks from content", async () => {
    const ws = await createWorkspace({
      name: "Physics",
      color: "#000",
      initials: "PH",
    });
    const note = await createNote({
      workspaceId: ws.id,
      content:
        "# Quantum Field Theory\n\nSee [[Wilsonian RG]] and [[source:peskin]].\n\nTopic: #fizik/qft",
    });

    expect(note.id).toMatch(/^note_/);
    expect(note.title).toBe("Quantum Field Theory");
    expect(note.wikilinks).toEqual(["Wilsonian RG", "peskin"]);
    expect(note.tags).toEqual(["fizik/qft"]);
    expect(note.path).toBe("Quantum Field Theory.md");
    expect(note.folderId).toBeNull();
    expect(note.createdAt).toBe(note.updatedAt);

    const fetched = await getNote(note.id);
    expect(fetched?.title).toBe("Quantum Field Theory");
  });

  it("updates content and bumps updatedAt + re-derives wikilinks", async () => {
    const ws = await createWorkspace({
      name: "Physics",
      color: "#000",
      initials: "PH",
    });
    const note = await createNote({
      workspaceId: ws.id,
      content: "# Old\n\n[[OldLink]]",
    });
    const before = note.updatedAt;
    await new Promise((r) => setTimeout(r, 5));
    await updateNote(note.id, { content: "# New Title\n\n[[NewLink]]" });
    const after = await getNote(note.id);
    expect(after?.title).toBe("New Title");
    expect(after?.wikilinks).toEqual(["NewLink"]);
    expect(after?.updatedAt).toBeGreaterThan(before);
  });

  it("moveNote re-stamps path with the new folder breadcrumb", async () => {
    const ws = await createWorkspace({
      name: "Physics",
      color: "#000",
      initials: "PH",
    });
    const folder = await createNoteFolder({
      workspaceId: ws.id,
      name: "Daily",
    });
    const note = await createNote({
      workspaceId: ws.id,
      content: "# Lecture 1\n\nNotes.",
    });
    expect(note.path).toBe("Lecture 1.md");
    await moveNote(note.id, folder.id);
    const moved = await getNote(note.id);
    expect(moved?.folderId).toBe(folder.id);
    expect(moved?.path).toBe("Daily/Lecture 1.md");
  });

  it("listBacklinks returns every note in the workspace whose content links to the target", async () => {
    const ws = await createWorkspace({
      name: "Physics",
      color: "#000",
      initials: "PH",
    });
    const other = await createWorkspace({
      name: "Other",
      color: "#000",
      initials: "OT",
    });
    await createNote({
      workspaceId: ws.id,
      content: "# A\n\nSee [[Target Note]].",
    });
    await createNote({
      workspaceId: ws.id,
      content: "# B\n\nAlso mentions [[Target Note]] here.",
    });
    await createNote({
      workspaceId: ws.id,
      content: "# C\n\nUnrelated.",
    });
    // Cross-workspace note with the same wikilink must NOT appear — vault scope.
    await createNote({
      workspaceId: other.id,
      content: "# X\n\n[[Target Note]]",
    });

    const backlinks = await listBacklinks(ws.id, "Target Note");
    expect(backlinks).toHaveLength(2);
    expect(backlinks.map((n) => n.title).sort()).toEqual(["A", "B"]);
  });

  it("listNotesByTag is workspace-scoped and case-insensitive", async () => {
    const ws = await createWorkspace({
      name: "Physics",
      color: "#000",
      initials: "PH",
    });
    await createNote({
      workspaceId: ws.id,
      content: "# A\n\n#kimya",
    });
    await createNote({
      workspaceId: ws.id,
      content: "# B\n\n#Kimya",
    });
    await createNote({
      workspaceId: ws.id,
      content: "# C\n\n#fizik",
    });
    const found = await listNotesByTag(ws.id, "KIMYA");
    expect(found.map((n) => n.title).sort()).toEqual(["A", "B"]);
  });

  it("listNotesByFolder returns root notes when folderId is null", async () => {
    const ws = await createWorkspace({
      name: "Physics",
      color: "#000",
      initials: "PH",
    });
    const folder = await createNoteFolder({
      workspaceId: ws.id,
      name: "Daily",
    });
    await createNote({
      workspaceId: ws.id,
      content: "# Root1",
    });
    await createNote({
      workspaceId: ws.id,
      folderId: folder.id,
      content: "# Inside",
    });
    const roots = await listNotesByFolder(ws.id, null);
    expect(roots).toHaveLength(1);
    expect(roots[0]?.title).toBe("Root1");
    const inside = await listNotesByFolder(ws.id, folder.id);
    expect(inside).toHaveLength(1);
    expect(inside[0]?.title).toBe("Inside");
  });

  it("deletes a single note", async () => {
    const ws = await createWorkspace({
      name: "Physics",
      color: "#000",
      initials: "PH",
    });
    const note = await createNote({
      workspaceId: ws.id,
      content: "# Doomed",
    });
    await deleteNote(note.id);
    expect(await getNote(note.id)).toBeUndefined();
  });

  it("deleteNotesByWorkspace cascades", async () => {
    const ws = await createWorkspace({
      name: "Physics",
      color: "#000",
      initials: "PH",
    });
    await createNote({ workspaceId: ws.id, content: "# A" });
    await createNote({ workspaceId: ws.id, content: "# B" });
    await deleteNotesByWorkspace(ws.id);
    expect(await listNotesByWorkspace(ws.id)).toHaveLength(0);
  });

  // Phase 6.9 — Notes-as-Source.
  it("deleteNote cascades through the linked SourceRecord when the note was embedded", async () => {
    const ws = await createWorkspace({
      name: "Physics",
      color: "#000",
      initials: "PH",
    });
    const note = await createNote({
      workspaceId: ws.id,
      content: "# Embedded note\n\nBody.",
    });
    const source = await createNoteSource({
      noteId: note.id,
      workspaceId: ws.id,
    });
    expect(await getSource(source.id)).toBeDefined();

    await deleteNote(note.id);

    expect(await getNote(note.id)).toBeUndefined();
    expect(await getSource(source.id)).toBeUndefined();
    expect(await getNoteSourceByNoteId(note.id)).toBeUndefined();
  });

  it("deleteNote on an un-embedded note is a no-op for sources (no linked row)", async () => {
    const ws = await createWorkspace({
      name: "Physics",
      color: "#000",
      initials: "PH",
    });
    const note = await createNote({
      workspaceId: ws.id,
      content: "# Plain note",
    });
    // Sanity: no linked source.
    expect(await getNoteSourceByNoteId(note.id)).toBeUndefined();
    await deleteNote(note.id);
    expect(await getNote(note.id)).toBeUndefined();
  });

  it("autoEmbedOnSave defaults to absent on freshly created notes (read as undefined)", async () => {
    const ws = await createWorkspace({
      name: "Physics",
      color: "#000",
      initials: "PH",
    });
    const note = await createNote({
      workspaceId: ws.id,
      content: "# Note",
    });
    const fetched = await getNote(note.id);
    expect(fetched?.autoEmbedOnSave).toBeUndefined();
  });
});
