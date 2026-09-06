// Local Claude Code CLI provider.
//
// Drives the `claude` binary the user already has installed instead of calling
// an HTTP endpoint. The point is authentication: the CLI signs requests with the
// user's Claude Pro/Max session, so a subscriber runs the whole app without an
// API key and without per-token billing. TME's existing `claude-code-oauth`
// preset reaches the same plan by having the user paste a `claude setup-token`
// value; this path needs no paste and never holds a token that can expire.
//
// The wire format is the gift here: each `stream_event` line wraps a verbatim
// Anthropic Messages SSE payload, so unwrapping the envelope hands the stream to
// `consumeAnthropicPayloads` — the same mapper the HTTP Anthropic provider uses.
//
// Desktop only. `startAgentCli` resolves to `null` on the web build and the
// stream degrades to one explanatory error event.

import { newId } from "@/lib/utils/id";
import {
  startAgentCli,
  stopAgentCli,
  type AgentCliEvent,
} from "@/lib/tauri/agent-cli";
import { usePrefs } from "@/stores/prefs";
import { consumeAnthropicPayloads, type AnthropicStreamPayload } from "./anthropic";
import {
  buildJsonToolPrompt,
  renderBlocksAsJsonProtocolText,
  withJsonToolFallback,
} from "./tool-translator";
import type {
  ChatMessage,
  ChatProvider,
  ChatRequest,
  ChatStreamHandle,
  ProviderCapabilities,
  StreamEvent,
} from "./types";

export const CLAUDE_CLI_BINARY = "claude";

/**
 * Every tool the CLI loads by default, named so `--disallowedTools` can empty
 * the set. Naming them is what actually does it: `--restricted` only drops the
 * ones that run code, and a measured run with the rest still in place carried
 * ~8.9k tokens of tool schema on every call. With this list the same run
 * reported `tools: []` and zero cache-creation.
 *
 * Sourced from a probe run's `system/init.tools`; refresh it when the CLI adds
 * a tool. One that slips through cannot actually execute — print mode has no
 * channel to ask for permission, so the request is denied — but it would cost
 * tokens on every call, which is the reason to keep this current.
 */
export const CLAUDE_CLI_DISALLOWED_TOOLS: readonly string[] = [
  "Task",
  "CronDelete",
  "CronList",
  "DesignSync",
  "Edit",
  "EnterWorktree",
  "ExitWorktree",
  "Glob",
  "Grep",
  "ListAgents",
  "NotebookEdit",
  "PushNotification",
  "Read",
  "ReportFindings",
  "ScheduleWakeup",
  "SendMessage",
  "TaskCreate",
  "TaskGet",
  "TaskList",
  "TaskOutput",
  "TaskStop",
  "TaskUpdate",
  "ToolSearch",
  "WebSearch",
  "Write",
  "Bash",
  "PowerShell",
];

export type ClaudeCliArgsOptions = {
  model: string;
  extraArgs?: readonly string[];
};

/**
 * argv for one turn. `--system-prompt-file` is appended by the Rust side, which
 * stages the prompt to a temp file — passing it inline would break on long
 * prompts, since Windows caps a command line near 32k characters and a TME
 * article window is far longer.
 */
export function buildClaudeCliArgs(opts: ClaudeCliArgsOptions): string[] {
  return [
    "-p",
    "--output-format",
    "stream-json",
    "--input-format",
    "stream-json",
    "--include-partial-messages",
    "--verbose",
    "--model",
    opts.model,
    // Strip everything the user configured for their own coding sessions —
    // CLAUDE.md, skills, plugins, hooks, MCP servers, custom agents, output
    // styles. TME supplies the entire prompt; anything else is both context
    // leakage into a learning answer and tokens the user pays for out of their
    // rate-limit budget.
    "--safe-mode",
    "--restricted",
    "--strict-mcp-config",
    "--disable-slash-commands",
    "--setting-sources",
    "",
    "--disallowedTools",
    ...CLAUDE_CLI_DISALLOWED_TOOLS,
    ...(opts.extraArgs ?? []),
  ];
}

function messageText(msg: ChatMessage): string {
  if (typeof msg.content === "string") return msg.content;
  return renderBlocksAsJsonProtocolText(msg.content);
}

