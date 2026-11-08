// One ephemeral OpenCode ACP session per TME request, over the native
// stdin/channel bridge. Rust supplies the agent profile (every tool denied,
// TME's system prompt behind a file reference); this side selects that agent,
// sends one flattened turn, streams `agent_message_chunk` text and deletes the
// session so TME traffic never lingers in the user's OpenCode history.
import {
  getAgentWorkspace,
  startAgentCli,
  stopAgentCli,
  writeAgentCli,
  type AgentCliEvent,
} from "@/lib/tauri/agent-cli";
import { newId } from "@/lib/utils/id";
import { usePrefs } from "@/stores/prefs";
import { flattenMessagesToTurn } from "./claude-cli";
import { buildJsonToolPrompt, withJsonToolFallback } from "./tool-translator";
import type { ChatRequest, ChatStreamHandle, StreamEvent, Usage } from "./types";

/** Agent registered by Rust (`OPENCODE_AGENT` in `src-tauri/src/agent_cli.rs`). */
export const OPENCODE_AGENT = "tme-tutor";
/** Model id that keeps whatever model the user picked inside OpenCode. */
export const OPENCODE_DEFAULT_MODEL = "default";

type RecordValue = Record<string, unknown>;
export function record(value: unknown): RecordValue {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as RecordValue : {};
}
export const acpLine = (value: RecordValue): string => JSON.stringify({ jsonrpc: "2.0", ...value }) + "\n";

/** ACP `initialize`. The client offers no file system or terminal access. */
export function acpInitialize(id: number): RecordValue {
  return { id, method: "initialize", params: {
    protocolVersion: 1,
    clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
  } };
}

const INIT = 1, SESSION = 2, MODE = 3, MODEL = 4, PROMPT = 5, DELETE = 6;
const HANDSHAKE_TIMEOUT = 20_000;
/** Upper bound on waiting for `session/delete` while tearing a turn down. */
const DELETE_TIMEOUT = 2_000;
/** ACP's "authentication required" error code. */
const ACP_AUTH_REQUIRED = -32000;
const ACP_METHOD_NOT_FOUND = -32601;

const PROFILE_MISSING = "This OpenCode version did not load TME's agent profile. Update to OpenCode 2 or newer.";

export function opencodeFailure(value: unknown): Extract<StreamEvent, { kind: "error" }> {
  const error = record(value);
  const data = record(error.data);
  const name = typeof data.errorName === "string" ? data.errorName : "";
  const raw = typeof error.message === "string" ? error.message : "";
  // OpenCode wraps every service failure as "Internal error: <reason>".
  let message = raw.replace(/^Internal error:\s*/i, "").trim() || "OpenCode reported an error";
  let status = 0;
  if (error.code === ACP_AUTH_REQUIRED || /auth|unauthori[sz]ed|credential/i.test(name)) {
    status = 401;
    if (error.code === ACP_AUTH_REQUIRED) {
      message += `${/[.!?]$/.test(message) ? "" : "."} Run \`opencode auth login\` in a terminal.`;
    }
  } else if (/limit|rate|quota/i.test(name)) {
    status = 429;
  }
  return { kind: "error", status, message };
}

/** ACP prompt usage. `inputTokens` already excludes cache reads. */
export function opencodeUsage(value: unknown): Usage {
  const raw = record(value);
  const count = (key: string): number => {
    const n = raw[key];
    return typeof n === "number" && Number.isFinite(n) ? Math.max(0, n) : 0;
  };
  const cacheRead = count("cachedReadTokens");
  const cacheWrite = count("cachedWriteTokens");
  return {
    input_tokens: count("inputTokens"),
    // Reasoning is billed as output.
    output_tokens: count("outputTokens") + count("thoughtTokens"),
    ...(cacheRead ? { cache_read_input_tokens: cacheRead } : {}),
    ...(cacheWrite ? { cache_creation_input_tokens: cacheWrite } : {}),
  };
}

