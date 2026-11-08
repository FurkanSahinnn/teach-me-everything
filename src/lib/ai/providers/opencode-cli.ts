// Local OpenCode provider: ACP token streaming, plus a catalog read from a
// throwaway ACP session listing the models the user's OpenCode setup reaches.
// Models come from whatever providers the user connected inside OpenCode
// (OpenCode Zen/Go, their own API keys, local servers), so the list is live.

import { openLineSession, type JsonLine, type LineSession } from "@/lib/ai/agent-status/session";
import { getAgentWorkspace } from "@/lib/tauri/agent-cli";
import { usePrefs } from "@/stores/prefs";
import { inferModelTier } from "./model-fetch/tier-infer";
import { acpInitialize, OPENCODE_AGENT, OPENCODE_DEFAULT_MODEL, record, streamOpencodeAcp } from "./opencode-acp";
import type {
  ChatProvider,
  ChatRequest,
  ChatStreamHandle,
  ModelDescriptor,
  ProviderCapabilities,
} from "./types";

export const OPENCODE_CLI_BINARY = "opencode";

export class OpencodeCliChatProvider implements ChatProvider {
  readonly id = "opencode-cli" as const;
  readonly capabilities: ProviderCapabilities = {
    cacheControl: false, toolUse: "json", streaming: true, vision: false,
  };
  streamChat(req: ChatRequest): ChatStreamHandle {
    return streamOpencodeAcp(req);
  }
}

export type OpencodeCatalog = {
  version?: string;
  /** Models from the `session/new` model option, in OpenCode's order. */
  models: ModelDescriptor[];
  /** The model OpenCode itself would use ("provider/model"). */
  defaultModel?: string;
  /** Provider ids that contribute models, e.g. "opencode", "anthropic". */
  providers: string[];
  /** False when OpenCode ignored TME's agent profile (too old, or its config schema changed). */
  profileLoaded: boolean;
};

type SelectOption = { value: string; name: string };

/** ACP select options, which may arrive grouped. */
function selectOptions(option: Record<string, unknown>): SelectOption[] {
  const out: SelectOption[] = [];
  const walk = (items: unknown): void => {
    if (!Array.isArray(items)) return;
    for (const item of items) {
      const row = record(item);
      if (Array.isArray(row.options)) {
        walk(row.options);
      } else if (typeof row.value === "string" && row.value) {
        out.push({ value: row.value, name: typeof row.name === "string" && row.name ? row.name : row.value });
      }
    }
  };
  walk(option.options);
  return out;
}

/** Reads models, the current model and the agent list from a `session/new` result. */
export function parseOpencodeSession(result: unknown): Omit<OpencodeCatalog, "version"> {
  const raw = record(result).configOptions;
  const options = Array.isArray(raw) ? raw : [];
  const find = (id: string): Record<string, unknown> => record(options.find((o) => record(o).id === id));
  const model = find("model");
  const models: ModelDescriptor[] = selectOptions(model).map(({ value, name }) => ({
    id: value, displayName: name, tier: inferModelTier(value),
  }));
  const providers = [...new Set(models.map((m) => m.id.split("/")[0]).filter((p): p is string => !!p))];
  return {
    models,
    providers,
    ...(typeof model.currentValue === "string" && model.currentValue ? { defaultModel: model.currentValue } : {}),
    profileLoaded: selectOptions(find("mode")).some((o) => o.value === OPENCODE_AGENT),
  };
}

/** Picker entry that keeps the model chosen inside OpenCode. */
export function opencodeDefaultModel(current?: string): ModelDescriptor {
  return {
    id: OPENCODE_DEFAULT_MODEL,
    displayName: "OpenCode default",
    tier: "balanced",
    hint: current ?? "Model selected in OpenCode",
  };
}

async function request(session: LineSession, remaining: () => number, message: JsonLine): Promise<unknown> {
  await session.send({ jsonrpc: "2.0", ...message });
  const reply = await session.waitFor((m) => m.id === message.id && m.method === undefined, remaining());
  if (reply.error !== undefined) {
    const text = record(reply.error).message;
    throw new Error(typeof text === "string" ? text.replace(/^Internal error:\s*/i, "") : `${String(message.method)} failed`);
  }
  return reply.result;
}

export type OpencodeCatalogOptions = {
  path?: string | undefined;
  env?: Record<string, string> | undefined;
  timeoutMs: number;
  signal?: AbortSignal | undefined;
};

/**
 * Opens an ACP session only to read its options, then deletes it. No prompt
 * is sent, so nothing is billed. `null` on the web build; throws when
 * OpenCode cannot be started or does not answer in time.
 */
export async function readOpencodeCatalog(opts: OpencodeCatalogOptions): Promise<OpencodeCatalog | null> {
  const workspace = await getAgentWorkspace();
  if (workspace === null) return null;
  const end = Date.now() + opts.timeoutMs;
  const remaining = (): number => Math.max(1, end - Date.now());
  const path = opts.path?.trim();
  const session = await openLineSession({
    cli: OPENCODE_CLI_BINARY, args: ["acp"], env: opts.env ?? {}, ...(path ? { path } : {}),
  });
  if (session === null) return null;
  // Killing the process makes the pending wait reject, which ends the read.
  const onAbort = (): void => { void session.close(); };
  opts.signal?.addEventListener("abort", onAbort, { once: true });
  // The listener never fires for a signal that aborted during the spawn.
  if (opts.signal?.aborted) onAbort();
  try {
    const init = record(await request(session, remaining, acpInitialize(1)));
    const created = await request(session, remaining, {
      id: 2, method: "session/new", params: { cwd: workspace, mcpServers: [] },
    });
    const sessionId = record(created).sessionId;
    if (typeof sessionId === "string") {
      // Keeps the probe out of the user's OpenCode history. A failed delete
      // costs one stray empty session, not the catalog, so it is not fatal.
      await request(session, remaining, { id: 3, method: "session/delete", params: { sessionId } })
        .catch(() => undefined);
    }
    const version = record(init.agentInfo).version;
    return { ...parseOpencodeSession(created), ...(typeof version === "string" && version ? { version } : {}) };
  } finally {
    opts.signal?.removeEventListener("abort", onAbort);
    await session.close();
  }
}

const MODEL_LIST_TIMEOUT_MS = 20_000;

/**
 * Models for the picker, led by the "OpenCode default" entry. Resolves to `[]`
 * on the web build, when the CLI is missing or fails, or on timeout; the
 * picker then falls back to the static preset list instead of going blank.
 */
export async function listOpencodeModels(
  opts: { signal?: AbortSignal | undefined } = {},
): Promise<ModelDescriptor[]> {
  if (opts.signal?.aborted) return [];
  try {
    const prefs = usePrefs.getState().agentCli;
    const catalog = await readOpencodeCatalog({
      path: prefs?.opencodePath, env: prefs?.env, timeoutMs: MODEL_LIST_TIMEOUT_MS, signal: opts.signal,
    });
    if (!catalog || opts.signal?.aborted) return [];
    return [opencodeDefaultModel(catalog.defaultModel), ...catalog.models];
  } catch {
    return [];
  }
}
