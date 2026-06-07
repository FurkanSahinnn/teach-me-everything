import type { ProviderAuth } from "./types";

// Embed presets registered separately from chat presets because dimensions
// and pricing differ per family and we need a stable id space for prefs +
// pricing lookups. Adapter implementations land in 3.3.B; this file is the
// metadata-only registry the registry/UI/proxy layers can read against.

export type EmbedPresetId =
  | "openai-3-small"
  | "openai-3-large"
  | "openrouter-3-small"
  | "openrouter-3-large"
  | "voyage-3"
  | "voyage-3-large"
  | "gemini-embed-2"
  | "gemini-004"
  | "gemini-001"
  | "cohere-multilingual"
  | "jina-v3"
  | "mistral-embed"
  | "hf-bge-m3"
  | "hf-e5-multilingual"
  | "ollama-nomic"
  | "ollama-mxbai"
  | "ollama-bge-m3";

export type EmbedFamily =
  | "openai-compat"
  | "voyage"
  | "gemini"
  | "cohere"
  | "jina"
  | "huggingface";

export type EmbedPreset = {
  id: EmbedPresetId;
  label: string;
  family: EmbedFamily;
  baseUrl: string;
  auth: ProviderAuth;
  // The exact model identifier the upstream API expects. Pricing keys on
  // this string, so changing it cascades to PRICING entries.
  model: string;
  // matryoshka models (Jina v3) expose multiple valid output sizes; all
  // others fix a single dim.
  dim: number | number[];
  freeTier: boolean;
  // True when the baseUrl points at a loopback / LAN address — the proxy
  // bypass branches off this in 3.3.C/F.
  isLocal?: boolean;
  // Provider has retired/deprecated this model. Hidden from the picker (new
  // selections) but still resolvable via getEmbedPreset so existing users'
  // stored bindings keep working until they switch + reembed.
  deprecated?: boolean;
  docsUrl: string;
};

