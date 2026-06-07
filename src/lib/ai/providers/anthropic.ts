import { isTauriEnvWithOverride } from "@/lib/tauri/env";
import { tauriFetch } from "@/lib/tauri/fetch";
import { buildChatUpstream, type ChatProxyBody } from "@/lib/ai/upstream/chat-request";
import type {
  ChatProvider,
  ChatRequest,
  ChatStreamHandle,
  ProviderCapabilities,
  StreamEvent,
  Usage,
} from "./types";

const SSE_MIME = "text/event-stream";

type SSEFrame = { event: string; data: string };

// Anthropic SSE payload shape is canon — adapter normalises it into provider-agnostic StreamEvent.
type AnthropicStreamPayload =
  | {
      type: "message_start";
      message?: { model?: string; usage?: Usage };
    }
  | {
      type: "content_block_start";
      index?: number;
      content_block?: {
        type?: string;
        id?: string;
        name?: string;
      };
    }
  | {
      type: "content_block_delta";
      index?: number;
      delta?: { type?: string; text?: string; partial_json?: string };
    }
  | {
      type: "content_block_stop";
      index?: number;
    }
  | {
      type: "message_delta";
      delta?: { stop_reason?: string | null };
      usage?: Usage;
    }
  | { type: "message_stop" }
  | { type: "ping" }
  | { type: "error"; error?: { message?: string } };

export class AnthropicChatProvider implements ChatProvider {
  readonly id = "anthropic" as const;
  readonly capabilities: ProviderCapabilities = {
    cacheControl: true,
    toolUse: "native",
    streaming: true,
    vision: true,
  };

