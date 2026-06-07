import { describe, expect, it, vi } from "vitest";

import type {
  ChatProvider,
  ChatRequest,
  ChatStreamHandle,
  StreamEvent,
  Usage,
} from "@/lib/ai/providers/types";

import type { SearchResultItem } from "../search/types";
import {
  extractFirstJsonObject,
  MAX_RESULTS,
  MIN_RESULTS,
  parseSynthesisOutput,
  runSynthesis,
  SynthesisError,
} from "../synthesis";

// ---------- helpers ----------

function mkResult(i: number): SearchResultItem {
  return {
    url: `https://example.com/${i}`,
    title: `Source ${i}`,
    description: `Description for source ${i}`,
  };
}

function mkResults(n: number): SearchResultItem[] {
  return Array.from({ length: n }, (_, i) => mkResult(i + 1));
}

async function* eventsOf(...events: StreamEvent[]): AsyncIterable<StreamEvent> {
  for (const e of events) yield e;
}

function mockProvider(events: StreamEvent[]): ChatProvider {
  const handle: ChatStreamHandle = {
    events: eventsOf(...events),
    abort: () => {
      // no-op for tests
    },
  };
  const provider: ChatProvider = {
    id: "anthropic",
    capabilities: {
      streaming: true,
      toolUse: "native",
      cacheControl: true,
      vision: false,
    },
    streamChat: (_req: ChatRequest) => handle,
  };
  return provider;
}

const VALID_OUTPUT = JSON.stringify({
  rows: [
    {
      metric: "Ana yöntem",
      metricEn: "Core method",
      values: ["DPO", "RLHF"],
    },
    {
      metric: "Veri",
      metricEn: "Data",
      values: ["Tercih çifti", "Etiketli"],
    },
    {
      metric: "Ölçek",
      metricEn: "Scale",
      values: ["1B–70B", "7B–70B"],
    },
    {
      metric: "Güçlü yön",
      metricEn: "Strength",
      values: ["Veri verimi", "Olgun ekosistem"],
    },
  ],
  insight: "İki yöntem örnek verimi konusunda farklı yaklaşımlar sunuyor.",
  insightEn: "The two methods take different approaches to sample efficiency.",
});

const HAPPY_EVENTS: StreamEvent[] = [
  {
    kind: "start",
    model: "claude-sonnet-4-6",
    usage: { input_tokens: 200 } as Usage,
  },
  { kind: "text", delta: VALID_OUTPUT.slice(0, 100) },
  { kind: "text", delta: VALID_OUTPUT.slice(100) },
  {
    kind: "delta",
    stopReason: "end_turn",
    usage: { output_tokens: 350 } as Usage,
  },
  { kind: "stop" },
];

// ---------- extractFirstJsonObject ----------

describe("extractFirstJsonObject", () => {
  it("returns the first balanced object even with preamble", () => {
    const text = `Here is the output:\n\n{"a":1,"b":{"c":"}"}}\n\nThanks!`;
    expect(extractFirstJsonObject(text)).toBe('{"a":1,"b":{"c":"}"}}');
  });

  it("returns null when no object found", () => {
    expect(extractFirstJsonObject("no object here")).toBeNull();
    expect(extractFirstJsonObject("")).toBeNull();
  });

  it("returns null when braces never balance", () => {
    expect(extractFirstJsonObject("{ partial")).toBeNull();
  });

  it("tolerates escaped braces inside string literals", () => {
    const text = `{"k":"a \\"} b"}`;
    expect(extractFirstJsonObject(text)).toBe(text);
  });
});

// ---------- parseSynthesisOutput ----------

describe("parseSynthesisOutput", () => {
  it("parses a valid JSON output with matching values length", () => {
    const parsed = parseSynthesisOutput(VALID_OUTPUT, 2);
    expect(parsed.rows).toHaveLength(4);
    expect(parsed.rows[0]?.metric).toBe("Ana yöntem");
    expect(parsed.rows[0]?.values).toEqual(["DPO", "RLHF"]);
    expect(parsed.insight.length).toBeGreaterThan(0);
    expect(parsed.insightEn.length).toBeGreaterThan(0);
  });

  it("throws parse_error when buffer has no JSON", () => {
    expect(() => parseSynthesisOutput("nope", 2)).toThrow(SynthesisError);
    try {
      parseSynthesisOutput("nope", 2);
    } catch (err) {
      expect((err as SynthesisError).code).toBe("parse_error");
    }
  });

  it("throws shape_error when values length mismatches", () => {
    const bad = JSON.stringify({
      rows: [
        { metric: "X", metricEn: "X", values: ["only-one"] },
      ],
      insight: "i",
      insightEn: "i",
    });
    try {
      parseSynthesisOutput(bad, 2);
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(SynthesisError);
      expect((err as SynthesisError).code).toBe("shape_error");
    }
  });

  it("throws shape_error when insight is missing", () => {
    const bad = JSON.stringify({
      rows: [{ metric: "X", metricEn: "X", values: ["a", "b"] }],
      insightEn: "i",
    });
    try {
      parseSynthesisOutput(bad, 2);
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as SynthesisError).code).toBe("shape_error");
    }
  });

  it("coerces non-string values to '—' fallback string", () => {
    const bad = JSON.stringify({
      rows: [{ metric: "X", metricEn: "X", values: [null, 42] }],
      insight: "i",
      insightEn: "i",
    });
    const parsed = parseSynthesisOutput(bad, 2);
    expect(parsed.rows[0]?.values).toEqual(["—", "42"]);
  });
});

