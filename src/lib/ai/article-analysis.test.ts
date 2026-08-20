import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ChatProvider,
  ChatRequest,
  ChatStreamHandle,
  StreamEvent,
} from "./providers/types";
import type { ChunkRecord, SourceRecord } from "@/lib/db/types";

// --- mocks (no DB, no network) ---------------------------------------------

const getChatProviderMock = vi.fn();
const getSourceMock = vi.fn<(id: string) => Promise<SourceRecord | undefined>>();
const listChunksBySourceMock =
  vi.fn<(id: string) => Promise<ChunkRecord[]>>();
const resolveCredMock = vi.fn();

vi.mock("./providers/registry", () => ({
  getChatProvider: (...args: unknown[]) => getChatProviderMock(...args),
}));
vi.mock("@/lib/db/sources", () => ({
  getSource: (id: string) => getSourceMock(id),
}));
vi.mock("@/lib/db/chunks", () => ({
  listChunksBySource: (id: string) => listChunksBySourceMock(id),
}));
vi.mock("@/lib/ai/anthropic-credential", () => ({
  resolveChatCredentialForPreset: (p: string) => resolveCredMock(p),
}));

const { runArticleAnalysis, ArticleAnalysisError, MAP_CONCURRENCY } =
  await import("./article-analysis");
const { encodeChatModelBinding } = await import("./model-options");

const SONNET = encodeChatModelBinding("anthropic", "claude-sonnet-4-6");

// --- stage routing ----------------------------------------------------------

type Stage =
  | "map"
  | "reduce"
  | "critique"
  | "glossary"
  | "reflection"
  | "synthesize";

// Detect which stage a request belongs to by the unique schema field name its
// system prompt embeds. Order matters: check the most specific tokens first so
// a synthesize prompt that quotes the critique's "weakest link" prose isn't
// mis-routed.
function detectStage(system: string): Stage {
  if (system.includes("ataGlance")) return "synthesize";
  if (system.includes("keyQuotes")) return "map";
  if (system.includes("methodWalkthrough")) return "reduce";
  if (system.includes("questionsToAsk")) return "reflection";
  if (system.includes("weakestLink")) return "critique";
  if (system.includes("glossary")) return "glossary";
  throw new Error(`Unroutable stage prompt:\n${system.slice(0, 200)}`);
}

type StageSpec = Record<string, unknown> | "error" | "malformed";

const VALID: Record<Stage, Record<string, unknown>> = {
  map: {
    sectionTitle: "Introduction",
    summary: "Introduces the method.",
    keyQuotes: [{ quote: "we propose a novel approach", page: 1 }],
  },
  reduce: {
    problemMotivation: [
      {
        text: "The problem is hard.",
        grounding: "source",
        citations: [{ quote: "to tackle a hard problem" }],
      },
    ],
    priorWorkGap: [{ text: "Prior work missed this.", grounding: "source" }],
    contributions: [{ text: "We contribute a method.", grounding: "source" }],
    methodWalkthrough: [{ step: "Encode inputs", why: "to capture structure" }],
    howItSolves: [{ text: "It solves via attention.", grounding: "source" }],
    keyResults: [
      {
        text: "Achieves 99% accuracy.",
        grounding: "source",
        citations: [{ quote: "accuracy of 99 percent", page: 5 }],
      },
    ],
  },
  critique: {
    critique: {
      soundness: "Sound.",
      novelty: "Novel.",
      significance: "Significant.",
      clarity: "Clear.",
      weakestLink: "Small sample size.",
    },
    assumptionsLimitations: [
      { text: "Assumes IID data.", grounding: "general" },
    ],
    reproducibility: "Code is released.",
  },
  glossary: {
    glossary: [
      { term: "Backprop", symbol: "∇", tr: "Geri yayılım", en: "Backpropagation" },
    ],
  },
  reflection: {
    questionsToAsk: ["Does it scale to larger datasets?"],
    soWhat: "It matters for efficient training.",
    whatToReadNext: [{ title: "Attention Is All You Need", why: "Foundational." }],
  },
  synthesize: {
    tldr: "A short plain-language summary.",
    ataGlance: {
      paperType: "empirical",
      field: "machine learning",
      purpose: "to test a method",
      headlineFinding: "the method works",
    },
    fiveCs: {
      category: "method paper",
      context: "deep learning",
      correctness: "appears valid",
      contributions: "a new method",
      clarity: "well written",
    },
    keyIdea: "Attention captures long-range structure.",
  },
};

