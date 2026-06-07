/**
 * Phase 6.8 — Note outline (heading nav) builder.
 *
 * Pure function. Walks the markdown line-by-line and pulls out ATX
 * headings (`# Heading`, `## Subheading`, … up to 6 levels). Setext
 * headings (`=====` / `-----` underlines) are ignored — they're rare in
 * the wild for note vaults and skipping them keeps this O(lines).
 *
 * Skips heading-looking text that sits inside fenced code blocks (``` /
 * ~~~), where a `#` is a comment, not a heading marker.
 *
 * Returns line numbers as 1-based to match CM6 `Text.line(n)` semantics —
 * the editor route can dispatch a `scrollIntoView` selection directly
 * without re-deriving offsets.
 */

export type NoteOutlineItem = {
  /** ATX level 1..6 (matches the `#` count). */
  level: 1 | 2 | 3 | 4 | 5 | 6;
  /** Heading text with leading `#` markers and trailing whitespace trimmed. */
  text: string;
  /** 1-based line number — feeds CM6 `state.doc.line(n).from`. */
  line: number;
};

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const FENCE_RE = /^\s{0,3}(```+|~~~+)/;

export function buildNoteOutline(content: string): NoteOutlineItem[] {
  if (!content) return [];
  const lines = content.split(/\r?\n/);
  const result: NoteOutlineItem[] = [];
  let inFence = false;
  let fenceChar: "`" | "~" | null = null;

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i] ?? "";
    const fence = FENCE_RE.exec(raw);
    if (fence) {
      const marker = (fence[1] ?? "")[0] as "`" | "~";
      if (!inFence) {
        inFence = true;
        fenceChar = marker;
      } else if (fenceChar === marker) {
        inFence = false;
        fenceChar = null;
      }
      continue;
    }
    if (inFence) continue;
    const match = HEADING_RE.exec(raw);
    if (!match) continue;
    const hashes = match[1] ?? "";
    const text = (match[2] ?? "").trim();
    if (text.length === 0) continue;
    const level = hashes.length as 1 | 2 | 3 | 4 | 5 | 6;
    result.push({ level, text, line: i + 1 });
  }
  return result;
}
