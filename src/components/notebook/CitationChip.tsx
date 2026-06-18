"use client";

import { NotebookPen } from "lucide-react";
import type { ChunkRecord } from "@/lib/db/types";

const CITATION_RE = /\[(?:Â§|§)([^\]]+)\]/g;

export type CitationToken =
  | { kind: "text"; text: string }
  | { kind: "citation"; ref: string; raw: string };

// Phase 6.9.7 — `tone` lets the caller flag a citation as originating from a
// user-authored note (Phase 6 vault). The chip swaps the § marker for a
// NotebookPen icon and the accent palette for the emerald embedded-source
// palette so the user can spot note citations at a glance without hovering.
export type CitationTone = "default" | "note";

export function parseCitations(content: string): CitationToken[] {
  if (!content) return [];
  const tokens: CitationToken[] = [];
  let last = 0;
  for (const match of content.matchAll(CITATION_RE)) {
    const idx = match.index ?? 0;
    if (idx > last) tokens.push({ kind: "text", text: content.slice(last, idx) });
    const ref = (match[1] ?? "").trim();
    tokens.push({ kind: "citation", ref, raw: match[0] });
    last = idx + match[0].length;
  }
  if (last < content.length) {
    tokens.push({ kind: "text", text: content.slice(last) });
  }
  return tokens;
}

function matchChunk(ref: string, chunks: ChunkRecord[]): ChunkRecord | null {
  const target = ref.trim().toLowerCase();
  if (!target) return null;

  for (const c of chunks) {
    if (c.section && c.section.trim().toLowerCase() === target) return c;
  }
  for (const c of chunks) {
    if (c.section && c.section.trim().toLowerCase().includes(target)) return c;
    if (
      c.headings &&
      c.headings.some((h) => h.trim().toLowerCase().includes(target))
    ) {
      return c;
    }
  }
  return null;
}

export function findChunkForRef(
  ref: string,
  chunks: ChunkRecord[],
): ChunkRecord | null {
  const direct = matchChunk(ref, chunks);
  if (direct) return direct;
  // The workspace chat emits multi-source citations as `[§<source-title> ·
  // <section>]`; the single-source reader emits a bare `[§<section>]`. When the
  // ref carries the ` · ` separator, retry with just the trailing section
  // segment so cross-source citations resolve (and the chip becomes clickable).
  const SEP = " · ";
  if (ref.includes(SEP)) {
    return matchChunk(ref.slice(ref.lastIndexOf(SEP) + SEP.length), chunks);
  }
  return null;
}

export function CitationChip({
  ref,
  active,
  onActivate,
  tone = "default",
}: {
  ref: string;
  active: boolean;
  onActivate: () => void;
  tone?: CitationTone;
}) {
  const isNote = tone === "note";
  // Active + inactive palettes are pre-mixed so the render stays branchless.
  // Emerald palette mirrors the embed button + Sources-page "from note"
  // badge so a user clicking through a thread sees the same visual hook.
  const activeClass = isNote
    ? "mx-0.5 inline-flex items-baseline gap-0.5 rounded-[6px] border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-px font-mono text-[10.5px] uppercase tracking-[0.04em] text-emerald-700 transition-all duration-150 hover:-translate-y-px hover:border-emerald-500 hover:shadow-[var(--shadow-soft)]"
    : "mx-0.5 inline-flex items-baseline gap-0.5 rounded-[6px] border border-accent-soft bg-accent-wash px-1.5 py-px font-mono text-[10.5px] uppercase tracking-[0.04em] text-accent-ink transition-all duration-150 hover:-translate-y-px hover:border-accent hover:shadow-[var(--shadow-soft)]";
  const inactiveClass = isNote
    ? "mx-0.5 inline-flex items-baseline gap-0.5 rounded-[6px] border border-rule bg-paper-2 px-1.5 py-px font-mono text-[10.5px] uppercase tracking-[0.04em] text-emerald-700/50 cursor-not-allowed"
    : "mx-0.5 inline-flex items-baseline gap-0.5 rounded-[6px] border border-rule bg-paper-2 px-1.5 py-px font-mono text-[10.5px] uppercase tracking-[0.04em] text-ink-4 cursor-not-allowed";
  return (
    <button
      type="button"
      onClick={active ? onActivate : undefined}
      disabled={!active}
      title={active ? (isNote ? `note · ${ref}` : `§${ref}`) : undefined}
      data-citation-ref={ref}
      data-citation-tone={tone}
      className={active ? activeClass : inactiveClass}
    >
      {isNote ? (
        <NotebookPen className="h-2.5 w-2.5" aria-hidden />
      ) : (
        <span aria-hidden>§</span>
      )}
      <span className="normal-case tracking-normal">{ref}</span>
    </button>
  );
}
