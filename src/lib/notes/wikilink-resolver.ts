/**
 * Phase 6.5 — Wikilink resolver + suggestion builder.
 *
 * Pure module. Takes a workspace's notes / sources / concepts as plain data
 * (caller does the Dexie reads via `useLiveQuery`) and produces either:
 *
 *   1. `resolveWikilink(ref, lookups)` → `{ kind, id, exists, label }`
 *      Used when the user clicks a `[[wikilink]]` chip so the parent route
 *      can navigate or surface a "create new" prompt for misses.
 *
 *   2. `buildWikilinkSuggestions(query, lookups, limit)` → `Suggestion[]`
 *      Used by the CM6 autocomplete extension when the user types `[[`.
 *      Ranks by exact > prefix > substring match, then by recency for
 *      notes (lookups pre-sort by updatedAt desc).
 *
 * Phase 7 (Tauri) prep: lookup data is structural, not Dexie-coupled. The
 * file-system swap will replace `noteByTitle: Map<string, …>` with a
 * `noteByPath` keyed off the filesystem path, but the resolver shape stays.
 */

import type { WikilinkKind, WikilinkRef } from "@/lib/db/types";

export type WikilinkResolution = {
  kind: WikilinkKind;
  /** Entity id when resolved; `null` when no match. */
  id: string | null;
  /** True when `id` points at an actual entity in the workspace. */
  exists: boolean;
  /**
   * Display label: alias (when the wikilink had `|`), otherwise the
   * canonical title/name of the resolved entity, otherwise the raw target.
   */
  label: string;
  /** Raw target verbatim from the wikilink (e.g. `"abc"` for `[[source:abc]]`). */
  target: string;
  /** Alias when present, else `null`. */
  alias: string | null;
};

export type NoteLookupEntry = { id: string; title: string };
export type SourceLookupEntry = { id: string; title: string };
export type ConceptLookupEntry = { id: string; name: string };

export type WikilinkLookups = {
  /** Notes keyed by `title` (case-insensitive). Caller dedupes by recency. */
  noteByTitle: Map<string, NoteLookupEntry>;
  /** Sources keyed by id. */
  sourceById: Map<string, SourceLookupEntry>;
  /** Concepts keyed by id. */
  conceptById: Map<string, ConceptLookupEntry>;
  /** Same notes flattened for prefix/substring scoring. */
  noteIndex: ReadonlyArray<NoteLookupEntry>;
  /** Same sources flattened for prefix/substring scoring. */
  sourceIndex: ReadonlyArray<SourceLookupEntry>;
  /** Same concepts flattened for prefix/substring scoring. */
  conceptIndex: ReadonlyArray<ConceptLookupEntry>;
};

export type BuildLookupsInput = {
  notes: ReadonlyArray<{ id: string; title: string; updatedAt?: number }>;
  sources: ReadonlyArray<{ id: string; title: string; updatedAt?: number }>;
  concepts: ReadonlyArray<{ id: string; name: string; updatedAt?: number }>;
};

/**
 * Build immutable lookup maps + flat indexes from raw workspace entities.
 * Notes are de-duplicated by lowercased title — when two notes share a
 * title, the one with the larger `updatedAt` wins (matches the "rename
 * sweep last-write" semantics).
 */
export function buildWikilinkLookups(input: BuildLookupsInput): WikilinkLookups {
  // Sort notes desc by updatedAt so the first Map.set per title wins.
  const sortedNotes = [...input.notes].sort(
    (a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0),
  );
  const noteByTitle = new Map<string, NoteLookupEntry>();
  const dedupedNotes: NoteLookupEntry[] = [];
  for (const n of sortedNotes) {
    const key = n.title.toLowerCase();
    if (key.length === 0) continue;
    if (noteByTitle.has(key)) continue;
    const entry: NoteLookupEntry = { id: n.id, title: n.title };
    noteByTitle.set(key, entry);
    dedupedNotes.push(entry);
  }

  const sourceById = new Map<string, SourceLookupEntry>();
  for (const s of input.sources) {
    sourceById.set(s.id, { id: s.id, title: s.title });
  }

  const conceptById = new Map<string, ConceptLookupEntry>();
  for (const c of input.concepts) {
    conceptById.set(c.id, { id: c.id, name: c.name });
  }

  return {
    noteByTitle,
    sourceById,
    conceptById,
    noteIndex: dedupedNotes,
    sourceIndex: input.sources.map((s) => ({ id: s.id, title: s.title })),
    conceptIndex: input.concepts.map((c) => ({ id: c.id, name: c.name })),
  };
}

/**
 * Resolve a wikilink ref against the lookup maps. Returns `exists: false`
 * with `id: null` when the target can't be found — the caller decides
 * whether to surface a "create new" prompt (notes) or a no-op tooltip
 * (sources / concepts, which can't be created from inside an editor).
 */
