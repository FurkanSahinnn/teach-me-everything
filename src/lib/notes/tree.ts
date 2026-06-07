// Pure tree builder for the notes sidebar (Phase 6.4). Folders + notes
// arrive as flat Dexie rows; the UI needs a recursive structure with
// per-node depth, expanded flag, and pre-filtered visibility for the
// search box. Keeping this pure (no React, no Dexie) lets us unit-test
// every edge case (cycles, orphan parents, search collapse, sort order)
// without spinning up a renderer.

import type { NoteFolderRecord, NoteRecord } from "@/lib/db/types";

export type FolderNode = {
  kind: "folder";
  id: string;
  name: string;
  parentId: string | null;
  path: string;
  depth: number;
  expanded: boolean;
  children: TreeNode[];
  /** Notes living directly inside this folder (already filtered + sorted). */
  notes: NoteNode[];
};

export type NoteNode = {
  kind: "note";
  id: string;
  title: string;
  folderId: string | null;
  depth: number;
  updatedAt: number;
};

export type TreeNode = FolderNode | NoteNode;

export type RootBucket = {
  /** Folders that hang directly off the workspace root. */
  folders: FolderNode[];
  /** Notes that live at the workspace root (no folder). */
  notes: NoteNode[];
};

export type BuildTreeOptions = {
  folders: NoteFolderRecord[];
  notes: NoteRecord[];
  expandedFolderIds: ReadonlySet<string>;
  /** Optional case-insensitive substring match against folder name + note title. */
  searchQuery?: string;
  /**
   * Phase 6.6 — When set, only notes whose `tags[]` contains this
   * lowercased path survive. Combines with `searchQuery` via AND. Folders
   * with no surviving descendant notes are pruned, so an empty filter
   * result reads as "no matches" rather than the full tree.
   */
  activeTagFilter?: string | null | undefined;
};

/** Lowercased trim used by the search filter. Exported so callers can
 *  reuse the same normalisation when computing match-count chips. */
export function normalizeSearch(value: string | undefined): string {
  if (!value) return "";
  return value.trim().toLowerCase();
}

function folderMatches(folder: NoteFolderRecord, q: string): boolean {
  if (q.length === 0) return true;
  return folder.name.toLowerCase().includes(q);
}

function noteMatches(note: NoteRecord, q: string): boolean {
  if (q.length === 0) return true;
  if (note.title.toLowerCase().includes(q)) return true;
  // Lightweight content match — full FTS lives in the command palette;
  // this gives the sidebar enough to find notes by body keyword without a
  // separate index round-trip.
  return note.content.toLowerCase().includes(q);
}

function noteMatchesTag(note: NoteRecord, tag: string | null | undefined): boolean {
  if (!tag) return true;
  return note.tags.includes(tag);
}

/**
 * Build the renderable tree for a single workspace.
 *
 * - Folders are grouped by `parentId`; orphans (parent missing) are surfaced
 *   under root so the user can still see and re-home them via DnD.
 * - Notes are grouped by `folderId`; folder-less notes go to root.
 * - Sort order: folders by `name` (locale-aware), notes by `title` (locale-aware).
 *   `name` ties broken by `id` so the order is fully deterministic.
 * - Search: a folder is kept only when itself matches OR any descendant
 *   (folder or note) matches; a note is kept only when itself matches.
 *   Matching folders auto-expand so the user sees the hits without clicking.
 */
export function buildNoteTree(opts: BuildTreeOptions): RootBucket {
  const q = normalizeSearch(opts.searchQuery);
  const tagFilter =
    opts.activeTagFilter && opts.activeTagFilter.length > 0
      ? opts.activeTagFilter.toLowerCase()
      : null;
  const searching = q.length > 0 || tagFilter !== null;

  // Index folders by parent for O(1) child lookup.
  const childrenByParent = new Map<string | null, NoteFolderRecord[]>();
  const folderById = new Map<string, NoteFolderRecord>();
  for (const f of opts.folders) {
    folderById.set(f.id, f);
  }
  for (const f of opts.folders) {
    // Treat orphan parents (id missing) as root so the folder stays visible.
    const effectiveParent =
      f.parentId !== null && folderById.has(f.parentId) ? f.parentId : null;
    const bucket = childrenByParent.get(effectiveParent);
    if (bucket) bucket.push(f);
    else childrenByParent.set(effectiveParent, [f]);
  }

  // Index notes by folder. Same orphan-to-root rescue as folders.
  const notesByFolder = new Map<string | null, NoteRecord[]>();
  for (const n of opts.notes) {
    const effectiveFolder =
      n.folderId !== null && folderById.has(n.folderId) ? n.folderId : null;
    const bucket = notesByFolder.get(effectiveFolder);
    if (bucket) bucket.push(n);
    else notesByFolder.set(effectiveFolder, [n]);
  }

  function buildFolder(folder: NoteFolderRecord, depth: number): FolderNode | null {
    const ownChildren = (childrenByParent.get(folder.id) ?? [])
      .slice()
      .sort(folderSort);
    const childNodes: FolderNode[] = [];
    for (const child of ownChildren) {
      const built = buildFolder(child, depth + 1);
      if (built) childNodes.push(built);
    }

    const ownNotes = (notesByFolder.get(folder.id) ?? [])
      .slice()
      .sort(noteSort)
      .filter((n) => noteMatches(n, q) && noteMatchesTag(n, tagFilter))
      .map((n) => buildNote(n, depth + 1));

    // Tag-only matches don't let a folder pass on its name — a folder
    // can't carry a tag, so keeping it would surface an empty branch.
    const selfMatches = folderMatches(folder, q) && tagFilter === null;
    const hasMatchingChild = childNodes.length > 0 || ownNotes.length > 0;
    if (searching && !selfMatches && !hasMatchingChild) return null;

    // When searching, force-expand to surface hits. Otherwise honour prefs.
    const expanded = searching
      ? true
      : opts.expandedFolderIds.has(folder.id);

    return {
      kind: "folder",
      id: folder.id,
      name: folder.name,
      parentId: folder.parentId,
      path: folder.path,
      depth,
      expanded,
      children: childNodes,
      notes: ownNotes,
    };
  }

  function buildNote(note: NoteRecord, depth: number): NoteNode {
    return {
      kind: "note",
      id: note.id,
      title: note.title,
      folderId: note.folderId,
      depth,
      updatedAt: note.updatedAt,
    };
  }

  const rootFolders = (childrenByParent.get(null) ?? [])
    .slice()
    .sort(folderSort);
  const builtRoot: FolderNode[] = [];
  for (const f of rootFolders) {
    const built = buildFolder(f, 0);
    if (built) builtRoot.push(built);
  }
  const rootNotes = (notesByFolder.get(null) ?? [])
    .slice()
    .sort(noteSort)
    .filter((n) => noteMatches(n, q) && noteMatchesTag(n, tagFilter))
    .map((n) => buildNote(n, 0));

  return { folders: builtRoot, notes: rootNotes };
}

