// Phase 10.A — Model-fetch adapter registry + dispatcher. Mirrors the
// `web-search/adapter.ts` shape: registry is `Partial<Record<ProviderId>>`,
// dispatcher returns null when a preset isn't supported, and a `list`
// helper enumerates every adapter for tests / settings.
//
// Perplexity intentionally has no entry — they don't publish a public
// `/models` endpoint; the picker falls back to the static preset.

import type { ProviderId } from "../types";
import { ANTHROPIC_MODEL_FETCH_ADAPTER } from "./anthropic";
import { CEREBRAS_MODEL_FETCH_ADAPTER } from "./cerebras";
import { DEEPSEEK_MODEL_FETCH_ADAPTER } from "./deepseek";
import { GEMINI_MODEL_FETCH_ADAPTER } from "./gemini";
import { GLM_MODEL_FETCH_ADAPTER } from "./glm";
import { GROQ_MODEL_FETCH_ADAPTER } from "./groq";
import { LLAMA_CPP_MODEL_FETCH_ADAPTER } from "./llama-cpp";
import { LM_STUDIO_MODEL_FETCH_ADAPTER } from "./lm-studio";
import { MISTRAL_MODEL_FETCH_ADAPTER } from "./mistral";
import { OLLAMA_MODEL_FETCH_ADAPTER } from "./ollama";
import {
  OPENAI_MODEL_FETCH_ADAPTER,
  OPENAI_RESPONSES_MODEL_FETCH_ADAPTER,
} from "./openai";
import { OPENROUTER_MODEL_FETCH_ADAPTER } from "./openrouter";
import { TOGETHER_MODEL_FETCH_ADAPTER } from "./together";
import type { ModelFetchAdapter } from "./types";
import { XAI_MODEL_FETCH_ADAPTER } from "./xai";

const ADAPTERS = {
  anthropic: ANTHROPIC_MODEL_FETCH_ADAPTER,
  openai: OPENAI_MODEL_FETCH_ADAPTER,
  "openai-responses": OPENAI_RESPONSES_MODEL_FETCH_ADAPTER,
  "google-gemini": GEMINI_MODEL_FETCH_ADAPTER,
  openrouter: OPENROUTER_MODEL_FETCH_ADAPTER,
  groq: GROQ_MODEL_FETCH_ADAPTER,
  deepseek: DEEPSEEK_MODEL_FETCH_ADAPTER,
  glm: GLM_MODEL_FETCH_ADAPTER,
  xai: XAI_MODEL_FETCH_ADAPTER,
  mistral: MISTRAL_MODEL_FETCH_ADAPTER,
  together: TOGETHER_MODEL_FETCH_ADAPTER,
  cerebras: CEREBRAS_MODEL_FETCH_ADAPTER,
  ollama: OLLAMA_MODEL_FETCH_ADAPTER,
  "lm-studio": LM_STUDIO_MODEL_FETCH_ADAPTER,
  "llama-cpp": LLAMA_CPP_MODEL_FETCH_ADAPTER,
  // perplexity intentionally omitted — no /models catalog endpoint
} as const satisfies Partial<Record<ProviderId, ModelFetchAdapter>>;

export type ModelFetchProviderId = keyof typeof ADAPTERS;

/** Returns the adapter for a provider preset, or null when unsupported. */
export function getModelFetchAdapter(presetId: ProviderId): ModelFetchAdapter | null {
  if (typeof presetId !== "string") return null;
  if (presetId.startsWith("custom:")) return null;
  const adapter = (ADAPTERS as Record<string, ModelFetchAdapter | undefined>)[presetId];
  return adapter ?? null;
}

/** Enumerate every registered fetch adapter. Tests + admin tools use this. */
export function listModelFetchAdapters(): ModelFetchAdapter[] {
  return Object.values(ADAPTERS);
}

/** True iff the preset has a registered model-fetch adapter. */
export function supportsModelFetch(presetId: ProviderId): boolean {
  return getModelFetchAdapter(presetId) !== null;
}
