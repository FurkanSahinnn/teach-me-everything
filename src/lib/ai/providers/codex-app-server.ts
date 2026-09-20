// One ephemeral app-server thread per TME request. JSON-RPC stays on the
// existing native stdin/channel bridge; no HTTP server or persisted CLI session.
import { startAgentCli, stopAgentCli, writeAgentCli, type AgentCliEvent } from "@/lib/tauri/agent-cli";
import { newId } from "@/lib/utils/id";
import { usePrefs } from "@/stores/prefs";
import { flattenMessagesToTurn } from "./claude-cli";
import { buildJsonToolPrompt, withJsonToolFallback } from "./tool-translator";
import type { ChatRequest, ChatStreamHandle, StreamEvent, Usage } from "./types";

type RecordValue = Record<string, unknown>;
function record(value: unknown): RecordValue {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as RecordValue : {};
}
const rpc = (value: RecordValue): string => JSON.stringify(value) + "\n";
const INIT = 1, THREAD = 2, TURN = 3;
const HANDSHAKE_TIMEOUT = 20_000;

function failure(value: unknown): Extract<StreamEvent, { kind: "error" }> {
  const error = record(value);
  const info = error.codexErrorInfo;
  let status = info === "rateLimitExceeded" || info === "usageLimitExceeded" ? 429
    : info === "unauthorized" ? 401 : info === "badRequest" ? 400
    : info === "serverOverloaded" ? 503 : info === "internalServerError" ? 500 : 0;
  for (const detail of Object.values(record(info))) {
    const code = record(detail).httpStatusCode;
    if (typeof code === "number") status = code;
  }
  let message = typeof error.message === "string" ? error.message : "The Codex app-server reported an error";
  // Some upstream failures carry a serialized HTTP error in the message.
  try {
    const inner = record(JSON.parse(message));
    const detail = record(inner.error).message ?? inner.message;
    if (typeof detail === "string") message = detail;
    if (!status && typeof inner.status === "number") status = inner.status;
  } catch { /* Plain-text errors need no unwrapping. */ }
  return { kind: "error", status, message };
}

function usageFrom(value: unknown): Usage {
  const raw = record(value);
  const count = (key: string): number => typeof raw[key] === "number" && Number.isFinite(raw[key])
    ? Math.max(0, raw[key]) : 0;
  const cached = Math.min(count("cachedInputTokens"), count("inputTokens"));
  return { input_tokens: count("inputTokens") - cached,
    output_tokens: count("outputTokens"), cache_read_input_tokens: cached };
}