function folderSort(a: NoteFolderRecord, b: NoteFolderRecord): number {
  const cmp = a.name.localeCompare(b.name);
  if (cmp !== 0) return cmp;
  return a.id.localeCompare(b.id);
}

function noteSort(a: NoteRecord, b: NoteRecord): number {
  const cmp = a.title.localeCompare(b.title);
  if (cmp !== 0) return cmp;
  return a.id.localeCompare(b.id);
}

/** True when the bucket has nothing to render (used to swap in EmptyState). */
export function isTreeEmpty(bucket: RootBucket): boolean {
  return bucket.folders.length === 0 && bucket.notes.length === 0;
}

// ---------------------------------------------------------------------------
// DnD payload helpers
//
// Browsers serialise dataTransfer to plain strings, and only the MIME type
// survives the round trip cleanly across drop targets. We use a custom MIME
// per payload kind so the drop handler can reject mismatched drags (a folder
// dragged into one of its own descendants, an unrelated browser drag) early.
// `text/plain` carries a human-readable label as a fallback for accessibility
// tools and for cross-tab drags where the custom MIME isn't honoured.

export const DND_MIME_NOTE = "application/x-tme-note";
export const DND_MIME_FOLDER = "application/x-tme-folder";

export type DragPayload =
  | { kind: "note"; id: string }
  | { kind: "folder"; id: string };

/** Encode a payload onto a DataTransfer object. Caller still controls effectAllowed. */
export function setDragPayload(dt: DataTransfer, payload: DragPayload): void {
  if (payload.kind === "note") {
    dt.setData(DND_MIME_NOTE, payload.id);
    dt.setData("text/plain", `note:${payload.id}`);
  } else {
    dt.setData(DND_MIME_FOLDER, payload.id);
    dt.setData("text/plain", `folder:${payload.id}`);
  }
}

/** Read whichever payload is present, or `null` if this drag isn't ours. */
export function readDragPayload(dt: DataTransfer): DragPayload | null {
  const noteId = dt.getData(DND_MIME_NOTE);
  if (noteId) return { kind: "note", id: noteId };
  const folderId = dt.getData(DND_MIME_FOLDER);
  if (folderId) return { kind: "folder", id: folderId };
  // Fallback: parse text/plain so we can still recognise our own drags when
  // a stricter drop target stripped the custom MIME (some Linux WMs do this).
  const text = dt.getData("text/plain");
  if (text.startsWith("note:")) return { kind: "note", id: text.slice(5) };
  if (text.startsWith("folder:")) return { kind: "folder", id: text.slice(7) };
  return null;
}

/**
 * True when dropping the payload onto `targetFolderId` (null = root) would
 * be a no-op or form a cycle. The tree build never gives us full descendant
 * sets here, so the caller passes a `descendantsOf(folderId)` lookup that
 * captures the heavy work in one place.
 */
export function isDropForbidden(
  payload: DragPayload,
  targetFolderId: string | null,
  current: { folderIdOfNote?: string | null; parentIdOfFolder?: string | null },
  descendantsOfFolder: (id: string) => ReadonlySet<string>,
): boolean {
  if (payload.kind === "note") {
    // Same-folder drop is a no-op; let the caller short-circuit before
    // touching Dexie. Returning `true` here surfaces the same UX as forbidden
    // (no insertion line) — desirable so the user doesn't think a no-op move
    // succeeded when nothing changed.
    const cur = current.folderIdOfNote ?? null;
    return cur === targetFolderId;
  }
  // Folder payload.
  if (payload.id === targetFolderId) return true; // can't drop a folder onto itself
  const curParent = current.parentIdOfFolder ?? null;
  if (curParent === targetFolderId) return true; // already there
  if (targetFolderId === null) return false;
  // Forbid moving a folder into one of its own descendants — that would form
  // a cycle that the repo's `moveNoteFolder` already short-circuits, but we
  // hide the drop indicator anyway so the user gets early feedback.
  return descendantsOfFolder(payload.id).has(targetFolderId);
}
