// Workspace Chat — per-block token budgets.
//
// Each toggled context block is hard-capped so the union of grounding blocks
// can't blow the input window or balloon cost. Sources keep the large
// `cache_control: ephemeral` breakpoint (handled by the prompt builder, not
// here); these caps cover only the prose blocks the `lib/ai/context/*`
// builders produce. Numbers are deliberately small — these blocks summarize
// learning state, they are not full-document dumps.

import type { ContextBlock } from "./types";

// Approx 4 chars per token (matches the heuristic used across the repo for
// pre-flight budgeting; never sent to the model as a real count). One place
// so `clampToBudget` and any caller agree on the conversion.
const CHARS_PER_TOKEN = 4;

export type ContextKind = ContextBlock["kind"];

// Per-kind caps in tokens. Notes get the most headroom (free-form prose
// excerpts); the structured blocks (concepts/roadmap/performance) are denser
// per token so they stay tighter.
export const CONTEXT_TOKEN_BUDGETS: Record<ContextKind, number> = {
  notes: 1500,
  concepts: 1000,
  roadmap: 800,
  performance: 800,
};

// Convert a token budget into a character budget using the shared heuristic.
export function tokensToChars(maxTokens: number): number {
  return Math.max(0, Math.floor(maxTokens * CHARS_PER_TOKEN));
}

// Trim `text` so its approximate token count fits within `maxTokens`. Cuts on
// the last whitespace before the limit when possible so a word isn't sliced in
// half, then appends a single ellipsis to signal truncation. Pure — never
// mutates input, deterministic for a given (text, maxTokens) pair.
export function clampToBudget(text: string, maxTokens: number): string {
  if (maxTokens <= 0) return "";
  const maxChars = tokensToChars(maxTokens);
  if (text.length <= maxChars) return text;
  const hardCut = text.slice(0, maxChars);
  // Prefer cutting at a whitespace boundary, but only if that boundary is
  // reasonably close to the cap (>= 60% of it) so a long unbroken token
  // doesn't collapse the whole block to almost nothing.
  const lastSpace = hardCut.lastIndexOf(" ");
  const lastNewline = hardCut.lastIndexOf("\n");
  const boundary = Math.max(lastSpace, lastNewline);
  const cut =
    boundary >= Math.floor(maxChars * 0.6)
      ? hardCut.slice(0, boundary)
      : hardCut;
  return `${cut.trimEnd()}…`;
}
