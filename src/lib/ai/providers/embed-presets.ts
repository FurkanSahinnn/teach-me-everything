import type { ProviderAuth } from "./types";

// Embed presets registered separately from chat presets because dimensions
// and pricing differ per family and we need a stable id space for prefs +
// pricing lookups.

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
  | "ollama-bge-m3"
  | "ollama-qwen3-embed"
  | "ollama-embeddinggemma-2"
  | "ollama-embeddinggemma"
  | "ollama-minilm"
  | "ollama-snowflake-arctic-embed2"
  | "local-qwen3-0.6b"
  | "local-embeddinggemma-2"
  | "local-embeddinggemma-300m"
  | "local-minilm-multilingual"
  | "local-minilm-l6"
  | "local-bge-m3"
  | "local-e5-multilingual-small"
  | "local-e5-multilingual-base"
  | "local-e5-multilingual-large"
  | "local-arctic-embed-m-v2";

export type EmbedFamily =
  | "openai-compat"
  | "voyage"
  | "gemini"
  | "cohere"
  | "jina"
  | "huggingface"
  | "local-onnx";

export type EmbedPreset = {
  id: EmbedPresetId;
  label: string;
  family: EmbedFamily;
  baseUrl: string;
  auth: ProviderAuth;
  // The exact model identifier the upstream API expects. Pricing keys on
  // this string, so changing it cascades to PRICING entries.
  model: string;
  // matryoshka models expose multiple valid output sizes; all others fix a
  // single dim.
  dim: number | number[];
  freeTier: boolean;
  // True when the preset runs locally (in-app ONNX or loopback/LAN server) —
  // the proxy bypass and keyless credential resolution branch off this.
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
  "ollama-qwen3-embed": {
    id: "ollama-qwen3-embed",
    label: "Ollama qwen3-embedding:0.6b (yerel)",
    family: "openai-compat",
    baseUrl: "http://localhost:11434/v1",
    auth: { kind: "bearer" },
    model: "qwen3-embedding:0.6b",
    dim: 1024,
    freeTier: true,
    isLocal: true,
    docsUrl: "https://ollama.com/library/qwen3-embedding",
  },
  "ollama-embeddinggemma-2": {
    id: "ollama-embeddinggemma-2",
    label: "Ollama embeddinggemma-2 (yerel)",
    family: "openai-compat",
    baseUrl: "http://localhost:11434/v1",
    auth: { kind: "bearer" },
    model: "embeddinggemma-2",
    dim: 768,
    freeTier: true,
    isLocal: true,
    docsUrl: "https://ollama.com/library/embeddinggemma-2",
  },
  "ollama-embeddinggemma": {
    id: "ollama-embeddinggemma",
    label: "Ollama embeddinggemma:300m (yerel)",
    family: "openai-compat",
    baseUrl: "http://localhost:11434/v1",
    auth: { kind: "bearer" },
    model: "embeddinggemma:300m",
    dim: 768,
    freeTier: true,
    isLocal: true,
    docsUrl: "https://ollama.com/library/embeddinggemma",
  },
  "ollama-minilm": {
    id: "ollama-minilm",
    label: "Ollama all-minilm (yerel)",
    family: "openai-compat",
    baseUrl: "http://localhost:11434/v1",
    auth: { kind: "bearer" },
    model: "all-minilm",
    dim: 384,
    freeTier: true,
    isLocal: true,
    docsUrl: "https://ollama.com/library/all-minilm",
  },
  "ollama-snowflake-arctic-embed2": {
    id: "ollama-snowflake-arctic-embed2",
    label: "Ollama snowflake-arctic-embed2 (yerel)",
    family: "openai-compat",
    baseUrl: "http://localhost:11434/v1",
    auth: { kind: "bearer" },
    model: "snowflake-arctic-embed2",
    dim: 1024,
    freeTier: true,
    isLocal: true,
    docsUrl: "https://ollama.com/library/snowflake-arctic-embed2",
  },
  // Built-in installable local ONNX models (no external daemon needed)
  "local-qwen3-0.6b": {
    id: "local-qwen3-0.6b",
    label: "Yerel (ONNX) · Qwen3-Embedding-0.6B",
    family: "local-onnx",
    baseUrl: "http://127.0.0.1:0/local-embed",
    auth: { kind: "bearer" },
    model: "local-qwen3-0.6b",
    dim: 1024,
    freeTier: true,
    isLocal: true,
    docsUrl: "https://huggingface.co/Qwen/Qwen3-Embedding-0.6B",
  },
  "local-embeddinggemma-2": {
    id: "local-embeddinggemma-2",
    label: "Yerel (ONNX) · Google EmbeddingGemma 2",
    family: "local-onnx",
    baseUrl: "http://127.0.0.1:0/local-embed",
    auth: { kind: "bearer" },
    model: "local-embeddinggemma-2",
    dim: 768,
    freeTier: true,
    isLocal: true,
    docsUrl: "https://huggingface.co/google/embeddinggemma-2",
  },
  "local-embeddinggemma-300m": {
    id: "local-embeddinggemma-300m",
    label: "Yerel (ONNX) · Google EmbeddingGemma 300M",
    family: "local-onnx",
    baseUrl: "http://127.0.0.1:0/local-embed",
    auth: { kind: "bearer" },
    model: "local-embeddinggemma-300m",
    dim: 768,
    freeTier: true,
    isLocal: true,
    docsUrl: "https://huggingface.co/google/embeddinggemma-300m",
  },
  "local-minilm-multilingual": {
    id: "local-minilm-multilingual",
    label: "Yerel (ONNX) · Multilingual MiniLM-L12-v2",
    family: "local-onnx",
    baseUrl: "http://127.0.0.1:0/local-embed",
    auth: { kind: "bearer" },
    model: "local-minilm-multilingual",
    dim: 384,
    freeTier: true,
    isLocal: true,
    docsUrl:
      "https://huggingface.co/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2",
  },
  "local-minilm-l6": {
    id: "local-minilm-l6",
    label: "Yerel (ONNX) · All-MiniLM-L6-v2 (EN)",
    family: "local-onnx",
    baseUrl: "http://127.0.0.1:0/local-embed",
    auth: { kind: "bearer" },
    model: "local-minilm-l6",
    dim: 384,
    freeTier: true,
    isLocal: true,
    docsUrl: "https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2",
  },
  "local-bge-m3": {
    id: "local-bge-m3",
    label: "Yerel (ONNX) · BAAI BGE-M3 Multilingual",
    family: "local-onnx",
    baseUrl: "http://127.0.0.1:0/local-embed",
    auth: { kind: "bearer" },
    model: "local-bge-m3",
    dim: 1024,
    freeTier: true,
    isLocal: true,
    docsUrl: "https://huggingface.co/BAAI/bge-m3",
  },
  "local-e5-multilingual-small": {
    id: "local-e5-multilingual-small",
    label: "Yerel (ONNX) · Multilingual-E5-Small",
    family: "local-onnx",
    baseUrl: "http://127.0.0.1:0/local-embed",
    auth: { kind: "bearer" },
    model: "local-e5-multilingual-small",
    dim: 384,
    freeTier: true,
    isLocal: true,
    docsUrl: "https://huggingface.co/intfloat/multilingual-e5-small",
  },
  "local-e5-multilingual-base": {
    id: "local-e5-multilingual-base",
    label: "Yerel (ONNX) · Multilingual-E5-Base",
    family: "local-onnx",
    baseUrl: "http://127.0.0.1:0/local-embed",
    auth: { kind: "bearer" },
    model: "local-e5-multilingual-base",
    dim: 768,
    freeTier: true,
    isLocal: true,
    docsUrl: "https://huggingface.co/intfloat/multilingual-e5-base",
  },
  "local-e5-multilingual-large": {
    id: "local-e5-multilingual-large",
    label: "Yerel (ONNX) · Multilingual-E5-Large",
    family: "local-onnx",
    baseUrl: "http://127.0.0.1:0/local-embed",
    auth: { kind: "bearer" },
    model: "local-e5-multilingual-large",
    dim: 1024,
    freeTier: true,
    isLocal: true,
    docsUrl: "https://huggingface.co/intfloat/multilingual-e5-large",
  },
  "local-arctic-embed-m-v2": {
    id: "local-arctic-embed-m-v2",
    label: "Yerel (ONNX) · Snowflake Arctic Embed M v2.0",
    family: "local-onnx",
    baseUrl: "http://127.0.0.1:0/local-embed",
    auth: { kind: "bearer" },
    model: "local-arctic-embed-m-v2",
    dim: 768,
    freeTier: true,
    isLocal: true,
    docsUrl: "https://huggingface.co/Snowflake/snowflake-arctic-embed-m-v2.0",
  },
};

export function getEmbedPreset(id: EmbedPresetId): EmbedPreset | undefined {
  return EMBED_PRESETS[id];
}

export function listEmbedPresets(): EmbedPreset[] {
  return Object.values(EMBED_PRESETS);
}
