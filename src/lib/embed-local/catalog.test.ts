import { describe, expect, it } from "vitest";
import {
  formatLocalEmbedInput,
  getLocalEmbedSpec,
  isLocalEmbedModelId,
  listLocalEmbedSpecs,
  LOCAL_EMBED_MODELS,
  type LocalEmbedModelId,
} from "./catalog";

describe("local embed catalog", () => {
  it("lists all 10 curated local ONNX models", () => {
    const specs = listLocalEmbedSpecs();
    expect(specs).toHaveLength(10);
    const ids = specs.map((s) => s.id);
    expect(ids).toContain("local-qwen3-0.6b");
    expect(ids).toContain("local-embeddinggemma-2");
    expect(ids).toContain("local-embeddinggemma-300m");
    expect(ids).toContain("local-minilm-multilingual");
    expect(ids).toContain("local-minilm-l6");
    expect(ids).toContain("local-bge-m3");
    expect(ids).toContain("local-e5-multilingual-small");
    expect(ids).toContain("local-e5-multilingual-base");
    expect(ids).toContain("local-e5-multilingual-large");
    expect(ids).toContain("local-arctic-embed-m-v2");
  });

  it("validates model ids and looks up by id or hfRepo", () => {
    expect(isLocalEmbedModelId("local-qwen3-0.6b")).toBe(true);
    expect(isLocalEmbedModelId("openai-3-small")).toBe(false);

    const byId = getLocalEmbedSpec("local-qwen3-0.6b");
    expect(byId?.hfRepo).toBe("onnx-community/Qwen3-Embedding-0.6B-ONNX");

    const byRepo = getLocalEmbedSpec("onnx-community/Qwen3-Embedding-0.6B-ONNX");
    expect(byRepo?.id).toBe("local-qwen3-0.6b");

    expect(getLocalEmbedSpec("unknown-model")).toBeUndefined();
  });

  it("every model declares valid files, positive dimensions, and hardware requirements", () => {
    for (const id of Object.keys(LOCAL_EMBED_MODELS) as LocalEmbedModelId[]) {
      const spec = LOCAL_EMBED_MODELS[id];
      expect(spec.dim).toBeGreaterThan(0);
      expect(spec.maxTokens).toBeGreaterThan(0);
      expect(spec.sizeBytes).toBeGreaterThan(0);
      expect(spec.files).toContain("config.json");
      expect(spec.files).toContain("tokenizer.json");
      expect(spec.files).toContain("onnx/model_quantized.onnx");
      expect(spec.requirements.minRamBytes).toBeGreaterThan(0);
      expect(spec.requirements.diskBytes).toBeGreaterThan(0);
      expect(spec.description.tr.length).toBeGreaterThan(0);
      expect(spec.description.en.length).toBeGreaterThan(0);
    }
  });

  it("formats query and document prefixes idempotently", () => {
    const qwen = LOCAL_EMBED_MODELS["local-qwen3-0.6b"];
    const qFormatted = formatLocalEmbedInput(qwen, "What is photosynthesis?", "query");
    expect(qFormatted).toBe(
      "Instruct: Given a web search query, retrieve relevant passages that answer the query\nQuery:What is photosynthesis?",
    );
    expect(formatLocalEmbedInput(qwen, qFormatted, "query")).toBe(qFormatted);
    expect(formatLocalEmbedInput(qwen, "Passage text", "document")).toBe("Passage text");

    const gemma = LOCAL_EMBED_MODELS["local-embeddinggemma-2"];
    expect(formatLocalEmbedInput(gemma, "search term", "query")).toBe(
      "task: search result | query: search term",
    );
    expect(formatLocalEmbedInput(gemma, "doc body", "document")).toBe(
      "title: none | text: doc body",
    );

    const e5 = LOCAL_EMBED_MODELS["local-e5-multilingual-small"];
    expect(formatLocalEmbedInput(e5, "merhaba", "query")).toBe("query: merhaba");
    expect(formatLocalEmbedInput(e5, "merhaba", "document")).toBe("passage: merhaba");
  });
});
