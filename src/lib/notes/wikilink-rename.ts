/**
 * Phase 6.5 — Rename-sweep for `[[Note Title]]` wikilinks.
 *
 * When a note's title changes (via the sidebar rename action) every other
 * note's `content` may still contain `[[old title]]`. This module:
 *
 *   • `renameWikilink(content, oldTitle, newTitle)` — pure string transform.
 *     Walks every `[[...]]` occurrence, rewrites the bare `[[old]]`,
 *     `[[old|alias]]` (alias preserved), but *not* `[[old:something]]` (kind
 *     prefix means it's a source/concept ref, not a note title).
 *     Code-block masking matches the parser so `` `[[old]]` `` is preserved.
 *
 *   • `renameNoteTitleWithSweep(noteId, newTitle)` — Dexie wrapper that
 *     runs the rename + sweep atomically (`rw`-transaction on `notes`).
 *     The renamed note's content also gets its H1 swapped so `extractTitle`
 *     keeps producing the new value; the sweep then touches every other
 *     note in the workspace whose `wikilinks` denormalised array contains
 *     the old title.
 */

import { db } from "@/lib/db/schema";
import type { NoteRecord } from "@/lib/db/types";
import { extractTags, extractTitle, extractWikilinks } from "@/lib/notes/parser";

const WIKILINK_RE = /(\\?)\[\[([^\]\n]+?)\]\](?!\])/g;

/**
 * Replace every `[[oldTitle]]` (with or without `|alias`) inside `content`
 * with `[[newTitle]]`. Comparison is case-insensitive on the target match
 * but the *output* uses the caller-provided `newTitle` verbatim so casing
 * stays under user control. Wikilinks with a kind prefix (`source:`,
 * `concept:`, `note:`) are never rewritten — only bare-target links count
 * as a "note title" reference. Escaped wikilinks (`\[[old]]`) and matches
 * inside fenced / inline code blocks are left alone.
 */
export function renameWikilink(
  content: string,
  oldTitle: string,
  newTitle: string,
): string {
  if (oldTitle.length === 0) return content;
  if (oldTitle === newTitle) return content;

  // Mask code regions so `` `[[old]]` `` and fenced blocks stay literal.
  // We rebuild the output piece-by-piece using the same indexes so the mask
  // is only for detection, never substitution.
  const codeMask = buildCodeMask(content);
  const oldLower = oldTitle.toLowerCase();

  let out = "";
  let lastIndex = 0;
  WIKILINK_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = WIKILINK_RE.exec(content)) !== null) {
    const matchStart = match.index;
    const raw = match[0];
    const escape = match[1] ?? "";
    const inner = match[2];
    if (inner === undefined) continue;

    // Always copy everything up to this match verbatim.
    out += content.slice(lastIndex, matchStart);
    lastIndex = matchStart + raw.length;

    // Escaped — leave verbatim.
    if (escape === "\\") {
      out += raw;
      continue;
    }
    // Inside a code span — leave verbatim.
    if (isInsideMask(codeMask, matchStart)) {
      out += raw;
      continue;
    }

    // Parse the inner. Honour the first `|` as alias separator.
    let target = inner;
    let alias: string | undefined;
    const pipeIdx = inner.indexOf("|");
    if (pipeIdx !== -1) {
      target = inner.slice(0, pipeIdx);
      alias = inner.slice(pipeIdx + 1);
    }
    const trimmedTarget = target.trim();
    // Kind-prefixed (source:abc / concept:xyz / note:abc) — not a title ref.
    if (/^(?:source|concept|note):/i.test(trimmedTarget)) {
      out += raw;
      continue;
    }
    // Title compare case-insensitive on the trimmed value.
    if (trimmedTarget.toLowerCase() !== oldLower) {
      out += raw;
      continue;
    }
    // Preserve leading / trailing whitespace inside the brackets so the
    // user's local styling doesn't get clobbered.
    const lead = target.slice(0, target.length - target.trimStart().length);
    const trail = target.slice(target.trimEnd().length);
    const rewrittenTarget = `${lead}${newTitle}${trail}`;
    if (alias !== undefined) {
      out += `[[${rewrittenTarget}|${alias}]]`;
    } else {
      out += `[[${rewrittenTarget}]]`;
    }
  }
  out += content.slice(lastIndex);
  return out;
}

/**
 * Mark byte ranges that fall inside fenced code blocks (``` ... ```) or
 * inline code spans (``` ` ` ```). Returned as a flat sorted array of
 * [from, to) tuples for O(log n) `isInsideMask` lookups.
 */
