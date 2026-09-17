// Local OpenAI Codex CLI provider.
//
// Drives the `codex` binary the user already has installed. This is the
// provider the whole agent-CLI transport was built for: a ChatGPT Plus/Pro
// subscription has NO API equivalent — there is no token to paste, no OAuth
// preset to reach it — so spawning the CLI is the only way a subscriber can
// run TME on that plan.
//
// Measured against codex-cli 0.153.4 (see `buildCodexCliArgs` for the exact
// argv):
//   - `exec --json` prints JSONL. There are NO token deltas: the whole reply
//     arrives in one `item.completed` line of type `agent_message`, usage in
//     `turn.completed`, failure as `turn.failed` (plus a duplicate top-level
//     `error`). So the stream is "start → one text → delta → stop".
//   - `item.completed` lines of type `error` are warnings (a malformed agent
//     role file in ~/.codex, missing model metadata) — the turn still
//     succeeds, so they must not be treated as fatal.
//   - There is no system-prompt channel. Instructions ride at the head of the
//     stdin prompt instead (`-` reads the prompt from stdin, which is also what
//     sidesteps the Windows argv cap).
//   - `codex app-server` speaks JSON-RPC over stdio and answers `model/list`
//     with what the signed-in account can actually use — the account, not
//     the binary, decides (a ChatGPT login rejects `gpt-5` with a 400).
//
// Desktop only, like the Claude CLI provider.

import { newId } from "@/lib/utils/id";
import {
  startAgentCli,
  stopAgentCli,
  type AgentCliEvent,
} from "@/lib/tauri/agent-cli";
import { usePrefs } from "@/stores/prefs";
import { flattenMessagesToTurn } from "./claude-cli";
import {
  buildJsonToolPrompt,
  withJsonToolFallback,
} from "./tool-translator";
import type {
  ChatProvider,
  ChatRequest,
  ChatStreamHandle,
  ModelDescriptor,
  ProviderCapabilities,
  StreamEvent,
  Usage,
} from "./types";

export const CODEX_CLI_BINARY = "codex";

export type CodexCliArgsOptions = {
  model: string;
  extraArgs?: readonly string[];
};

/**
 * argv for one turn. The prompt itself is not here — `-` tells the CLI to
 * read it from stdin.
 */
export function buildCodexCliArgs(opts: CodexCliArgsOptions): string[] {
  return [
    "exec",
    "--json",
    "--color",
    "never",
    // TME owns the prompt: skip the user's ~/.codex/config.toml, their
    // execpolicy rules, and any session files this run would otherwise write.
    "--ephemeral",
    "--ignore-user-config",
    "--ignore-rules",
    // The working directory is not a project — it is whatever the app was
    // launched from — so neither the git check nor a writable sandbox applies.
    "--skip-git-repo-check",
    "--sandbox",
    "read-only",
    "--model",
    opts.model,
    ...(opts.extraArgs ?? []),
    "-",
  ];
}

/**
 * The whole prompt as one stdin document. Codex has no separate system slot,
 * so the instructions lead and the (flattened) conversation follows.
 */
export function buildCodexPrompt(
  systemText: string,
  messages: ChatRequest["messages"],
): string {
  const turn = flattenMessagesToTurn(messages);
  if (!systemText) return turn;
  return `## Instructions\n\n${systemText}\n\n---\n\n${turn}`;
}

export type ParsedCodexLine =
  | { kind: "text"; text: string }
  | { kind: "usage"; usage: Usage }
  | { kind: "error"; message: string; status: number }
  | { kind: "ignored" };

type CodexUsage = {
  input_tokens?: number;
  cached_input_tokens?: number;
  output_tokens?: number;
};

/**
 * Codex counts cached tokens INSIDE `input_tokens`; Anthropic's vocabulary —
 * which every TME cost/context consumer speaks — counts them beside it. Split
 * so the same prompt is not billed twice in the cost chip.
 */
function mapUsage(raw: CodexUsage): Usage {
  const cached = Math.max(0, raw.cached_input_tokens ?? 0);
  const input = Math.max(0, (raw.input_tokens ?? 0) - cached);
  const out: Usage = { input_tokens: input, output_tokens: raw.output_tokens ?? 0 };
  if (cached > 0) out.cache_read_input_tokens = cached;
  return out;
}

/**
 * `turn.failed.error.message` is frequently a JSON document in its own right
 * (the upstream API error, stringified). Pull the human sentence and the HTTP
 * status back out so retry logic can key off 429 / 5xx.
 */
function unwrapFailure(message: unknown): { message: string; status: number } {
  const text = typeof message === "string" ? message : "";
  if (text.startsWith("{")) {
    try {
      const inner = JSON.parse(text) as {
        status?: unknown;
        error?: { message?: unknown };
        message?: unknown;
      };
      const status = typeof inner.status === "number" ? inner.status : 0;
      const innerMessage =
        typeof inner.error?.message === "string"
          ? inner.error.message
          : typeof inner.message === "string"
            ? inner.message
            : text;
      return { message: innerMessage, status };
    } catch {
      /* fall through — treat as plain text */
    }
  }
  return {
    message: text.length > 0 ? text : "The Codex CLI reported an error",
    status: 0,
  };
}

