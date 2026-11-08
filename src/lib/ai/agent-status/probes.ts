// Status probes for the user's own `claude` / `codex` / `opencode` CLIs.
// Everything goes through the CLI's public control channel; credential files
// are never read.
import { probeAgentCli } from "@/lib/tauri/agent-cli";
import { buildClaudeCliArgs } from "@/lib/ai/providers/claude-cli";
import { readOpencodeCatalog } from "@/lib/ai/providers/opencode-cli";
import {
  parseClaudeInitialize,
  parseClaudeUsage,
  parseCliVersion,
  parseCodexAccount,
  parseCodexRateLimits,
  parseCodexUserAgent,
} from "./parsers";
import { openLineSession, type JsonLine, type LineSession } from "./session";
import type { AgentAccountStatus, AgentCliId, AgentProbeOptions } from "./types";

/** Total budget for one probe (after the binary lookup). */
export const PROBE_BUDGET_MS = 20_000;
/** Cheapest alias; the session never sends a user message, so no inference runs. */
const CLAUDE_PROBE_MODEL = "haiku";
/** The ACP agent profile TME relies on arrived in OpenCode 2. */
const OPENCODE_MIN_MAJOR = 2;

const rec = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

function base(cli: AgentCliId): AgentAccountStatus {
  return { cli, state: "error", limits: [], checkedAt: Date.now() };
}

/** Short, secret-free message from any thrown value. */
function shortError(err: unknown): string {
  const msg = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  const firstLine = msg.split("\n")[0]?.trim() ?? "";
  return firstLine ? firstLine.slice(0, 200) : "The CLI could not be queried";
}

function deadline(ms: number): () => number {
  const end = Date.now() + ms;
  return () => Math.max(1, end - Date.now());
}

async function locate(
  cli: AgentCliId,
  path: string | undefined,
): Promise<{ status: AgentAccountStatus } | { version: string | undefined }> {
  const probe = await probeAgentCli(cli, path?.trim() || undefined);
  if (probe === null) {
    return {
      status: {
        ...base(cli),
        state: "not_installed",
        error: "Local agent CLIs are only available in the desktop app",
      },
    };
  }
  if (!probe.found) {
    return {
      status: {
        ...base(cli),
        state: "not_installed",
        error: probe.error ? shortError(probe.error) : `${cli} CLI not found`,
      },
    };
  }
  return { version: parseCliVersion(probe.version) };
}

const isControlResponse =
  (requestId: string) =>
  (m: JsonLine): boolean =>
    m.type === "control_response" && rec(m.response).request_id === requestId;

async function claudeRequest(
  session: LineSession,
  remaining: () => number,
  id: string,
  subtype: string,
): Promise<unknown> {
  await session.send({ type: "control_request", request_id: id, request: { subtype } });
  const msg = await session.waitFor(isControlResponse(id), remaining());
  const response = rec(msg.response);
  if (response.subtype !== "success") {
    throw new Error(typeof response.error === "string" ? response.error : `${subtype} failed`);
  }
  return response.response;
}

export async function probeClaudeStatus(opts: AgentProbeOptions = {}): Promise<AgentAccountStatus> {
  const located = await locate("claude", opts.path);
  if ("status" in located) return located.status;
  const remaining = deadline(PROBE_BUDGET_MS);
  const path = opts.path?.trim();
  let session: LineSession | null = null;
  try {
    session = await openLineSession({
      cli: "claude",
      args: buildClaudeCliArgs({ model: CLAUDE_PROBE_MODEL }),
      env: opts.env ?? {},
      ...(path ? { path } : {}),
    });
    if (session === null) {
      return { ...base("claude"), state: "not_installed", error: "Desktop app only" };
    }
    const init = parseClaudeInitialize(await claudeRequest(session, remaining, "tme-init", "initialize"));
    const version = init.version ?? located.version;
    const status: AgentAccountStatus = {
      ...base("claude"),
      state: init.email || init.planLabel ? "authenticated" : "unauthenticated",
      ...(version ? { version } : {}),
      ...(init.email ? { email: init.email } : {}),
      ...(init.organization ? { organization: init.organization } : {}),
      ...(init.planLabel ? { planLabel: init.planLabel } : {}),
    };
    if (status.state === "authenticated") {
      try {
        status.limits = parseClaudeUsage(
          await claudeRequest(session, remaining, "tme-usage", "get_usage"),
        ).limits;
      } catch (err) {
        status.limitsError = shortError(err);
      }
    }
    return status;
  } catch (err) {
    return { ...base("claude"), error: shortError(err), ...(located.version ? { version: located.version } : {}) };
  } finally {
    if (session) await session.close();
  }
}

