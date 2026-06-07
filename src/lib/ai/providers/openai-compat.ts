import { isTauriEnvWithOverride } from "@/lib/tauri/env";
import { tauriFetch } from "@/lib/tauri/fetch";
import {
  buildChatUpstream,
  type ChatProxyBody,
} from "@/lib/ai/upstream/chat-request";
import { isLocalUrl } from "./local-bypass";
import {
  buildJsonToolPrompt,
  parseJsonToolUseFromText,
  renderBlocksAsJsonProtocolText,
  toProviderTools,
} from "./tool-translator";
import {
  ProviderError,
  type ChatMessage,
  type ChatProvider,
  type ChatRequest,
  type ChatStreamHandle,
  type ContentBlock,
  type ProviderCapabilities,
  type ProviderId,
  type ProviderPreset,
  type StreamEvent,
  type ToolUseStrategy,
  type Usage,
} from "./types";
import type { AnthropicToolChoice } from "../tools";

const SSE_MIME = "text/event-stream";

type SSEFrame = { event: string; data: string };

type OpenAIToolCallDelta = {
  index?: number;
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
};

type OpenAIChoiceDelta = {
  role?: string;
  content?: string | null;
  tool_calls?: OpenAIToolCallDelta[];
};

type OpenAIStreamPayload = {
  id?: string;
  model?: string;
  choices?: Array<{
    index?: number;
    delta?: OpenAIChoiceDelta;
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  error?: { type?: string; code?: string; message?: string };
};

type OpenAIMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }> }
  | { role: "tool"; tool_call_id: string; content: string };

export class OpenAICompatChatProvider implements ChatProvider {
  readonly id: ProviderId;
  readonly capabilities: ProviderCapabilities;
  private preset: ProviderPreset;

  constructor(args: { preset: ProviderPreset }) {
    this.preset = args.preset;
    this.id = args.preset.id;
    this.capabilities = args.preset.capabilities;
  }

  streamChat(req: ChatRequest): ChatStreamHandle {
    const controller = new AbortController();
    const signal = req.signal
      ? mergeSignals(controller.signal, req.signal)
      : controller.signal;

    const preset = this.preset;
    const providerId = this.id;
    const strategy: ToolUseStrategy = preset.capabilities.toolUse;

    async function* run(): AsyncGenerator<StreamEvent> {
      // Routing has three modes:
      //  1. Local bypass — preset.baseUrl is loopback/LAN; call upstream
      //     directly so prompts never traverse our infra.
      //  2. Tauri direct — static export has no SSR proxy; the upstream
      //     URL/headers/body are computed via the shared chat builder so
      //     the wire shape matches the (web-mode) /api/ai/chat proxy exactly.
      //  3. Web proxy — existing dev/web fallback hits /api/ai/chat which
      //     handles family routing + auth header swap server-side.
      const isLocal = isLocalUrl(preset.baseUrl);
      const isTauri = !isLocal && isTauriEnvWithOverride();

      let url: string;
      const headers: Record<string, string> = {
        "content-type": "application/json",
        accept: SSE_MIME,
      };
      let body: string;
      try {
        const requestBody = buildRequestBody(providerId, req, strategy);
        if (isLocal) {
          url = joinChatCompletions(preset.baseUrl);
          if (req.apiKey) headers.authorization = `Bearer ${req.apiKey}`;
          body = JSON.stringify(requestBody);
        } else if (isTauri) {
          const built = buildChatUpstream(
            { provider: providerId, ...requestBody } as ChatProxyBody,
            req.apiKey,
          );
          if (!built.ok) {
            yield {
              kind: "error",
              status: 400,
              message: `${built.error.code}: ${built.error.message}`,
            };
            return;
          }
          url = built.request.url;
          Object.assign(headers, built.request.headers);
          body = built.request.body;
        } else {
          url = "/api/ai/chat";
          if (req.apiKey) headers.authorization = `Bearer ${req.apiKey}`;
          // The Edge proxy keys upstream routing on `provider`; the local
          // server only understands vanilla OpenAI shape and would 4xx on
          // unknown fields.
          body = JSON.stringify({ provider: providerId, ...requestBody });
        }
      } catch (err) {
        if (err instanceof ProviderError) {
          yield { kind: "error", status: err.status, message: err.message };
          return;
        }
        throw err;
      }

      let response: Response;
      try {
        response = isTauri
          ? await tauriFetch(url, { method: "POST", signal, headers, body })
          : await fetch(url, { method: "POST", signal, headers, body });
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
            error?: { type?: string; code?: string; message?: string };
          };
          message = errBody.error?.message ?? message;
          code = errBody.error?.code ?? errBody.error?.type;
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

      const baseStream = consumeOpenAICompatStream(
        response.body,
        signal,
        { fallbackModel: req.model },
      );

      if (strategy !== "json") {
        for await (const event of baseStream) yield event;
        return;
      }

      // JSON degraded mode: the model emits prose with embedded ```json
      // tool blocks. Buffer the assistant text to scan it once at stop, then
      // synthesize tool_use events so the reader's tool loop continues just
      // as it does for native callers. We rewrite the trailing `delta` event
      // to stopReason="tool_use" when we extract any tool, otherwise leave
      // it as the model reported.
      let bufferedText = "";
      let pendingDelta:
        | { kind: "delta"; stopReason: string | null; usage: Usage }
        | null = null;

      for await (const event of baseStream) {
        if (event.kind === "text") {
          bufferedText += event.delta;
          yield event;
          continue;
        }
        if (event.kind === "delta") {
          pendingDelta = event;
          continue;
        }
        if (event.kind === "stop") {
          const { toolUses } = parseJsonToolUseFromText(bufferedText);
          for (let i = 0; i < toolUses.length; i++) {
            const tu = toolUses[i]!;
            yield { kind: "tool_start", index: i, id: tu.id, name: tu.name };
            yield {
              kind: "tool_input_delta",
              index: i,
              partial: JSON.stringify(tu.input),
            };
            yield { kind: "tool_stop", index: i };
          }
          if (pendingDelta) {
            yield toolUses.length > 0
              ? { ...pendingDelta, stopReason: "tool_use" }
              : pendingDelta;
            pendingDelta = null;
          }
          yield event;
          return;
        }
        yield event;
      }
      if (pendingDelta) yield pendingDelta;
    }

    return { events: run(), abort: () => controller.abort() };
  }
}

