import { afterEach, describe, expect, it, vi } from "vitest";

import { MISTRAL_MODEL_FETCH_ADAPTER } from "../mistral";

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

describe("MISTRAL_MODEL_FETCH_ADAPTER", () => {
  it("keeps function_calling=true AND completion_chat=true rows", async () => {
    mockFetch({
      data: [
        {
          id: "mistral-large-latest",
          name: "Mistral Large",
          capabilities: { completion_chat: true, function_calling: true },
        },
        {
          id: "mistral-no-tools",
          name: "Mistral No Tools",
          capabilities: { completion_chat: true, function_calling: false },
        },
        {
          id: "codestral-completion-only",
          name: "Codestral FIM",
          capabilities: { completion_chat: false, function_calling: true },
        },
        {
          id: "mistral-embed",
          capabilities: { completion_chat: false, function_calling: false },
        },
      ],
    });

    const result = await MISTRAL_MODEL_FETCH_ADAPTER.fetch({ apiKey: "k" });
    const ids = result.models.map((m) => m.id);
    expect(ids).toEqual(["mistral-large-latest"]);
  });

  it("returns empty without api key", async () => {
    const result = await MISTRAL_MODEL_FETCH_ADAPTER.fetch({});
    expect(result.models).toEqual([]);
  });

  it("returns empty on HTTP error", async () => {
    mockFetch({}, false);
    const result = await MISTRAL_MODEL_FETCH_ADAPTER.fetch({ apiKey: "bad" });
    expect(result.models).toEqual([]);
  });
});
