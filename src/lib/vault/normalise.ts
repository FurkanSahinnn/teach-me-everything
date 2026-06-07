// Phase 7.4.A — content normalisation primitives.
//
// Why: round-trip integrity. A note written from Dexie ends as LF-only
// UTF-8 without BOM. An external editor (VS Code on Windows, Notepad,
// some Markdown apps) may add a UTF-8 BOM or CRLF line endings, which
// would otherwise cause the read-back content hash to differ from the
// stored hash even though the visible text is identical. Normalising on
// read collapses these into the canonical form used at write time, so
// hash equality means semantic equality.
//
// How to apply: any sync code that compares disk content to Dexie content
// must hash through `normalizeForRead` (in hash.ts) — never raw bytes.

export const BOM = "﻿";

export function stripBom(s: string): string {
  if (s.length === 0) return s;
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

export function crlfToLf(s: string): string {
  // Replace \r\n first to avoid double-counting the embedded \n. A lone
  // \r (legacy classic-Mac or torn-write edge case) collapses to \n on
  // the second pass.
  return s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function normalizeForRead(s: string): string {
  return crlfToLf(stripBom(s));
}
