// Phase 5.5.H — OpenAI Responses API chat provider.
//
// OpenAI's native `web_search` server tool is only available on the
// `/v1/responses` endpoint; Chat Completions rejects the tool envelope
// with HTTP 400. This provider POSTs to a dedicated proxy
// (`/api/ai/chat-responses`) that forwards to the Responses API, and
// translates the Responses-flavored SSE stream into our internal
// `StreamEvent` union — including pass-through of `kind: "raw"` so the
// 5.5.B web-search adapter can extract citations.
//
// Why a separate provider class (vs widening `OpenAICompatChatProvider`):
//   - Body shape diverges: `input` / `instructions` vs `messages` / `system`.
//   - Token cap field is `max_output_tokens` (not `max_completion_tokens`).
//   - Tool envelope is the built-in `{type:"web_search"}` form, not the
//     OpenAI-function-style entries that openai-compat translates to.
//   - SSE shape uses named events (`response.output_item.added`,
//     `response.output_text.delta`, `response.completed`) instead of the
//     Chat Completions `[DONE]` sentinel + plain `data:` chunks.
// Keeping a clean second class avoids polluting the openai-compat code
// path with branches that only matter for one endpoint.

import { isTauriEnvWithOverride } from "@/lib/tauri/env";
import { tauriFetch } from "@/lib/tauri/fetch";
import { buildResponsesUpstream } from "@/lib/ai/upstream/responses-request";
import {
  type ChatProvider,
  type ChatRequest,
  type ChatStreamHandle,
  type ContentBlock,
  type ProviderCapabilities,
  type ProviderId,
  type StreamEvent,
  type Usage,
} from "./types";

const SSE_MIME = "text/event-stream";

const OPENAI_RESPONSES_CAPABILITIES: ProviderCapabilities = {
  cacheControl: false,
  toolUse: "native",
  streaming: true,
  vision: true,
};

type SSEFrame = { event: string; data: string };

export class OpenAIResponsesChatProvider implements ChatProvider {
  readonly id: ProviderId = "openai-responses";
  readonly capabilities: ProviderCapabilities = OPENAI_RESPONSES_CAPABILITIES;

  streamChat(req: ChatRequest): ChatStreamHandle {
    const controller = new AbortController();
    const signal = req.signal
      ? mergeSignals(controller.signal, req.signal)
      : controller.signal;

    async function* run(): AsyncGenerator<StreamEvent> {
      const body = buildResponsesBody(req);

      let response: Response;
      try {
        if (isTauriEnvWithOverride()) {
          const built = buildResponsesUpstream(body, req.apiKey);
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
          response = await fetch("/api/ai/chat-responses", {
            method: "POST",
            signal,
            headers: {
              "content-type": "application/json",
              accept: SSE_MIME,
              authorization: `Bearer ${req.apiKey}`,
            },
            body: JSON.stringify(body),
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
            error?: string;
            code?: string;
          };
          if (typeof errBody.error === "string") message = errBody.error;
          if (typeof errBody.code === "string") code = errBody.code;
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
      if (!ct.startsWith(SSE_MIME) && !ct.includes("event-stream")) {
        yield {
          kind: "error",
          status: response.status,
          message: "Unexpected response type",
        };
        return;
      }

      const usage: Usage = {};
      let started = false;
      let model = req.model;

      try {
        for await (const frame of parseSSE(response.body)) {
          if (signal.aborted) {
            yield { kind: "abort" };
            return;
          }

          let payload: unknown;
          try {
            payload = JSON.parse(frame.data);
          } catch {
            continue;
          }

          // Splice the SSE `event:` name back into the payload so adapters
          // that key on `type` (e.g. the OPENAI_RESPONSES web-search
          // adapter expects `type: "response.output_item.added"`) see the
          // canonical shape regardless of whether OpenAI inlined `type`
          // in the data block or not.
          const enriched: Record<string, unknown> =
            payload && typeof payload === "object"
              ? { type: frame.event, ...(payload as Record<string, unknown>) }
              : { type: frame.event, value: payload };

          if (!started) {
            started = true;
            const startPayload = payload as
              | { response?: { model?: string } }
              | null;
            if (
              startPayload &&
              typeof startPayload === "object" &&
              startPayload.response?.model
            ) {
              model = startPayload.response.model;
            }
            yield { kind: "start", model, usage: { ...usage } };
          }

          // Pass-through so the web-search adapter can claim citations.
          yield { kind: "raw", payload: enriched };

          if (frame.event === "response.output_text.delta") {
            const p = payload as { delta?: string } | null;
            if (p && typeof p.delta === "string" && p.delta.length > 0) {
              yield { kind: "text", delta: p.delta };
            }
          }

          if (
            frame.event === "response.completed" ||
            frame.event === "response.error" ||
            frame.event === "response.failed"
          ) {
            const p = payload as
              | {
                  response?: {
                    usage?: {
                      input_tokens?: number;
                      output_tokens?: number;
                    };
                  };
                  error?: { message?: string };
                }
              | null;
            const u = p?.response?.usage;
            if (u && typeof u.input_tokens === "number") {
              usage.input_tokens = u.input_tokens;
            }
            if (u && typeof u.output_tokens === "number") {
              usage.output_tokens = u.output_tokens;
            }
            if (
              frame.event === "response.failed" ||
              frame.event === "response.error"
            ) {
              yield {
                kind: "error",
                status: 500,
                message:
                  p?.error?.message ?? "Responses API reported a stream error",
              };
              return;
            }
            yield {
              kind: "delta",
              stopReason: "end_turn",
              usage: { ...usage },
            };
            yield { kind: "stop" };
            return;
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

    return { events: run(), abort: () => controller.abort() };
  }
}

type ResponsesInputItem = { role: "user" | "assistant"; content: string };

function buildResponsesBody(req: ChatRequest): Record<string, unknown> {
  const instructions = req.system.map((b) => b.text).join("\n\n");
  const input: ResponsesInputItem[] = [];
  for (const msg of req.messages) {
    if (typeof msg.content === "string") {
      input.push({ role: msg.role, content: msg.content });
      continue;
    }
    // Block content: keep text segments only — Responses API doesn't
    // accept Anthropic-style tool_use / tool_result blocks at the input
    // layer when web_search is the only tool we drive through this
    // provider. Higher-level callers that need richer block flows should
    // route through openai-compat instead.
    const text = (msg.content as ContentBlock[])
      .filter((b): b is { type: "text"; text: string } => b.type === "text")
      .map((b) => b.text)
      .join("\n\n");
    if (text.length > 0) {
      input.push({ role: msg.role, content: text });
    }
  }

  const body: Record<string, unknown> = {
    model: req.model,
    input,
    stream: true,
  };
  if (instructions.length > 0) body.instructions = instructions;
  if (typeof req.maxTokens === "number") {
    body.max_output_tokens = req.maxTokens;
  }
  if (req.tools && req.tools.length > 0) {
    // The chat-llm-search wrapper casts the adapter's buildToolBlock
    // output through `unknown as AnthropicTool` — at runtime it's the
    // Responses-API-shaped `{type:"web_search", search_context_size:...}`
    // entry, which is exactly what the endpoint expects. Forward as-is.
    body.tools = req.tools as unknown[];
  }
  return body;
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
    let idx: number;
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
