// Phase 7.3 — One-way export orchestrator. Walks a workspace's notes +
// folders and writes them as `.md` files under the chosen vault root.
//
// Failure model: per-file errors are captured in the result's `errors`
// array but DO NOT abort the export — a single note hitting EPERM
// shouldn't lose the rest of the vault. The first error surfaces in the
// UI as a toast; the full list is available via the result for a future
// "show details" panel.

import { listFoldersByWorkspace } from "@/lib/db/note-folders";
import { listNotesByWorkspace } from "@/lib/db/notes";
import type { NoteFolderRecord, NoteRecord } from "@/lib/db/types";
import { mkdirRecursive, writeTextFile } from "./fs-adapter";
import { buildNoteAbsolutePath } from "./note-path";
import { joinPath, splitFolderPath } from "./paths";
import { resolveNoteFolderPath, serializeNote } from "./serialize";

export type ExportProgress = {
  total: number;
  done: number;
  currentTitle: string;
};

export type ExportFileError = {
  noteId: string;
  noteTitle: string;
  message: string;
};

export type ExportVaultResult = {
  notesWritten: number;
  foldersCreated: number;
  errors: ExportFileError[];
  durationMs: number;
};

export type ExportVaultOptions = {
  workspaceId: string;
  vaultRoot: string;
  onProgress?: (p: ExportProgress) => void;
  /** Test seam — override the folder + note loaders. */
  loaders?: {
    folders: (workspaceId: string) => Promise<NoteFolderRecord[]>;
    notes: (workspaceId: string) => Promise<NoteRecord[]>;
  };
};

/**
 * Export every note in `workspaceId` as a `.md` file under `vaultRoot`.
 * Folders are mkdir'd as we walk them; daily notes route to a fixed
 * `Daily/` folder regardless of the in-Dexie folder name.
 */
export async function exportVault(
  opts: ExportVaultOptions,
): Promise<ExportVaultResult> {
  const start = Date.now();
  const loaders = opts.loaders ?? {
    folders: listFoldersByWorkspace,
    notes: listNotesByWorkspace,
  };

  const [folders, notes] = await Promise.all([
    loaders.folders(opts.workspaceId),
    loaders.notes(opts.workspaceId),
  ]);

  const foldersById = new Map(folders.map((f) => [f.id, f]));

  // Compute the set of folder paths we'll write into so we can mkdir each
  // exactly once. Daily/ always appears if any note routes there.
  const folderPaths = new Set<string>();
  for (const note of notes) {
    const folderPath = resolveNoteFolderPath(note, foldersById);
    if (folderPath.length > 0) folderPaths.add(folderPath);
  }

  let foldersCreated = 0;
  // mkdir root first (idempotent inside the adapter), then each folder
  // path under it. We split on `/` and walk each level so a deep
  // `Parent/Child/Grandchild` path materialises every intermediate.
  await mkdirRecursive(opts.vaultRoot);
  for (const folderPath of folderPaths) {
    const segments = splitFolderPath(folderPath);
    let cursor = opts.vaultRoot;
    for (const seg of segments) {
      cursor = joinPath(cursor, seg);
      await mkdirRecursive(cursor);
      foldersCreated += 1;
    }
  }

  const errors: ExportFileError[] = [];
  let notesWritten = 0;

  for (let i = 0; i < notes.length; i++) {
    const note = notes[i];
    if (!note) continue;
    opts.onProgress?.({
      total: notes.length,
      done: i,
      currentTitle: note.title,
    });

    const { absPath: fullPath } = buildNoteAbsolutePath({
      note,
      foldersById,
      vaultRoot: opts.vaultRoot,
    });
    const body = serializeNote(note);

    try {
      await writeTextFile(fullPath, body);
      notesWritten += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push({ noteId: note.id, noteTitle: note.title, message });
    }
  }

  opts.onProgress?.({
    total: notes.length,
    done: notes.length,
    currentTitle: "",
  });

  return {
    notesWritten,
    foldersCreated,
    errors,
    durationMs: Date.now() - start,
  };
}
