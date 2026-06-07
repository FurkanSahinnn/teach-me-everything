// Notes repo (Phase 6.1). Workspace-bound markdown notes. Wikilinks and
// tags are denormalised onto every row at write time so the multiEntry
// indexes on the table answer backlink and tag-panel queries without a full
// scan. `path` is recomputed from the parent folder's path + slugified
// title — repo callers never have to track it manually; Phase 7 (Tauri)
// will swap the resolver from id-lookup to filesystem-path-lookup without
// touching the schema.

import { newId } from "@/lib/utils/id";
import type { NoteRecord } from "./types";
import { db } from "./schema";
import { deleteSource, getNoteSourceByNoteId } from "./sources";
import { extractTags, extractTitle, extractWikilinks } from "@/lib/notes/parser";

export type CreateNoteInput = {
  id?: string;
  workspaceId: string;
  folderId?: string | null;
  title?: string;
  content?: string;
};

export type NotePatch = {
  title?: string;
  content?: string;
  folderId?: string | null;
};

// Slugify a note title into a filesystem-safe path segment. Keeps Turkish
// letters as-is (Tauri's NTFS / APFS / ext4 paths all handle UTF-8); replaces
// only the characters that break path joining (`/`, `\`, `:`, `*`, `?`, `"`,
// `<`, `>`, `|`). Empty / whitespace-only titles collapse to "untitled" so
// the path index always has a non-empty bucket.
function slugifySegment(title: string): string {
  const trimmed = title.trim();
  if (trimmed.length === 0) return "untitled";
  return trimmed.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").slice(0, 200);
}

// Compute the breadcrumb path for a note from its folder + title.
async function computePath(
  folderId: string | null,
  title: string,
): Promise<string> {
  const segment = `${slugifySegment(title)}.md`;
  if (folderId === null) return segment;
  const folder = await db.noteFolders.get(folderId);
  if (!folder) return segment;
  return `${folder.path}/${segment}`;
}

// Project the denormalised fields (title, tags, wikilinks, path) off the
// canonical content. Centralised so create + update never drift.
async function projectFromContent(
  content: string,
  fallbackTitle: string | undefined,
  folderId: string | null,
): Promise<{
  title: string;
  tags: string[];
  wikilinks: string[];
  path: string;
}> {
  const parsedTitle = extractTitle(content);
  const title =
    parsedTitle.length > 0 ? parsedTitle : (fallbackTitle?.trim() ?? "");
  const finalTitle = title.length > 0 ? title : "Untitled";
  const tags = extractTags(content);
  const wikilinks = extractWikilinks(content).map((ref) => ref.target);
  const path = await computePath(folderId, finalTitle);
  return { title: finalTitle, tags, wikilinks, path };
}

export async function createNote(input: CreateNoteInput): Promise<NoteRecord> {
  const now = Date.now();
  const folderId = input.folderId ?? null;
  const content = input.content ?? "";
  const { title, tags, wikilinks, path } = await projectFromContent(
    content,
    input.title,
    folderId,
  );
  const record: NoteRecord = {
    id: input.id ?? newId("note"),
    workspaceId: input.workspaceId,
    folderId,
    title,
    content,
    tags,
    wikilinks,
    path,
    createdAt: now,
    updatedAt: now,
  };
  await db.notes.add(record);
  return record;
}

export async function getNote(id: string): Promise<NoteRecord | undefined> {
  return db.notes.get(id);
}

