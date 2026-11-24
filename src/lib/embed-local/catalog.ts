// Curated catalog of on-demand installable local ONNX embedding models.
//
// Models in this catalog can be downloaded into `appDataDir/embed-models/<id>/`
// (Tauri desktop) or Browser CacheStorage (web dev) and executed locally via
// `@huggingface/transformers` (ONNX Runtime) without any external server
// (Ollama, LM Studio) or API key.
//
// Keep imports relative so `embed-presets.ts` → `csp-origins.ts` →
// `next.config.ts` can load this module at build time without the `@/` path
// alias resolver.

export type LocalEmbedModelId =
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

export type LocalEmbedTier = "recommended" | "fast" | "quality";

export type LocalEmbedPooling = "mean" | "cls" | "last_token";

export type LocalEmbedArchitecture = "feature-extraction" | "embeddinggemma";

export type LocalEmbedHardwareReq = {
  minRamBytes: number;
  diskBytes: number;
  gpu: "none" | "recommended" | "required";
};

export type LocalEmbedModelSpec = {
  id: LocalEmbedModelId;
  name: string;
  hfRepo: string;
  dim: number;
  matryoshkaDims?: readonly number[];
  maxTokens: number;
  sizeBytes: number;
  languages: string;
  multilingual: boolean;
  tier: LocalEmbedTier;
  architecture: LocalEmbedArchitecture;
  pooling: LocalEmbedPooling;
  normalize: boolean;
  dtype: "q8" | "q4" | "fp32";
  /**
   * True for multimodal Gemma-based models (`embeddinggemma-2`) where we
   * null out `vision_config` and `audio_config` before loading so only the
   * text encoder runs.
   */
  textOnlyConfig?: boolean;
  /** Prepended to search queries (`inputType === "query"`). */
  queryPrefix?: string;
  /** Prepended to source chunks / passages (`inputType === "document"`). */
  documentPrefix?: string;
  /** Exact relative file paths inside `hfRepo` (`resolve/main/<path>`). */
  files: readonly string[];
  requirements: LocalEmbedHardwareReq;
  docsUrl: string;
  description: {
    tr: string;
    en: string;
  };
};

const MB = 1024 * 1024;
const GB = 1024 * 1024 * 1024;