const isRpcResponse =
  (id: number) =>
  (m: JsonLine): boolean =>
    m.id === id && m.method === undefined;

async function codexRequest(
  session: LineSession,
  remaining: () => number,
  id: number,
  method: string,
  params: unknown,
): Promise<unknown> {
  await session.send({ id, method, params });
  const msg = await session.waitFor(isRpcResponse(id), remaining());
  if (msg.error !== undefined) {
    const message = rec(msg.error).message;
    throw new Error(typeof message === "string" ? message : `${method} failed`);
  }
  return msg.result;
}

export async function probeCodexStatus(opts: AgentProbeOptions = {}): Promise<AgentAccountStatus> {
  const located = await locate("codex", opts.path);
  if ("status" in located) return located.status;
  const remaining = deadline(PROBE_BUDGET_MS);
  const path = opts.path?.trim();
  let session: LineSession | null = null;
  try {
    session = await openLineSession({
      cli: "codex",
      args: ["app-server"],
      env: opts.env ?? {},
      ...(path ? { path } : {}),
    });
    if (session === null) {
      return { ...base("codex"), state: "not_installed", error: "Desktop app only" };
    }
    const init = rec(
      await codexRequest(session, remaining, 1, "initialize", {
        clientInfo: { name: "tme", title: "Teach Me Everything", version: "1" },
        capabilities: { experimentalApi: true },
      }),
    );
    await session.send({ method: "initialized" });
    const version = parseCodexUserAgent(init.userAgent) ?? located.version;
    const account = parseCodexAccount(await codexRequest(session, remaining, 2, "account/read", {}));
    const status: AgentAccountStatus = {
      ...base("codex"),
      state: account.kind === "none" ? "unauthenticated" : "authenticated",
      ...(version ? { version } : {}),
      ...(account.email ? { email: account.email } : {}),
      ...(account.planLabel ? { planLabel: account.planLabel } : {}),
    };
    if (status.state === "authenticated" && account.kind === "chatgpt") {
      try {
        const rl = parseCodexRateLimits(
          await codexRequest(session, remaining, 3, "account/rateLimits/read", null),
        );
        status.limits = rl.limits;
        if (rl.planLabel) status.planLabel = rl.planLabel;
      } catch (err) {
        status.limitsError = shortError(err);
      }
    }
    return status;
  } catch (err) {
    return { ...base("codex"), error: shortError(err), ...(located.version ? { version: located.version } : {}) };
  } finally {
    if (session) await session.close();
  }
}

/**
 * OpenCode has no single account: every provider is connected inside it, and
 * its free models work without any sign-in. "Authenticated" therefore means
 * "ACP answers with TME's agent loaded and at least one model reachable".
 */
export async function probeOpencodeStatus(opts: AgentProbeOptions = {}): Promise<AgentAccountStatus> {
  const located = await locate("opencode", opts.path);
  if ("status" in located) return located.status;
  const withVersion = (version: string | undefined) => (version ? { version } : {});
  const major = Number(located.version?.split(".")[0]);
  if (Number.isFinite(major) && major < OPENCODE_MIN_MAJOR) {
    return { ...base("opencode"), ...withVersion(located.version), error: `OpenCode ${OPENCODE_MIN_MAJOR} or newer is required` };
  }
  try {
    const catalog = await readOpencodeCatalog({ path: opts.path, env: opts.env, timeoutMs: PROBE_BUDGET_MS });
    if (catalog === null) {
      return { ...base("opencode"), state: "not_installed", error: "Desktop app only" };
    }
    const version = catalog.version ?? located.version;
    if (!catalog.profileLoaded) {
      return { ...base("opencode"), ...withVersion(version), error: "This OpenCode version did not load TME's agent profile" };
    }
    return {
      ...base("opencode"),
      state: catalog.models.length > 0 ? "authenticated" : "unauthenticated",
      ...withVersion(version),
      modelCount: catalog.models.length,
      providers: catalog.providers,
    };
  } catch (err) {
    return { ...base("opencode"), error: shortError(err), ...withVersion(located.version) };
  }
}
