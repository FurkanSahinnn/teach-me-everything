// Note folders repo (Phase 6.1). Hierarchical, workspace-bound. Every
// folder carries a `path` breadcrumb ("Daily/Sub") recomputed by the repo
// on every rename / move so callers never have to track it manually. Phase
// 7 (Tauri) will turn `path` directly into a filesystem directory.

import { newId } from "@/lib/utils/id";
import type { NoteFolderRecord } from "./types";
import { db } from "./schema";
import { recomputeNotePathsForFolder, updateNote } from "./notes";

export type CreateNoteFolderInput = {
  id?: string;
  workspaceId: string;
  parentId?: string | null;
  name: string;
};

export type FolderDeleteMode =
  | { kind: "cascade" }
  | { kind: "move-to-root" };

function sanitizeName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) return "Untitled";
  // Same restrictions as a note slug: NTFS / APFS reserved chars are stripped
  // so the path string round-trips into a real directory when Phase 7 ships.
  return trimmed.replace(/[\\/:*?"<>|]/g, "-").slice(0, 120);
}

async function buildPath(
  workspaceId: string,
  parentId: string | null,
  name: string,
): Promise<string> {
  const segment = sanitizeName(name);
  if (parentId === null) return segment;
  const parent = await db.noteFolders.get(parentId);
  if (!parent || parent.workspaceId !== workspaceId) return segment;
  return `${parent.path}/${segment}`;
}

export async function createNoteFolder(
  input: CreateNoteFolderInput,
): Promise<NoteFolderRecord> {
  const parentId = input.parentId ?? null;
  const path = await buildPath(input.workspaceId, parentId, input.name);
  const record: NoteFolderRecord = {
    id: input.id ?? newId("nfld"),
    workspaceId: input.workspaceId,
    parentId,
    name: sanitizeName(input.name),
    path,
    createdAt: Date.now(),
  };
  await db.noteFolders.add(record);
  return record;
}

export async function getNoteFolder(
  id: string,
): Promise<NoteFolderRecord | undefined> {
  return db.noteFolders.get(id);
}

export async function listFoldersByWorkspace(
  workspaceId: string,
): Promise<NoteFolderRecord[]> {
  const rows = await db.noteFolders
    .where("workspaceId")
    .equals(workspaceId)
    .toArray();
  return rows.sort((a, b) => a.path.localeCompare(b.path));
}

export async function listFoldersByParent(
  workspaceId: string,
  parentId: string | null,
): Promise<NoteFolderRecord[]> {
  // Same `null`-can't-be-indexed dance as notes/listNotesByFolder.
  if (parentId === null) {
    const rows = await db.noteFolders
      .where("workspaceId")
      .equals(workspaceId)
      .toArray();
    return rows
      .filter((f) => f.parentId === null)
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  const rows = await db.noteFolders
    .where("[workspaceId+parentId]")
    .equals([workspaceId, parentId])
    .toArray();
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

// Walk every descendant under `folderId` (BFS). Used by rename + move to
// know which child paths must be re-stamped, and by cascade-delete.
async function listDescendants(
  folderId: string,
): Promise<NoteFolderRecord[]> {
  const out: NoteFolderRecord[] = [];
  const queue: string[] = [folderId];
  while (queue.length > 0) {
    const next = queue.shift();
    if (next === undefined) break;
    const children = await db.noteFolders
      .where("parentId")
      .equals(next)
      .toArray();
    for (const child of children) {
      out.push(child);
      queue.push(child.id);
    }
  }
  return out;
}

export async function renameNoteFolder(
  id: string,
  newName: string,
): Promise<void> {
  const folder = await db.noteFolders.get(id);
  if (!folder) return;
  const sanitized = sanitizeName(newName);
  const newPath = await buildPath(folder.workspaceId, folder.parentId, sanitized);
  await db.noteFolders.update(id, { name: sanitized, path: newPath });
  // Cascade path rewrite to descendants + their notes.
  const descendants = await listDescendants(id);
  for (const child of descendants) {
    const childPath = await buildPath(
      child.workspaceId,
      child.parentId,
      child.name,
    );
    await db.noteFolders.update(child.id, { path: childPath });
  }
  await recomputeNotePathsForFolder(id);
  for (const child of descendants) {
    await recomputeNotePathsForFolder(child.id);
  }
}

export async function moveNoteFolder(
  id: string,
  newParentId: string | null,
): Promise<void> {
  const folder = await db.noteFolders.get(id);
  if (!folder) return;
  // Defend against forming a cycle (moving a folder into its own descendant).
  if (newParentId !== null) {
    const descendants = await listDescendants(id);
    const blocked = new Set([id, ...descendants.map((d) => d.id)]);
    if (blocked.has(newParentId)) return;
  }
  const newPath = await buildPath(folder.workspaceId, newParentId, folder.name);
  await db.noteFolders.update(id, { parentId: newParentId, path: newPath });
  const descendants = await listDescendants(id);
  for (const child of descendants) {
    const childPath = await buildPath(
      child.workspaceId,
      child.parentId,
      child.name,
    );
    await db.noteFolders.update(child.id, { path: childPath });
  }
  await recomputeNotePathsForFolder(id);
  for (const child of descendants) {
    await recomputeNotePathsForFolder(child.id);
  }
}

// Delete a folder. `mode.kind === "cascade"` removes the folder, all its
// descendant folders, and every note inside them. `"move-to-root"` keeps
// the notes alive but drops them to the vault root (recomputing each
// note's path). The UI always prompts before calling this; here we just
// honour the chosen mode.
export async function deleteNoteFolder(
  id: string,
  mode: FolderDeleteMode = { kind: "move-to-root" },
): Promise<void> {
  const folder = await db.noteFolders.get(id);
  if (!folder) return;
  const descendants = await listDescendants(id);
  const folderIdsToRemove = [id, ...descendants.map((d) => d.id)];

  if (mode.kind === "cascade") {
    // Delete every note inside the doomed folders + the folders themselves.
    const noteIds: string[] = [];
    for (const fid of folderIdsToRemove) {
      const ids = await db.notes
        .where("folderId")
        .equals(fid)
        .primaryKeys();
      noteIds.push(...ids.map((k) => String(k)));
    }
    await db.transaction("rw", [db.notes, db.noteFolders], async () => {
      if (noteIds.length > 0) await db.notes.bulkDelete(noteIds);
      await db.noteFolders.bulkDelete(folderIdsToRemove);
    });
    return;
  }

  // move-to-root: re-parent every note inside the doomed folders to root,
  // then delete the folders. Notes get their paths re-stamped since the
  // parent breadcrumb disappears.
  for (const fid of folderIdsToRemove) {
    const notesInFolder = await db.notes
      .where("folderId")
      .equals(fid)
      .toArray();
    for (const note of notesInFolder) {
      // Route through updateNote so the root path is slugified/projected the
      // same way every other path is. Setting `${note.title}.md` raw skipped
      // slugifySegment, so a title with slashes/colons produced an invalid
      // path that diverged from what the vault exporter and rebuildIndex
      // recompute — orphaning the note's on-disk file.
      await updateNote(note.id, { folderId: null });
    }
  }
  await db.noteFolders.bulkDelete(folderIdsToRemove);
}

export async function deleteNoteFoldersByWorkspace(
  workspaceId: string,
): Promise<void> {
  const ids = await db.noteFolders
    .where("workspaceId")
    .equals(workspaceId)
    .primaryKeys();
  if (ids.length === 0) return;
  await db.noteFolders.bulkDelete(ids);
}
