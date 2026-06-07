import { isTauriEnvWithOverride } from "@/lib/tauri/env";
import { tauriFetch } from "@/lib/tauri/fetch";
import {
  abortableDelay,
  classifyGeminiError,
  computeBackoffMs,
  isRetryableStatus,
} from "./gemini-retry";
import {
  buildChatUpstream,
  type ChatProxyBody,
} from "@/lib/ai/upstream/chat-request";
import type { AnthropicTool, AnthropicToolChoice } from "../tools";
import { toProviderTools } from "./tool-translator";
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
  type SystemBlock,
  type Usage,
} from "./types";

const SSE_MIME = "text/event-stream";

type GeminiPart =
  | { text: string }
  | { functionCall: { name: string; args: Record<string, unknown> } }
  | {
      functionResponse: {
        name: string;
        response: { content: string };
      };
    };

type GeminiContent = {
  role: "user" | "model";
  parts: GeminiPart[];
};

type GeminiStreamPayload = {
  candidates?: Array<{
    content?: { role?: string; parts?: GeminiPart[] };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
  };
  promptFeedback?: {
    blockReason?: string;
  };
};

type GeminiErrorBody = {
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
};

export class GeminiChatProvider implements ChatProvider {
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

    async function* run(): AsyncGenerator<StreamEvent> {
      const isTauri = isTauriEnvWithOverride();
      void preset;

      // Body shape posted into the proxy; the shared builder reuses the
      // same shape for the direct-upstream Tauri path.
      let proxyBody: ChatProxyBody;
      try {
        proxyBody = {
          provider: providerId,
          model: req.model,
          ...buildGeminiBody(req, providerId),
        };
      } catch (err) {
        yield {
          kind: "error",
          status: 0,
          message: err instanceof Error ? err.message : "Body build error",
        };
        return;
      }

      let url: string;
      let headers: Record<string, string>;
      let body: string;

      if (isTauri) {
        const built = buildChatUpstream(proxyBody, req.apiKey);
        if (!built.ok) {
          yield {
            kind: "error",
            status: 400,
            message: `${built.error.code}: ${built.error.message}`,
          };
          return;
        }
        url = built.request.url;
        headers = { accept: SSE_MIME, ...built.request.headers };
        body = built.request.body;
      } else {
        url = "/api/ai/chat";
        headers = {
          "content-type": "application/json",
          accept: SSE_MIME,
          authorization: `Bearer ${req.apiKey}`,
        };
        body = JSON.stringify(proxyBody);
      }

      // Retry loop around connection admission: Gemini 429s (and 408/5xx /
      // transient network errors) happen BEFORE any stream data flows, so
      // retrying the initial request is safe. Honor the server's
      // RetryInfo.retryDelay; treat per-day/limit-0 quota failures as terminal.
      const MAX_GEMINI_RETRIES = 4;
      let response: Response;
      let attempt = 0;
      while (true) {
        try {
          response = isTauri
            ? await tauriFetch(url, { method: "POST", signal, headers, body })
            : await fetch(url, { method: "POST", signal, headers, body });
        } catch (err) {
          if (signal.aborted) {
            yield { kind: "abort" };
            return;
          }
          // Transient network error — back off and retry a few times.
          if (attempt < MAX_GEMINI_RETRIES) {
            const ok = await abortableDelay(computeBackoffMs(attempt, null), signal);
            if (!ok) {
              yield { kind: "abort" };
              return;
            }
            attempt += 1;
            continue;
          }
          yield {
            kind: "error",
            status: 0,
            message: err instanceof Error ? err.message : "Network error",
          };
          return;
        }

        if (response.ok && response.body) break;

        let message = `HTTP ${response.status}`;
        let code = "http_error";
        let errBody: unknown = undefined;
        try {
          errBody = (await response.json()) as GeminiErrorBody;
          const e = (errBody as GeminiErrorBody).error;
          if (e?.message) message = e.message;
          if (e?.status) code = e.status;
        } catch {
          /* ignore */
        }
        const { retryDelayMs, terminal } = classifyGeminiError(errBody);
        const retryable = isRetryableStatus(response.status) && !terminal;
        if (retryable && attempt < MAX_GEMINI_RETRIES && !signal.aborted) {
          const ok = await abortableDelay(
            computeBackoffMs(attempt, retryDelayMs),
            signal,
          );
          if (!ok) {
            yield { kind: "abort" };
            return;
          }
          attempt += 1;
          continue;
        }
        const err = new ProviderError(response.status, code, message);
        yield {
          kind: "error",
          status: err.status,
          message: `${err.code}: ${err.message}`,
        };
        return;
      }

      const ct = response.headers.get("content-type") ?? "";
      if (!ct.startsWith(SSE_MIME) && !ct.includes("json")) {
        yield {
          kind: "error",
          status: response.status,
          message: "Unexpected response type",
        };
        return;
      }

      for await (const event of consumeGeminiStream(response.body, signal, {
        fallbackModel: req.model,
      })) {
        yield event;
      }
    }

    return { events: run(), abort: () => controller.abort() };
  }
}

