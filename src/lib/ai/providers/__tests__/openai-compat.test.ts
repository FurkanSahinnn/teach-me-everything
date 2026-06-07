import { afterEach, describe, expect, it, vi } from "vitest";
import {
  OpenAICompatChatProvider,
  consumeOpenAICompatStream,
} from "../openai-compat";
import { PROVIDER_PRESETS } from "../presets";
import type { StreamEvent } from "../types";

function makeBody(...frames: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(ctrl) {
      for (const f of frames) ctrl.enqueue(enc.encode(`data: ${f}\n\n`));
      ctrl.close();
    },
  });
}

async function collect(
  stream: AsyncIterable<StreamEvent>,
): Promise<StreamEvent[]> {
  const out: StreamEvent[] = [];
  for await (const ev of stream) out.push(ev);
  return out;
}

describe("consumeOpenAICompatStream", () => {
  it("emits text deltas from delta.content frames", async () => {
    const body = makeBody(
      JSON.stringify({
        model: "gpt-5-mini",
        choices: [{ index: 0, delta: { content: "hello" } }],
      }),
      "[DONE]",
    );
    const ac = new AbortController();
    const events = await collect(consumeOpenAICompatStream(body, ac.signal));
    const text = events
      .filter((e) => e.kind === "text")
      .map((e) => (e as { delta: string }).delta)
      .join("");
    expect(text).toBe("hello");
  });

  it("yields a start event on the first delta frame with model from payload", async () => {
    const body = makeBody(
      JSON.stringify({
        model: "llama-3.3-70b-versatile",
        choices: [{ index: 0, delta: { content: "hi" } }],
      }),
      "[DONE]",
    );
    const ac = new AbortController();
    const events = await collect(
      consumeOpenAICompatStream(body, ac.signal, { fallbackModel: "fallback" }),
    );
    const start = events.find((e) => e.kind === "start") as
      | { kind: "start"; model: string }
      | undefined;
    expect(start?.model).toBe("llama-3.3-70b-versatile");
    expect(events[0]?.kind).toBe("start");
  });

  it("falls back to opts.fallbackModel when payload omits model", async () => {
    const body = makeBody(
      JSON.stringify({ choices: [{ index: 0, delta: { content: "x" } }] }),
      "[DONE]",
    );
    const ac = new AbortController();
    const events = await collect(
      consumeOpenAICompatStream(body, ac.signal, { fallbackModel: "groq-x" }),
    );
    const start = events.find((e) => e.kind === "start") as
      | { kind: "start"; model: string }
      | undefined;
    expect(start?.model).toBe("groq-x");
  });

  it("emits tool_start once and tool_input_delta for incremental arguments", async () => {
    const body = makeBody(
      JSON.stringify({
        model: "m",
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                { index: 0, id: "call_x", function: { name: "add" } },
              ],
            },
          },
        ],
      }),
      JSON.stringify({
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [{ index: 0, function: { arguments: '{"a"' } }],
            },
          },
        ],
      }),
      JSON.stringify({
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [{ index: 0, function: { arguments: ":1}" } }],
            },
          },
        ],
      }),
      "[DONE]",
    );
    const ac = new AbortController();
    const events = await collect(consumeOpenAICompatStream(body, ac.signal));
    const toolStarts = events.filter((e) => e.kind === "tool_start");
    expect(toolStarts).toHaveLength(1);
    expect(toolStarts[0]).toMatchObject({ index: 0, id: "call_x", name: "add" });
    const partials = events
      .filter((e) => e.kind === "tool_input_delta")
      .map((e) => (e as { partial: string }).partial)
      .join("");
    expect(partials).toBe('{"a":1}');
  });

  it("closes all open tool slots on finish_reason 'tool_calls' and emits delta", async () => {
    const body = makeBody(
      JSON.stringify({
        model: "m",
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                { index: 0, id: "call_a", function: { name: "ta" } },
              ],
            },
          },
        ],
      }),
      JSON.stringify({
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                { index: 1, id: "call_b", function: { name: "tb" } },
              ],
            },
          },
        ],
      }),
      JSON.stringify({
        choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
      }),
      "[DONE]",
    );
    const ac = new AbortController();
    const events = await collect(consumeOpenAICompatStream(body, ac.signal));
    const stops = events.filter((e) => e.kind === "tool_stop");
    expect(stops).toHaveLength(2);
    const stopIdx = stops.map((e) => (e as { index: number }).index).sort();
    expect(stopIdx).toEqual([0, 1]);
    const delta = events.find((e) => e.kind === "delta") as
      | { kind: "delta"; stopReason: string | null }
      | undefined;
    expect(delta?.stopReason).toBe("tool_use");
  });

  it("normalizes finish_reason values to anthropic-style stopReason", async () => {
    async function runWith(reason: string): Promise<string | null> {
      const body = makeBody(
        JSON.stringify({
          model: "m",
          choices: [{ index: 0, delta: { content: "x" }, finish_reason: reason }],
        }),
        "[DONE]",
      );
      const ac = new AbortController();
      const events = await collect(consumeOpenAICompatStream(body, ac.signal));
      const delta = events.find((e) => e.kind === "delta") as
        | { kind: "delta"; stopReason: string | null }
        | undefined;
      return delta?.stopReason ?? null;
    }
    expect(await runWith("stop")).toBe("end_turn");
    expect(await runWith("length")).toBe("max_tokens");
    expect(await runWith("tool_calls")).toBe("tool_use");
    expect(await runWith("content_filter")).toBe("content_filter");
  });

  it("emits a stop event when [DONE] sentinel arrives", async () => {
    const body = makeBody(
      JSON.stringify({
        model: "m",
        choices: [{ index: 0, delta: { content: "a" } }],
      }),
      "[DONE]",
    );
    const ac = new AbortController();
    const events = await collect(consumeOpenAICompatStream(body, ac.signal));
    expect(events.at(-1)?.kind).toBe("stop");
  });

  it("propagates usage tokens onto the trailing delta event", async () => {
    const body = makeBody(
      JSON.stringify({
        model: "m",
        choices: [{ index: 0, delta: { content: "x" } }],
      }),
      JSON.stringify({
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 20 },
      }),
      "[DONE]",
    );
    const ac = new AbortController();
    const events = await collect(consumeOpenAICompatStream(body, ac.signal));
    const delta = events.find((e) => e.kind === "delta") as
      | {
          kind: "delta";
          usage: { input_tokens?: number; output_tokens?: number };
        }
      | undefined;
    expect(delta?.usage.input_tokens).toBe(10);
    expect(delta?.usage.output_tokens).toBe(20);
  });

  it("yields an error event for payload.error and continues parsing", async () => {
    const body = makeBody(
      JSON.stringify({
        model: "m",
        choices: [{ index: 0, delta: { content: "ok" } }],
      }),
      JSON.stringify({ error: { message: "rate limit" } }),
      "[DONE]",
    );
    const ac = new AbortController();
    const events = await collect(consumeOpenAICompatStream(body, ac.signal));
    const err = events.find((e) => e.kind === "error") as
      | { kind: "error"; status: number; message: string }
      | undefined;
    expect(err?.status).toBe(500);
    expect(err?.message).toBe("rate limit");
    expect(events.at(-1)?.kind).toBe("stop");
  });

  it("yields abort and returns early when signal is pre-aborted", async () => {
    const body = makeBody(
      JSON.stringify({
        model: "m",
        choices: [{ index: 0, delta: { content: "never" } }],
      }),
      "[DONE]",
    );
    const ac = new AbortController();
    ac.abort();
    const events = await collect(consumeOpenAICompatStream(body, ac.signal));
    expect(events[0]?.kind).toBe("abort");
    expect(events.some((e) => e.kind === "text")).toBe(false);
  });

  it("ignores malformed JSON frames without surfacing an error", async () => {
    const body = makeBody(
      "NOT_JSON",
      JSON.stringify({
        model: "m",
        choices: [{ index: 0, delta: { content: "ok" } }],
      }),
      "[DONE]",
    );
    const ac = new AbortController();
    const events = await collect(consumeOpenAICompatStream(body, ac.signal));
    expect(events.some((e) => e.kind === "error")).toBe(false);
    expect(events.some((e) => e.kind === "text")).toBe(true);
  });
});

