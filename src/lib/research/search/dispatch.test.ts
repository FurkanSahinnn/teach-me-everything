import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  searchWithFallback,
  SearchDispatchError,
} from "@/lib/research/search/dispatch";
import type { SearchProviderEntry, UnifiedSearchProvider } from "./types";

// Mock the api-keys repo so we can control which providers "have a key".
vi.mock("@/lib/db/api-keys-repo", () => ({
  getApiKey: vi.fn(),
}));

// Mock the registry so we can inject fake search providers per test.
vi.mock("@/lib/research/search/registry", () => ({
  getSearchProvider: vi.fn(),
}));

import { getApiKey } from "@/lib/db/api-keys-repo";
import { getSearchProvider } from "@/lib/research/search/registry";

const getApiKeyMock = getApiKey as unknown as ReturnType<typeof vi.fn>;
const getSearchProviderMock = getSearchProvider as unknown as ReturnType<
  typeof vi.fn
>;

function makeProvider(opts: {
  id: string;
  result?:
    | Array<{ url: string; title: string; description: string }>
    | (() => Promise<
        Array<{ url: string; title: string; description: string }>
      >);
  throws?: string;
}): UnifiedSearchProvider {
  return {
    id: opts.id as never,
    label: opts.id,
    kind: "pure",
    async search() {
      if (opts.throws) throw new Error(opts.throws);
      const r = opts.result ?? [];
      const list = typeof r === "function" ? await r() : r;
      return list.map((x) => ({
        url: x.url,
        title: x.title,
        description: x.description,
      }));
    },
  };
}