function buildCodeMask(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  // Fenced first (multi-line, no nesting).
  const fenced = /```[\s\S]*?```/g;
  let m: RegExpExecArray | null;
  while ((m = fenced.exec(text)) !== null) {
    ranges.push([m.index, m.index + m[0].length]);
  }
  // Inline (single + double backticks). Skip ranges inside fenced.
  const inline = /(`+)[^`\n]+?\1/g;
  while ((m = inline.exec(text)) !== null) {
    const start = m.index;
    if (ranges.some(([a, b]) => start >= a && start < b)) continue;
    ranges.push([start, start + m[0].length]);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  return ranges;
}

function isInsideMask(mask: Array<[number, number]>, idx: number): boolean {
  // Linear is fine — mask is short for typical notes; binary search later
  // if profiling shows it.
  for (const [a, b] of mask) {
    if (idx >= a && idx < b) return true;
    if (a > idx) return false;
  }
  return false;
}

/**
 * Rename a note's title and sweep every *other* note in the same workspace
 * whose denormalised `wikilinks` array carries the old title. The renamed
 * note itself gets its H1 swapped so `extractTitle` produces `newTitle`
 * on the next read. All writes happen inside a single Dexie `rw` txn so
 * a partial sweep can't leave dangling references on crash.
 *
 * Returns the count of notes whose content was rewritten (renamed note
 * not included).
 */
export async function renameNoteTitleWithSweep(
  noteId: string,
  newTitle: string,
): Promise<{ sweptCount: number; oldTitle: string }> {
  const trimmedNew = newTitle.trim();
  if (trimmedNew.length === 0) {
    throw new Error("renameNoteTitleWithSweep: newTitle must be non-empty");
  }

  return db.transaction(
    "rw",
    db.notes,
    db.noteFolders,
    db.sources,
    async () => {
      const target = await db.notes.get(noteId);
      if (!target) return { sweptCount: 0, oldTitle: "" };
      const oldTitle = target.title;
      if (oldTitle === trimmedNew) {
        return { sweptCount: 0, oldTitle };
      }

      // 1) Rewrite the renamed note's own H1 so extractTitle agrees.
      const swappedContent = swapH1(target.content, trimmedNew);
      await writeNoteProjection(target, { content: swappedContent });

      // 2) Sweep every other note that references the old title. The
      // `wikilinks` multiEntry index is CASE-SENSITIVE (.equals(oldTitle)),
      // but wikilink resolution is case-insensitive — so an index query
      // silently misses `[[quantum physics]]` when renaming "Quantum
      // Physics". Scan the workspace (bounded) and match on a lowercased
      // projection instead.
      const oldLower = oldTitle.toLowerCase();
      const candidates = await db.notes
        .where("workspaceId")
        .equals(target.workspaceId)
        .toArray();
      let sweptCount = 0;
      for (const row of candidates) {
        if (row.id === noteId) continue;
        if (!(row.wikilinks ?? []).some((w) => w.toLowerCase() === oldLower)) {
          continue;
        }
        const nextContent = renameWikilink(row.content, oldTitle, trimmedNew);
        if (nextContent === row.content) continue;
        await writeNoteProjection(row, { content: nextContent });
        sweptCount += 1;
      }

      // 3) Phase 6.9 — Notes-as-Source. If this note is embedded as a
      // source, keep the SourceRecord.title in sync with the note title so
      // the Sources page row, ChatBubble citations, and the composer
      // source-filter chip all show the updated label without a manual
      // resync. Done inside the same `rw` transaction so a crash can't
      // leave the source labeled with a stale title.
      const linkedSource = await db.sources
        .where("noteId")
        .equals(noteId)
        .first();
      if (linkedSource) {
        await db.sources.update(linkedSource.id, {
          title: trimmedNew,
          updatedAt: Date.now(),
        });
      }

      return { sweptCount, oldTitle };
    },
  );
}

/**
 * Replace the first ATX H1 line with a new title. Matches the
 * first-H1-anywhere semantics of `extractTitle` (it scans every line, not
 * just the document start) — anchoring to the very first line caused a
 * duplicate H1 whenever the note began with a non-H1 line. If no H1 exists
 * anywhere, prepend one so the document gains a canonical title.
 */
function swapH1(content: string, newTitle: string): string {
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line !== undefined && /^\s*#\s+/.test(line)) {
      lines[i] = `# ${newTitle}`;
      return lines.join("\n");
    }
  }
  // No H1 anywhere — prepend one. Use trim to avoid double-blank when content
  // already starts with a newline.
  const body = content.replace(/^\s+/, "");
  if (body.length === 0) return `# ${newTitle}\n`;
  return `# ${newTitle}\n\n${body}`;
}

/**
 * Re-project a note row (recompute title / tags / wikilinks / path) and
 * write it back. Stays inside the surrounding transaction. Kept private
 * here because the sweep needs to bypass the public `updateNote` (which
 * starts its own transaction and would deadlock when nested).
 */
async function writeNoteProjection(
  existing: NoteRecord,
  patch: { content: string },
): Promise<void> {
  const content = patch.content;
  const parsedTitle = extractTitle(content);
  const title = parsedTitle.length > 0 ? parsedTitle : existing.title;
  const tags = extractTags(content);
  const wikilinks = extractWikilinks(content).map((ref) => ref.target);
  // Path is folder-path-prefixed; recompute the slug segment off the new
  // title but keep folder lookup async-free (we're already inside a txn).
  const folder =
    existing.folderId === null
      ? null
      : await db.noteFolders.get(existing.folderId);
  const segment = `${slugifySegment(title)}.md`;
  const path = folder ? `${folder.path}/${segment}` : segment;
  await db.notes.update(existing.id, {
    content,
    title,
    tags,
    wikilinks,
    path,
    updatedAt: Date.now(),
  });
}

function slugifySegment(title: string): string {
  const trimmed = title.trim();
  if (trimmed.length === 0) return "untitled";
  return trimmed.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").slice(0, 200);
}
