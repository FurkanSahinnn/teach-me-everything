import { afterEach, describe, expect, it, vi } from "vitest";
import {
  _setLocalEmbedRunnerForTests,
  LocalOnnxEmbedProvider,
  matchLocalModelUrl,
  normalizeL2,
} from "./embed-local";
import { ProviderError } from "./types";

describe("LocalOnnxEmbedProvider", () => {
  afterEach(() => {
    _setLocalEmbedRunnerForTests(null);
  });

  it("reports expected dimensions via dimFor", () => {
    const provider = new LocalOnnxEmbedProvider();
    expect(provider.id).toBe("local-embed");
    expect(provider.dimFor("local-qwen3-0.6b")).toBe(1024);
    expect(provider.dimFor("local-embeddinggemma-2")).toBe(768);
    expect(provider.dimFor("local-minilm-multilingual")).toBe(384);
    expect(provider.dimFor("unknown")).toBe(384);
  });

  it("throws ProviderError(400, unknown_model) for unrecognized models", async () => {
    const provider = new LocalOnnxEmbedProvider();
    await expect(
      provider.embed({
        apiKey: "",
        model: "not-a-local-model",
        inputs: ["hello"],
      }),
    ).rejects.toThrow(ProviderError);
  });

  it("formats query and document prefixes and returns vectors", async () => {
    const runnerSpy = vi.fn(async (spec, formatted: string[]) =>
      formatted.map(() => new Float32Array(spec.dim).fill(0.5)),
    );
    _setLocalEmbedRunnerForTests(runnerSpy);

    const provider = new LocalOnnxEmbedProvider();
    const qRes = await provider.embed({
      apiKey: "",
      model: "local-embeddinggemma-2",
      inputs: ["nedir bu?"],
      inputType: "query",
    });
    expect(qRes.dim).toBe(768);
    expect(qRes.vectors).toHaveLength(1);
    expect(runnerSpy).toHaveBeenCalledWith(
      expect.objectContaining({ id: "local-embeddinggemma-2" }),
      ["task: search result | query: nedir bu?"],
      undefined,
    );

    const dRes = await provider.embed({
      apiKey: "",
      model: "local-embeddinggemma-2",
      inputs: ["makale içeriği"],
      inputType: "document",
    });
    expect(dRes.vectors).toHaveLength(1);
    expect(runnerSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: "local-embeddinggemma-2" }),
      ["title: none | text: makale içeriği"],
      undefined,
    );
  });

  it("matches Hugging Face resolve URLs to local model IDs", () => {
    const matched = matchLocalModelUrl(
      "https://huggingface.co/onnx-community/Qwen3-Embedding-0.6B-ONNX/resolve/main/onnx/model_quantized.onnx",
    );
    expect(matched).toEqual({
      modelId: "local-qwen3-0.6b",
      relPath: "onnx/model_quantized.onnx",
    });

    expect(
      matchLocalModelUrl("https://huggingface.co/other/repo/resolve/main/config.json"),
    ).toBeNull();
    // Even optional files must be routed to the installed directory. A
    // missing file yields a local 404, never a silent remote download.
    expect(
      matchLocalModelUrl("https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main/private.txt"),
    ).toEqual({ modelId: "local-minilm-l6", relPath: "private.txt" });
  });

  it("normalizes vectors to unit L2 length", () => {
    const raw = new Float32Array([3, 4]);
    const normed = normalizeL2(raw);
    expect(normed[0]).toBeCloseTo(0.6, 5);
    expect(normed[1]).toBeCloseTo(0.8, 5);
  });
});
