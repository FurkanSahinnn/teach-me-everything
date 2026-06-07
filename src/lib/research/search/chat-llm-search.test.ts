import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  ChatLlmSearchProvider,
  CHAT_LLM_SEARCH_CATALOG,
} from "./chat-llm-search";
import type { StreamEvent } from "@/lib/ai/providers/types";

// Mock the chat provider registry so we can inject a fake streaming chat.
vi.mock("@/lib/ai/providers/registry", () => ({
  getChatProvider: vi.fn(),
}));

// Mock the web-search adapter dispatcher so we can pin both `buildToolBlock`
// and `parseStreamEvent` behaviour per test.
vi.mock("@/lib/ai/web-search/adapter", () => ({
  getWebSearchAdapter: vi.fn(),
}));

import { getChatProvider } from "@/lib/ai/providers/registry";
import { getWebSearchAdapter } from "@/lib/ai/web-search/adapter";

const getChatProviderMock = getChatProvider as unknown as ReturnType<typeof vi.fn>;
const getWebSearchAdapterMock = getWebSearchAdapter as unknown as ReturnType<
  typeof vi.fn
>;

async function* eventStream(events: StreamEvent[]): AsyncIterable<StreamEvent> {
  for (const e of events) yield e;
}

function makeChatProvider(events: StreamEvent[]) {
  return {
    id: "anthropic",
    capabilities: {} as never,
    streamChat: vi.fn(() => ({
      events: eventStream(events),
      abort: vi.fn(),
    })),
  };
}

