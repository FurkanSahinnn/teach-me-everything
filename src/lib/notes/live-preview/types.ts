/**
 * Phase 6.3 — Shared types for the live-preview widget pipeline.
 *
 * Every widget module pushes `DecoSpec[]` into a single buffer that the
 * top-level ViewPlugin sorts and converts to a `DecorationSet`. Keeping the
 * shape uniform lets the pipeline stay decoupled — modules don't need to
 * know about each other or about CM6 `RangeSetBuilder` ordering rules.
 */

import type { Decoration } from "@codemirror/view";

export type DecoSpec = {
  from: number;
  to: number;
  deco: Decoration;
};

export type WikilinkClickDetail = {
  raw: string;
  target: string;
  kind: "note" | "source" | "concept";
  alias: string | null;
};

export type CheckboxToggleDetail = {
  /** 0-based position of the `[` in `[ ]` / `[x]`. */
  from: number;
  /** Position of the `]` (inclusive end is `to`). */
  to: number;
  /** New state to write into the document. */
  checked: boolean;
};

export type TagClickDetail = {
  /** Raw `#tag` text including the leading hash. */
  raw: string;
  /** Lowercased tag value without the leading `#` (matches `extractTags`). */
  tag: string;
};

export const TME_EVENT = {
  wikilinkClick: "tme-wikilink-click",
  checkboxToggle: "tme-checkbox-toggle",
  sourceModeChange: "tme-source-mode",
  tagClick: "tme-tag-click",
} as const;
