import { describe, it, expect } from "vitest";
import { consumeAnthropicStream } from "../anthropic";
import type { StreamEvent } from "../types";

function toStream(parts: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of parts) controller.enqueue(encoder.encode(part));
      controller.close();
    },
  });
}

function frame(event: string, data: Record<string, unknown> | string): string {
  const payload = typeof data === "string" ? data : JSON.stringify(data);
  return `event: ${event}\ndata: ${payload}\n\n`;
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<StreamEvent[]> {
  const out: StreamEvent[] = [];
  const ac = new AbortController();
  for await (const ev of consumeAnthropicStream(stream, ac.signal)) out.push(ev);
  return out;
}

describe("consumeAnthropicStream", () => {
  it("emits start/text/delta/stop for a text-only response", async () => {
    const stream = toStream([
      frame("message_start", {
        type: "message_start",
        message: { model: "claude-sonnet-4-6", usage: { input_tokens: 10 } },
      }),
      frame("content_block_delta", {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "Hello" },
      }),
      frame("content_block_delta", {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: " world" },
      }),
      frame("message_delta", {
        type: "message_delta",
        delta: { stop_reason: "end_turn" },
        usage: { output_tokens: 2 },
      }),
      frame("message_stop", { type: "message_stop" }),
    ]);
    const events = await collect(stream);
    const kinds = events.map((e) => e.kind);
    expect(kinds).toContain("start");
    expect(kinds).toContain("text");
    expect(kinds).toContain("delta");
    expect(kinds).toContain("stop");
    const text = events.filter((e) => e.kind === "text").map((e) => (e as { delta: string }).delta).join("");
    expect(text).toBe("Hello world");
  });

  it("surfaces cache_read / cache_creation tokens through usage", async () => {
    const stream = toStream([
      frame("message_start", {
        type: "message_start",
        message: {
          model: "claude-sonnet-4-6",
          usage: { input_tokens: 5, cache_read_input_tokens: 12, cache_creation_input_tokens: 4 },
        },
      }),
      frame("message_stop", { type: "message_stop" }),
    ]);
    const events = await collect(stream);
    const start = events.find((e) => e.kind === "start") as
      | { kind: "start"; usage: { cache_read_input_tokens?: number; cache_creation_input_tokens?: number } }
      | undefined;
    expect(start?.usage.cache_read_input_tokens).toBe(12);
    expect(start?.usage.cache_creation_input_tokens).toBe(4);
  });

  it("emits tool_start / tool_input_delta / tool_stop for tool use", async () => {
    const stream = toStream([
      frame("content_block_start", {
        type: "content_block_start",
        index: 0,
        content_block: { type: "tool_use", id: "tool_1", name: "add_flashcard" },
      }),
      frame("content_block_delta", {
        type: "content_block_delta",
        index: 0,
        delta: { type: "input_json_delta", partial_json: '{"question":' },
      }),
      frame("content_block_delta", {
        type: "content_block_delta",
        index: 0,
        delta: { type: "input_json_delta", partial_json: '"What?"}' },
      }),
      frame("content_block_stop", { type: "content_block_stop", index: 0 }),
      frame("message_stop", { type: "message_stop" }),
    ]);
    const events = await collect(stream);
    const toolStart = events.find((e) => e.kind === "tool_start") as
      | { kind: "tool_start"; id: string; name: string }
      | undefined;
    expect(toolStart?.id).toBe("tool_1");
    expect(toolStart?.name).toBe("add_flashcard");
    const partials = events
      .filter((e) => e.kind === "tool_input_delta")
      .map((e) => (e as { partial: string }).partial)
      .join("");
    expect(partials).toBe('{"question":"What?"}');
    expect(events.find((e) => e.kind === "tool_stop")).toBeDefined();
  });

  it("yields a single error event when payload type is 'error'", async () => {
    const stream = toStream([
      frame("error", { type: "error", error: { message: "rate limited" } }),
    ]);
    const events = await collect(stream);
    const err = events.find((e) => e.kind === "error") as
      | { kind: "error"; status: number; message: string }
      | undefined;
    expect(err?.message).toBe("rate limited");
  });

  it("ignores ping frames and malformed JSON", async () => {
    const stream = toStream([
      "event: ping\ndata: {}\n\n",
      "event: message_start\ndata: NOT_JSON\n\n",
      frame("message_stop", { type: "message_stop" }),
    ]);
    const events = await collect(stream);
    expect(events.some((e) => e.kind === "stop")).toBe(true);
    expect(events.some((e) => e.kind === "error")).toBe(false);
  });

  it("yields 'abort' when the signal is already aborted", async () => {
    const stream = toStream([
      frame("message_start", { type: "message_start", message: { model: "x" } }),
    ]);
    const ac = new AbortController();
    ac.abort();
    const out: StreamEvent[] = [];
    for await (const ev of consumeAnthropicStream(stream, ac.signal)) out.push(ev);
    expect(out[0]?.kind).toBe("abort");
  });
});

