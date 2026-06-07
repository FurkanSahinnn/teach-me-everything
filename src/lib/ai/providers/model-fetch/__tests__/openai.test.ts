import { afterEach, describe, expect, it, vi } from "vitest";

import {
  OPENAI_MODEL_FETCH_ADAPTER,
  OPENAI_RESPONSES_MODEL_FETCH_ADAPTER,
} from "../openai";

const ORIGINAL_FETCH = globalThis.fetch;

function mockFetch(json: unknown, ok: boolean = true): void {
  globalThis.fetch = vi.fn(async () => ({
    ok,
    status: ok ? 200 : 400,
    json: async () => json,
  })) as unknown as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

describe("OPENAI_MODEL_FETCH_ADAPTER", () => {
  it("keeps gpt-/o-series chat models and drops non-chat classes", async () => {
    mockFetch({
      data: [
        { id: "gpt-5", object: "model" },
        { id: "gpt-5-mini", object: "model" },
        { id: "o3", object: "model" },
        { id: "o3-mini", object: "model" },
        { id: "text-embedding-3-small", object: "model" },
        { id: "dall-e-3", object: "model" },
        { id: "whisper-1", object: "model" },
        { id: "tts-1", object: "model" },
        { id: "gpt-4o-audio-preview", object: "model" },
        { id: "babbage-002", object: "model" },
      ],
    });

    const result = await OPENAI_MODEL_FETCH_ADAPTER.fetch({ apiKey: "k" });
    const ids = result.models.map((m) => m.id);
    expect(ids).toContain("gpt-5");
    expect(ids).toContain("gpt-5-mini");
    expect(ids).toContain("o3");
    expect(ids).toContain("o3-mini");
    expect(ids).not.toContain("text-embedding-3-small");
    expect(ids).not.toContain("dall-e-3");
    expect(ids).not.toContain("whisper-1");
    expect(ids).not.toContain("tts-1");
    expect(ids).not.toContain("gpt-4o-audio-preview");
    expect(ids).not.toContain("babbage-002");
  });

  it("assigns flagship tier to gpt-5 / o3 and fast to *-mini / nano", async () => {
    mockFetch({
      data: [
        { id: "gpt-5", object: "model" },
        { id: "gpt-5-mini", object: "model" },
        { id: "gpt-5-nano", object: "model" },
      ],
    });

    const result = await OPENAI_MODEL_FETCH_ADAPTER.fetch({ apiKey: "k" });
    expect(result.models.find((m) => m.id === "gpt-5")?.tier).toBe("flagship");
    expect(result.models.find((m) => m.id === "gpt-5-mini")?.tier).toBe("fast");
    expect(result.models.find((m) => m.id === "gpt-5-nano")?.tier).toBe("fast");
  });

  it("OPENAI_RESPONSES_MODEL_FETCH_ADAPTER shares the same catalog filter", async () => {
    mockFetch({
      data: [
        { id: "gpt-5", object: "model" },
        { id: "text-embedding-3-small", object: "model" },
      ],
    });

    const result = await OPENAI_RESPONSES_MODEL_FETCH_ADAPTER.fetch({
      apiKey: "k",
    });
    const ids = result.models.map((m) => m.id);
    expect(ids).toEqual(["gpt-5"]);
    expect(OPENAI_RESPONSES_MODEL_FETCH_ADAPTER.providerId).toBe(
      "openai-responses",
    );
  });
});