export const LOCAL_EMBED_MODELS: Record<LocalEmbedModelId, LocalEmbedModelSpec> = {
  "local-qwen3-0.6b": {
    id: "local-qwen3-0.6b",
    name: "Qwen3-Embedding-0.6B",
    hfRepo: "onnx-community/Qwen3-Embedding-0.6B-ONNX",
    dim: 1024,
    matryoshkaDims: [128, 256, 512, 1024],
    maxTokens: 32768,
    sizeBytes: 625 * MB,
    languages: "100+ (TR/EN)",
    multilingual: true,
    tier: "recommended",
    architecture: "feature-extraction",
    pooling: "last_token",
    normalize: true,
    dtype: "q8",
    queryPrefix:
      "Instruct: Given a web search query, retrieve relevant passages that answer the query\nQuery:",
    files: [
      "config.json",
      "tokenizer.json",
      "tokenizer_config.json",
      "special_tokens_map.json",
      "onnx/model_quantized.onnx",
    ],
    requirements: {
      minRamBytes: Math.round(1.5 * GB),
      diskBytes: 650 * MB,
      gpu: "none",
    },
    docsUrl: "https://huggingface.co/Qwen/Qwen3-Embedding-0.6B",
    description: {
      tr: "Alibaba Qwen3 0.6B · 32K bağlam · Türkçe, İngilizce ve kod aramalarında çok yüksek doğruluk.",
      en: "Alibaba Qwen3 0.6B · 32K context · Top accuracy across Turkish, English, and code retrieval.",
    },
  },
  "local-embeddinggemma-2": {
    id: "local-embeddinggemma-2",
    name: "Google EmbeddingGemma 2",
    hfRepo: "onnx-community/embeddinggemma-2-ONNX",
    dim: 768,
    matryoshkaDims: [128, 256, 512, 768],
    maxTokens: 8192,
    sizeBytes: 346 * MB,
    languages: "100+ (TR/EN)",
    multilingual: true,
    tier: "recommended",
    architecture: "embeddinggemma",
    pooling: "mean",
    normalize: true,
    dtype: "q8",
    textOnlyConfig: true,
    queryPrefix: "task: search result | query: ",
    documentPrefix: "title: none | text: ",
    files: [
      "config.json",
      "tokenizer.json",
      "tokenizer_config.json",
      "onnx/model_quantized.onnx",
      "onnx/model_quantized.onnx_data",
    ],
    requirements: {
      minRamBytes: Math.round(1.2 * GB),
      diskBytes: 380 * MB,
      gpu: "none",
    },
    docsUrl: "https://huggingface.co/google/embeddinggemma-2",
    description: {
      tr: "Google DeepMind Gemma 4 tabanlı yeni nesil model · Metin enkoderi (768d MRL) · Güçlü çok dilli başarım.",
      en: "Next-gen Google DeepMind Gemma 4 embedding model · Text encoder (768d MRL) · Strong multilingual quality.",
    },
  },
  "local-embeddinggemma-300m": {
    id: "local-embeddinggemma-300m",
    name: "Google EmbeddingGemma 300M",
    hfRepo: "onnx-community/embeddinggemma-300m-ONNX",
    dim: 768,
    matryoshkaDims: [128, 256, 512, 768],
    maxTokens: 2048,
    sizeBytes: 330 * MB,
    languages: "100+ (TR/EN)",
    multilingual: true,
    tier: "recommended",
    architecture: "feature-extraction",
    pooling: "mean",
    normalize: true,
    dtype: "q8",
    queryPrefix: "task: search result | query: ",
    documentPrefix: "title: none | text: ",
    files: [
      "config.json",
      "tokenizer.json",
      "tokenizer_config.json",
      "special_tokens_map.json",
      "onnx/model_quantized.onnx",
      "onnx/model_quantized.onnx_data",
    ],
    requirements: {
      minRamBytes: 900 * MB,
      diskBytes: 350 * MB,
      gpu: "none",
    },
    docsUrl: "https://huggingface.co/google/embeddinggemma-300m",
    description: {
      tr: "Google'ın cihaz-içi (on-device) CPU çıkarımı için geliştirdiği 308M parametreli hızlı çok dilli model.",
      en: "Google's 308M on-device multilingual embedding model tuned for fast local CPU inference.",
    },
  },
  "local-minilm-multilingual": {
    id: "local-minilm-multilingual",
    name: "Multilingual MiniLM-L12-v2",
    hfRepo: "Xenova/paraphrase-multilingual-MiniLM-L12-v2",
    dim: 384,
    maxTokens: 512,
    sizeBytes: 120 * MB,
    languages: "50+ (TR/EN)",
    multilingual: true,
    tier: "fast",
    architecture: "feature-extraction",
    pooling: "mean",
    normalize: true,
    dtype: "q8",
    files: [
      "config.json",
      "tokenizer.json",
      "tokenizer_config.json",
      "special_tokens_map.json",
      "onnx/model_quantized.onnx",
    ],
    requirements: {
      minRamBytes: 400 * MB,
      diskBytes: 140 * MB,
      gpu: "none",
    },
    docsUrl:
      "https://huggingface.co/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2",
    description: {
      tr: "Çok hafif ve hızlı 50+ dilli MiniLM modeli · Düşük RAM'li bilgisayarlar ve kısa notlar için ideal.",
      en: "Lightweight and fast 50+ language MiniLM · Ideal for low-RAM machines and short notes.",
    },
  },
  "local-minilm-l6": {
    id: "local-minilm-l6",
    name: "All-MiniLM-L6-v2 (EN · Ultra-Hafif)",
    hfRepo: "Xenova/all-MiniLM-L6-v2",
    dim: 384,
    maxTokens: 512,
    sizeBytes: 23 * MB,
    languages: "EN",
    multilingual: false,
    tier: "fast",
    architecture: "feature-extraction",
    pooling: "mean",
    normalize: true,
    dtype: "q8",
    files: [
      "config.json",
      "tokenizer.json",
      "tokenizer_config.json",
      "special_tokens_map.json",
      "onnx/model_quantized.onnx",
    ],
    requirements: {
      minRamBytes: 200 * MB,
      diskBytes: 30 * MB,
      gpu: "none",
    },
    docsUrl: "https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2",
    description: {
      tr: "Yalnızca 23 MB boyutunda ultra-hızlı İngilizce model · Sadece İngilizce kaynak çalışanlar için.",
      en: "Ultra-compact 23 MB English model · Fastest local option for English-only workspaces.",
    },
  },
  "local-bge-m3": {
    id: "local-bge-m3",
    name: "BAAI BGE-M3 Multilingual",
    hfRepo: "Xenova/bge-m3",
    dim: 1024,
    maxTokens: 8192,
    sizeBytes: 572 * MB,
    languages: "100+ (TR/EN)",
    multilingual: true,
    tier: "quality",
    architecture: "feature-extraction",
    pooling: "cls",
    normalize: true,
    dtype: "q8",
    files: [
      "config.json",
      "tokenizer.json",
      "tokenizer_config.json",
      "special_tokens_map.json",
      "onnx/model_quantized.onnx",
    ],
    requirements: {
      minRamBytes: Math.round(1.5 * GB),
      diskBytes: 600 * MB,
      gpu: "none",
    },
    docsUrl: "https://huggingface.co/BAAI/bge-m3",
    description: {
      tr: "Uzun akademik makaleler (8K) ve Türkçe-İngilizce çapraz arama için referans çok dilli model.",
      en: "Reference multilingual model for long academic papers (8K) and TR/EN cross-lingual retrieval.",
    },
  },
  "local-e5-multilingual-small": {
    id: "local-e5-multilingual-small",
    name: "Multilingual-E5-Small",
    hfRepo: "Xenova/multilingual-e5-small",
    dim: 384,
    maxTokens: 512,
    sizeBytes: 120 * MB,
    languages: "100+ (TR/EN)",
    multilingual: true,
    tier: "fast",
    architecture: "feature-extraction",
    pooling: "mean",
    normalize: true,
    dtype: "q8",
    queryPrefix: "query: ",
    documentPrefix: "passage: ",
    files: [
      "config.json",
      "tokenizer.json",
      "tokenizer_config.json",
      "special_tokens_map.json",
      "onnx/model_quantized.onnx",
    ],
    requirements: {
      minRamBytes: 400 * MB,
      diskBytes: 140 * MB,
      gpu: "none",
    },
    docsUrl: "https://huggingface.co/intfloat/multilingual-e5-small",
    description: {
      tr: "Microsoft E5 ailesinin 118M hafif modeli · MiniLM boyutunda olup daha yüksek Türkçe arama kalitesi sunar.",
      en: "Microsoft's 118M E5 model · Same footprint as MiniLM with stronger Turkish & multilingual retrieval.",
    },
  },
  "local-e5-multilingual-base": {
    id: "local-e5-multilingual-base",
    name: "Multilingual-E5-Base",
    hfRepo: "Xenova/multilingual-e5-base",
    dim: 768,
    maxTokens: 512,
    sizeBytes: 280 * MB,
    languages: "100+ (TR/EN)",
    multilingual: true,
    tier: "recommended",
    architecture: "feature-extraction",
    pooling: "mean",
    normalize: true,
    dtype: "q8",
    queryPrefix: "query: ",
    documentPrefix: "passage: ",
    files: [
      "config.json",
      "tokenizer.json",
      "tokenizer_config.json",
      "special_tokens_map.json",
      "onnx/model_quantized.onnx",
    ],
    requirements: {
      minRamBytes: 800 * MB,
      diskBytes: 300 * MB,
      gpu: "none",
    },
    docsUrl: "https://huggingface.co/intfloat/multilingual-e5-base",
    description: {
      tr: "Hız ve kalite arasında dengeli 278M parametreli, 768 boyutlu çok dilli E5 modeli.",
      en: "Balanced 278M parameter, 768-d multilingual E5 model bridging speed and retrieval accuracy.",
    },
  },
  "local-e5-multilingual-large": {
    id: "local-e5-multilingual-large",
    name: "Multilingual-E5-Large",
    hfRepo: "Xenova/multilingual-e5-large",
    dim: 1024,
    maxTokens: 512,
    sizeBytes: 565 * MB,
    languages: "100+ (TR/EN)",
    multilingual: true,
    tier: "quality",
    architecture: "feature-extraction",
    pooling: "mean",
    normalize: true,
    dtype: "q8",
    queryPrefix: "query: ",
    documentPrefix: "passage: ",
    files: [
      "config.json",
      "tokenizer.json",
      "tokenizer_config.json",
      "special_tokens_map.json",
      "onnx/model_quantized.onnx",
    ],
    requirements: {
      minRamBytes: Math.round(1.5 * GB),
      diskBytes: 600 * MB,
      gpu: "none",
    },
    docsUrl: "https://huggingface.co/intfloat/multilingual-e5-large",
    description: {
      tr: "560M parametreli yüksek hassasiyetli çok dilli E5 modeli · Bulut kalitesinde yerel yoğun arama.",
      en: "High-precision 560M multilingual E5 model · Cloud-grade dense retrieval on local hardware.",
    },
  },
  "local-arctic-embed-m-v2": {
    id: "local-arctic-embed-m-v2",
    name: "Snowflake Arctic Embed M v2.0",
    hfRepo: "Snowflake/snowflake-arctic-embed-m-v2.0",
    dim: 768,
    matryoshkaDims: [256, 768],
    maxTokens: 8192,
    sizeBytes: 328 * MB,
    languages: "70+ (TR/EN)",
    multilingual: true,
    tier: "quality",
    architecture: "feature-extraction",
    pooling: "cls",
    normalize: true,
    dtype: "q8",
    queryPrefix: "Represent this sentence for searching relevant passages: ",
    files: [
      "config.json",
      "tokenizer.json",
      "tokenizer_config.json",
      "special_tokens_map.json",
      "onnx/model_quantized.onnx",
    ],
    requirements: {
      minRamBytes: 900 * MB,
      diskBytes: 350 * MB,
      gpu: "none",
    },
    docsUrl: "https://huggingface.co/Snowflake/snowflake-arctic-embed-m-v2.0",
    description: {
      tr: "Snowflake'in 305M parametreli, 8K uzun bağlam destekli hızlı ve çok dilli Apache 2.0 modeli.",
      en: "Snowflake's 305M multilingual model with 8K context window and fast CPU inference.",
    },
  },
};

export function isLocalEmbedModelId(id: string): id is LocalEmbedModelId {
  return Object.prototype.hasOwnProperty.call(LOCAL_EMBED_MODELS, id);
}

export function getLocalEmbedSpec(
  id: string,
): LocalEmbedModelSpec | undefined {
  if (isLocalEmbedModelId(id)) {
    return LOCAL_EMBED_MODELS[id];
  }
  // Also allow lookup by hfRepo string since `preset.model` can store the id or repo.
  return Object.values(LOCAL_EMBED_MODELS).find((m) => m.hfRepo === id);
}

export function listLocalEmbedSpecs(): LocalEmbedModelSpec[] {
  return Object.values(LOCAL_EMBED_MODELS);
}

/**
 * Apply model-specific task/instruction prefix to an input string.
 * Idempotent: if the input already begins with the prefix, it is returned
 * unchanged.
 */
export function formatLocalEmbedInput(
  spec: LocalEmbedModelSpec,
  text: string,
  inputType: "query" | "document" = "document",
): string {
  const prefix =
    inputType === "query" ? spec.queryPrefix : spec.documentPrefix;
  if (!prefix) return text;
  if (text.startsWith(prefix)) return text;
  return `${prefix}${text}`;
}