export async function* consumeOpenAICompatStream(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  opts: { fallbackModel?: string } = {},
): AsyncGenerator<StreamEvent> {
  const usage: Usage = {};
  let model = opts.fallbackModel ?? "";
  let started = false;
  // Captures the last finish_reason so the trailing usage frame (OpenAI sends
  // final usage in a separate `choices:[]` chunk AFTER the finish_reason
  // delta when stream_options.include_usage is set) can re-emit a delta with
  // the complete token counts — otherwise output tokens are undercounted and
  // cost is computed input-only.
  let lastStopReason: string | null = null;
  let emittedFinishDelta = false;
  // Tracks active tool_call slots by index — OpenAI streams arguments as incremental string fragments per index.
  const toolSlots = new Map<number, { id: string; name: string; opened: boolean }>();

  try {
    for await (const frame of parseSSE(body)) {
      if (signal.aborted) {
        yield { kind: "abort" };
        return;
      }
      const data = frame.data;
      if (data === "[DONE]") {
        for (const idx of toolSlots.keys()) {
          yield { kind: "tool_stop", index: idx };
        }
        toolSlots.clear();
        yield { kind: "stop" };
        return;
      }

      let payload: OpenAIStreamPayload;
      try {
        payload = JSON.parse(data) as OpenAIStreamPayload;
      } catch {
        continue;
      }

      if (payload.error) {
        yield {
          kind: "error",
          status: 500,
          message: payload.error.message ?? "Stream error",
        };
        continue;
      }

      if (!started) {
        started = true;
        model = payload.model ?? model;
        yield { kind: "start", model, usage: { ...usage } };
      }

      const choice = payload.choices?.[0];
      const delta = choice?.delta;
      if (delta?.content && typeof delta.content === "string") {
        yield { kind: "text", delta: delta.content };
      }

      if (delta?.tool_calls && delta.tool_calls.length > 0) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0;
          let slot = toolSlots.get(idx);
          if (!slot) {
            slot = { id: tc.id ?? "", name: tc.function?.name ?? "", opened: false };
            toolSlots.set(idx, slot);
          }
          if (!slot.id && tc.id) slot.id = tc.id;
          if (!slot.name && tc.function?.name) slot.name = tc.function.name;
          if (!slot.opened && slot.id && slot.name) {
            slot.opened = true;
            yield { kind: "tool_start", index: idx, id: slot.id, name: slot.name };
          }
          if (tc.function?.arguments) {
            yield {
              kind: "tool_input_delta",
              index: idx,
              partial: tc.function.arguments,
            };
          }
        }
      }

      if (payload.usage) {
        if (typeof payload.usage.prompt_tokens === "number") {
          usage.input_tokens = payload.usage.prompt_tokens;
        }
        if (typeof payload.usage.completion_tokens === "number") {
          usage.output_tokens = payload.usage.completion_tokens;
        }
      }

      if (choice?.finish_reason !== undefined && choice.finish_reason !== null) {
        if (choice.finish_reason === "tool_calls") {
          for (const idx of toolSlots.keys()) {
            yield { kind: "tool_stop", index: idx };
          }
          toolSlots.clear();
        }
        lastStopReason = normalizeStopReason(choice.finish_reason);
        emittedFinishDelta = true;
        yield {
          kind: "delta",
          stopReason: lastStopReason,
          usage: { ...usage },
        };
      }
    }
    // Trailing usage frame: the loop above updated `usage` from the final
    // `choices:[]` chunk but emitted no delta for it. Re-emit one delta with
    // the complete usage so consumers (which replace, not sum, usage) get the
    // real output-token count.
    if (emittedFinishDelta) {
      yield { kind: "delta", stopReason: lastStopReason, usage: { ...usage } };
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

function joinChatCompletions(baseUrl: string): string {
  const trimmed = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  return `${trimmed}/chat/completions`;
}

function buildRequestBody(
  providerId: ProviderId,
  req: ChatRequest,
  strategy: ToolUseStrategy,
): Record<string, unknown> {
  const messages: OpenAIMessage[] = [];
  const useJson = strategy === "json";

  // In JSON mode the system message also carries the tool protocol prompt,
  // and the request body omits the `tools` / `tool_choice` fields entirely
  // (sending them to a tool-naive server is at best ignored, at worst 400).
  let systemText = req.system.map((b) => b.text).join("\n\n");
  if (useJson && req.tools && req.tools.length > 0) {
    const toolPrompt = buildJsonToolPrompt(req.tools);
    systemText = systemText ? `${systemText}\n\n${toolPrompt}` : toolPrompt;
  }
  if (systemText.length > 0) {
    messages.push({ role: "system", content: systemText });
  }

  for (const msg of req.messages) {
    appendMessage(messages, msg, useJson);
  }

  const tokenLimitKey =
    providerId === "openai" ? "max_completion_tokens" : "max_tokens";
  const body: Record<string, unknown> = {
    model: req.model,
    messages,
    [tokenLimitKey]: req.maxTokens ?? 1024,
    stream: true,
    stream_options: { include_usage: true },
  };

  if (!useJson && req.tools && req.tools.length > 0) {
    body["tools"] = toProviderTools(providerId, req.tools);
  }

  if (!useJson && req.tool_choice) {
    body["tool_choice"] = mapToolChoice(req.tool_choice);
  }

  return body;
}

function appendMessage(
  out: OpenAIMessage[],
  msg: ChatMessage,
  useJson: boolean,
): void {
  if (typeof msg.content === "string") {
    out.push(
      msg.role === "user"
        ? { role: "user", content: msg.content }
        : { role: "assistant", content: msg.content },
    );
    return;
  }

  // JSON degraded mode: the server has no concept of "tool" role messages,
  // so flatten tool_use / tool_result blocks back into prose. The assistant
  // sees its own past JSON blocks and the labelled tool result lines on
  // re-runs, which mirrors what the system prompt taught it.
  if (useJson) {
    const text = renderBlocksAsJsonProtocolText(msg.content as ContentBlock[]);
    if (text.length > 0) {
      out.push(
        msg.role === "user"
          ? { role: "user", content: text }
          : { role: "assistant", content: text },
      );
    }
    return;
  }

  // Split blocks: text/tool_use → assistant message; tool_result → separate "tool" messages emitted after.
  const textParts: string[] = [];
  const toolCalls: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }> = [];
  const toolResults: Array<{ id: string; content: string }> = [];

  for (const block of msg.content as ContentBlock[]) {
    if (block.type === "text") {
      textParts.push(block.text);
    } else if (block.type === "tool_use") {
      toolCalls.push({
        id: block.id,
        type: "function",
        function: { name: block.name, arguments: JSON.stringify(block.input) },
      });
    } else if (block.type === "tool_result") {
      toolResults.push({ id: block.tool_use_id, content: block.content });
    }
  }

  if (msg.role === "user") {
    if (textParts.length > 0) {
      out.push({ role: "user", content: textParts.join("\n\n") });
    }
    for (const tr of toolResults) {
      out.push({ role: "tool", tool_call_id: tr.id, content: tr.content });
    }
  } else {
    if (textParts.length > 0 || toolCalls.length > 0) {
      const assistant: OpenAIMessage = {
        role: "assistant",
        content: textParts.length > 0 ? textParts.join("\n\n") : null,
      };
      if (toolCalls.length > 0) assistant.tool_calls = toolCalls;
      out.push(assistant);
    }
  }
}

function mapToolChoice(
  choice: AnthropicToolChoice,
): string | { type: "function"; function: { name: string } } {
  if (choice.type === "auto") return "auto";
  if (choice.type === "any") return "required";
  if (choice.type === "tool") {
    return { type: "function", function: { name: choice.name } };
  }
  // Defensive: AnthropicToolChoice union currently lacks "none" but spec accepts it.
  return "auto";
}

function normalizeStopReason(reason: string | null | undefined): string | null {
  if (reason == null) return null;
  switch (reason) {
    case "stop":
      return "end_turn";
    case "length":
      return "max_tokens";
    case "tool_calls":
      return "tool_use";
    case "content_filter":
      return "content_filter";
    default:
      return reason;
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