export function streamCodexAppServer(req: ChatRequest): ChatStreamHandle {
  const controller = new AbortController();
  const signal = req.signal ? AbortSignal.any([req.signal, controller.signal]) : controller.signal;
  const session = newId("codex");

  async function* run(): AsyncGenerator<StreamEvent> {
    if (signal.aborted) { yield { kind: "abort" }; return; }
    const queue: StreamEvent[] = [];
    let wake: (() => void) | undefined;
    let closed = false;
    let started = false;
    let threadId: string | undefined;
    let turnId: string | undefined;
    let stage: number = INIT;
    let usage: Usage = {};
    let timer: ReturnType<typeof setTimeout> | undefined;
    const streamedItems = new Set<string>();
    const completedItems = new Set<string>();
    const push = (event: StreamEvent): void => { queue.push(event); wake?.(); wake = undefined; };
    const finish = (event: StreamEvent): void => {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      // Preserve usage on failures too, without reporting successful completion.
      if (event.kind !== "stop" && Object.keys(usage).length) push({ kind: "delta", stopReason: null, usage });
      push(event);
    };
    const send = async (message: RecordValue): Promise<void> => {
      if (closed || signal.aborted) return;
      await writeAgentCli(session, rpc(message));
    };
    const armTimeout = (): void => {
      clearTimeout(timer);
      timer = setTimeout(() => finish({ kind: "error", status: 0,
        message: "The Codex app-server did not finish starting in time." }), HANDSHAKE_TIMEOUT);
    };
    let instructions = req.system.map((block) => block.text).join("\n\n");
    if (req.tools?.length) instructions += "\n\n" + buildJsonToolPrompt(req.tools);

    const handle = async (event: AgentCliEvent): Promise<void> => {
      if (closed || signal.aborted) return;
      if (event.type === "stderr") return;
      if (event.type !== "line") {
        finish({ kind: "error", status: 0, message: event.type === "error" ? event.message
          : `The Codex CLI exited before completing the turn (code ${event.code ?? "unknown"}).` });
        return;
      }
      let message: RecordValue;
      try { message = record(JSON.parse(event.data)); } catch { return; }
      // Never leave a server approval/tool request waiting indefinitely. TME's
      // tools use its own JSON protocol, not app-server tool execution.
      if (message.id !== undefined && typeof message.method === "string") {
        await send({ id: message.id, error: { code: -32601, message: "This client does not support server requests" } });
        finish({ kind: "error", status: 0, message: "Codex requested an unsupported interactive action." });
        return;
      }
      if (message.id === stage) {
        if (message.error) { finish(failure(message.error)); return; }
        if (!message.result || typeof message.result !== "object") {
          finish({ kind: "error", status: 0, message: "Invalid Codex app-server response." }); return;
        }
        if (stage === INIT) {
          stage = THREAD;
          armTimeout();
          await send({ method: "initialized" });
          await send({ id: THREAD, method: "thread/start", params: {
            model: req.model, ephemeral: true, approvalPolicy: "never", sandbox: "read-only",
            baseInstructions: instructions || "You are a helpful tutor.", developerInstructions: "",
          } });
        } else if (stage === THREAD) {
          const id = record(record(message.result).thread).id;
          if (typeof id !== "string" || !id) {
            finish({ kind: "error", status: 0, message: "Codex did not return a thread identifier." }); return;
          }
          threadId = id;
          stage = TURN;
          armTimeout();
          await send({ id: TURN, method: "turn/start", params: {
            threadId, input: [{ type: "text", text: flattenMessagesToTurn(req.messages), text_elements: [] }],
          } });
        } else if (stage === TURN) {
          const id = record(record(message.result).turn).id;
          if (typeof id !== "string" || !id) {
            finish({ kind: "error", status: 0, message: "Codex did not return a turn identifier." }); return;
          }
          turnId = id;
          stage = 0;
          clearTimeout(timer);
        }
        return;
      }
      const params = record(message.params);
      if (!threadId || params.threadId !== threadId) return;
      const notifiedTurn = typeof params.turnId === "string" ? params.turnId : record(params.turn).id;
      if (turnId && notifiedTurn !== turnId) return;
      // Notifications may precede the turn/start response on the same channel.
      if (!turnId && typeof notifiedTurn === "string") turnId = notifiedTurn;
      if (message.method === "item/agentMessage/delta") {
        if (typeof params.delta === "string" && typeof params.itemId === "string" && !completedItems.has(params.itemId)) {
          streamedItems.add(params.itemId);
          push({ kind: "text", delta: params.delta });
        }
      } else if (message.method === "item/completed") {
        const item = record(params.item);
        if (item.type === "agentMessage" && typeof item.id === "string" && !completedItems.has(item.id)) {
          completedItems.add(item.id);
          if (!streamedItems.has(item.id) && typeof item.text === "string") push({ kind: "text", delta: item.text });
        }
      } else if (message.method === "thread/tokenUsage/updated") {
        // A fresh ephemeral thread can still have several internal model calls.
        usage = usageFrom(record(params.tokenUsage).total);
      } else if (message.method === "error") {
        if (params.willRetry !== true) finish(failure(params.error));
      } else if (message.method === "turn/completed") {
        const turn = record(params.turn);
        if (turn.status === "completed") {
          push({ kind: "delta", stopReason: "end_turn", usage });
          finish({ kind: "stop" });
        } else if (turn.status === "interrupted") finish({ kind: "abort" });
        else finish(failure(turn.error));
      }
    };
    // Sequential dispatch preserves handshake order even when native events
    // arrive before the invoke that spawned the process has resolved.
    let ready: (() => void) | undefined;
    let pending = new Promise<void>((resolve) => { ready = resolve; });
    const onEvent = (event: AgentCliEvent): void => {
      pending = pending.then(() => handle(event)).catch((error: unknown) => {
        finish({ kind: "error", status: 0, message: error instanceof Error ? error.message : "Could not write to the Codex CLI" });
      });
    };
    const onAbort = (): void => {
      finish({ kind: "abort" });
      if (started) { started = false; void stopAgentCli(session); }
    };
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      const prefs = usePrefs.getState().agentCli;
      const path = prefs?.codexPath?.trim();
      const key = await startAgentCli({ session, cli: "codex", args: ["app-server"],
        env: prefs?.env ?? {}, ...(path ? { path } : {}),
        stdin: rpc({ id: INIT, method: "initialize", params: {
          clientInfo: { name: "tme", title: "Teach Me Everything", version: "1" },
        } }),
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
        message: error instanceof Error ? error.message : "Could not start the Codex CLI" };
    } finally {
      closed = true;
      ready?.();
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      if (started) await stopAgentCli(session);
    }
  }
  return { events: req.tools?.length ? withJsonToolFallback(run()) : run(), abort: () => controller.abort() };
}
