// Local Codex provider: app-server token streaming and account model discovery.
// Each request uses an ephemeral thread; TME owns conversation persistence.

import { newId } from "@/lib/utils/id";
import {
  startAgentCli,
  stopAgentCli,
  type AgentCliEvent,
} from "@/lib/tauri/agent-cli";
import { usePrefs } from "@/stores/prefs";
import { streamCodexAppServer } from "./codex-app-server";
import type {
  ChatProvider,
  ChatRequest,
  ChatStreamHandle,
  ModelDescriptor,
  ProviderCapabilities,
} from "./types";

export const CODEX_CLI_BINARY = "codex";

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
    cacheControl: false, toolUse: "json", streaming: true, vision: false,
  };
  streamChat(req: ChatRequest): ChatStreamHandle {
    return streamCodexAppServer(req);
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
