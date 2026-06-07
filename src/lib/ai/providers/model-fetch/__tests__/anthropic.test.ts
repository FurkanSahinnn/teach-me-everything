import { afterEach, describe, expect, it, vi } from "vitest";

import { ANTHROPIC_MODEL_FETCH_ADAPTER } from "../anthropic";

const ORIGINAL_FETCH = globalThis.fetch;

function mockFetch(json: unknown, ok: boolean = true): void {
  globalThis.fetch = vi.fn(async () => ({
    ok,
    status: ok ? 200 : 401,
    json: async () => json,
  })) as unknown as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

describe("ANTHROPIC_MODEL_FETCH_ADAPTER", () => {
  it("returns empty without an api key", async () => {
    const result = await ANTHROPIC_MODEL_FETCH_ADAPTER.fetch({});
    expect(result.models).toEqual([]);
  });

  it("parses claude-* models and drops non-claude rows", async () => {
    mockFetch({
      data: [
        { id: "claude-opus-4-7", display_name: "Claude Opus 4.7" },
        { id: "claude-sonnet-4-6", display_name: "Claude Sonnet 4.6" },
        { id: "claude-haiku-4-5", display_name: "Claude Haiku 4.5" },
        { id: "legacy-text-001", display_name: "Legacy" },
      ],
      has_more: false,
    });

    const result = await ANTHROPIC_MODEL_FETCH_ADAPTER.fetch({ apiKey: "k" });
    const ids = result.models.map((m) => m.id);
    expect(ids).toEqual([
      "claude-opus-4-7",
      "claude-sonnet-4-6",
      "claude-haiku-4-5",
    ]);
  });

  it("infers tier from id (opus → flagship, haiku → fast)", async () => {
    mockFetch({
      data: [
        { id: "claude-opus-4-7", display_name: "Opus" },
        { id: "claude-haiku-4-5", display_name: "Haiku" },
      ],
    });

    const result = await ANTHROPIC_MODEL_FETCH_ADAPTER.fetch({ apiKey: "k" });
    expect(result.models.find((m) => m.id === "claude-opus-4-7")?.tier).toBe(
      "flagship",
    );
    expect(result.models.find((m) => m.id === "claude-haiku-4-5")?.tier).toBe(
      "fast",
    );
  });

  it("returns empty on auth failure", async () => {
    mockFetch({}, false);
    const result = await ANTHROPIC_MODEL_FETCH_ADAPTER.fetch({ apiKey: "bad" });
    expect(result.models).toEqual([]);
  });
});