// Phase 5.5.C.B — `kind: "raw"` pass-through. Web-search adapters route
// raw provider payloads through `parseStreamEvent`; the consumer must
// emit one raw event per parsed payload BEFORE the typed yield so the
// adapter sees usage ticks (`message_delta.usage.server_tool_use`) and
// citation blocks (`content_block_start.content_block.type ===
// "web_search_tool_result"`) without each provider importing the adapter
// layer directly.
describe("consumeAnthropicStream — raw event pass-through", () => {
  it("yields a raw event for every parsed payload alongside typed events", async () => {
    const stream = toStream([
      frame("message_start", {
        type: "message_start",
        message: { model: "claude-sonnet-4-6", usage: { input_tokens: 3 } },
      }),
      frame("content_block_delta", {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "hi" },
      }),
      frame("message_stop", { type: "message_stop" }),
    ]);
    const events = await collect(stream);
    const rawEvents = events.filter((e) => e.kind === "raw");
    // 3 SSE frames → 3 parsed payloads → 3 raw events. Typed yields are
    // separate (start + text + (no typed for message_stop equivalent…
    // wait — message_stop emits "stop"). Either way ≥ 3 raw events.
    expect(rawEvents.length).toBe(3);
    const rawTypes = rawEvents.map(
      (e) => (e as { payload: { type?: string } }).payload.type,
    );
    expect(rawTypes).toEqual([
      "message_start",
      "content_block_delta",
      "message_stop",
    ]);
  });

  it("emits the raw event before the typed yield for the same payload", async () => {
    // Order matters: the chat handler accumulates web citations from raw
    // events; the existing typed branches (text/tool_start/...) may flush
    // to Dexie. If raw came after, an adapter listener that called
    // setMessageWebCitations could race against patchMessageUsage written
    // by the trailing typed event.
    const stream = toStream([
      frame("message_start", {
        type: "message_start",
        message: { model: "claude-sonnet-4-6", usage: {} },
      }),
    ]);
    const events = await collect(stream);
    const startIdx = events.findIndex((e) => e.kind === "start");
    const rawIdx = events.findIndex((e) => e.kind === "raw");
    expect(rawIdx).toBeGreaterThanOrEqual(0);
    expect(startIdx).toBeGreaterThanOrEqual(0);
    expect(rawIdx).toBeLessThan(startIdx);
  });

  it("forwards web_search_tool_result content blocks via raw payloads", async () => {
    // Adapter contract: claude.parseStreamEvent reads
    // `e.content_block.content[]` when `e.type === "content_block_start"
    // && e.content_block.type === "web_search_tool_result"`. The consumer
    // doesn't emit a typed event for these blocks (no tool_use case), so
    // the raw pass-through is the only surface that delivers them.
    const stream = toStream([
      frame("content_block_start", {
        type: "content_block_start",
        index: 2,
        content_block: {
          type: "web_search_tool_result",
          content: [
            {
              type: "web_search_result",
              url: "https://example.com/one",
              title: "First",
              page_age: "2026-05-01",
            },
          ],
        },
      }),
    ]);
    const events = await collect(stream);
    const raw = events.filter((e) => e.kind === "raw")[0] as
      | {
          kind: "raw";
          payload: { type?: string; content_block?: { type?: string } };
        }
      | undefined;
    expect(raw?.payload.type).toBe("content_block_start");
    expect(raw?.payload.content_block?.type).toBe("web_search_tool_result");
  });
});