  streamChat(req: ChatRequest): ChatStreamHandle {
    const controller = new AbortController();
    const signal = req.signal
      ? mergeSignals(controller.signal, req.signal)
      : controller.signal;

    async function* run(): AsyncGenerator<StreamEvent> {
      // Same JSON shape the `/api/ai/chat` proxy expects — the `provider`
      // hint + `authKind` are stripped by the upstream builder so the wire
      // shape is identical to what the proxy would have produced.
      const proxyBody: ChatProxyBody = {
        provider: "anthropic",
        model: req.model,
        system: req.system,
        messages: req.messages,
        max_tokens: req.maxTokens ?? 1024,
        ...(req.tools && req.tools.length > 0 ? { tools: req.tools } : {}),
        ...(req.tool_choice ? { tool_choice: req.tool_choice } : {}),
        ...(req.authKind ? { authKind: req.authKind } : {}),
      };

      let response: Response;
      try {
        if (isTauriEnvWithOverride()) {
          // Tauri: call Anthropic upstream directly via plugin-http (no
          // CORS, no /api/ai/* dependency — static export has no SSR).
          const built = buildChatUpstream(proxyBody, req.apiKey);
          if (!built.ok) {
            yield {
              kind: "error",
              status: 400,
              message: `${built.error.code}: ${built.error.message}`,
            };
            return;
          }
          response = await tauriFetch(built.request.url, {
            method: "POST",
            signal,
            headers: built.request.headers,
            body: built.request.body,
          });
        } else {
          response = await fetch("/api/ai/chat", {
            method: "POST",
            signal,
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${req.apiKey}`,
            },
            body: JSON.stringify(proxyBody),
          });
        }
      } catch (err) {
        if (signal.aborted) {
          yield { kind: "abort" };
          return;
        }
        yield {
          kind: "error",
          status: 0,
          message: err instanceof Error ? err.message : "Network error",
        };
        return;
      }

      if (!response.ok || !response.body) {
        let message = `HTTP ${response.status}`;
        let code: string | undefined;
        try {
          const errBody = (await response.json()) as {
            code?: string;
            error?: string;
          };
          message = errBody.error ?? message;
          code = errBody.code;
        } catch {
          /* ignore */
        }
        yield {
          kind: "error",
          status: response.status,
          message: code ? `${code}: ${message}` : message,
        };
        return;
      }

      const ct = response.headers.get("content-type") ?? "";
      // Anthropic upstream emits `text/event-stream; charset=utf-8`; the
      // proxy preserves this. Some Tauri http-plugin builds wrap the
      // header value with extra params — `startsWith` covers both.
      if (!ct.startsWith(SSE_MIME) && !ct.includes("event-stream")) {
        yield {
          kind: "error",
          status: response.status,
          message: "Unexpected response type",
        };
        return;
      }

      for await (const event of consumeAnthropicStream(response.body, signal, {
        fallbackModel: req.model,
      })) {
        yield event;
      }
    }

    return { events: run(), abort: () => controller.abort() };
  }
}

export async function* consumeAnthropicStream(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  opts: { fallbackModel?: string } = {},
): AsyncGenerator<StreamEvent> {
  const usage: Usage = {};
  let model = opts.fallbackModel ?? "";
  try {
    for await (const frame of parseSSE(body)) {
      if (signal.aborted) {
        yield { kind: "abort" };
        return;
      }
      if (frame.event === "ping") continue;
      let payload: AnthropicStreamPayload;
      try {
        payload = JSON.parse(frame.data) as AnthropicStreamPayload;
      } catch {
        continue;
      }
      // Phase 5.5.C.B — surface the raw payload before any typed yield so
      // web-search adapters (claude.ts) can pick out web_search_tool_result
      // content blocks and message_delta usage ticks. The handler ignores
      // this when no adapter is wired.
      yield { kind: "raw", payload };
      if (payload.type === "message_start") {
        model = payload.message?.model ?? model;
        if (payload.message?.usage) Object.assign(usage, payload.message.usage);
        yield { kind: "start", model, usage: { ...usage } };
      } else if (payload.type === "content_block_start") {
        const block = payload.content_block;
        if (
          block?.type === "tool_use" &&
          typeof block.id === "string" &&
          typeof block.name === "string"
        ) {
          yield {
            kind: "tool_start",
            index: payload.index ?? 0,
            id: block.id,
            name: block.name,
          };
        }
      } else if (payload.type === "content_block_delta") {
        if (
          payload.delta?.type === "text_delta" &&
          typeof payload.delta.text === "string"
        ) {
          yield { kind: "text", delta: payload.delta.text };
        } else if (
          payload.delta?.type === "input_json_delta" &&
          typeof payload.delta.partial_json === "string"
        ) {
          yield {
            kind: "tool_input_delta",
            index: payload.index ?? 0,
            partial: payload.delta.partial_json,
          };
        }
      } else if (payload.type === "content_block_stop") {
        yield { kind: "tool_stop", index: payload.index ?? 0 };
      } else if (payload.type === "message_delta") {
        if (payload.usage) Object.assign(usage, payload.usage);
        yield {
          kind: "delta",
          stopReason: payload.delta?.stop_reason ?? null,
          usage: { ...usage },
        };
      } else if (payload.type === "message_stop") {
        yield { kind: "stop" };
      } else if (payload.type === "error") {
        yield {
          kind: "error",
          status: 500,
          message: payload.error?.message ?? "Stream error",
        };
      }
    }
  } catch (err) {
    if (signal.aborted) {
      yield { kind: "abort" };
      return;
    }
    yield {
      kind: "error",
      status: 0,
      message: err instanceof Error ? err.message : "Stream read error",
    };
  }
}

async function* parseSSE(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<SSEFrame> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const raw = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      let event = "message";
      const dataLines: string[] = [];
      for (const line of raw.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
      }
      if (dataLines.length === 0) continue;
      yield { event, data: dataLines.join("\n") };
    }
  }
}

function mergeSignals(a: AbortSignal, b: AbortSignal): AbortSignal {
  if (a.aborted) return a;
  if (b.aborted) return b;
  const ctrl = new AbortController();
  a.addEventListener("abort", () => ctrl.abort(a.reason), { once: true });
  b.addEventListener("abort", () => ctrl.abort(b.reason), { once: true });
  return ctrl.signal;
}
