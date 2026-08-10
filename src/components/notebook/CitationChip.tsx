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
//
// Article Analysis adds two verification tones. A model asked for a verbatim
// quote can paraphrase or invent one, so the chip must show whether the quote
// was actually found in the source: `approx` (anchored but reflowed) and
// `unverified` (not found — model prose, not paper text).
export type CitationTone = "default" | "note" | "approx" | "unverified";

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
  // Active + inactive palettes are pre-mixed per tone so the render stays
  // branchless. Emerald mirrors the embed button + Sources-page "from note"
  // badge; warn mirrors the analysis "weakest link" callout so an unverifiable
  // quote reads as a caution everywhere it appears.
  const BASE =
    "mx-0.5 inline-flex items-baseline gap-0.5 rounded-[6px] border px-1.5 py-px font-mono text-[10.5px] uppercase tracking-[0.04em]";
  const HOVER =
    "transition-all duration-150 hover:-translate-y-px hover:shadow-[var(--shadow-soft)]";
  const PALETTE: Record<CitationTone, { active: string; inactive: string }> = {
    default: {
      active: `${BASE} border-accent-soft bg-accent-wash text-accent-ink ${HOVER} hover:border-accent`,
      inactive: `${BASE} border-rule bg-paper-2 text-ink-4 cursor-not-allowed`,
    },
    note: {
      active: `${BASE} border-emerald-500/40 bg-emerald-500/10 text-emerald-700 ${HOVER} hover:border-emerald-500`,
      inactive: `${BASE} border-rule bg-paper-2 text-emerald-700/50 cursor-not-allowed`,
    },
    approx: {
      active: `${BASE} border-dashed border-accent-soft bg-accent-wash/50 text-accent-ink ${HOVER} hover:border-accent`,
      inactive: `${BASE} border-dashed border-rule bg-paper-2 text-ink-4 cursor-not-allowed`,
    },
    unverified: {
      active: `${BASE} border-dashed border-warn/40 bg-warn/10 text-warn ${HOVER} hover:border-warn`,
      inactive: `${BASE} border-dashed border-warn/30 bg-warn/5 text-warn/70 cursor-not-allowed`,
    },
  };
  const palette = PALETTE[tone];
  const marker =
    tone === "unverified" ? "?" : tone === "approx" ? "≈" : "§";
  return (
    <button
      type="button"
      onClick={active ? onActivate : undefined}
      disabled={!active}
      title={active ? (isNote ? `note · ${ref}` : `${marker}${ref}`) : undefined}
      data-citation-ref={ref}
      data-citation-tone={tone}
      className={active ? palette.active : palette.inactive}
    >
      {isNote ? (
        <NotebookPen className="h-2.5 w-2.5" aria-hidden />
      ) : (
        <span aria-hidden>{marker}</span>
      )}
      <span className="normal-case tracking-normal">{ref}</span>
    </button>
  );
}
