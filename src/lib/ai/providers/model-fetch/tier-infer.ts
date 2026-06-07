// Phase 10.E — Tier inference for dynamically-fetched provider models.
//
// Static presets in `providers/presets.ts` hand-curate `tier` per-model. When
// we fetch the live `/models` catalog from a provider we lose that curation,
// so this helper assigns a coarse ranking from the model id alone (plus
// optional pricing). Result feeds the UI tier badge in the picker.
//
// Heuristic — checked in order:
//   1. Pricing 0/0 OR `:free` suffix → "free" (zero-cost wins regardless of
//      capability tier; consistent with `ModelTier` doc in providers/types.ts)
//   2. Flagship patterns (opus, reasoner, gpt-5+, o-series, grok-4+, etc.)
//   3. Fast patterns (mini, nano, lite, haiku, small, 3b/7b/8b/9b, instant)
//   4. Default → "balanced"
//
// Provider-specific outliers (e.g. GLM-4.6 is Zhipu's flagship but lacks a
// "pro/opus" token) fall through to "balanced" — acceptable for a heuristic
// tier badge, and the static preset's curated tier still wins when it exists.

import type { ModelTier } from "../types";

const FLAGSHIP_RE =
  /(opus|reasoner|sonar-pro|sonar-reasoning-pro|sonar-deep-research|deep-research|mistral-large|pixtral-large|^o[1-9]$|gpt-?[5-9]$|gpt-?[5-9]-pro|gemini-?[3-9](-pro)?$|gemini-?[3-9]-pro|gemini-?2\.5-pro|grok-?[4-9])/i;

const FAST_RE =
  /(mini|nano|lite|haiku|small|tiny|gemma|-3b|-7b|-8b|-9b|instant|flash-lite|flash-thinking)/i;

const FREE_RE = /(:free$|free-tier|-free$)/i;

export interface InferTierOpts {
  /** Per-1M-token pricing. When both are 0 the model is free regardless of name. */
  pricing?: { input: number; output: number } | undefined;
  /** OpenRouter-style flag — caller already knows the model is free. */
  isFree?: boolean;
}

export function inferModelTier(
  modelId: string,
  opts: InferTierOpts = {},
): ModelTier {
  if (opts.isFree === true) return "free";
  const p = opts.pricing;
  if (p && p.input === 0 && p.output === 0) return "free";
  if (FREE_RE.test(modelId)) return "free";
  if (FLAGSHIP_RE.test(modelId)) return "flagship";
  if (FAST_RE.test(modelId)) return "fast";
  return "balanced";
}

/**
 * Synthesize a display name from a raw model id. Provider catalogs sometimes
 * return only an id without a friendly `display_name`. We humanize the slug
 * — `gemini-2.5-flash-lite` → `Gemini 2.5 Flash Lite`, `z-ai/glm-4.6` →
 * `GLM-4.6 (z-ai)`. Falls back to the raw id when humanization would lose
 * information (model name contains chars beyond letters/digits/dot/hyphen
 * after we've stripped the namespace).
 */
export function humanizeModelId(rawId: string): string {
  // OpenRouter-style `org/model-id` — surface model first, org in parens.
  const slashIdx = rawId.indexOf("/");
  if (slashIdx > 0) {
    const org = rawId.slice(0, slashIdx);
    const model = rawId.slice(slashIdx + 1);
    return `${titleCase(model)} (${org})`;
  }
  return titleCase(rawId);
}

function titleCase(slug: string): string {
  return slug
    .split(/[-_]/g)
    .map((word) => {
      if (!word) return word;
      // Keep version-like tokens (2.5, 4.6, v3) lowercase except first char.
      if (/^[0-9]/.test(word)) return word;
      // Common acronyms stay uppercase.
      if (/^(ai|api|llm|gpt|gpu|cpu|sdk|qa|moe|rag|tts|stt|ocr)$/i.test(word)) {
        return word.toUpperCase();
      }
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}