const fakeMasterKey = {} as CryptoKey;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("searchWithFallback", () => {
  it("returns the first provider's results when it succeeds", async () => {
    const providers: SearchProviderEntry[] = [
      { id: "brave", enabled: true },
      { id: "exa-search", enabled: true },
    ];
    getApiKeyMock.mockResolvedValue("BSA-xxx");
    getSearchProviderMock.mockImplementation((id: string) =>
      makeProvider({
        id,
        result: [{ url: `https://${id}.test/1`, title: "T1", description: "D1" }],
      }),
    );

    const out = await searchWithFallback({
      query: "x",
      providers,
    });

    expect(out.providerId).toBe("brave");
    expect(out.results).toHaveLength(1);
    expect(out.results[0]!.url).toBe("https://brave.test/1");
    expect(out.attempted).toEqual([{ id: "brave", status: "ok" }]);
  });

  it("falls back to the next provider when the first throws", async () => {
    const providers: SearchProviderEntry[] = [
      { id: "brave", enabled: true },
      { id: "exa-search", enabled: true },
    ];
    getApiKeyMock.mockResolvedValue("KEY");
    getSearchProviderMock.mockImplementation((id: string) =>
      id === "brave"
        ? makeProvider({ id, throws: "rate-limited" })
        : makeProvider({
            id,
            result: [{ url: "https://exa.test/1", title: "T", description: "D" }],
          }),
    );

    const out = await searchWithFallback({
      query: "x",
      providers,
    });

    expect(out.providerId).toBe("exa-search");
    expect(out.attempted[0]).toEqual({
      id: "brave",
      status: "error",
      error: "rate-limited",
    });
    expect(out.attempted[1]).toEqual({ id: "exa-search", status: "ok" });
  });

  it("skips disabled providers", async () => {
    const providers: SearchProviderEntry[] = [
      { id: "brave", enabled: false },
      { id: "exa-search", enabled: true },
    ];
    getApiKeyMock.mockResolvedValue("KEY");
    getSearchProviderMock.mockImplementation((id: string) =>
      makeProvider({
        id,
        result: [{ url: "https://exa.test/1", title: "T", description: "D" }],
      }),
    );

    const out = await searchWithFallback({
      query: "x",
      providers,
    });

    expect(out.attempted[0]).toEqual({
      id: "brave",
      status: "skipped-disabled",
    });
    expect(out.providerId).toBe("exa-search");
  });

  it("skips providers without an API key", async () => {
    const providers: SearchProviderEntry[] = [
      { id: "brave", enabled: true },
      { id: "exa-search", enabled: true },
    ];
    getApiKeyMock.mockImplementation(async (provider: string) =>
      provider === "brave" ? null : "EXA-key",
    );
    getSearchProviderMock.mockImplementation((id: string) =>
      makeProvider({
        id,
        result: [{ url: "https://exa.test/1", title: "T", description: "D" }],
      }),
    );

    const out = await searchWithFallback({
      query: "x",
      providers,
    });

    expect(out.attempted[0]).toEqual({
      id: "brave",
      status: "skipped-no-key",
    });
    expect(out.providerId).toBe("exa-search");
  });

  it("skips unknown provider ids", async () => {
    const providers: SearchProviderEntry[] = [
      { id: "future-search-engine", enabled: true },
      { id: "brave", enabled: true },
    ];
    getApiKeyMock.mockResolvedValue("KEY");
    getSearchProviderMock.mockImplementation((id: string) =>
      id === "brave"
        ? makeProvider({
            id,
            result: [{ url: "https://b.test/1", title: "T", description: "D" }],
          })
        : null,
    );

    const out = await searchWithFallback({
      query: "x",
      providers,
    });

    expect(out.attempted[0]).toEqual({
      id: "future-search-engine",
      status: "skipped-unknown",
    });
    expect(out.providerId).toBe("brave");
  });

  it("advances when a provider returns 0 results", async () => {
    const providers: SearchProviderEntry[] = [
      { id: "brave", enabled: true },
      { id: "exa-search", enabled: true },
    ];
    getApiKeyMock.mockResolvedValue("KEY");
    getSearchProviderMock.mockImplementation((id: string) =>
      id === "brave"
        ? makeProvider({ id, result: [] })
        : makeProvider({
            id,
            result: [{ url: "https://exa.test/1", title: "T", description: "D" }],
          }),
    );

    const out = await searchWithFallback({
      query: "x",
      providers,
    });

    expect(out.attempted[0]).toEqual({
      id: "brave",
      status: "skipped-empty",
    });
    expect(out.providerId).toBe("exa-search");
  });

  it("throws SearchDispatchError with full attempt trace when all fail", async () => {
    const providers: SearchProviderEntry[] = [
      { id: "brave", enabled: true },
      { id: "exa-search", enabled: false },
      { id: "tavily-search", enabled: true },
    ];
    getApiKeyMock.mockImplementation(async (provider: string) =>
      provider === "brave" ? "KEY" : null,
    );
    getSearchProviderMock.mockImplementation((id: string) =>
      makeProvider({ id, throws: "boom" }),
    );

    await expect(
      searchWithFallback({
        query: "x",
        providers,
      }),
    ).rejects.toBeInstanceOf(SearchDispatchError);

    try {
      await searchWithFallback({
        query: "x",
        providers,
      });
    } catch (err) {
      const e = err as SearchDispatchError;
      expect(e.attempted).toEqual([
        { id: "brave", status: "error", error: "boom" },
        { id: "exa-search", status: "skipped-disabled" },
        { id: "tavily-search", status: "skipped-no-key" },
      ]);
    }
  });

  it("throws when the priority list is empty", async () => {
    await expect(
      searchWithFallback({
        query: "x",
        providers: [],
      }),
    ).rejects.toBeInstanceOf(SearchDispatchError);
  });

  it("fires onAttempt with 1-based attemptIndex for each real attempt", async () => {
    const providers: SearchProviderEntry[] = [
      { id: "brave", enabled: true },
      { id: "exa-search", enabled: true },
    ];
    getApiKeyMock.mockResolvedValue("KEY");
    getSearchProviderMock.mockImplementation((id: string) =>
      id === "brave"
        ? makeProvider({ id, throws: "boom" })
        : makeProvider({
            id,
            result: [{ url: "https://exa.test/1", title: "T", description: "D" }],
          }),
    );
    const calls: Array<{ id: string; label: string; attemptIndex: number }> = [];

    const out = await searchWithFallback({
      query: "x",
      providers,
      onAttempt: (info) => calls.push({ ...info, id: String(info.id) }),
    });

    expect(out.providerId).toBe("exa-search");
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual({
      id: "brave",
      label: "brave",
      attemptIndex: 1,
    });
    expect(calls[1]).toEqual({
      id: "exa-search",
      label: "exa-search",
      attemptIndex: 2,
    });
  });

  it("does NOT fire onAttempt for skipped (disabled / no-key / unknown) entries", async () => {
    const providers: SearchProviderEntry[] = [
      { id: "brave", enabled: false }, // disabled
      { id: "future-search-engine", enabled: true }, // unknown
      { id: "exa-search", enabled: true }, // no-key
      { id: "tavily-search", enabled: true }, // real attempt → success
    ];
    // `getApiKey` is called with the credential-slot id, not the search-provider id.
    // `tavily-search` → credential slot "tavily"; `exa-search` → "exa". Only
    // grant a key to tavily so exa is forced into "skipped-no-key".
    getApiKeyMock.mockImplementation(async (provider: string) =>
      provider === "tavily" ? "KEY" : null,
    );
    getSearchProviderMock.mockImplementation((id: string) =>
      id === "future-search-engine"
        ? null
        : makeProvider({
            id,
            result: [{ url: `https://${id}.test/1`, title: "T", description: "D" }],
          }),
    );
    const calls: Array<{ id: string; attemptIndex: number }> = [];

    const out = await searchWithFallback({
      query: "x",
      providers,
      onAttempt: (info) =>
        calls.push({ id: String(info.id), attemptIndex: info.attemptIndex }),
    });

    expect(out.providerId).toBe("tavily-search");
    expect(calls).toEqual([{ id: "tavily-search", attemptIndex: 1 }]);
  });

  it("fires onAttempt once with attemptIndex=1 on first-try success", async () => {
    const providers: SearchProviderEntry[] = [
      { id: "brave", enabled: true },
      { id: "exa-search", enabled: true },
    ];
    getApiKeyMock.mockResolvedValue("KEY");
    getSearchProviderMock.mockImplementation((id: string) =>
      makeProvider({
        id,
        result: [{ url: `https://${id}.test/1`, title: "T", description: "D" }],
      }),
    );
    const calls: Array<{ id: string; attemptIndex: number }> = [];

    await searchWithFallback({
      query: "x",
      providers,
      onAttempt: (info) =>
        calls.push({ id: String(info.id), attemptIndex: info.attemptIndex }),
    });

    expect(calls).toEqual([{ id: "brave", attemptIndex: 1 }]);
  });

  it("captures getApiKey rejections without aborting the whole chain", async () => {
    const providers: SearchProviderEntry[] = [
      { id: "brave", enabled: true },
      { id: "exa-search", enabled: true },
    ];
    getApiKeyMock.mockImplementation(async (provider: string) => {
      if (provider === "brave") throw new Error("vault locked");
      return "EXA-key";
    });
    getSearchProviderMock.mockImplementation((id: string) =>
      makeProvider({
        id,
        result: [{ url: "https://exa.test/1", title: "T", description: "D" }],
      }),
    );

    const out = await searchWithFallback({
      query: "x",
      providers,
    });

    expect(out.attempted[0]).toEqual({
      id: "brave",
      status: "error",
      error: "vault locked",
    });
    expect(out.providerId).toBe("exa-search");
  });
});
