import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createNote, getNote, listNotesByFolder } from "./notes";
import {
  createNoteFolder,
  deleteNoteFolder,
  listFoldersByWorkspace,
  moveNoteFolder,
  renameNoteFolder,
} from "./note-folders";
import { db } from "./schema";
import { createWorkspace } from "./workspaces";

beforeEach(async () => {
  await db.delete();
  await db.open();
});

afterEach(async () => {
  await db.delete();
});

describe("note-folders repo", () => {
  it("creates a root folder with path = name and a nested folder with composed path", async () => {
    const ws = await createWorkspace({
      name: "Physics",
      color: "#000",
      initials: "PH",
    });
    const root = await createNoteFolder({
      workspaceId: ws.id,
      name: "Daily",
    });
    expect(root.path).toBe("Daily");
    expect(root.parentId).toBeNull();
    const child = await createNoteFolder({
      workspaceId: ws.id,
      parentId: root.id,
      name: "2026",
    });
    expect(child.path).toBe("Daily/2026");
  });

  it("renaming a folder re-stamps paths on its descendant folders and notes", async () => {
    const ws = await createWorkspace({
      name: "Physics",
      color: "#000",
      initials: "PH",
    });
    const root = await createNoteFolder({
      workspaceId: ws.id,
      name: "Daily",
    });
    const child = await createNoteFolder({
      workspaceId: ws.id,
      parentId: root.id,
      name: "2026",
    });
    const note = await createNote({
      workspaceId: ws.id,
      folderId: child.id,
      content: "# Entry",
    });
    expect(note.path).toBe("Daily/2026/Entry.md");

    await renameNoteFolder(root.id, "Günlük");

    const renamedChild = await db.noteFolders.get(child.id);
    expect(renamedChild?.path).toBe("Günlük/2026");
    const movedNote = await getNote(note.id);
    expect(movedNote?.path).toBe("Günlük/2026/Entry.md");
  });

  it("move-to-root delete drops folder + reparents inside notes to vault root", async () => {
    const ws = await createWorkspace({
      name: "Physics",
      color: "#000",
      initials: "PH",
    });
    const folder = await createNoteFolder({
      workspaceId: ws.id,
      name: "Doomed",
    });
    const note = await createNote({
      workspaceId: ws.id,
      folderId: folder.id,
      content: "# Survivor",
    });
    await deleteNoteFolder(folder.id, { kind: "move-to-root" });

    expect(await db.noteFolders.get(folder.id)).toBeUndefined();
    const survived = await getNote(note.id);
    expect(survived?.folderId).toBeNull();
    expect(survived?.path).toBe("Survivor.md");
  });

  it("cascade delete removes folder + every descendant note", async () => {
    const ws = await createWorkspace({
      name: "Physics",
      color: "#000",
      initials: "PH",
    });
    const folder = await createNoteFolder({
      workspaceId: ws.id,
      name: "Doomed",
    });
    const note = await createNote({
      workspaceId: ws.id,
      folderId: folder.id,
      content: "# Gone",
    });
    await deleteNoteFolder(folder.id, { kind: "cascade" });
    expect(await db.noteFolders.get(folder.id)).toBeUndefined();
    expect(await getNote(note.id)).toBeUndefined();
  });

  it("move refuses to form a cycle (cannot move parent into its own descendant)", async () => {
    const ws = await createWorkspace({
      name: "Physics",
      color: "#000",
      initials: "PH",
    });
    const parent = await createNoteFolder({
      workspaceId: ws.id,
      name: "A",
    });
    const child = await createNoteFolder({
      workspaceId: ws.id,
      parentId: parent.id,
      name: "B",
    });
    await moveNoteFolder(parent.id, child.id);
    const after = await db.noteFolders.get(parent.id);
    expect(after?.parentId).toBeNull(); // unchanged
  });

  it("listFoldersByWorkspace returns folders sorted by path", async () => {
    const ws = await createWorkspace({
      name: "Physics",
      color: "#000",
      initials: "PH",
    });
    await createNoteFolder({ workspaceId: ws.id, name: "Zeta" });
    await createNoteFolder({ workspaceId: ws.id, name: "Alpha" });
    const folders = await listFoldersByWorkspace(ws.id);
    expect(folders.map((f) => f.name)).toEqual(["Alpha", "Zeta"]);
  });

  it("notes inside the folder show up in listNotesByFolder", async () => {
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
      folderId: folder.id,
      content: "# First",
    });
    const inside = await listNotesByFolder(ws.id, folder.id);
    expect(inside).toHaveLength(1);
    expect(inside[0]?.title).toBe("First");
  });
});
