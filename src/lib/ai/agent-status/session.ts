// Minimal request/response session over the agent-CLI bridge, used by the
// status probes. Always call `close()` when done.
import {
  startAgentCli,
  stopAgentCli,
  writeAgentCli,
  type AgentCliEvent,
  type AgentCliStartOptions,
} from "@/lib/tauri/agent-cli";
import { newId } from "@/lib/utils/id";

export type JsonLine = Record<string, unknown>;

export type LineSession = {
  send: (message: JsonLine) => Promise<void>;
  /** Resolves with the first (buffered or future) message matching `match`. */
  waitFor: (match: (m: JsonLine) => boolean, timeoutMs: number) => Promise<JsonLine>;
  close: () => Promise<void>;
};

type Waiter = {
  match: (m: JsonLine) => boolean;
  resolve: (m: JsonLine) => void;
  reject: (e: Error) => void;
};

/** Returns null on the web build. */
export async function openLineSession(
  opts: Omit<AgentCliStartOptions, "session" | "stdin" | "closeStdin">,
): Promise<LineSession | null> {
  const session = newId("agentstatus");
  const buffer: JsonLine[] = [];
  let ended: string | null = null;
  const waiters = new Set<Waiter>();

  const onEvent = (event: AgentCliEvent): void => {
    if (event.type === "line") {
      let parsed: unknown;
      try {
        parsed = JSON.parse(event.data);
      } catch {
        return;
      }
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return;
      const msg = parsed as JsonLine;
      for (const w of waiters) {
        if (w.match(msg)) {
          waiters.delete(w);
          w.resolve(msg);
          return;
        }
      }
      buffer.push(msg);
    } else if (event.type === "exit" || event.type === "error") {
      ended = event.type === "error" ? event.message : "The CLI exited before answering";
      for (const w of waiters) w.reject(new Error(ended));
      waiters.clear();
    }
  };

  const key = await startAgentCli({ ...opts, session }, onEvent);
  if (key === null) return null;

  return {
    send: (message) => writeAgentCli(session, JSON.stringify(message) + "\n"),
    waitFor: (match, timeoutMs) =>
      new Promise<JsonLine>((resolve, reject) => {
        const idx = buffer.findIndex(match);
        const hit = idx >= 0 ? buffer.splice(idx, 1)[0] : undefined;
        if (hit) {
          resolve(hit);
          return;
        }
        if (ended !== null) {
          reject(new Error(ended));
          return;
        }
        const timer = setTimeout(() => {
          waiters.delete(waiter);
          reject(new Error("Timed out waiting for the CLI"));
        }, timeoutMs);
        const waiter: Waiter = {
          match,
          resolve: (m) => {
            clearTimeout(timer);
            resolve(m);
          },
          reject: (e) => {
            clearTimeout(timer);
            reject(e);
          },
        };
        waiters.add(waiter);
      }),
    close: () => stopAgentCli(session),
  };
}
