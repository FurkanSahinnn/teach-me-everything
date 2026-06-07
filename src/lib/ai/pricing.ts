import type {
  WebSearchCapability,
  WebSearchUsage,
} from "./web-search/types";

// Pricing snapshot · provider invoice'u source of truth
// AI pricing table — USD per 1M tokens, broken down by request shape.
//
// Numbers reflect public Anthropic / OpenAI list pricing as of the snapshot
// date below and are only used to *estimate* user-visible cost. The provider's
// invoice is the source of truth. We never call out to a billing API.
//
// Periodic sync: bump `PRICING_SNAPSHOT_DATE` (and any changed entries) when
// you re-verify cloud prices. The pricing-freshness test fails CI once the
// snapshot is older than `PRICING_FRESHNESS_DAYS_MAX` days, so the cadence
// is enforced rather than aspirational. See `docs/PROVIDERS.md` § 5.
export const PRICING_SNAPSHOT_DATE = "2026-04-29";
export const PRICING_FRESHNESS_DAYS_MAX = 90;

export function pricingSnapshotAgeDays(now: Date = new Date()): number {
  const snap = new Date(`${PRICING_SNAPSHOT_DATE}T00:00:00Z`);
  const ms = now.getTime() - snap.getTime();
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

export function isPricingSnapshotStale(now: Date = new Date()): boolean {
  return pricingSnapshotAgeDays(now) > PRICING_FRESHNESS_DAYS_MAX;
}

export interface ModelPricing {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
}

// Anthropic published prompt-caching reads at 10% of input and writes at
// 1.25x input. Embedding models bill input only.
export const PRICING: Record<string, ModelPricing> = {
  "claude-opus-4-7": {
    input: 15,
    output: 75,
    cacheRead: 1.5,
    cacheCreation: 18.75,
  },
  "claude-sonnet-4-6": {
    input: 3,
    output: 15,
    cacheRead: 0.3,
    cacheCreation: 3.75,
  },
  "claude-haiku-4-5-20251001": {
    input: 0.8,
    output: 4,
    cacheRead: 0.08,
    cacheCreation: 1.0,
  },
  // Undated alias — Anthropic accepts both forms; the alias auto-tracks the
  // latest haiku-4-5 build. UI catalog + default modelBindings use the alias
  // so users see "Claude Haiku 4.5" without a confusing date suffix.
  "claude-haiku-4-5": {
    input: 0.8,
    output: 4,
    cacheRead: 0.08,
    cacheCreation: 1.0,
  },
  "text-embedding-3-small": {
    input: 0.02,
    output: 0,
    cacheRead: 0,
    cacheCreation: 0,
  },

  // OpenAI chat
  "gpt-5-mini": { input: 0.25, output: 2.0, cacheRead: 0, cacheCreation: 0 },
  "gpt-5-nano": { input: 0.05, output: 0.4, cacheRead: 0, cacheCreation: 0 },
  "gpt-5": { input: 1.25, output: 10.0, cacheRead: 0, cacheCreation: 0 },
  "o3-mini": { input: 1.1, output: 4.4, cacheRead: 0, cacheCreation: 0 },
  o3: { input: 2.0, output: 8.0, cacheRead: 0, cacheCreation: 0 },
  // OpenAI legacy (still widely used)
  "gpt-4o": { input: 2.5, output: 10.0, cacheRead: 0, cacheCreation: 0 },
  "gpt-4o-mini": { input: 0.15, output: 0.6, cacheRead: 0, cacheCreation: 0 },
  "gpt-4-turbo": { input: 10.0, output: 30.0, cacheRead: 0, cacheCreation: 0 },

  // OpenAI embed
  "text-embedding-3-large": { input: 0.13, output: 0, cacheRead: 0, cacheCreation: 0 },

  // Google Gemini chat — current lineup (2026-06). Gemini 3.x; 2.5 kept for
  // existing user bindings (deprecated, shutdown 2026-10-16). Free-tier keys
  // bill $0; placeholders here are overridden by the dynamic model fetch.
  "gemini-3.1-pro-preview": { input: 1.25, output: 10.0, cacheRead: 0, cacheCreation: 0 },
  "gemini-3.5-flash": { input: 0.3, output: 2.5, cacheRead: 0, cacheCreation: 0 },
  "gemini-3.1-flash-lite": { input: 0.075, output: 0.3, cacheRead: 0, cacheCreation: 0 },
  "gemini-2.5-pro": { input: 1.25, output: 10.0, cacheRead: 0, cacheCreation: 0 },
  "gemini-2.5-flash": { input: 0.0, output: 0.0, cacheRead: 0, cacheCreation: 0 },
  "gemini-2.5-flash-lite": { input: 0.0, output: 0.0, cacheRead: 0, cacheCreation: 0 },

  // Google embed — gemini-embedding-2 is the current GA model; the older two
  // are kept for pricing lookups on existing chunks (004 retired, 001 deprecated).
  "gemini-embedding-2": { input: 0.0, output: 0, cacheRead: 0, cacheCreation: 0 },
  "text-embedding-004": { input: 0.0, output: 0, cacheRead: 0, cacheCreation: 0 },
  "gemini-embedding-001": { input: 0.0, output: 0, cacheRead: 0, cacheCreation: 0 },

  // OpenRouter (aggregator — :free models ücretsiz)
  "deepseek/deepseek-r1:free": { input: 0.0, output: 0.0, cacheRead: 0, cacheCreation: 0 },
  "qwen/qwen3-235b:free": { input: 0.0, output: 0.0, cacheRead: 0, cacheCreation: 0 },
  "meta-llama/llama-3.3-70b:free": { input: 0.0, output: 0.0, cacheRead: 0, cacheCreation: 0 },
  "google/gemini-2.0-flash-exp:free": { input: 0.0, output: 0.0, cacheRead: 0, cacheCreation: 0 },
  "mistralai/mistral-small-3.2-24b-instruct:free": { input: 0.0, output: 0.0, cacheRead: 0, cacheCreation: 0 },
  // OpenRouter passthrough (price ~ matches direct provider)
  "anthropic/claude-sonnet-4.5": { input: 3.0, output: 15.0, cacheRead: 0, cacheCreation: 0 },
  "openai/gpt-5": { input: 1.25, output: 10.0, cacheRead: 0, cacheCreation: 0 },
  "x-ai/grok-4": { input: 5.0, output: 15.0, cacheRead: 0, cacheCreation: 0 },
  // GLM via OpenRouter
  "z-ai/glm-4.5-air:free": { input: 0.0, output: 0.0, cacheRead: 0, cacheCreation: 0 },
  "z-ai/glm-4.6": { input: 0.5, output: 1.5, cacheRead: 0, cacheCreation: 0 },
  "z-ai/glm-4.5": { input: 0.5, output: 1.5, cacheRead: 0, cacheCreation: 0 },
  "z-ai/glm-4.5v": { input: 0.5, output: 1.5, cacheRead: 0, cacheCreation: 0 },

  // Groq (free tier)
  "llama-3.3-70b-versatile": { input: 0.0, output: 0.0, cacheRead: 0, cacheCreation: 0 },
  "qwen-2.5-32b": { input: 0.0, output: 0.0, cacheRead: 0, cacheCreation: 0 },
  "deepseek-r1-distill-llama-70b": { input: 0.0, output: 0.0, cacheRead: 0, cacheCreation: 0 },
  "llama-3.1-8b-instant": { input: 0.0, output: 0.0, cacheRead: 0, cacheCreation: 0 },
  "mixtral-8x7b-32768": { input: 0.0, output: 0.0, cacheRead: 0, cacheCreation: 0 },
  "gemma2-9b-it": { input: 0.0, output: 0.0, cacheRead: 0, cacheCreation: 0 },

  // DeepSeek
  "deepseek-chat": { input: 0.27, output: 1.1, cacheRead: 0, cacheCreation: 0 },
  "deepseek-reasoner": { input: 0.55, output: 2.19, cacheRead: 0, cacheCreation: 0 },
  "deepseek-coder": { input: 0.14, output: 0.28, cacheRead: 0, cacheCreation: 0 },

  // GLM (Zhipu AI)
  "glm-4.6": { input: 0.5, output: 1.5, cacheRead: 0, cacheCreation: 0 },
  "glm-4-plus": { input: 0.5, output: 1.5, cacheRead: 0, cacheCreation: 0 },
  "glm-4-air": { input: 0.1, output: 0.3, cacheRead: 0, cacheCreation: 0 },
  "glm-4-flash": { input: 0.0, output: 0.0, cacheRead: 0, cacheCreation: 0 },
  "glm-4-long": { input: 0.5, output: 1.5, cacheRead: 0, cacheCreation: 0 },

  // xAI Grok
  "grok-4": { input: 5.0, output: 15.0, cacheRead: 0, cacheCreation: 0 },
  "grok-3": { input: 3.0, output: 15.0, cacheRead: 0, cacheCreation: 0 },
  "grok-3-mini": { input: 0.3, output: 0.5, cacheRead: 0, cacheCreation: 0 },
  "grok-2-vision-1212": { input: 2.0, output: 10.0, cacheRead: 0, cacheCreation: 0 },

  // Mistral
  "mistral-large-latest": { input: 2.0, output: 6.0, cacheRead: 0, cacheCreation: 0 },
  "mistral-medium-latest": { input: 2.7, output: 8.1, cacheRead: 0, cacheCreation: 0 },
  "mistral-small-latest": { input: 0.2, output: 0.6, cacheRead: 0, cacheCreation: 0 },
  "codestral-latest": { input: 0.2, output: 0.6, cacheRead: 0, cacheCreation: 0 },
  "ministral-3b": { input: 0.04, output: 0.04, cacheRead: 0, cacheCreation: 0 },
  "ministral-3b-latest": { input: 0.04, output: 0.04, cacheRead: 0, cacheCreation: 0 },
  "open-mistral-nemo": { input: 0.0, output: 0.0, cacheRead: 0, cacheCreation: 0 },
  "pixtral-large-latest": { input: 2.0, output: 6.0, cacheRead: 0, cacheCreation: 0 },

  // Together AI
  "meta-llama/Llama-3.3-70B-Instruct-Turbo": { input: 0.88, output: 0.88, cacheRead: 0, cacheCreation: 0 },
  "Qwen/Qwen2.5-72B-Instruct-Turbo": { input: 1.2, output: 1.2, cacheRead: 0, cacheCreation: 0 },
  "deepseek-ai/DeepSeek-V3": { input: 1.25, output: 1.25, cacheRead: 0, cacheCreation: 0 },
  "deepseek-ai/DeepSeek-R1": { input: 7.0, output: 7.0, cacheRead: 0, cacheCreation: 0 },
  "meta-llama/Llama-3.2-3B-Instruct-Turbo": { input: 0.06, output: 0.06, cacheRead: 0, cacheCreation: 0 },
  "mistralai/Mixtral-8x22B-Instruct-v0.1": { input: 1.2, output: 1.2, cacheRead: 0, cacheCreation: 0 },

  // Cerebras (free tier)
  "llama-3.3-70b": { input: 0.0, output: 0.0, cacheRead: 0, cacheCreation: 0 },
  "qwen-3-32b": { input: 0.0, output: 0.0, cacheRead: 0, cacheCreation: 0 },
  "llama-3.1-8b": { input: 0.0, output: 0.0, cacheRead: 0, cacheCreation: 0 },
  "llama-4-scout-17b-16e-instruct": { input: 0.0, output: 0.0, cacheRead: 0, cacheCreation: 0 },

  // Perplexity
  sonar: { input: 1.0, output: 1.0, cacheRead: 0, cacheCreation: 0 },
  "sonar-pro": { input: 3.0, output: 15.0, cacheRead: 0, cacheCreation: 0 },
  "sonar-reasoning": { input: 1.0, output: 5.0, cacheRead: 0, cacheCreation: 0 },
  "sonar-reasoning-pro": { input: 2.0, output: 8.0, cacheRead: 0, cacheCreation: 0 },
  "sonar-deep-research": { input: 2.0, output: 8.0, cacheRead: 0, cacheCreation: 0 },

  // Local / self-hosted (compute is the user's; dollar cost is zero)
  "ollama-default": { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
  "lm-studio-default": { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
  "llama-cpp-default": { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },

  // Voyage embed
  "voyage-3": { input: 0.06, output: 0, cacheRead: 0, cacheCreation: 0 },
  "voyage-3-large": { input: 0.18, output: 0, cacheRead: 0, cacheCreation: 0 },

  // Cohere embed
  "embed-multilingual-v3.0": { input: 0.1, output: 0, cacheRead: 0, cacheCreation: 0 },

  // Jina embed (free tier — rate limited)
  "jina-embeddings-v3": { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },

  // Mistral embed
  "mistral-embed": { input: 0.1, output: 0, cacheRead: 0, cacheCreation: 0 },

  // HuggingFace Inference embed (rate-limited free tier)
  "BAAI/bge-m3": { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
  "intfloat/multilingual-e5-large": { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },

  // Ollama embed (yerel; compute is the user's)
  "nomic-embed-text": { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
  "mxbai-embed-large": { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
  "bge-m3": { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
};

export interface UsageBreakdown {
  input_tokens?: number | undefined;
  output_tokens?: number | undefined;
  cache_read_input_tokens?: number | undefined;
  cache_creation_input_tokens?: number | undefined;
}

const PER_MILLION = 1_000_000;
const warned = new Set<string>();

// Returns USD cost for one request. Unknown models return 0 (with a one-shot
// console warning) so an undeployed model never inflates the user's number;
// the alternative — throwing — would break the chip the moment a user enabled
// a fresh model alias.
export function computeCostUsd(model: string, usage: UsageBreakdown): number {
  const price = PRICING[model];
  if (!price) {
    if (!warned.has(model)) {
      warned.add(model);
      // eslint-disable-next-line no-console
      console.warn(`[pricing] no entry for model "${model}" — counted as $0`);
    }
    return 0;
  }
  const input = usage.input_tokens ?? 0;
  const output = usage.output_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheCreation = usage.cache_creation_input_tokens ?? 0;
  const total =
    (input * price.input +
      output * price.output +
      cacheRead * price.cacheRead +
      cacheCreation * price.cacheCreation) /
    PER_MILLION;
  return total;
}

/**
 * USD cost for a single web-search-augmented chat turn. Providers price web
 * search separately from token usage — Claude bills per call, Perplexity
 * bundles into Sonar model cost (so capability is undefined), OpenAI
 * Responses + Gemini bill per result group, OpenRouter bills per Exa/
 * Parallel/Firecrawl backend. The capability registry (Phase 5.5.B) declares
 * the unit economics; this helper just multiplies through.
 *
 * Returns 0 for unknown / unsupported capabilities so the cost chip
 * gracefully reports "search cost: included" instead of forcing the caller
 * to special-case every undefined branch. Callers that want explicit
 * "unknown" semantics should check `capability` themselves before calling.
 */
export function computeWebSearchCostUsd(
  capability: WebSearchCapability | undefined,
  usage: WebSearchUsage,
): number {
  if (!capability) return 0;
  const calls = usage.calls ?? 0;
  const results = usage.results ?? 0;
  const perCall = capability.pricePerCall ?? 0;
  const perResult = capability.pricePerResult ?? 0;
  // Both factors may be 0 simultaneously (e.g. Perplexity, where search is
  // bundled into the model price). The multiplication still resolves to 0
  // — no early return needed.
  return calls * perCall + results * perResult;
}
