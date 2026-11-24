import { afterEach, describe, expect, it, vi } from "vitest";
import {
  _setTauriEmbedApisForTests,
  checkEmbedModelReadiness,
  deleteEmbedModel,
  installEmbedModel,
  isEmbedModelInstalled,
  listInstalledEmbedModels,
} from "./install";

describe("local embed install helpers", () => {
  afterEach(() => {
    _setTauriEmbedApisForTests({ invoke: null, event: null });
    vi.unstubAllGlobals();
  });

  it("lists installed models via Tauri invoke when available", async () => {
    const invoke = vi.fn().mockResolvedValue([
      {
        modelId: "local-qwen3-0.6b",
        hfRepo: "onnx-community/Qwen3-Embedding-0.6B-ONNX",
        sizeBytes: 613_000_000,
        installedAt: 1700000000000,
      },
    ]);
    _setTauriEmbedApisForTests({ invoke });

    const list = await listInstalledEmbedModels();
    expect(list).toHaveLength(1);
    expect(list[0]?.modelId).toBe("local-qwen3-0.6b");
    expect(invoke).toHaveBeenCalledWith("embed_list_installed_models");
  });

  it("checks readiness via Tauri invoke", async () => {
    const invoke = vi.fn().mockResolvedValue({
      state: "ready",
      modelId: "local-minilm-multilingual",
      sizeBytes: 120_000_000,
    });
    _setTauriEmbedApisForTests({ invoke });

    const ready = await isEmbedModelInstalled("local-minilm-multilingual");
    expect(ready).toBe(true);
    expect(invoke).toHaveBeenCalledWith("embed_check_readiness", {
      modelId: "local-minilm-multilingual",
    });
  });

  it("installs a model via Tauri invoke and forwards progress events", async () => {
    let handlerRef: ((e: { payload: unknown }) => void) | null = null;
    const unlisten = vi.fn();
    const listen = vi.fn(async (_event: string, cb: (e: { payload: unknown }) => void) => {
      handlerRef = cb;
      return unlisten;
    });
    const invoke = vi.fn(async () => {
      handlerRef?.({
        payload: {
          modelId: "local-embeddinggemma-2",
          downloadedBytes: 50_000_000,
          totalBytes: 346_000_000,
        },
      });
      return {
        modelId: "local-embeddinggemma-2",
        hfRepo: "onnx-community/embeddinggemma-2-ONNX",
        sizeBytes: 346_000_000,
        installedAt: 1700000000000,
      };
    });
    _setTauriEmbedApisForTests({ invoke: invoke as never, event: { listen: listen as never } });

    const progressUpdates: number[] = [];
    const installed = await installEmbedModel({
      modelId: "local-embeddinggemma-2",
      onProgress: (p) => progressUpdates.push(p.downloadedBytes),
    });

    expect(installed.modelId).toBe("local-embeddinggemma-2");
    expect(progressUpdates).toEqual([50_000_000]);
    expect(invoke).toHaveBeenCalledWith("embed_install_model", expect.objectContaining({
      modelId: "local-embeddinggemma-2",
      hfRepo: "onnx-community/embeddinggemma-2-ONNX",
      files: expect.arrayContaining(["onnx/model_quantized.onnx_data"]),
      expectedBytes: expect.any(Number),
    }));
    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it("deletes a model via Tauri invoke", async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    _setTauriEmbedApisForTests({ invoke });

    await deleteEmbedModel({ modelId: "local-minilm-l6" });
    expect(invoke).toHaveBeenCalledWith("embed_delete_model", {
      modelId: "local-minilm-l6",
    });
  });

  it("returns missing-model when not in Tauri and no web manifest exists", async () => {
    const res = await checkEmbedModelReadiness("local-bge-m3");
    expect(res.state).toBe("missing-model");
  });

  it("does not report a web install when CacheStorage is unavailable", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await expect(installEmbedModel({ modelId: "local-minilm-l6" })).rejects.toThrow(
      "CacheStorage",
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("treats a web manifest with missing cached files as not installed", async () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => JSON.stringify([{
          modelId: "local-minilm-l6",
          hfRepo: "Xenova/all-MiniLM-L6-v2",
          sizeBytes: 23_000_000,
          installedAt: 1700000000000,
        }]),
      },
      caches: { open: async () => ({ match: async () => undefined }) },
    });
    expect((await checkEmbedModelReadiness("local-minilm-l6")).state).toBe("missing-model");
  });
});