function makeAdapter(opts: {
  toolBlock: unknown;
  citationsByPayload?: Array<Array<{
    url: string;
    title: string;
    snippet?: string;
    publishedAt?: string;
  }>>;
}) {
  let parseIndex = 0;
  return {
    providerId: "anthropic" as const,
    capability: { paramsSupported: [] },
    buildToolBlock: vi.fn(() => opts.toolBlock),
    parseStreamEvent: vi.fn(() => {
      const citationsRaw = opts.citationsByPayload?.[parseIndex];
      parseIndex += 1;
      if (!citationsRaw) return null;
      return {
        citations: citationsRaw.map((c) => ({
          result: {
            url: c.url,
            title: c.title,
            snippet: c.snippet ?? "",
            provider: "anthropic",
            ...(c.publishedAt ? { publishedAt: c.publishedAt } : {}),
          },
          messageBlockIndex: 0,
        })),
      };
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ChatLlmSearchProvider", () => {
  it("collects citations from raw stream events and normalises to SearchResultItem", async () => {
    const adapter = makeAdapter({
      toolBlock: { type: "web_search_20260209", name: "web_search", max_uses: 1 },
      citationsByPayload: [
        [
          { url: "https://a.test/1", title: "A1", publishedAt: "2026-04-01" },
          { url: "https://b.test/2", title: "B2" },
        ],
      ],
    });
    getWebSearchAdapterMock.mockReturnValue(adapter);
    getChatProviderMock.mockReturnValue(
      makeChatProvider([
        { kind: "raw", payload: { type: "content_block_start" } },
        { kind: "stop" },
      ]),
    );

    const provider = new ChatLlmSearchProvider({
      searchId: "anthropic-search",
      chatProviderId: "anthropic",
      modelId: "claude-sonnet-4-6",
      label: "Claude (web search)",
    });
    const out = await provider.search({
      query: "machine learning",
      apiKey: "sk-ant-x",
    });

    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      url: "https://a.test/1",
      title: "A1",
      age: "2026-04-01",
    });
    expect(out[1]).toMatchObject({ url: "https://b.test/2", title: "B2" });
    expect(adapter.buildToolBlock).toHaveBeenCalledWith({ maxUses: 1 });
  });

  it("dedupes citations that appear in multiple stream events", async () => {
    const adapter = makeAdapter({
      toolBlock: { type: "web_search_20260209" },
      citationsByPayload: [
        [{ url: "https://a.test/dup", title: "A" }],
        [{ url: "https://a.test/dup", title: "A-again" }],
        [{ url: "https://b.test/new", title: "B" }],
      ],
    });
    getWebSearchAdapterMock.mockReturnValue(adapter);
    getChatProviderMock.mockReturnValue(
      makeChatProvider([
        { kind: "raw", payload: { type: "content_block_start" } },
        { kind: "raw", payload: { type: "content_block_start" } },
        { kind: "raw", payload: { type: "content_block_start" } },
        { kind: "stop" },
      ]),
    );

    const provider = new ChatLlmSearchProvider({
      searchId: "anthropic-search",
      chatProviderId: "anthropic",
      modelId: "claude-sonnet-4-6",
      label: "Claude",
    });
    const out = await provider.search({
      query: "x",
      apiKey: "k",
    });
    expect(out).toHaveLength(2);
    expect(out.map((r) => r.url)).toEqual([
      "https://a.test/dup",
      "https://b.test/new",
    ]);
  });

  it("caps result count to the input count param", async () => {
    const adapter = makeAdapter({
      toolBlock: {},
      citationsByPayload: [
        Array.from({ length: 10 }, (_, i) => ({
          url: `https://x.test/${i}`,
          title: `T${i}`,
        })),
      ],
    });
    getWebSearchAdapterMock.mockReturnValue(adapter);
    getChatProviderMock.mockReturnValue(
      makeChatProvider([
        { kind: "raw", payload: {} },
        { kind: "stop" },
      ]),
    );

    const provider = new ChatLlmSearchProvider({
      searchId: "anthropic-search",
      chatProviderId: "anthropic",
      modelId: "claude-sonnet-4-6",
      label: "Claude",
    });
    const out = await provider.search({
      query: "x",
      apiKey: "k",
      count: 3,
    });
    expect(out).toHaveLength(3);
  });

  it("throws missing_key when apiKey is empty", async () => {
    const provider = new ChatLlmSearchProvider({
      searchId: "anthropic-search",
      chatProviderId: "anthropic",
      modelId: "claude-sonnet-4-6",
      label: "Claude",
    });
    await expect(
      provider.search({ query: "x", apiKey: "" }),
    ).rejects.toMatchObject({ code: "missing_key", status: 401 });
  });

  it("throws empty_query when query is blank", async () => {
    const provider = new ChatLlmSearchProvider({
      searchId: "anthropic-search",
      chatProviderId: "anthropic",
      modelId: "claude-sonnet-4-6",
      label: "Claude",
    });
    await expect(
      provider.search({ query: "  ", apiKey: "k" }),
    ).rejects.toMatchObject({ code: "empty_query", status: 400 });
  });

  it("surfaces stream-error events as upstream_error", async () => {
    const adapter = makeAdapter({ toolBlock: {}, citationsByPayload: [] });
    getWebSearchAdapterMock.mockReturnValue(adapter);
    getChatProviderMock.mockReturnValue(
      makeChatProvider([
        { kind: "error", status: 429, message: "rate limited" },
        { kind: "stop" },
      ]),
    );

    const provider = new ChatLlmSearchProvider({
      searchId: "anthropic-search",
      chatProviderId: "anthropic",
      modelId: "claude-sonnet-4-6",
      label: "Claude",
    });
    await expect(
      provider.search({ query: "x", apiKey: "k" }),
    ).rejects.toMatchObject({ code: "upstream_error", status: 429 });
  });

  it("throws no_adapter if the chat provider has no registered web-search adapter", async () => {
    getWebSearchAdapterMock.mockReturnValue(null);
    const provider = new ChatLlmSearchProvider({
      searchId: "anthropic-search",
      chatProviderId: "anthropic",
      modelId: "claude-sonnet-4-6",
      label: "Claude",
    });
    await expect(
      provider.search({ query: "x", apiKey: "k" }),
    ).rejects.toMatchObject({ code: "no_adapter", status: 500 });
  });

  it("exposes a catalog with 8 known chat-LLM search ids", () => {
    const keys = Object.keys(CHAT_LLM_SEARCH_CATALOG);
    expect(keys).toEqual([
      "anthropic-search",
      "openai-search",
      "gemini-search",
      "perplexity-search",
      "xai-search",
      "mistral-search",
      "glm-search",
      "openrouter-search",
    ]);
  });
});