/**
 * Collapse a conversation into the single user turn the CLI's stream-json input
 * accepts.
 *
 * TME's `ChatRequest` is stateless — it re-sends the whole history on every
 * call — while the CLI owns a live session and answers each user line it reads.
 * Replaying prior turns as separate lines would make it reply to every one of
 * them, so the history is transcribed into the turn instead.
 */
export function flattenMessagesToTurn(messages: readonly ChatMessage[]): string {
  const usable = messages.filter((m) => messageText(m).trim().length > 0);
  if (usable.length === 0) return "";
  const last = usable[usable.length - 1]!;
  if (usable.length === 1 && last.role === "user") return messageText(last);

  const transcript = usable
    .slice(0, -1)
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${messageText(m)}`);
  const tail =
    last.role === "user"
      ? `## Current message\n\n${messageText(last)}`
      : `## Continue this reply\n\nAssistant: ${messageText(last)}`;
  if (transcript.length === 0) return tail;
  return `## Conversation so far\n\n${transcript.join("\n\n")}\n\n${tail}`;
}

export type ParsedCliLine =
  | { kind: "payload"; payload: AnthropicStreamPayload }
  | { kind: "result"; isError: boolean; message: string; status: number }
  | { kind: "ignored" };

/**
 * Classify one NDJSON line. Non-JSON lines are normal CLI chatter rather than a
 * fault, so they are ignored rather than failing the turn.
 */
export function parseCliLine(line: string): ParsedCliLine {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return { kind: "ignored" };
  }
  if (!parsed || typeof parsed !== "object") return { kind: "ignored" };
  const rec = parsed as Record<string, unknown>;

  if (rec.type === "stream_event" && rec.event && typeof rec.event === "object") {
    return { kind: "payload", payload: rec.event as AnthropicStreamPayload };
  }

  if (rec.type === "result") {
    const isError =
      rec.is_error === true ||
      (typeof rec.subtype === "string" && rec.subtype !== "success");
    // The CLI forwards the upstream HTTP status here when the failure came from
    // the API, which is what `isRetryableStreamError` keys off (429 / 529 / 5xx).
    const status =
      typeof rec.api_error_status === "number" ? rec.api_error_status : 0;
    const message =
      typeof rec.result === "string" && rec.result.length > 0
        ? rec.result
        : typeof rec.subtype === "string"
          ? rec.subtype
          : "The agent CLI reported an error";
    return { kind: "result", isError, message, status };
  }

  // `system`, `assistant`, `rate_limit_event` and friends carry nothing the
  // stream needs: partial-message events already delivered the content.
  return { kind: "ignored" };
}

type PayloadQueue = {
  push: (payload: AnthropicStreamPayload) => void;
  close: () => void;
  iterate: () => AsyncGenerator<AnthropicStreamPayload>;
};

