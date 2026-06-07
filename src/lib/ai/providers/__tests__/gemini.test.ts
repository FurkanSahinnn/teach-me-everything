import { describe, expect, it } from "vitest";
import { consumeGeminiStream, GeminiChatProvider } from "../gemini";
import { PROVIDER_PRESETS } from "../presets";
import type { StreamEvent } from "../types";

function makeBody(...frames: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
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

describe("consumeGeminiStream", () => {
  it("emits start and text deltas for plain text frames", async () => {
    const body = makeBody(
      JSON.stringify({
        candidates: [{ content: { parts: [{ text: "hello" }] } }],
      }),
    );
    const events = await collect(
      consumeGeminiStream(body, new AbortController().signal, {
        fallbackModel: "gemini-2.5-flash",
      }),
    );
    const start = events.find((e) => e.kind === "start");
    expect(start).toBeDefined();
    const text = events
      .filter((e) => e.kind === "text")
      .map((e) => (e as { delta: string }).delta)
      .join("");
    expect(text).toBe("hello");
  });

  it("translates functionCall part into tool_start/tool_input_delta/tool_stop", async () => {
    const body = makeBody(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [{ functionCall: { name: "add", args: { q: "hi" } } }],
            },
          },
        ],
      }),
    );
    const events = await collect(
      consumeGeminiStream(body, new AbortController().signal),
    );
    const toolStart = events.find((e) => e.kind === "tool_start") as
      | { kind: "tool_start"; id: string; name: string; index: number }
      | undefined;
    expect(toolStart?.name).toBe("add");
    expect(toolStart?.id).toMatch(/^gemini-/);
    const partial = events.find((e) => e.kind === "tool_input_delta") as
      | { kind: "tool_input_delta"; partial: string }
      | undefined;
    expect(partial?.partial).toBe('{"q":"hi"}');
    expect(events.find((e) => e.kind === "tool_stop")).toBeDefined();
  });

  it("exposes preset id and capabilities on GeminiChatProvider", () => {
    const preset = PROVIDER_PRESETS["google-gemini"]!;
    const provider = new GeminiChatProvider({ preset });
    expect(provider.id).toBe("google-gemini");
    expect(provider.capabilities).toEqual(preset.capabilities);
  });

  it("consumes only the first candidate when multiple are present", async () => {
    const body = makeBody(
      JSON.stringify({
        candidates: [
          { content: { parts: [{ text: "first" }] } },
          { content: { parts: [{ text: "second" }] } },
        ],
      }),
    );
    const events = await collect(
      consumeGeminiStream(body, new AbortController().signal),
    );
    const text = events
      .filter((e) => e.kind === "text")
      .map((e) => (e as { delta: string }).delta)
      .join("");
    expect(text).toBe("first");
    expect(text).not.toContain("second");
  });

  it("ignores safetyRatings field and continues normal flow", async () => {
    const body = makeBody(
      JSON.stringify({
        candidates: [{ content: { parts: [{ text: "ok" }] } }],
        safetyRatings: [{ category: "HARM_CATEGORY_HARASSMENT", probability: "LOW" }],
      }),
    );
    const events = await collect(
      consumeGeminiStream(body, new AbortController().signal),
    );
    expect(events.some((e) => e.kind === "error")).toBe(false);
    expect(events.some((e) => e.kind === "text")).toBe(true);
    expect(events.some((e) => e.kind === "stop")).toBe(true);
  });

  it("normalizes finishReason values", async () => {
    const cases: Array<[string | undefined, string | null]> = [
      ["STOP", "end_turn"],
      ["MAX_TOKENS", "max_tokens"],
      ["TOOL_USE", "tool_use"],
      ["SAFETY", "content_filter"],
      ["RECITATION", "content_filter"],
      [undefined, null],
    ];
    for (const [input, expected] of cases) {
      const candidate: Record<string, unknown> = {
        content: { parts: [{ text: "x" }] },
      };
      if (input !== undefined) candidate.finishReason = input;
      const body = makeBody(JSON.stringify({ candidates: [candidate] }));
      const events = await collect(
        consumeGeminiStream(body, new AbortController().signal),
      );
      const delta = events.find((e) => e.kind === "delta") as
        | { kind: "delta"; stopReason: string | null }
        | undefined;
      expect(delta?.stopReason).toBe(expected);
    }
  });

  it("emits error and returns when promptFeedback.blockReason is set", async () => {
    const body = makeBody(
      JSON.stringify({ promptFeedback: { blockReason: "SAFETY" } }),
    );
    const events = await collect(
      consumeGeminiStream(body, new AbortController().signal),
    );
    const err = events.find((e) => e.kind === "error") as
      | { kind: "error"; status: number; message: string }
      | undefined;
    expect(err?.status).toBe(400);
    expect(err?.message).toBe("safety_block: SAFETY");
    expect(events.some((e) => e.kind === "stop")).toBe(false);
  });

  it("propagates usageMetadata into the final delta event", async () => {
    const body = makeBody(
      JSON.stringify({
        candidates: [{ content: { parts: [{ text: "hi" }] } }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20 },
      }),
    );
    const events = await collect(
      consumeGeminiStream(body, new AbortController().signal),
    );
    const delta = events.find((e) => e.kind === "delta") as
      | { kind: "delta"; usage: { input_tokens?: number; output_tokens?: number } }
      | undefined;
    expect(delta?.usage.input_tokens).toBe(10);
    expect(delta?.usage.output_tokens).toBe(20);
  });

  it("yields start exactly once across multiple frames", async () => {
    const body = makeBody(
      JSON.stringify({ candidates: [{ content: { parts: [{ text: "a" }] } }] }),
      JSON.stringify({ candidates: [{ content: { parts: [{ text: "b" }] } }] }),
      JSON.stringify({ candidates: [{ content: { parts: [{ text: "c" }] } }] }),
    );
    const events = await collect(
      consumeGeminiStream(body, new AbortController().signal),
    );
    const startCount = events.filter((e) => e.kind === "start").length;
    expect(startCount).toBe(1);
  });

  it("emits a final delta and stop event when the body closes", async () => {
    const body = makeBody(
      JSON.stringify({
        candidates: [
          { content: { parts: [{ text: "done" }] }, finishReason: "STOP" },
        ],
      }),
    );
    const events = await collect(
      consumeGeminiStream(body, new AbortController().signal),
    );
    const delta = events.find((e) => e.kind === "delta") as
      | { kind: "delta"; stopReason: string | null }
      | undefined;
    expect(delta?.stopReason).toBe("end_turn");
    expect(events[events.length - 1]?.kind).toBe("stop");
  });
});