// ---------- runSynthesis ----------

describe("runSynthesis", () => {
  it("happy path: streams events, parses JSON, returns rows + insight + usage", async () => {
    const provider = mockProvider(HAPPY_EVENTS);
    const out = await runSynthesis(
      {
        results: mkResults(2),
        apiKey: "sk-test",
        modelId: "anthropic::claude-sonnet-4-6",
      },
      { getProvider: () => provider },
    );
    expect(out.rows.length).toBeGreaterThanOrEqual(4);
    expect(out.rows[0]?.values).toHaveLength(2);
    expect(out.insight).toContain("yaklaşım");
    expect(out.insightEn).toContain("approaches");
    expect(out.usage.input_tokens).toBe(200);
    expect(out.usage.output_tokens).toBe(350);
    expect(out.model).toBe("claude-sonnet-4-6");
  });

  it("rejects when results.length < MIN_RESULTS", async () => {
    await expect(
      runSynthesis({
        results: mkResults(MIN_RESULTS - 1),
        apiKey: "sk",
        modelId: "anthropic::claude-sonnet-4-6",
      }),
    ).rejects.toMatchObject({ code: "too_few_results" });
  });

  it("rejects when results.length > MAX_RESULTS", async () => {
    await expect(
      runSynthesis({
        results: mkResults(MAX_RESULTS + 1),
        apiKey: "sk",
        modelId: "anthropic::claude-sonnet-4-6",
      }),
    ).rejects.toMatchObject({ code: "too_many_results" });
  });

  it("rejects unknown model id", async () => {
    await expect(
      runSynthesis(
        {
          results: mkResults(2),
          apiKey: "sk",
          modelId: "nope::nope",
        },
        { getProvider: () => mockProvider(HAPPY_EVENTS) },
      ),
    ).rejects.toMatchObject({ code: "unknown_model" });
  });

  it("propagates provider stream error", async () => {
    const provider = mockProvider([
      { kind: "start", model: "x", usage: {} as Usage },
      { kind: "error", status: 500, message: "boom" },
    ]);
    await expect(
      runSynthesis(
        {
          results: mkResults(2),
          apiKey: "sk",
          modelId: "anthropic::claude-sonnet-4-6",
        },
        { getProvider: () => provider },
      ),
    ).rejects.toMatchObject({ code: "stream_error" });
  });

  it("propagates parse error when buffer is not JSON", async () => {
    const provider = mockProvider([
      { kind: "start", model: "x", usage: {} as Usage },
      { kind: "text", delta: "I am not JSON, sorry." },
      { kind: "stop" },
    ]);
    await expect(
      runSynthesis(
        {
          results: mkResults(2),
          apiKey: "sk",
          modelId: "anthropic::claude-sonnet-4-6",
        },
        { getProvider: () => provider },
      ),
    ).rejects.toMatchObject({ code: "parse_error" });
  });

  it("passes apiKey + model + system + user prompt through to the provider", async () => {
    const provider = mockProvider(HAPPY_EVENTS);
    const spy = vi.spyOn(provider, "streamChat");
    await runSynthesis(
      {
        results: mkResults(2),
        apiKey: "sk-123",
        modelId: "anthropic::claude-sonnet-4-6",
      },
      { getProvider: () => provider },
    );
    expect(spy).toHaveBeenCalledTimes(1);
    const req = spy.mock.calls[0]?.[0] as ChatRequest;
    expect(req.apiKey).toBe("sk-123");
    expect(req.model).toBe("claude-sonnet-4-6");
    expect(req.system[0]?.type).toBe("text");
    const systemBlock = req.system[0];
    if (systemBlock?.type !== "text") {
      throw new Error("expected text system block");
    }
    expect(systemBlock.text).toMatch(/comparison/i);
    expect(req.messages[0]?.role).toBe("user");
    const userMsg = req.messages[0];
    if (typeof userMsg?.content === "string") {
      expect(userMsg.content).toContain("Source 1");
      expect(userMsg.content).toContain("Source 2");
    } else {
      throw new Error("expected string user content");
    }
  });

  it("forwards authKind=oauth to provider opts and request", async () => {
    const provider = mockProvider(HAPPY_EVENTS);
    const streamSpy = vi.spyOn(provider, "streamChat");
    const getProvider = vi.fn(() => provider);
    await runSynthesis(
      {
        results: mkResults(2),
        apiKey: "tok",
        modelId: "anthropic::claude-sonnet-4-6",
        authKind: "oauth",
      },
      { getProvider },
    );
    expect(getProvider).toHaveBeenCalledWith("anthropic", { authKind: "oauth" });
    const req = streamSpy.mock.calls[0]?.[0] as ChatRequest;
    expect(req.authKind).toBe("oauth");
  });
});
