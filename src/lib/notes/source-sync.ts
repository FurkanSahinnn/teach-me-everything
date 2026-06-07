/**
 * Phase 6.9 — Notes-as-Source sync detection (pure).
 *
 * Pulls together the three primitives the editor-toolbar button (6.9.4) and
 * embed worker (6.9.2) need to derive their state without each owning its
 * own hashing or pricing logic:
 *
 *   • `computeNoteHash(content)` — sha256 of the markdown content via
 *     `crypto.subtle.digest`. Used for both the SourceRecord-level
 *     `lastEmbeddedContentHash` (note-level snapshot) and individual chunk
 *     hashes when 6.9.2 wires up the per-chunk content-hash-cache.
 *
 *   • `getNoteSourceState(note, source, currentHash)` — the only decision
 *     function the button needs: maps the (note, linkedSource, freshHash)
 *     triple to `"idle" | "synced" | "dirty"`. Conservative on incomplete
 *     inputs (no current hash → dirty) so the UI never shows ✓ Embedded
 *     while the comparison is still pending.
 *
 *   • `estimateEmbedCost(content, pricePerMillionTokensUsd)` — token-count
 *     × per-million pricing. We use a coarse char-to-token approximation
 *     (≈4 chars per token, conservative round-up) instead of pulling in a
 *     real tokenizer dependency. Goal is a hover-tooltip "≈ $0.02" preview,
 *     not a precise quote — the actual usage figure comes back from the
 *     embed provider response and rolls into the cost chip.
 *
 * Pure module. No Dexie, no React, no fetch. Callers thread the
 * dependencies in.
 */

import type { NoteRecord, SourceRecord } from "@/lib/db/types";

/**
 * State machine the editor toolbar button (6.9.4) reads via a live query.
 * Two transient states (`embedding`, `error`) are handled in the React
 * component locally; this pure module reports only the persisted-state
 * derivation.
 */
export type NoteSourceState = "idle" | "synced" | "dirty";

/**
 * Toolbar-button visible state. The three stable states (`idle`, `synced`,
 * `dirty`) are derived from `getNoteSourceState`; the two transient states
 * (`embedding`, `error`) are owned by the React component and override the
 * derived value while a network call is in flight or a recent failure is
 * still surfaced. Kept here so the pure derivation + tests live next to
 * the persistence layer.
 */
export type ButtonState = NoteSourceState | "embedding" | "error";

/**
 * Pure state derivation for `EmbedAsSourceButton`. The component owns
 * `transient` (null when no in-flight action, otherwise `"embedding"` or
 * `"error"`); this function reports what to render. Encapsulated as a
 * pure fn so the matrix of (source, hash, transient) → state stays
 * test-covered without component-level harness.
 */
export function deriveButtonState(input: {
  source: SourceRecord | null | undefined;
  currentHash: string | undefined;
  transient: "embedding" | "error" | null;
}): ButtonState {
  if (input.transient) return input.transient;
  // `useNoteSource` returns `undefined` while the live query is still
  // resolving on first render. Treat that the same as `null` (no source
  // → idle) — the moment the row lands, the live-query re-fires.
  const sourceForState =
    input.source === null || input.source === undefined
      ? undefined
      : input.source;
  return getNoteSourceState(
    { id: "" },
    sourceForState,
    input.currentHash,
  );
}

/**
 * sha256 hex of the markdown content. Used for both the note-level
 * `lastEmbeddedContentHash` snapshot (toolbar-button state) and the
 * per-chunk hashes the embed worker writes into Dexie (chunk-cache reuse).
 *
 * The Web Crypto SubtleCrypto API is available in the browser context the
 * note vault runs in (CodeMirror editor in a top-level page), in Web
 * Workers (where the embed pipeline executes), and under happy-dom for the
 * Vitest harness. We deliberately don't fall back to a JS hashing library
 * because the existing crypto/backup code paths already require SubtleCrypto
 * — keeping one hashing primitive is simpler than introducing a second.
 */
export async function computeNoteHash(content: string): Promise<string> {
  const bytes = new TextEncoder().encode(content);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return bytesToHex(new Uint8Array(digest));
}

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) {
    out += b.toString(16).padStart(2, "0");
  }
  return out;
}

/**
 * Map the (note, linkedSource, currentHash) triple to a `NoteSourceState`.
 *
 *   • No source row → `"idle"` — the note has never been embedded. Button
 *     renders ✨ Embed as source.
 *
 *   • Source exists but `currentHash === undefined` → `"dirty"`. The hash
 *     compute is still pending; we conservatively show the sync action so
 *     a user mid-edit doesn't see ✓ Embedded against a stale snapshot.
 *
 *   • Hashes match → `"synced"`. Button shows ✓ Embedded.
 *
 *   • Hashes diverge → `"dirty"`. Button flips to ⚠ Sync embedding.
 *
 * Tolerates `note` being narrower than `NoteRecord` so callers can pass
 * partial projections (the function only reads `note` for typing
 * convenience — current behavior doesn't depend on note fields).
 *
 * `source` is matched by its `noteId` upstream (via `getNoteSourceByNoteId`
 * in `db/sources.ts`); this function does not re-check the link.
 */
export function getNoteSourceState(
  _note: Pick<NoteRecord, "id">,
  source: SourceRecord | undefined,
  currentHash: string | undefined,
): NoteSourceState {
  if (!source) return "idle";
  if (currentHash === undefined) return "dirty";
  return source.lastEmbeddedContentHash === currentHash ? "synced" : "dirty";
}

/**
 * Coarse cost estimate for embedding the given content. Used by the
 * toolbar-button hover tooltip ("≈ $0.02 (456 tokens)") and the
 * auto-sync cost guard (6.9.5 skips when this exceeds
 * `prefs.cost.autoEmbedCap`).
 *
 * Approximations:
 *   • 1 token ≈ 4 characters (OpenAI tokenizer typical for English/Latin
 *     scripts). Turkish + Cyrillic + CJK tokenize denser; this function is
 *     deliberately a *lower bound*, not a precise quote.
 *   • Cost = (tokens / 1_000_000) × `pricePerMillionTokensUsd`. Matches the
 *     unit `pricing.ts` exposes for embed models (`input` field).
 *
 * Returns 0 for empty content and clamps negative prices to 0 so a misread
 * pricing row never produces a negative estimate.
 */
export function estimateEmbedCost(
  content: string,
  pricePerMillionTokensUsd: number,
): number {
  if (content.length === 0) return 0;
  if (pricePerMillionTokensUsd <= 0) return 0;
  const tokens = estimateTokenCount(content);
  return (tokens / 1_000_000) * pricePerMillionTokensUsd;
}

/**
 * Char-based token estimate. ~4 chars per token for English; we round up so
 * the estimate is conservative (slight overestimate beats sticker shock).
 */
export function estimateTokenCount(content: string): number {
  if (content.length === 0) return 0;
  return Math.ceil(content.length / 4);
}