/** Classify one JSONL line. Non-JSON is CLI chatter, not a fault. */
export function parseCodexLine(line: string): ParsedCodexLine {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return { kind: "ignored" };
  }
  if (!parsed || typeof parsed !== "object") return { kind: "ignored" };
  const rec = parsed as Record<string, unknown>;

  if (rec.type === "item.completed" && rec.item && typeof rec.item === "object") {
    const item = rec.item as { type?: unknown; text?: unknown };
    if (item.type === "agent_message" && typeof item.text === "string") {
      return { kind: "text", text: item.text };
    }
    // `error` items are warnings about the user's own setup; the turn goes on.
    return { kind: "ignored" };
  }

  if (rec.type === "turn.completed") {
    const usage =
      rec.usage && typeof rec.usage === "object" ? (rec.usage as CodexUsage) : {};
    return { kind: "usage", usage: mapUsage(usage) };
  }

  if (rec.type === "turn.failed") {
    const err = rec.error as { message?: unknown } | undefined;
    return { kind: "error", ...unwrapFailure(err?.message) };
  }
  if (rec.type === "error") {
    return { kind: "error", ...unwrapFailure(rec.message) };
  }

  return { kind: "ignored" };
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
    const path = usePrefs.getState().agentCli?.codexPath;
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

/** Resolves when `close()` is called; `wait()` never rejects. */
function createLatch(): { close: () => void; wait: () => Promise<void> } {
  let resolve: (() => void) | null = null;
  let closed = false;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return {
    close() {
      closed = true;
      resolve?.();
    },
    wait: () => (closed ? Promise.resolve() : promise),
  };
}

export class CodexCliChatProvider implements ChatProvider {
  readonly id = "codex-cli" as const;
  readonly capabilities: ProviderCapabilities = {
    cacheControl: false,
    // Codex's own tools are sandboxed read-only and irrelevant to a tutor;
    // TME's tools ride the JSON prompt protocol like every non-native provider.
    toolUse: "json",
    // The CLI does not stream tokens; "streaming" here means the transport is
    // async and abortable; text still arrives as a complete message.
    streaming: true,
    vision: false,
  };

  streamChat(req: ChatRequest): ChatStreamHandle {
    const controller = new AbortController();
    const signal = req.signal
      ? mergeSignals(controller.signal, req.signal)
      : controller.signal;
    const session = newId("codex");

    async function* run(): AsyncGenerator<StreamEvent> {
      if (signal.aborted) {
        yield { kind: "abort" };
        return;
      }
      const texts: string[] = [];
      let usage: Usage = {};
      let completed = false;
      // Boxed so the event callback and the generator body share one cell —
      // a bare `let` closed over here would not narrow after the callback runs.
      const terminal: { failure: { status: number; message: string } | null } = {
        failure: null,
      };
      const done = createLatch();

      let systemText = req.system.map((b) => b.text).join("\n\n");
      if (req.tools && req.tools.length > 0) {
        const toolPrompt = buildJsonToolPrompt(req.tools);
        systemText = systemText ? `${systemText}\n\n${toolPrompt}` : toolPrompt;
      }
      const stdin = buildCodexPrompt(systemText, req.messages);

      const onEvent = (event: AgentCliEvent): void => {
        if (completed) return;
        if (event.type === "line") {
          const parsed = parseCodexLine(event.data);
          if (parsed.kind === "text") texts.push(parsed.text);
          else if (parsed.kind === "usage") {
            usage = parsed.usage;
            completed = true;
            done.close();
          }
          else if (parsed.kind === "error") {
            terminal.failure ??= { status: parsed.status, message: parsed.message };
            done.close();
          }
          return;
        }
        if (event.type === "error") {
          terminal.failure ??= { status: 0, message: event.message };
          done.close();
          return;
        }
        if (event.type === "exit") {
          if (event.code !== null && event.code !== 0) {
            terminal.failure ??= {
              status: 0,
              message: `The Codex CLI exited with code ${event.code}`,
            };
          }
          done.close();
        }
      };

      let started = false;
      try {
        const path = configuredPath();
        const key = await startAgentCli(
          {
            session,
            cli: CODEX_CLI_BINARY,
            args: buildCodexCliArgs({ model: req.model }),
            env: configuredEnv(),
            stdin,
            // `-` reads the prompt to EOF; without this the turn never starts.
            closeStdin: true,
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
            err instanceof Error ? err.message : "Could not start the Codex CLI",
        };
        return;
      }

      const onAbort = (): void => {
        if (started) {
          started = false;
          void stopAgentCli(session);
        }
        done.close();
      };
      signal.addEventListener("abort", onAbort, { once: true });
      // A cancel that landed while `startAgentCli` was still spawning fired
      // before the listener existed; the process is running now, so act on it.
      if (signal.aborted) onAbort();

      try {
        yield { kind: "start", model: req.model, usage: {} };
        // turn.completed is authoritative; do not wait for process teardown
        // or discard a completed answer because cleanup later exits non-zero.
        await done.wait();
        if (signal.aborted) {
          yield { kind: "abort" };
          return;
        }
        if (terminal.failure) {
          yield {
            kind: "error",
            status: terminal.failure.status,
            message: terminal.failure.message,
          };
          return;
        }
        for (const text of texts) yield { kind: "text", delta: text };
        yield { kind: "delta", stopReason: "end_turn", usage };
        yield { kind: "stop" };
      } finally {
        signal.removeEventListener("abort", onAbort);
        if (started) void stopAgentCli(session);
      }
    }

    const events =
      req.tools && req.tools.length > 0 ? withJsonToolFallback(run()) : run();
    return { events, abort: () => controller.abort() };
  }
}

// ---------------------------------------------------------------------------
// Model discovery via `codex app-server`
// ---------------------------------------------------------------------------

/** JSON-RPC id of the `model/list` request; the response is matched on it. */
const MODEL_LIST_ID = 2;

/** The three lines the app-server needs before it will answer `model/list`. */
export function buildCodexModelListStdin(): string {
  const lines = [
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { clientInfo: { name: "tme", title: "Teach Me Everything", version: "1" } },
    },
    { jsonrpc: "2.0", method: "initialized" },
    { jsonrpc: "2.0", id: MODEL_LIST_ID, method: "model/list", params: {} },
  ];
  return lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
}

