import { isTauriEnvWithOverride } from "@/lib/tauri/env";
import { tauriFetch } from "@/lib/tauri/fetch";
import { buildOAuthChatUpstream } from "@/lib/ai/upstream/oauth-request";
import { consumeAnthropicStream } from "./anthropic";
import type {
  ChatProvider,
  ChatRequest,
  ChatStreamHandle,
  ProviderCapabilities,
  StreamEvent,
} from "./types";

const SSE_MIME = "text/event-stream";

function mergeSignals(a: AbortSignal, b: AbortSignal): AbortSignal {
  if (a.aborted) return a;
  if (b.aborted) return b;
  const ctrl = new AbortController();
  a.addEventListener("abort", () => ctrl.abort(a.reason), { once: true });
  b.addEventListener("abort", () => ctrl.abort(b.reason), { once: true });
  return ctrl.signal;
}

/**
 * Talks to /api/ai/chat-oauth, which fronts @anthropic-ai/claude-agent-sdk
 * with the user's Claude Code OAuth token. The SDK handles the Anthropic
 * tool round-trip server-side; tool side effects are reproduced on the
 * client when this provider's stream surfaces tool_start / tool_input_delta
 * / tool_stop events.
 *
 * Reuses consumeAnthropicStream because the SDK forwards
 * BetaRawMessageStreamEvent payloads in the same vocabulary as Anthropic's
 * native SSE (message_start, content_block_*, message_delta, message_stop).
 */
export class AnthropicOAuthChatProvider implements ChatProvider {
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
      let response: Response;
      try {
        if (isTauriEnvWithOverride()) {
          // Tauri: bypass the agent-SDK proxy and call Anthropic /v1/messages
          // directly with the OAuth bearer + `oauth-2025-04-20` beta flag.
          // The SDK's only job server-side was credential injection — the
          // SSE shape is canonical Anthropic so consumeAnthropicStream
          // handles it identically.
          const built = buildOAuthChatUpstream(
            {
              model: req.model,
              system: req.system,
              messages: req.messages,
              max_tokens: req.maxTokens ?? 1024,
            },
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
          response = await tauriFetch(built.request.url, {
            method: "POST",
            signal,
            headers: built.request.headers,
            body: built.request.body,
          });
        } else {
          response = await fetch("/api/ai/chat-oauth", {
            method: "POST",
            signal,
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${req.apiKey}`,
            },
            body: JSON.stringify({
              model: req.model,
              system: req.system,
              messages: req.messages,
              max_tokens: req.maxTokens ?? 1024,
            }),
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
        // Two upstream shapes are possible:
        //   • Web build (via /api/ai/chat-oauth): { ok:false, code, error }
        //   • Tauri build (direct Anthropic): { type:"error", error:{ type, message } }
        // Without this dual-parse the user sees a generic "HTTP 401" on
        // Tauri, masking Anthropic's actual reason — invalid token vs.
        // "direct browser access disabled for this org" vs. rate limit.
        try {
          const raw = await response.text();
          try {
            const parsed = JSON.parse(raw) as
              | { code?: string; error?: string; ok?: boolean }
              | { type?: string; error?: { type?: string; message?: string } };
            if (
              "error" in parsed &&
              parsed.error &&
              typeof parsed.error === "object"
            ) {
              const inner = parsed.error as { type?: string; message?: string };
              if (typeof inner.message === "string" && inner.message.length > 0) {
                message = inner.message;
              }
              if (typeof inner.type === "string" && inner.type.length > 0) {
                code = inner.type;
              }
            } else {
              const flat = parsed as { code?: string; error?: string };
              if (typeof flat.error === "string" && flat.error.length > 0) {
                message = flat.error;
              }
              if (typeof flat.code === "string" && flat.code.length > 0) {
                code = flat.code;
              }
            }
          } catch {
            if (raw && raw.length > 0 && raw.length < 500) {
              message = raw;
            }
          }
        } catch {
          /* response body unavailable */
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

      for await (const event of consumeAnthropicStream(response.body, signal, {
        fallbackModel: req.model,
      })) {
        yield event;
      }
    }

    return { events: run(), abort: () => controller.abort() };
  }
}

let oauthSingleton: AnthropicOAuthChatProvider | null = null;

export function getAnthropicOAuthChatProvider(): AnthropicOAuthChatProvider {
  if (!oauthSingleton) oauthSingleton = new AnthropicOAuthChatProvider();
  return oauthSingleton;
}