function createPayloadQueue(): PayloadQueue {
  const items: AnthropicStreamPayload[] = [];
  let wake: (() => void) | null = null;
  let closed = false;

  return {
    push(payload) {
      items.push(payload);
      wake?.();
      wake = null;
    },
    close() {
      closed = true;
      wake?.();
      wake = null;
    },
    async *iterate() {
      for (;;) {
        const next = items.shift();
        if (next !== undefined) {
          yield next;
          continue;
        }
        if (closed) return;
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
    },
  };
}

function mergeSignals(a: AbortSignal, b: AbortSignal): AbortSignal {
  if (a.aborted) return a;
  if (b.aborted) return b;
  const ctrl = new AbortController();
  a.addEventListener("abort", () => ctrl.abort(a.reason), { once: true });
  b.addEventListener("abort", () => ctrl.abort(b.reason), { once: true });
  return ctrl.signal;
}

function configuredPath(): string | undefined {
  try {
    const path = usePrefs.getState().agentCli?.claudePath;
    return path && path.trim().length > 0 ? path.trim() : undefined;
  } catch {
    return undefined;
  }
}

function configuredEnv(): Record<string, string> {
  try {
    return usePrefs.getState().agentCli?.env ?? {};
  } catch {
    return {};
  }
}

export class ClaudeCliChatProvider implements ChatProvider {
  readonly id = "claude-cli" as const;
  readonly capabilities: ProviderCapabilities = {
    // The CLI manages its own prompt cache; TME's per-block cache_control has
    // nowhere to travel once the system blocks are joined into one file.
    cacheControl: false,
    // The CLI's own tool machinery is switched off on purpose, so TME's tools
    // ride the prompt protocol instead — see `withJsonToolFallback`.
    toolUse: "json",
    streaming: true,
    vision: false,
  };

  streamChat(req: ChatRequest): ChatStreamHandle {
    const controller = new AbortController();
    const signal = req.signal
      ? mergeSignals(controller.signal, req.signal)
      : controller.signal;
    const session = newId("cli");

    async function* run(): AsyncGenerator<StreamEvent> {
      const queue = createPayloadQueue();
      // Boxed so the event callback and the generator body share one cell —
      // a bare `let` closed over here would not narrow after the callback runs.
      const terminal: { error: { status: number; message: string } | null } = {
        error: null,
      };

      let systemText = req.system.map((b) => b.text).join("\n\n");
      if (req.tools && req.tools.length > 0) {
        const toolPrompt = buildJsonToolPrompt(req.tools);
        systemText = systemText ? `${systemText}\n\n${toolPrompt}` : toolPrompt;
      }

      const turn = flattenMessagesToTurn(req.messages);
      const stdin = `${JSON.stringify({
        type: "user",
        message: { role: "user", content: [{ type: "text", text: turn }] },
      })}\n`;

      const onEvent = (event: AgentCliEvent): void => {
        if (event.type === "line") {
          const parsed = parseCliLine(event.data);
          if (parsed.kind === "payload") {
            queue.push(parsed.payload);
            return;
          }
          if (parsed.kind === "result") {
            if (parsed.isError) {
              terminal.error = { status: parsed.status, message: parsed.message };
            }
            queue.close();
          }
          return;
        }
        if (event.type === "error") {
          terminal.error ??= { status: 0, message: event.message };
          queue.close();
          return;
        }
        if (event.type === "exit") {
          if (event.code !== null && event.code !== 0) {
            terminal.error ??= {
              status: 0,
              message: `The agent CLI exited with code ${event.code}`,
            };
          }
          queue.close();
        }
        // `stderr` is progress noise; a genuine failure reaches us as `error`.
      };

      let started = false;
      try {
        const path = configuredPath();
        const key = await startAgentCli(
          {
            session,
            cli: CLAUDE_CLI_BINARY,
            args: buildClaudeCliArgs({ model: req.model }),
            env: configuredEnv(),
            stdin,
            ...(systemText ? { systemPrompt: systemText } : {}),
            ...(path ? { path } : {}),
          },
          onEvent,
        );
        if (key === null) {
          yield {
            kind: "error",
            status: 0,
            message: "The local agent CLI is only available in the desktop app.",
          };
          return;
        }
        started = true;
      } catch (err) {
        yield {
          kind: "error",
          status: 0,
          message:
            err instanceof Error ? err.message : "Could not start the agent CLI",
        };
        return;
      }

      // Killing the child is what actually stops generation — closing the queue
      // alone would leave the process running and still burning quota.
      const onAbort = (): void => {
        void stopAgentCli(session);
        queue.close();
      };
      signal.addEventListener("abort", onAbort, { once: true });

      try {
        let sawAbort = false;
        for await (const event of consumeAnthropicPayloads(queue.iterate(), signal, {
          fallbackModel: req.model,
        })) {
          if (event.kind === "abort") sawAbort = true;
          yield event;
        }
        // The mapper only notices an abort when the next payload arrives. A
        // cancel that lands while the CLI is still thinking closes the queue
        // with no payload behind it, so the stream would end silently and the
        // panel would sit in "streaming" forever. Say so explicitly.
        if (signal.aborted) {
          if (!sawAbort) yield { kind: "abort" };
          return;
        }
        if (terminal.error) {
          yield {
            kind: "error",
            status: terminal.error.status,
            message: terminal.error.message,
          };
        }
      } finally {
        signal.removeEventListener("abort", onAbort);
        // The process waits for more stdin after a turn, so it has to be told
        // to go; stopping an already-exited session is a no-op.
        if (started) void stopAgentCli(session);
      }
    }

    const events =
      req.tools && req.tools.length > 0 ? withJsonToolFallback(run()) : run();
    return { events, abort: () => controller.abort() };
  }
}