type CodexModelRow = {
  id?: unknown;
  model?: unknown;
  displayName?: unknown;
  hidden?: unknown;
  isDefault?: unknown;
};

/**
 * Turn the `model/list` result into TME descriptors. Tier is inferred from the
 * only signals the CLI gives: the account default and a "mini" suffix.
 */
export function parseCodexModelList(line: string): ModelDescriptor[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const rec = parsed as { id?: unknown; result?: unknown; error?: unknown };
  if (rec.id !== MODEL_LIST_ID) return null;
  if (!rec.result || typeof rec.result !== "object") return [];
  const result = rec.result as { data?: unknown; models?: unknown };
  const rows = Array.isArray(result.data)
    ? result.data
    : Array.isArray(result.models)
      ? result.models
      : [];
  const out: ModelDescriptor[] = [];
  for (const row of rows as CodexModelRow[]) {
    if (!row || typeof row !== "object" || row.hidden === true) continue;
    const id =
      typeof row.model === "string" && row.model.length > 0
        ? row.model
        : typeof row.id === "string"
          ? row.id
          : "";
    if (!id) continue;
    const displayName = typeof row.displayName === "string" ? row.displayName : id;
    const isDefault = row.isDefault === true;
    const tier = /mini/i.test(id) ? "fast" : isDefault ? "balanced" : "flagship";
    out.push({
      id,
      displayName,
      tier,
      ...(isDefault ? { hint: "Default" } : {}),
    });
  }
  return out;
}

const MODEL_LIST_TIMEOUT_MS = 20_000;

/**
 * Ask the signed-in account which models it may use. Resolves to `[]` on the
 * web build, when the CLI is missing, or on timeout — the picker then falls
 * back to the static preset list, never to a blank.
 */
export async function listCodexModels(
  opts: { signal?: AbortSignal | undefined } = {},
): Promise<ModelDescriptor[]> {
  if (opts.signal?.aborted) return [];
  const session = newId("codexls");
  const found: { models: ModelDescriptor[] | null } = { models: null };
  const done = createLatch();

  const onEvent = (event: AgentCliEvent): void => {
    if (event.type === "line") {
      const parsed = parseCodexModelList(event.data);
      if (parsed !== null) {
        found.models = parsed;
        done.close();
      }
      return;
    }
    if (event.type === "exit" || event.type === "error") done.close();
  };

  let started = false;
  try {
    const path = configuredPath();
    const key = await startAgentCli(
      {
        session,
        cli: CODEX_CLI_BINARY,
        args: ["app-server"],
        env: configuredEnv(),
        stdin: buildCodexModelListStdin(),
        ...(path ? { path } : {}),
      },
      onEvent,
    );
    if (key === null) return [];
    started = true;

    const timer = setTimeout(() => done.close(), MODEL_LIST_TIMEOUT_MS);
    const onAbort = (): void => done.close();
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    if (opts.signal?.aborted) onAbort();
    try {
      await done.wait();
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
    }
    return opts.signal?.aborted ? [] : found.models ?? [];
  } catch {
    return [];
  } finally {
    // The app-server is a long-lived daemon that only leaves when told to.
    if (started) void stopAgentCli(session);
  }
}