export const EMBED_PRESETS: Record<EmbedPresetId, EmbedPreset> = {
  "openai-3-small": {
    id: "openai-3-small",
    label: "OpenAI text-embedding-3-small",
    family: "openai-compat",
    baseUrl: "https://api.openai.com/v1",
    auth: { kind: "bearer" },
    model: "text-embedding-3-small",
    dim: 1536,
    freeTier: false,
    docsUrl: "https://platform.openai.com/docs/guides/embeddings",
  },
  "openai-3-large": {
    id: "openai-3-large",
    label: "OpenAI text-embedding-3-large",
    family: "openai-compat",
    baseUrl: "https://api.openai.com/v1",
    auth: { kind: "bearer" },
    model: "text-embedding-3-large",
    dim: 3072,
    freeTier: false,
    docsUrl: "https://platform.openai.com/docs/guides/embeddings",
  },
  "openrouter-3-small": {
    id: "openrouter-3-small",
    label: "OpenRouter · text-embedding-3-small",
    family: "openai-compat",
    baseUrl: "https://openrouter.ai/api/v1",
    auth: { kind: "bearer" },
    model: "openai/text-embedding-3-small",
    dim: 1536,
    freeTier: false,
    docsUrl: "https://openrouter.ai/docs/api/reference/embeddings",
  },
  "openrouter-3-large": {
    id: "openrouter-3-large",
    label: "OpenRouter · text-embedding-3-large",
    family: "openai-compat",
    baseUrl: "https://openrouter.ai/api/v1",
    auth: { kind: "bearer" },
    model: "openai/text-embedding-3-large",
    dim: 3072,
    freeTier: false,
    docsUrl: "https://openrouter.ai/docs/api/reference/embeddings",
  },
  "voyage-3": {
    id: "voyage-3",
    label: "Voyage voyage-3",
    family: "voyage",
    baseUrl: "https://api.voyageai.com/v1",
    auth: { kind: "bearer" },
    model: "voyage-3",
    dim: 1024,
    freeTier: false,
    docsUrl: "https://docs.voyageai.com/docs/embeddings",
  },
  "voyage-3-large": {
    id: "voyage-3-large",
    label: "Voyage voyage-3-large",
    family: "voyage",
    baseUrl: "https://api.voyageai.com/v1",
    auth: { kind: "bearer" },
    model: "voyage-3-large",
    dim: 2048,
    freeTier: false,
    docsUrl: "https://docs.voyageai.com/docs/embeddings",
  },
  "gemini-embed-2": {
    id: "gemini-embed-2",
    label: "Gemini gemini-embedding-2",
    family: "gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    auth: { kind: "header", headerName: "x-goog-api-key" },
    model: "gemini-embedding-2",
    // MRL: default 3072 (recommended 768/1536/3072), auto-renormalised.
    dim: 3072,
    freeTier: true,
    docsUrl: "https://ai.google.dev/gemini-api/docs/embeddings",
  },
  // RETIRED 2026-01-14 — requests now 404. Kept only so an existing binding
  // resolves to *something*; migrated to gemini-embed-2 in prefs (v22).
  "gemini-004": {
    id: "gemini-004",
    label: "Gemini text-embedding-004 (retired)",
    family: "gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    auth: { kind: "header", headerName: "x-goog-api-key" },
    model: "text-embedding-004",
    dim: 768,
    freeTier: true,
    deprecated: true,
    docsUrl: "https://ai.google.dev/gemini-api/docs/embeddings",
  },
  // DEPRECATED (shutdown 2026-07-14) — still works; hidden from new picks.
  // Its vector space is INCOMPATIBLE with gemini-embedding-2, so we do NOT
  // auto-migrate existing users (would silently corrupt retrieval) — they
  // keep it until they switch + reembed.
  "gemini-001": {
    id: "gemini-001",
    label: "Gemini gemini-embedding-001 (deprecated)",
    family: "gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    auth: { kind: "header", headerName: "x-goog-api-key" },
    model: "gemini-embedding-001",
    dim: 3072,
    freeTier: true,
    deprecated: true,
    docsUrl: "https://ai.google.dev/gemini-api/docs/embeddings",
  },
  "cohere-multilingual": {
    id: "cohere-multilingual",
    label: "Cohere embed-multilingual-v3.0",
    family: "cohere",
    baseUrl: "https://api.cohere.com/v2",
    auth: { kind: "bearer" },
    model: "embed-multilingual-v3.0",
    dim: 1024,
    freeTier: false,
    docsUrl: "https://docs.cohere.com/reference/embed",
  },
  "jina-v3": {
    id: "jina-v3",
    label: "Jina jina-embeddings-v3",
    family: "jina",
    baseUrl: "https://api.jina.ai/v1",
    auth: { kind: "bearer" },
    model: "jina-embeddings-v3",
    dim: [256, 512, 1024],
    freeTier: true,
    docsUrl: "https://jina.ai/embeddings/",
  },
  "mistral-embed": {
    id: "mistral-embed",
    label: "Mistral mistral-embed",
    family: "openai-compat",
    baseUrl: "https://api.mistral.ai/v1",
    auth: { kind: "bearer" },
    model: "mistral-embed",
    dim: 1024,
    freeTier: false,
    docsUrl: "https://docs.mistral.ai/api/#operation/createEmbedding",
  },
  "hf-bge-m3": {
    id: "hf-bge-m3",
    label: "HuggingFace BAAI/bge-m3",
    family: "huggingface",
    baseUrl: "https://router.huggingface.co/hf-inference",
    auth: { kind: "bearer" },
    model: "BAAI/bge-m3",
    dim: 1024,
    freeTier: true,
    docsUrl: "https://huggingface.co/BAAI/bge-m3",
  },
  "hf-e5-multilingual": {
    id: "hf-e5-multilingual",
    label: "HuggingFace intfloat/multilingual-e5-large",
    family: "huggingface",
    baseUrl: "https://router.huggingface.co/hf-inference",
    auth: { kind: "bearer" },
    model: "intfloat/multilingual-e5-large",
    dim: 1024,
    freeTier: true,
    docsUrl: "https://huggingface.co/intfloat/multilingual-e5-large",
  },
  "ollama-nomic": {
    id: "ollama-nomic",
    label: "Ollama nomic-embed-text (yerel)",
    family: "openai-compat",
    baseUrl: "http://localhost:11434/v1",
    auth: { kind: "bearer" },
    model: "nomic-embed-text",
    dim: 768,
    freeTier: true,
    isLocal: true,
    docsUrl: "https://ollama.com/library/nomic-embed-text",
  },
  "ollama-mxbai": {
    id: "ollama-mxbai",
    label: "Ollama mxbai-embed-large (yerel)",
    family: "openai-compat",
    baseUrl: "http://localhost:11434/v1",
    auth: { kind: "bearer" },
    model: "mxbai-embed-large",
    dim: 1024,
    freeTier: true,
    isLocal: true,
    docsUrl: "https://ollama.com/library/mxbai-embed-large",
  },
  "ollama-bge-m3": {
    id: "ollama-bge-m3",
    label: "Ollama bge-m3 (yerel)",
    family: "openai-compat",
    baseUrl: "http://localhost:11434/v1",
    auth: { kind: "bearer" },
    model: "bge-m3",
    dim: 1024,
    freeTier: true,
    isLocal: true,
    docsUrl: "https://ollama.com/library/bge-m3",
  },
};

export function getEmbedPreset(id: EmbedPresetId): EmbedPreset | undefined {
  return EMBED_PRESETS[id];
}

export function listEmbedPresets(): EmbedPreset[] {
  return Object.values(EMBED_PRESETS);
}