export async function* consumeGeminiStream(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  opts: { fallbackModel?: string } = {},
): AsyncGenerator<StreamEvent> {
  const usage: Usage = {};
  const model = opts.fallbackModel ?? "";
  let started = false;
  let toolIndex = 0;
  let lastFinishReason: string | undefined;

  try {
    for await (const frame of parseSSE(body)) {
      if (signal.aborted) {
        yield { kind: "abort" };
        return;
      }
      let payload: GeminiStreamPayload;
      try {
        payload = JSON.parse(frame.data) as GeminiStreamPayload;
      } catch {
        continue;
      }

      if (payload.promptFeedback?.blockReason) {
        yield {
          kind: "error",
          status: 400,
          message: `safety_block: ${payload.promptFeedback.blockReason}`,
        };
        return;
      }

      if (!started) {
        started = true;
        yield { kind: "start", model, usage: { ...usage } };
      }

      if (payload.usageMetadata) {
        if (typeof payload.usageMetadata.promptTokenCount === "number") {
          usage.input_tokens = payload.usageMetadata.promptTokenCount;
        }
        if (typeof payload.usageMetadata.candidatesTokenCount === "number") {
          usage.output_tokens = payload.usageMetadata.candidatesTokenCount;
        }
      }

      const candidate = payload.candidates?.[0];
      if (candidate?.content?.parts) {
        for (const part of candidate.content.parts) {
          if ("text" in part && typeof part.text === "string") {
            yield { kind: "text", delta: part.text };
          } else if ("functionCall" in part && part.functionCall) {
            const idx = toolIndex++;
            const name = part.functionCall.name;
            const args = part.functionCall.args ?? {};
            yield {
              kind: "tool_start",
              index: idx,
              id: `gemini-${synthId()}`,
              name,
            };
            yield {
              kind: "tool_input_delta",
              index: idx,
              partial: JSON.stringify(args),
            };
            yield { kind: "tool_stop", index: idx };
          }
        }
      }

      if (candidate?.finishReason) {
        lastFinishReason = candidate.finishReason;
      }
    }

    if (!started) {
      yield { kind: "start", model, usage: { ...usage } };
    }
    // Gemini frequently reports finishReason "STOP" (→ end_turn) even when it
    // emitted a functionCall, so trusting finishReason alone leaves the
    // runner thinking the turn ended and the tool is never executed. If any
    // tool call was emitted this turn (toolIndex advanced), force tool_use.
    yield {
      kind: "delta",
      stopReason:
        toolIndex > 0 ? "tool_use" : normalizeStopReason(lastFinishReason),
      usage: { ...usage },
    };
    yield { kind: "stop" };
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

function buildGeminiBody(
  req: ChatRequest,
  providerId: ProviderId,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    contents: convertMessages(req.messages),
    generationConfig: { maxOutputTokens: req.maxTokens ?? 1024 },
  };

  const sysText = flattenSystem(req.system);
  if (sysText) {
    body.systemInstruction = { parts: [{ text: sysText }] };
  }

  if (req.tools && req.tools.length > 0) {
    body.tools = [
      { functionDeclarations: toProviderTools(providerId, req.tools) as AnthropicTool[] },
    ];
  }

  const toolConfig = convertToolChoice(req.tool_choice);
  if (toolConfig) body.toolConfig = toolConfig;

  return body;
}

function flattenSystem(system: SystemBlock[]): string {
  return system.map((b) => b.text).join("\n\n");
}

function convertMessages(messages: ChatMessage[]): GeminiContent[] {
  // toolUseId -> name map so tool_result blocks can recover the function name Gemini requires.
  const toolNameById = new Map<string, string>();
  for (const msg of messages) {
    if (typeof msg.content === "string") continue;
    for (const block of msg.content) {
      if (block.type === "tool_use") toolNameById.set(block.id, block.name);
    }
  }

  const out: GeminiContent[] = [];
  for (const msg of messages) {
    if (typeof msg.content === "string") {
      out.push({
        role: msg.role === "assistant" ? "model" : "user",
        parts: [{ text: msg.content }],
      });
      continue;
    }
    const modelParts: GeminiPart[] = [];
    const toolResultParts: GeminiPart[] = [];
    for (const block of msg.content as ContentBlock[]) {
      if (block.type === "text") {
        modelParts.push({ text: block.text });
      } else if (block.type === "tool_use") {
        modelParts.push({
          functionCall: { name: block.name, args: block.input },
        });
      } else if (block.type === "tool_result") {
        const name = toolNameById.get(block.tool_use_id) ?? "";
        toolResultParts.push({
          functionResponse: { name, response: { content: block.content } },
        });
      }
    }
    if (modelParts.length > 0) {
      out.push({
        role: msg.role === "assistant" ? "model" : "user",
        parts: modelParts,
      });
    }
    if (toolResultParts.length > 0) {
      out.push({ role: "user", parts: toolResultParts });
    }
  }
  return out;
}

function convertToolChoice(
  choice: AnthropicToolChoice | undefined,
): Record<string, unknown> | null {
  if (!choice) return null;
  if (choice.type === "auto") {
    return { functionCallingConfig: { mode: "AUTO" } };
  }
  if (choice.type === "any") {
    return { functionCallingConfig: { mode: "ANY" } };
  }
  if (choice.type === "tool") {
    return {
      functionCallingConfig: {
        mode: "ANY",
        allowedFunctionNames: [choice.name],
      },
    };
  }
  return null;
}

function normalizeStopReason(reason: string | undefined): string | null {
  switch (reason) {
    case "STOP":
      return "end_turn";
    case "MAX_TOKENS":
      return "max_tokens";
    case "TOOL_USE":
      return "tool_use";
    case "SAFETY":
    case "RECITATION":
      return "content_filter";
    default:
      return null;
  }
}

function synthId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

type SSEFrame = { event: string; data: string };

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
