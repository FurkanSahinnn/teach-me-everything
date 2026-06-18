// Workspace Chat — Notlar context builder.
//
// Summarizes the workspace's most recently edited notes (title + a short body
// excerpt + tags) into a single token-budgeted block. Reads the live Dexie
// vault via the notes repo; never throws on an empty workspace (returns null
// so the runner simply omits the block). Pure aside from the single repo read.

import { listNotesByWorkspace } from "@/lib/db/notes";
import type { NoteRecord } from "@/lib/db/types";
import { CONTEXT_TOKEN_BUDGETS, clampToBudget } from "./budget";
import type { ContextBlock } from "./types";

// How many notes to surface and how long each excerpt may be before the
// overall block budget trims the tail. Newest-first so the chat reflects what
// the user has been working on most recently.
const MAX_NOTES = 12;
const EXCERPT_CHARS = 320;

// Strip the leading markdown H1 (it usually duplicates the note title) plus
// heading hashes / list bullets, collapse whitespace, and hard-cap length so a
// single note can't dominate the block.
function excerpt(note: NoteRecord): string {
  let body = note.content;
  // Drop a leading "# Title" line if it matches the derived title — avoids
  // echoing the title twice in the same entry.
  body = body.replace(/^\s*#\s+.*(?:\r?\n|$)/, "");
  const collapsed = body
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^[-*]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
  return collapsed.slice(0, EXCERPT_CHARS);
}

export async function buildNotesContext(
  workspaceId: string,
): Promise<ContextBlock | null> {
  const notes = await listNotesByWorkspace(workspaceId);
  if (notes.length === 0) return null;

  const lines: string[] = [
    "User's notes in this workspace (most recently edited first):",
  ];
  for (const note of notes.slice(0, MAX_NOTES)) {
    const title = note.title.trim() || "Untitled";
    const tags =
      note.tags.length > 0
        ? ` [tags: ${note.tags.map((t) => `#${t}`).join(" ")}]`
        : "";
    const body = excerpt(note);
    lines.push(body.length > 0 ? `- ${title}${tags}: ${body}` : `- ${title}${tags}`);
  }

  const text = clampToBudget(lines.join("\n"), CONTEXT_TOKEN_BUDGETS.notes);
  if (text.trim().length === 0) return null;
  return { kind: "notes", text };
}
