import { describe, expect, it } from "vitest";
import {
  EMBED_PRESETS,
  getEmbedPreset,
  listEmbedPresets,
  type EmbedFamily,
  type EmbedPresetId,
} from "./embed-presets";

const ALL_IDS: EmbedPresetId[] = [
  "openai-3-small",
  "openai-3-large",
  "openrouter-3-small",
  "openrouter-3-large",
  "voyage-3",
  "voyage-3-large",
  "gemini-embed-2",
  "gemini-004",
  "gemini-001",
  "cohere-multilingual",
  "jina-v3",
  "mistral-embed",
  "hf-bge-m3",
  "hf-e5-multilingual",
  "ollama-nomic",
  "ollama-mxbai",
  "ollama-bge-m3",
  "ollama-qwen3-embed",
  "ollama-embeddinggemma-2",
  "ollama-embeddinggemma",
  "ollama-minilm",
  "ollama-snowflake-arctic-embed2",
  "local-qwen3-0.6b",
  "local-embeddinggemma-2",
  "local-embeddinggemma-300m",
  "local-minilm-multilingual",
  "local-minilm-l6",
  "local-bge-m3",
  "local-e5-multilingual-small",
  "local-e5-multilingual-base",
  "local-e5-multilingual-large",
  "local-arctic-embed-m-v2",
];

const FAMILIES: ReadonlySet<EmbedFamily> = new Set<EmbedFamily>([
  "openai-compat",
  "voyage",
  "gemini",
  "cohere",
  "jina",
  "huggingface",
  "local-onnx",
]);

describe("embed presets", () => {
  it("registers all 32 presets", () => {
    expect(Object.keys(EMBED_PRESETS).sort()).toEqual([...ALL_IDS].sort());
    expect(listEmbedPresets()).toHaveLength(ALL_IDS.length);
  });

  it("getEmbedPreset returns the entry by id and shape matches", () => {
    for (const id of ALL_IDS) {
      const preset = getEmbedPreset(id);
      expect(preset).toBeDefined();
      expect(preset?.id).toBe(id);
      expect(typeof preset?.label).toBe("string");
      expect(typeof preset?.model).toBe("string");
    }
  });

  it("getEmbedPreset returns undefined for unknown ids", () => {
    expect(getEmbedPreset("nonexistent" as EmbedPresetId)).toBeUndefined();
  });

  it("every preset declares a positive dim or non-empty matryoshka array", () => {
    for (const preset of listEmbedPresets()) {
      const dim = preset.dim;
      if (Array.isArray(dim)) {
        expect(dim.length).toBeGreaterThan(0);
        for (const d of dim) expect(d).toBeGreaterThan(0);
      } else {
        expect(dim).toBeGreaterThan(0);
      }
    }
  });

  it("every preset baseUrl is a parsable http(s) URL", () => {
    for (const preset of listEmbedPresets()) {
      expect(preset.baseUrl).toMatch(/^https?:\/\//);
      expect(() => new URL(preset.baseUrl)).not.toThrow();
    }
  });

  it("only ollama and local-onnx presets are flagged isLocal", () => {
    for (const preset of listEmbedPresets()) {
      const expectedLocal =
        preset.id.startsWith("ollama-") || preset.id.startsWith("local-");
      expect(preset.isLocal === true).toBe(expectedLocal);
    }
  });

  it("isLocal presets resolve to a loopback hostname", () => {
    for (const preset of listEmbedPresets()) {
      if (!preset.isLocal) continue;
      const url = new URL(preset.baseUrl);
      expect(["localhost", "127.0.0.1"]).toContain(url.hostname);
    }
  });

  it("family enum is one of seven declared values", () => {
    for (const preset of listEmbedPresets()) {
      expect(FAMILIES.has(preset.family)).toBe(true);
    }
  });

  it("freeTier flag matches expected per-provider table", () => {
    const expected: Record<EmbedPresetId, boolean> = {
      "openai-3-small": false,
      "openai-3-large": false,
      "openrouter-3-small": false,
      "openrouter-3-large": false,
      "voyage-3": false,
      "voyage-3-large": false,
      "gemini-embed-2": true,
      "gemini-004": true,
      "gemini-001": true,
      "cohere-multilingual": false,
      "jina-v3": true,
      "mistral-embed": false,
      "hf-bge-m3": true,
      "hf-e5-multilingual": true,
      "ollama-nomic": true,
      "ollama-mxbai": true,
      "ollama-bge-m3": true,
      "ollama-qwen3-embed": true,
      "ollama-embeddinggemma-2": true,
      "ollama-embeddinggemma": true,
      "ollama-minilm": true,
      "ollama-snowflake-arctic-embed2": true,
      "local-qwen3-0.6b": true,
      "local-embeddinggemma-2": true,
      "local-embeddinggemma-300m": true,
      "local-minilm-multilingual": true,
      "local-minilm-l6": true,
      "local-bge-m3": true,
      "local-e5-multilingual-small": true,
      "local-e5-multilingual-base": true,
      "local-e5-multilingual-large": true,
      "local-arctic-embed-m-v2": true,
    };
    for (const preset of listEmbedPresets()) {
      expect(preset.freeTier).toBe(expected[preset.id]);
    }
  });
});