function streamFor(spec: StageSpec): StreamEvent[] {
  if (spec === "error") {
    return [
      { kind: "start", model: "claude-sonnet-4-6", usage: { input_tokens: 100 } },
      { kind: "error", status: 500, message: "upstream broke" },
    ];
  }
  const text = spec === "malformed" ? "sorry, no JSON here" : JSON.stringify(spec);
  return [
    { kind: "start", model: "claude-sonnet-4-6", usage: { input_tokens: 100 } },
    { kind: "text", delta: text },
    {
      kind: "delta",
      stopReason: "end_turn",
      usage: { input_tokens: 100, output_tokens: 50 },
    },
  ];
}

const CAPABILITIES = {
  cacheControl: true,
  toolUse: "native",
  streaming: true,
  vision: false,
} as const;

function stageOf(req: ChatRequest): Stage {
  return detectStage(req.system.map((b) => b.text).join("\n"));
}

function handleFor(events: StreamEvent[]): ChatStreamHandle {
  async function* gen(): AsyncGenerator<StreamEvent> {
    for (const e of events) yield e;
  }
  return { events: gen(), abort: () => {} };
}

function routingProvider(overrides: Partial<Record<Stage, StageSpec>>): ChatProvider {
  return {
    id: "anthropic",
    capabilities: CAPABILITIES,
    streamChat(req: ChatRequest): ChatStreamHandle {
      const stage = stageOf(req);
      return handleFor(streamFor(overrides[stage] ?? VALID[stage]));
    },
  };
}

// Sheds the first `failures` Map calls with a 429 and serves everything else
// normally — the shape of a provider trimming a burst rather than rejecting the
// request outright.
function shedsMapCalls(failures: number): ChatProvider {
  let remaining = failures;
  return {
    id: "anthropic",
    capabilities: CAPABILITIES,
    streamChat(req: ChatRequest): ChatStreamHandle {
      const stage = stageOf(req);
      if (stage === "map" && remaining > 0) {
        remaining -= 1;
        return handleFor([
          { kind: "start", model: "claude-sonnet-4-6", usage: {} },
          { kind: "error", status: 429, message: "rate limited" },
        ]);
      }
      return handleFor(streamFor(VALID[stage]));
    },
  };
}

// Records the high-water mark of simultaneously-open Map streams. The await
// between the first and second event is what makes overlap observable at all.
function concurrencyProbeProvider(probe: { peak: number }): ChatProvider {
  let inFlight = 0;
  return {
    id: "anthropic",
    capabilities: CAPABILITIES,
    streamChat(req: ChatRequest): ChatStreamHandle {
      const stage = stageOf(req);
      async function* gen(): AsyncGenerator<StreamEvent> {
        const counted = stage === "map";
        if (counted) {
          inFlight += 1;
          probe.peak = Math.max(probe.peak, inFlight);
        }
        try {
          yield { kind: "start", model: "claude-sonnet-4-6", usage: {} };
          await new Promise((resolve) => setTimeout(resolve, 0));
          yield { kind: "text", delta: JSON.stringify(VALID[stage]) };
          yield {
            kind: "delta",
            stopReason: "end_turn",
            usage: { input_tokens: 100, output_tokens: 50 },
          };
        } finally {
          if (counted) inFlight -= 1;
        }
      }
      return { events: gen(), abort: () => {} };
    },
  };
}

function source(): SourceRecord {
  return {
    id: "src_1",
    workspaceId: "ws_1",
    type: "pdf",
    title: "A Paper",
    ingestStatus: "ready",
    embeddingStatus: "ready",
    createdAt: 0,
    updatedAt: 0,
  };
}

function chunks(): ChunkRecord[] {
  return [
    {
      id: "ck_0",
      sourceId: "src_1",
      workspaceId: "ws_1",
      index: 0,
      text: "We propose a novel approach to tackle a hard problem in the field.",
      tokenCount: 100,
      section: "Introduction",
      page: 1,
      createdAt: 0,
    },
    {
      id: "ck_1",
      sourceId: "src_1",
      workspaceId: "ws_1",
      index: 1,
      text: "Our experiments report an accuracy of 99 percent on the benchmark.",
      tokenCount: 100,
      section: "Results",
      page: 5,
      createdAt: 0,
    },
  ];
}