export function resolveWikilink(
  ref: WikilinkRef,
  lookups: WikilinkLookups,
): WikilinkResolution {
  const base: Omit<WikilinkResolution, "id" | "exists" | "label"> = {
    kind: ref.kind,
    target: ref.target,
    alias: ref.alias ?? null,
  };

  if (ref.kind === "source") {
    const hit = lookups.sourceById.get(ref.target);
    return {
      ...base,
      id: hit ? hit.id : null,
      exists: hit !== undefined,
      label: ref.alias ?? hit?.title ?? ref.target,
    };
  }

  if (ref.kind === "concept") {
    const hit = lookups.conceptById.get(ref.target);
    return {
      ...base,
      id: hit ? hit.id : null,
      exists: hit !== undefined,
      label: ref.alias ?? hit?.name ?? ref.target,
    };
  }

  // Notes: case-insensitive title match.
  const key = ref.target.toLowerCase();
  const hit = lookups.noteByTitle.get(key);
  return {
    ...base,
    id: hit ? hit.id : null,
    exists: hit !== undefined,
    label: ref.alias ?? hit?.title ?? ref.target,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Autocomplete suggestions

export type WikilinkSuggestion = {
  /** Entity id (for sources/concepts) or note id. */
  id: string;
  kind: WikilinkKind;
  /**
   * What to insert between `[[ ]]`. For notes this is the title; for
   * sources/concepts it's the prefixed form (`source:abc`, `concept:xyz`)
   * so the resolver round-trips unchanged on next read.
   */
  insertText: string;
  /** Human-readable label shown in the dropdown row. */
  label: string;
  /** Secondary line (kind hint or path). */
  detail: string;
  /** Internal score for unit tests + deterministic ordering. */
  score: number;
};

const SCORE_EXACT = 1000;
const SCORE_PREFIX = 500;
const SCORE_WORD_PREFIX = 250;
const SCORE_SUBSTRING = 100;
const SCORE_NONE = 0;

function scoreMatch(haystack: string, needle: string): number {
  if (needle.length === 0) return SCORE_PREFIX; // empty query lists all, prefix-priority
  const h = haystack.toLowerCase();
  const n = needle.toLowerCase();
  if (h === n) return SCORE_EXACT;
  if (h.startsWith(n)) return SCORE_PREFIX;
  // Word-boundary prefix: "Reading Notes" matches "not" at word start.
  if (/(?:^|[\s\-_/])/.test(h)) {
    const parts = h.split(/[\s\-_/]+/);
    for (const p of parts) {
      if (p.startsWith(n) && p.length > 0) return SCORE_WORD_PREFIX;
    }
  }
  if (h.includes(n)) return SCORE_SUBSTRING;
  return SCORE_NONE;
}

/**
 * Build a ranked list of suggestions for a typed query. `query` is the
 * text the user has typed *after* `[[` — it may be empty (full list) or
 * include a kind prefix like `source:foo` (filters to that kind).
 *
 * Returned in descending-score order; ties broken by label (locale sort).
 * Pass `limit` to cap the dropdown (default 20).
 */
export function buildWikilinkSuggestions(
  query: string,
  lookups: WikilinkLookups,
  limit = 20,
): WikilinkSuggestion[] {
  const { kind, rest } = splitKindPrefix(query);

  const out: WikilinkSuggestion[] = [];

  if (kind === null || kind === "note") {
    for (const n of lookups.noteIndex) {
      const s = scoreMatch(n.title, rest);
      if (s === SCORE_NONE && rest.length > 0) continue;
      out.push({
        id: n.id,
        kind: "note",
        insertText: n.title,
        label: n.title,
        detail: "note",
        score: s + (kind === null ? 5 : 0), // tiny boost: ungrouped query prefers notes
      });
    }
  }

  if (kind === null || kind === "source") {
    for (const s of lookups.sourceIndex) {
      // Match both title (what the user sees) and id (what they type).
      const titleScore = scoreMatch(s.title, rest);
      const idScore = scoreMatch(s.id, rest);
      const best = Math.max(titleScore, idScore);
      if (best === SCORE_NONE && rest.length > 0) continue;
      out.push({
        id: s.id,
        kind: "source",
        insertText: `source:${s.id}`,
        label: s.title,
        detail: `source · ${s.id.slice(0, 8)}`,
        score: best,
      });
    }
  }

  if (kind === null || kind === "concept") {
    for (const c of lookups.conceptIndex) {
      const nameScore = scoreMatch(c.name, rest);
      const idScore = scoreMatch(c.id, rest);
      const best = Math.max(nameScore, idScore);
      if (best === SCORE_NONE && rest.length > 0) continue;
      out.push({
        id: c.id,
        kind: "concept",
        insertText: `concept:${c.id}`,
        label: c.name,
        detail: `concept · ${c.id.slice(0, 8)}`,
        score: best,
      });
    }
  }

  out.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.label.localeCompare(b.label);
  });

  return out.slice(0, Math.max(0, limit));
}

function splitKindPrefix(query: string): {
  kind: WikilinkKind | null;
  rest: string;
} {
  const colonIdx = query.indexOf(":");
  if (colonIdx === -1) return { kind: null, rest: query };
  const prefix = query.slice(0, colonIdx).toLowerCase();
  const rest = query.slice(colonIdx + 1);
  if (prefix === "note" || prefix === "source" || prefix === "concept") {
    return { kind: prefix as WikilinkKind, rest };
  }
  return { kind: null, rest: query };
}
