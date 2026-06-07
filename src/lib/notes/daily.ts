// Daily Notes (Phase 6.7). Locale-aware date / template helpers plus the
// find-or-create entry point that the sidebar "Bugünün notu" button calls.
// Pure helpers (date / template / highlight-extract) are exported so the
// Settings preview pane can render them without touching Dexie.

import { createNote } from "@/lib/db/notes";
import { createNoteFolder } from "@/lib/db/note-folders";
import { db } from "@/lib/db/schema";
import type { NoteRecord } from "@/lib/db/types";

export type DailyLocale = "tr" | "en";

const TR_FOLDER = "Günlük";
const EN_FOLDER = "Daily";

// Default templates. {{date}} expands to the rendered date string in the
// user's locale; {{locale}} expands to "tr" / "en". Plain markdown — the H1
// drives the note title, which in turn drives the file path slug. Keep the
// `Daily-` prefix on the H1 so a calendar export trivially groups by it.
const TR_TEMPLATE = "# Daily-{{date}}\n\n## Bugün öğrendiklerim\n\n";
const EN_TEMPLATE = "# Daily-{{date}}\n\n## What I learned today\n\n";

export function getDefaultDailyFolderName(locale: DailyLocale): string {
  return locale === "tr" ? TR_FOLDER : EN_FOLDER;
}

export function getDefaultDailyTemplate(locale: DailyLocale): string {
  return locale === "tr" ? TR_TEMPLATE : EN_TEMPLATE;
}

// Format a Date into the user's locale-specific calendar string. TR follows
// the regional `DD-MM-YYYY` convention; EN uses ISO `YYYY-MM-DD` so daily
// notes sort lexicographically by name in any file explorer. Local time is
// used (not UTC) so "today" matches the wall clock the user is reading off.
export function formatDateForLocale(date: Date, locale: DailyLocale): string {
  const yyyy = date.getFullYear().toString().padStart(4, "0");
  const mm = (date.getMonth() + 1).toString().padStart(2, "0");
  const dd = date.getDate().toString().padStart(2, "0");
  return locale === "tr" ? `${dd}-${mm}-${yyyy}` : `${yyyy}-${mm}-${dd}`;
}

// Substitute `{{date}}` and `{{locale}}` (whitespace-tolerant) tokens. Unknown
// tokens pass through untouched so a user pasting their own template doesn't
// get their `{{custom}}` markers stripped.
export function renderDailyTemplate(
  template: string,
  ctx: { dateString: string; locale: DailyLocale },
): string {
  return template
    .replace(/\{\{\s*date\s*\}\}/g, ctx.dateString)
    .replace(/\{\{\s*locale\s*\}\}/g, ctx.locale);
}

// Title used for the daily note's H1 and (by extension) its filename slug.
// The repo's `slugifySegment` keeps the dashes intact, so `Daily-15-05-2026`
// round-trips into `Daily-15-05-2026.md`.
export function buildDailyTitle(dateString: string): string {
  return `Daily-${dateString}`;
}

// Highlight → Note (Phase 6.7 "Not olarak çıkar" button). The title is the
// excerpt's first 80 chars on a single line (filename-safe — see slugify in
// the notes repo); the body quotes every line of the original excerpt and
// links back to the originating source via `[[source:{id}]]` so the new note
// is reachable from the backlinks panel.
export function buildHighlightExtractContent(input: {
  excerpt: string;
  sourceId: string;
  fallbackTitle?: string;
}): string {
  const oneLine = input.excerpt.replace(/\s+/g, " ").trim();
  const fallback = input.fallbackTitle ?? "Highlight";
  const title =
    oneLine.length === 0
      ? fallback
      : oneLine.length > 80
        ? `${oneLine.slice(0, 80).replace(/\s+$/u, "")}…`
        : oneLine;
  const quoted =
    input.excerpt.trim().length === 0
      ? "> "
      : input.excerpt
          .split(/\r?\n/)
          .map((line) => `> ${line}`)
          .join("\n");
  return `# ${title}\n\n${quoted}\n\nSource: [[source:${input.sourceId}]]\n`;
}

// Find-or-create the daily note for `dateString` under `folderName`. If the
// folder doesn't exist yet it is created at the workspace root. Idempotent:
// calling twice on the same day returns the same note and `created=false`.
// `folderName.trim() === ""` puts the daily note at the vault root.
export async function findOrCreateDailyNote(input: {
  workspaceId: string;
  folderName: string;
  dateString: string;
  template: string;
  locale: DailyLocale;
}): Promise<{ note: NoteRecord; created: boolean }> {
  const title = buildDailyTitle(input.dateString);
  const slug = `${title}.md`;
  const trimmedFolder = input.folderName.trim();

  // Root-level daily note. No folder lookup needed.
  if (trimmedFolder.length === 0) {
    const existing = await db.notes
      .where("[workspaceId+path]")
      .equals([input.workspaceId, slug])
      .first();
    if (existing) return { note: existing, created: false };
    const content = renderDailyTemplate(input.template, {
      dateString: input.dateString,
      locale: input.locale,
    });
    const note = await createNote({
      workspaceId: input.workspaceId,
      content,
      title,
    });
    return { note, created: true };
  }

  // Ensure folder exists. Folder path === folder name when parent is root,
  // which is how the Daily/ folder always sits — `[workspaceId+path]` is the
  // index that backs the lookup.
  let folder = await db.noteFolders
    .where("[workspaceId+path]")
    .equals([input.workspaceId, trimmedFolder])
    .first();
  if (!folder) {
    folder = await createNoteFolder({
      workspaceId: input.workspaceId,
      parentId: null,
      name: trimmedFolder,
    });
  }

  const fullPath = `${folder.path}/${slug}`;
  const existing = await db.notes
    .where("[workspaceId+path]")
    .equals([input.workspaceId, fullPath])
    .first();
  if (existing) return { note: existing, created: false };

  const content = renderDailyTemplate(input.template, {
    dateString: input.dateString,
    locale: input.locale,
  });
  const note = await createNote({
    workspaceId: input.workspaceId,
    folderId: folder.id,
    content,
    title,
  });
  return { note, created: true };
}
