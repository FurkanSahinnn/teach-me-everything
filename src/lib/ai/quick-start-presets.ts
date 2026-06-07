import type { ApiKeyProvider } from "@/lib/db/schema";
import type { ModelBindings } from "@/stores/prefs";
import { encodeChatModelBinding } from "./model-options";

// Curated list shown as one-tap tiles in Setup Wizard Step 2 and Settings →
// Models → "Hızlı başlangıç". This is intentionally a tiny subset of the full
// PROVIDER_PRESETS — covers the most common 3 categories: free cloud (Gemini /
// Groq / OpenRouter), local-first (Ollama), and the canonical paid choice
// (Anthropic). Anything beyond these five lives in the full Settings picker.
//
// Why a separate file from PROVIDER_PRESETS: those entries are protocol-level
// (baseUrl / auth / capabilities), and importing them as quick-starts would
// drag the entire 15-preset table into the Setup Wizard bundle. This file is a
// thin metadata layer keyed by ProviderId, so the wizard can render tiles
// without loading any provider adapter code.

export type QuickStartPresetId =
  | "gemini"
  | "ollama"
  | "groq"
  | "anthropic"
  | "openrouter";

export type QuickStartPreset = {
  id: QuickStartPresetId;
  // Provider id this maps onto in the full registry — vault writes and
  // setModelBinding share this surface. Typed as `ApiKeyProvider` (not
  // `CloudProviderId`) because the value is fed into `keys.setDraft`, and
  // some chat-only ids like `openai-responses` don't have their own key
  // row — they share an existing slot (`openai`).
  providerId: ApiKeyProvider;
  label: string;
  // One-line value prop shown under the label in the tile. Bilingual TR/EN
  // strings live with i18n messages; keep this short and provider-agnostic.
  tagline: { tr: string; en: string };
  // External URL where the user gets an API key. Skipped for local-only
  // presets (`requiresKey: false`) since Ollama has no key concept.
  providerHomeUrl: string;
  // True for cloud providers (must collect a key); false for local servers
  // running on loopback. Drives whether DynamicKeyField renders the input.
  requiresKey: boolean;
  // True when the provider runs on the user's own machine — surfaces a
  // "private / no network" badge in the tile.
  isLocal: boolean;
  // True when the provider has a no-card free tier — surfaces a "free" badge.
  // Note: free !== requiresKey === false. Gemini is free but still needs a
  // key; Ollama is local AND free.
  freeTier: boolean;
  // Models to write into prefs.modelBindings when this preset is applied.
  // Partial because not every provider has an embed model — chat-only
  // providers (Groq / Anthropic / OpenRouter) leave embedPresetId untouched
  // so the user keeps whatever default they had.
  defaultBindings: Partial<ModelBindings>;
};

export const QUICK_START_PRESETS: QuickStartPreset[] = [
  {
    id: "gemini",
    providerId: "google-gemini",
    label: "Google Gemini",
    tagline: {
      tr: "Ücretsiz katman · sohbet + gömme",
      en: "Free tier · chat + embed",
    },
    providerHomeUrl: "https://aistudio.google.com/apikey",
    requiresKey: true,
    isLocal: false,
    freeTier: true,
    defaultBindings: {
      chat: encodeChatModelBinding("google-gemini", "gemini-2.5-flash"),
      summary: encodeChatModelBinding("google-gemini", "gemini-2.5-flash"),
      quick: encodeChatModelBinding("google-gemini", "gemini-2.5-flash"),
      embedPresetId: "gemini-004",
      flashcardGen: encodeChatModelBinding("google-gemini", "gemini-2.5-flash"),
    },
  },
  {
    id: "ollama",
    providerId: "ollama",
    label: "Ollama",
    tagline: {
      tr: "Tamamen yerel · ağa çıkmaz",
      en: "Fully local · no network",
    },
    // Setup instructions, not key issuance — Ollama has no API key concept.
    providerHomeUrl: "https://ollama.com/download",
    requiresKey: false,
    isLocal: true,
    freeTier: true,
    defaultBindings: {
      chat: encodeChatModelBinding("ollama", "qwen2.5:14b"),
      summary: encodeChatModelBinding("ollama", "qwen2.5:14b"),
      quick: encodeChatModelBinding("ollama", "qwen2.5:14b"),
      embedPresetId: "ollama-nomic",
      flashcardGen: encodeChatModelBinding("ollama", "qwen2.5:14b"),
    },
  },
  {
    id: "groq",
    providerId: "groq",
    label: "Groq",
    tagline: {
      tr: "Çok hızlı · ücretsiz katman",
      en: "Ultra-fast · free tier",
    },
    providerHomeUrl: "https://console.groq.com/keys",
    requiresKey: true,
    isLocal: false,
    freeTier: true,
    defaultBindings: {
      chat: encodeChatModelBinding("groq", "llama-3.3-70b-versatile"),
      summary: encodeChatModelBinding("groq", "llama-3.3-70b-versatile"),
      quick: encodeChatModelBinding("groq", "llama-3.3-70b-versatile"),
      flashcardGen: encodeChatModelBinding("groq", "llama-3.3-70b-versatile"),
    },
  },
  {
    id: "anthropic",
    providerId: "anthropic",
    label: "Anthropic",
    tagline: {
      tr: "Premium · Claude Sonnet + araçlar",
      en: "Premium · Claude Sonnet + tools",
    },
    providerHomeUrl: "https://console.anthropic.com/settings/keys",
    requiresKey: true,
    isLocal: false,
    freeTier: false,
    defaultBindings: {
      chat: encodeChatModelBinding("anthropic", "claude-sonnet-4-6"),
      summary: encodeChatModelBinding("anthropic", "claude-sonnet-4-6"),
      quick: encodeChatModelBinding("anthropic", "claude-haiku-4-5"),
      flashcardGen: encodeChatModelBinding("anthropic", "claude-sonnet-4-6"),
    },
  },
  {
    id: "openrouter",
    providerId: "openrouter",
    label: "OpenRouter",
    tagline: {
      tr: "Tek anahtarla 100+ model",
      en: "100+ models with one key",
    },
    providerHomeUrl: "https://openrouter.ai/keys",
    requiresKey: true,
    isLocal: false,
    freeTier: true,
    defaultBindings: {
      chat: encodeChatModelBinding("openrouter", "z-ai/glm-5"),
      summary: encodeChatModelBinding("openrouter", "z-ai/glm-5"),
      quick: encodeChatModelBinding("openrouter", "z-ai/glm-5"),
      flashcardGen: encodeChatModelBinding("openrouter", "z-ai/glm-5"),
    },
  },
];

export function getQuickStartPreset(
  id: QuickStartPresetId,
): QuickStartPreset | undefined {
  return QUICK_START_PRESETS.find((p) => p.id === id);
}