describe("OpenAICompatChatProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("exposes preset id and capabilities on the instance", () => {
    const provider = new OpenAICompatChatProvider({
      preset: PROVIDER_PRESETS.groq!,
    });
    expect(provider.id).toBe("groq");
    expect(provider.capabilities).toEqual(PROVIDER_PRESETS.groq!.capabilities);
  });

  it("can be constructed for openai and deepseek presets with matching ids", () => {
    const oa = new OpenAICompatChatProvider({ preset: PROVIDER_PRESETS.openai! });
    const ds = new OpenAICompatChatProvider({
      preset: PROVIDER_PRESETS.deepseek!,
    });
    expect(oa.id).toBe("openai");
    expect(ds.id).toBe("deepseek");
    expect(oa.capabilities.toolUse).toBe("native");
    expect(ds.capabilities.streaming).toBe(true);
  });

  it("uses max_completion_tokens for native OpenAI chat requests", async () => {
    let capturedBody: Record<string, unknown> = {};
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url, init) => {
        capturedBody = JSON.parse(String((init as RequestInit).body));
        return Promise.resolve(
          new Response(makeBody("[DONE]"), {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          }),
        );
      }),
    );
    const provider = new OpenAICompatChatProvider({ preset: PROVIDER_PRESETS.openai! });

    await collect(
      provider.streamChat({
        apiKey: "sk-test",
        model: "gpt-5-mini",
        system: [],
        messages: [{ role: "user", content: "ping" }],
        maxTokens: 12,
      }).events,
    );

    expect(capturedBody.max_completion_tokens).toBe(12);
    expect(capturedBody.max_tokens).toBeUndefined();
  });

  it("keeps max_tokens for non-OpenAI compatible chat requests", async () => {
    let capturedBody: Record<string, unknown> = {};
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url, init) => {
        capturedBody = JSON.parse(String((init as RequestInit).body));
        return Promise.resolve(
          new Response(makeBody("[DONE]"), {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          }),
        );
      }),
    );
    const provider = new OpenAICompatChatProvider({ preset: PROVIDER_PRESETS.deepseek! });

    await collect(
      provider.streamChat({
        apiKey: "sk-test",
        model: "deepseek-chat",
        system: [],
        messages: [{ role: "user", content: "ping" }],
        maxTokens: 12,
      }).events,
    );

    expect(capturedBody.max_tokens).toBe(12);
    expect(capturedBody.max_completion_tokens).toBeUndefined();
  });
});