export function streamOpencodeAcp(req: ChatRequest): ChatStreamHandle {
  const controller = new AbortController();
  const signal = req.signal ? AbortSignal.any([req.signal, controller.signal]) : controller.signal;
  const session = newId("opencode");

  async function* run(): AsyncGenerator<StreamEvent> {
    if (signal.aborted) { yield { kind: "abort" }; return; }
    const queue: StreamEvent[] = [];
    let wake: (() => void) | undefined;
    let closed = false;
    let started = false;
    let exited = false;
    let stage: number = INIT;
    let sessionId: string | undefined;
    let prompting = false;
    let workspace = "";
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onDeleted: (() => void) | undefined;
    const push = (event: StreamEvent): void => { queue.push(event); wake?.(); wake = undefined; };
    const finish = (event: StreamEvent): void => {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      push(event);
    };
    const send = async (message: RecordValue): Promise<void> => {
      if (closed || signal.aborted) return;
      await writeAgentCli(session, acpLine(message));
    };
    const armTimeout = (): void => {
      clearTimeout(timer);
      timer = setTimeout(() => finish({ kind: "error", status: 0,
        message: "OpenCode did not finish starting in time." }), HANDSHAKE_TIMEOUT);
    };
    let instructions = req.system.map((block) => block.text).join("\n\n");
    if (req.tools?.length) instructions += "\n\n" + buildJsonToolPrompt(req.tools);
    instructions = instructions.trim() || "You are a helpful tutor.";

    const startPrompt = async (): Promise<void> => {
      stage = PROMPT;
      prompting = true;
      // Generation can legitimately take minutes; only the handshake is timed.
      clearTimeout(timer);
      await send({ id: PROMPT, method: "session/prompt", params: {
        sessionId, prompt: [{ type: "text", text: flattenMessagesToTurn(req.messages) }],
      } });
    };

    const onResponse = async (message: RecordValue): Promise<void> => {
      if (message.error !== undefined) {
        const code = record(message.error).code;
        // A missing agent means OpenCode ignored the Rust-supplied profile.
        const profileMissing = stage === MODE || (stage !== PROMPT && code === ACP_METHOD_NOT_FOUND);
        finish(profileMissing ? { kind: "error", status: 0, message: PROFILE_MISSING } : opencodeFailure(message.error));
        return;
      }
      const result = record(message.result);
      if (stage === INIT) {
        stage = SESSION;
        armTimeout();
        await send({ id: SESSION, method: "session/new", params: { cwd: workspace, mcpServers: [] } });
      } else if (stage === SESSION) {
        if (typeof result.sessionId !== "string" || !result.sessionId) {
          finish({ kind: "error", status: 0, message: "OpenCode did not return a session identifier." });
          return;
        }
        sessionId = result.sessionId;
        stage = MODE;
        armTimeout();
        await send({ id: MODE, method: "session/set_config_option", params: {
          sessionId, configId: "mode", value: OPENCODE_AGENT,
        } });
      } else if (stage === MODE) {
        if (req.model && req.model !== OPENCODE_DEFAULT_MODEL) {
          stage = MODEL;
          armTimeout();
          await send({ id: MODEL, method: "session/set_config_option", params: {
            sessionId, configId: "model", value: req.model,
          } });
        } else {
          await startPrompt();
        }
      } else if (stage === MODEL) {
        await startPrompt();
      } else if (stage === PROMPT) {
        prompting = false;
        const stopReason = typeof result.stopReason === "string" ? result.stopReason : "end_turn";
        if (stopReason === "cancelled") { finish({ kind: "abort" }); return; }
        push({ kind: "delta", stopReason, usage: opencodeUsage(result.usage) });
        finish({ kind: "stop" });
      }
    };

    const handle = async (event: AgentCliEvent): Promise<void> => {
      if (event.type === "stderr") return;
      if (event.type !== "line") {
        exited = true;
        onDeleted?.();
        if (closed || signal.aborted) return;
        finish({ kind: "error", status: 0, message: event.type === "error" ? event.message
          : `OpenCode exited before completing the turn (code ${event.code ?? "unknown"}).` });
        return;
      }
      let message: RecordValue;
      try { message = record(JSON.parse(event.data)); } catch { return; }
      const isRequest = message.id !== undefined && typeof message.method === "string";
      // Checked before the closed guard: teardown waits on this response.
      if (!isRequest && message.id === DELETE) { onDeleted?.(); return; }
      if (closed || signal.aborted) return;
      if (isRequest) {
        // Every tool is denied, so a permission prompt should not appear; if
        // one does, decline it and let the turn continue without the tool.
        await send(message.method === "session/request_permission"
          ? { id: message.id, result: { outcome: { outcome: "cancelled" } } }
          : { id: message.id, error: { code: ACP_METHOD_NOT_FOUND, message: "This client does not support that request" } });
        return;
      }
      if (message.id !== undefined) {
        if (message.id === stage) await onResponse(message);
        return;
      }
      if (message.method !== "session/update") return;
      const params = record(message.params);
      if (!sessionId || params.sessionId !== sessionId) return;
      const update = record(params.update);
      const content = record(update.content);
      if (update.sessionUpdate === "agent_message_chunk" && content.type === "text" && typeof content.text === "string") {
        push({ kind: "text", delta: content.text });
      }
    };

    // Best effort: cancel a running prompt and delete the session so it does
    // not show up in OpenCode's history. Bounded, and skipped once exited.
    const discardSession = async (): Promise<void> => {
      if (!sessionId || exited) return;
      let deleteTimer: ReturnType<typeof setTimeout> | undefined;
      const deleted = new Promise<void>((resolve) => {
        onDeleted = resolve;
        deleteTimer = setTimeout(resolve, DELETE_TIMEOUT);
      });
      try {
        if (prompting) await writeAgentCli(session, acpLine({ method: "session/cancel", params: { sessionId } }));
        await writeAgentCli(session, acpLine({ id: DELETE, method: "session/delete", params: { sessionId } }));
        await deleted;
      } catch {
        // The process already closed its input; the kill below still runs.
      } finally {
        clearTimeout(deleteTimer);
      }
    };

    // Sequential dispatch preserves handshake order even when native events
    // arrive before the invoke that spawned the process has resolved.
    let ready: (() => void) | undefined;
    let pending = new Promise<void>((resolve) => { ready = resolve; });
    const onEvent = (event: AgentCliEvent): void => {
      pending = pending.then(() => handle(event)).catch((error: unknown) => {
        finish({ kind: "error", status: 0, message: error instanceof Error ? error.message : "Could not write to OpenCode" });
      });
    };
    const onAbort = (): void => finish({ kind: "abort" });
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      const dir = await getAgentWorkspace();
      if (dir === null) {
        closed = true;
        yield { kind: "error", status: 0, message: "The local agent CLI is only available in the desktop app." };
        return;
      }
      workspace = dir;
      // Nothing is running yet, so an abort here needs no teardown.
      if (signal.aborted) { yield { kind: "abort" }; return; }
      const prefs = usePrefs.getState().agentCli;
      const path = prefs?.opencodePath?.trim();
      const key = await startAgentCli({
        session, cli: "opencode", args: ["acp"], env: { ...(prefs?.env ?? {}) },
        systemPrompt: instructions, stdin: acpLine(acpInitialize(INIT)), ...(path ? { path } : {}),
      }, onEvent);
      if (key === null) {
        closed = true;
        yield { kind: "error", status: 0, message: "The local agent CLI is only available in the desktop app." };
        return;
      }
      started = true;
      if (signal.aborted) onAbort();
      else armTimeout();
      ready?.();
      yield { kind: "start", model: req.model, usage: {} };
      for (;;) {
        const event = queue.shift();
        if (event) { yield event; continue; }
        if (closed) return;
        await new Promise<void>((resolve) => { wake = resolve; });
      }
    } catch (error) {
      yield signal.aborted ? { kind: "abort" } : { kind: "error", status: 0,
        message: error instanceof Error ? error.message : "Could not start OpenCode" };
    } finally {
      closed = true;
      ready?.();
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      if (started) {
        await discardSession();
        await stopAgentCli(session);
      }
    }
  }
  return { events: req.tools?.length ? withJsonToolFallback(run()) : run(), abort: () => controller.abort() };
}