export async function listNotesByWorkspace(
  workspaceId: string,
): Promise<NoteRecord[]> {
  const rows = await db.notes
    .where("[workspaceId+updatedAt]")
    .between([workspaceId, -Infinity], [workspaceId, Infinity])
    .toArray();
  return rows.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function listNotesByFolder(
  workspaceId: string,
  folderId: string | null,
): Promise<NoteRecord[]> {
  // Dexie cannot index `null`, so the compound `[workspaceId+folderId]`
  // index buckets root notes under their workspace only. Fall back to a
  // workspace scan + filter for the root case; folder buckets stay indexed.
  if (folderId === null) {
    const rows = await db.notes
      .where("workspaceId")
      .equals(workspaceId)
      .toArray();
    return rows
      .filter((n) => n.folderId === null)
      .sort((a, b) => a.title.localeCompare(b.title));
  }
  const rows = await db.notes
    .where("[workspaceId+folderId]")
    .equals([workspaceId, folderId])
    .toArray();
  return rows.sort((a, b) => a.title.localeCompare(b.title));
}

export async function updateNote(
  id: string,
  patch: NotePatch,
): Promise<void> {
  const existing = await db.notes.get(id);
  if (!existing) return;
  const nextContent = patch.content ?? existing.content;
  const nextFolderId =
    patch.folderId === undefined ? existing.folderId : patch.folderId;
  const fallbackTitle = patch.title ?? existing.title;
  const projected = await projectFromContent(
    nextContent,
    fallbackTitle,
    nextFolderId,
  );
  await db.notes.update(id, {
    content: nextContent,
    folderId: nextFolderId,
    title: projected.title,
    tags: projected.tags,
    wikilinks: projected.wikilinks,
    path: projected.path,
    updatedAt: Date.now(),
  });
}

export async function moveNote(
  id: string,
  folderId: string | null,
): Promise<void> {
  await updateNote(id, { folderId });
}

// Phase 6.9.5 — Per-note auto-sync toggle. Kept off the `NotePatch` shape on
// purpose: `updateNote(...)` re-projects title/tags/wikilinks/path from
// `content`, which is unnecessary churn for a single boolean flip. The
// setter writes the field + `updatedAt` and leaves projection alone so
// toggling auto-sync doesn't re-walk the parser on every flip.
export async function setNoteAutoEmbed(
  id: string,
  value: boolean,
): Promise<void> {
  const existing = await db.notes.get(id);
  if (!existing) return;
  await db.notes.update(id, {
    autoEmbedOnSave: value,
    updatedAt: Date.now(),
  });
}

export async function deleteNote(id: string): Promise<void> {
  // Phase 6.9 — Notes-as-Source. If this note was embedded as a source,
  // cascade through deleteSource() so the linked SourceRecord, its chunks,
  // chat threads, concepts, and source blob all clean up. deleteSource()
  // opens its own rw transaction over the wide source-graph table set,
  // so we run it sequentially before removing the note row itself.
  //
  // Failure window: if the process exits between deleteSource and
  // db.notes.delete, the note is still present while its source is gone;
  // the next embed click recreates the source via createNoteSource. The
  // reverse window (note deleted, source dangling) is recoverable too —
  // getNoteSourceByNoteId(id) returns an orphan that any future sweep can
  // collect. We accept both windows rather than rewrite the wider
  // delete-source transaction to also touch the notes table.
  const linkedSource = await getNoteSourceByNoteId(id);
  if (linkedSource) {
    await deleteSource(linkedSource.id);
  }
  await db.notes.delete(id);
}

export async function listBacklinks(
  workspaceId: string,
  targetTitle: string,
): Promise<NoteRecord[]> {
  // The `wikilinks` multiEntry index is case-sensitive, but wikilink
  // resolution is case-insensitive — an index equality query silently misses
  // cross-cased backlinks (`[[quantum physics]]` for target "Quantum
  // Physics"). Scan the workspace (bounded) and match on a lowercased
  // projection so the backlinks panel matches what actually resolves.
  const targetLower = targetTitle.toLowerCase();
  const rows = await db.notes
    .where("workspaceId")
    .equals(workspaceId)
    .toArray();
  return rows
    .filter((n) =>
      (n.wikilinks ?? []).some((w) => w.toLowerCase() === targetLower),
    )
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function listNotesByTag(
  workspaceId: string,
  tag: string,
): Promise<NoteRecord[]> {
  const rows = await db.notes
    .where("tags")
    .equals(tag.toLowerCase())
    .toArray();
  return rows
    .filter((n) => n.workspaceId === workspaceId)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

// Workspace-cascade delete. Used by `deleteWorkspace` so removing a
// workspace also removes its notes (folders cascade separately in their
// own repo). Kept here next to the table that owns the rows.
export async function deleteNotesByWorkspace(
  workspaceId: string,
): Promise<void> {
  const ids = await db.notes
    .where("workspaceId")
    .equals(workspaceId)
    .primaryKeys();
  if (ids.length === 0) return;
  await db.notes.bulkDelete(ids);
}

// Recompute path for every note whose folder ancestry just moved. Called
// from the folders repo after rename / move; not part of the public-create
// surface but exported so a hypothetical Tauri migration can re-stamp paths
// on first launch without bypassing the repo layer.
export async function recomputeNotePathsForFolder(
  folderId: string,
): Promise<void> {
  const rows = await db.notes
    .where("folderId")
    .equals(folderId)
    .toArray();
  for (const row of rows) {
    const path = await computePath(row.folderId, row.title);
    if (path !== row.path) {
      await db.notes.update(row.id, { path });
    }
  }
}