// One distinct `section` per chunk, so groupChunksIntoSections yields one group
// per chunk and the Map fan-out is wider than MAP_CONCURRENCY.
function manyChunks(count: number): ChunkRecord[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `ck_${i}`,
    sourceId: "src_1",
    workspaceId: "ws_1",
    index: i,
    text: `Section ${i} describes a distinct part of the method in detail.`,
    tokenCount: 100,
    section: `Section ${i}`,
    page: i + 1,
    createdAt: 0,
  }));
}

function baseArgs() {
  return {
    workspaceId: "ws_1",
    sourceId: "src_1",
    targetLang: "en" as const,
    models: { extract: SONNET, synthesize: SONNET, critique: SONNET },
  };
}

beforeEach(() => {
  getChatProviderMock.mockReset();
  getSourceMock.mockReset();
  listChunksBySourceMock.mockReset();
  resolveCredMock.mockReset();
  resolveCredMock.mockResolvedValue({ apiKey: "sk-test" });
  getSourceMock.mockResolvedValue(source());
  listChunksBySourceMock.mockResolvedValue(chunks());
  getChatProviderMock.mockReturnValue(routingProvider({}));
});

describe("runArticleAnalysis", () => {
  it("returns a fully-assembled payload with status 'ready' on the happy path", async () => {
    const result = await runArticleAnalysis(baseArgs());

    expect(result.status).toBe("ready");
    expect(result.fallbackReason).toBeUndefined();
    // Orientation (synthesize)
    expect(result.payload.tldr).toBe("A short plain-language summary.");
    expect(result.payload.ataGlance.field).toBe("machine learning");
    expect(result.payload.keyIdea).toContain("Attention");
    // Understanding (reduce)
    expect(result.payload.contributions).toHaveLength(1);
    expect(result.payload.methodWalkthrough[0]?.step).toBe("Encode inputs");
    // Critique
    expect(result.payload.critique.weakestLink).toBe("Small sample size.");
    expect(result.payload.reproducibility).toBe("Code is released.");
    // Glossary (always bilingual)
    expect(result.payload.glossary[0]?.tr).toBe("Geri yayılım");
    expect(result.payload.glossary[0]?.en).toBe("Backpropagation");
    // Reflection
    expect(result.payload.soWhat).toContain("efficient training");
    // Usage + cost
    expect(result.usage.outputTokens).toBeGreaterThan(0);
    expect(result.usage.costUsd).toBeGreaterThan(0);
  });

  it("resolves citation chunkIds when the verbatim quote matches a chunk", async () => {
    const result = await runArticleAnalysis(baseArgs());
    // "to tackle a hard problem" appears verbatim in ck_0.
    const cite = result.payload.problemMotivation[0]?.citations?.[0];
    expect(cite?.chunkId).toBe("ck_0");
    // keyResults quote "accuracy of 99 percent" appears in ck_1.
    const resultCite = result.payload.keyResults[0]?.citations?.[0];
    expect(resultCite?.chunkId).toBe("ck_1");
  });

  it("stamps every citation with a verification verdict", async () => {
    const result = await runArticleAnalysis(baseArgs());
    expect(result.payload.problemMotivation[0]?.citations?.[0]).toMatchObject({
      verification: "exact",
      chunkId: "ck_0",
    });
  });

  it("flags a quote absent from the paper as unverified with no jump target", async () => {
    getChatProviderMock.mockReturnValue(
      routingProvider({
        reduce: {
          ...VALID.reduce,
          problemMotivation: [
            {
              text: "The problem is hard.",
              grounding: "source",
              citations: [
                { quote: "this sentence never appears anywhere in the paper" },
              ],
            },
          ],
        },
      }),
    );
    const result = await runArticleAnalysis(baseArgs());
    const cite = result.payload.problemMotivation[0]?.citations?.[0];
    expect(cite?.verification).toBe("unverified");
    expect(cite?.chunkId).toBeUndefined();
  });

  it("degrades to 'draft' with a fallbackReason when the Map stage is malformed", async () => {
    getChatProviderMock.mockReturnValue(routingProvider({ map: "malformed" }));
    const result = await runArticleAnalysis(baseArgs());

    expect(result.status).toBe("draft");
    // Spelled out: "map (1/11 sections)" read as "1 of 11 done" when it always
    // meant the opposite, and it named no cause.
    expect(result.fallbackReason).toContain("map (2 of 2 sections failed");
    expect(result.fallbackReason).toContain("no_json");
    // Other stages still produced a usable payload.
    expect(result.payload.tldr).toBe("A short plain-language summary.");
  });

  it("collapses repeated Map failure causes instead of listing one per section", async () => {
    listChunksBySourceMock.mockResolvedValue(manyChunks(6));
    getChatProviderMock.mockReturnValue(routingProvider({ map: "malformed" }));
    const result = await runArticleAnalysis(baseArgs());

    expect(result.fallbackReason).toContain("map (6 of 6 sections failed");
    expect(result.fallbackReason?.match(/no_json/g)).toHaveLength(1);
  });

  it("retries a shed Map section instead of downgrading the run to draft", async () => {
    vi.useFakeTimers();
    try {
      getChatProviderMock.mockReturnValue(shedsMapCalls(1));
      const running = runArticleAnalysis(baseArgs());
      await vi.advanceTimersByTimeAsync(5_000);
      const result = await running;

      expect(result.status).toBe("ready");
      expect(result.fallbackReason).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not retry a malformed Map section — same prompt, same answer", async () => {
    const inner = routingProvider({ map: "malformed" });
    let mapCalls = 0;
    getChatProviderMock.mockReturnValue({
      ...inner,
      streamChat(req: ChatRequest): ChatStreamHandle {
        if (stageOf(req) === "map") mapCalls += 1;
        return inner.streamChat(req);
      },
    });

    await runArticleAnalysis(baseArgs());

    expect(mapCalls).toBe(2);
  });

  it("caps how many Map sections are in flight at once", async () => {
    listChunksBySourceMock.mockResolvedValue(manyChunks(9));
    const probe = { peak: 0 };
    getChatProviderMock.mockReturnValue(concurrencyProbeProvider(probe));

    const result = await runArticleAnalysis(baseArgs());

    expect(result.status).toBe("ready");
    expect(probe.peak).toBe(MAP_CONCURRENCY);
  });

  it("reports Map progress monotonically as sections settle", async () => {
    listChunksBySourceMock.mockResolvedValue(manyChunks(6));
    const seen: number[] = [];
    await runArticleAnalysis({
      ...baseArgs(),
      onStage: (ev) => {
        if (ev.stage === "map") seen.push(ev.index);
      },
    });

    // Completion order varies; the number the UI renders must not.
    expect(seen).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("still produces a payload when a single specialist rejects", async () => {
    getChatProviderMock.mockReturnValue(routingProvider({ glossary: "error" }));
    const result = await runArticleAnalysis(baseArgs());

    expect(result.status).toBe("draft");
    expect(result.fallbackReason).toContain("glossary");
    expect(result.payload.glossary).toEqual([]);
    // Critique + reflection + synthesize unaffected.
    expect(result.payload.critique.weakestLink).toBe("Small sample size.");
    expect(result.payload.soWhat).toContain("efficient training");
  });

  it("throws ArticleAnalysisError('empty_source') when the source has no chunks", async () => {
    listChunksBySourceMock.mockResolvedValue([]);
    await expect(runArticleAnalysis(baseArgs())).rejects.toMatchObject({
      code: "empty_source",
    });
    await expect(runArticleAnalysis(baseArgs())).rejects.toBeInstanceOf(
      ArticleAnalysisError,
    );
  });

  it("throws no_credential when no credential is on file", async () => {
    resolveCredMock.mockResolvedValue(null);
    await expect(runArticleAnalysis(baseArgs())).rejects.toMatchObject({
      code: "no_credential",
    });
  });

  it("emits stage progress events", async () => {
    const events: string[] = [];
    await runArticleAnalysis({
      ...baseArgs(),
      onStage: (ev) => events.push(ev.stage),
    });
    expect(events).toContain("map");
    expect(events).toContain("reduce");
    expect(events).toContain("specialists");
    expect(events).toContain("synthesize");
    expect(events).toContain("done");
  });
});
