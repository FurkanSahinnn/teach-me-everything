// Local agent-CLI bridge.
//
// Thin TypeScript wrapper around the Rust `agent_cli_*` commands
// (`src-tauri/src/agent_cli.rs`), which spawn a user-installed agent CLI and
// stream its NDJSON stdout back over a `tauri::ipc::Channel`.
//
// Pattern mirrors `lib/tauri/sysinfo.ts`: a lazy `getCore()` resolves the Tauri
// global once per session and returns `null` on the web build, so the caller
// routes to a "desktop-only" branch instead of wrapping every call in try/catch
// for the common "browser, not desktop" case.
//
// This is the first streaming Rust → JS path in the app. Everything else emits
// one global event; a per-session Channel is used here because article analysis
// fans out several stages at once and a global event name would force us to
// hand-multiplex a run id on top of it.

import { isTauriEnvWithOverride } from "@/lib/tauri/env";

export type AgentCliProbe = {
  found: boolean;
  path: string | null;
  /** "node" when the resolved target is a JS wrapper run under a runtime. */
  launcher: string | null;
  version: string | null;
  error: string | null;
};

export type AgentCliEvent =
  /** Exactly one line of stdout — Rust reads in line mode, so no reassembly. */
  | { type: "line"; data: string }
  | { type: "stderr"; data: string }
  | { type: "exit"; code: number | null }
  | { type: "error"; message: string };

export type AgentCliStartOptions = {
  /** Addresses this process in `writeAgentCli` / `stopAgentCli`. */
  session: string;
  /** Which CLI to auto-detect when `path` is empty. */
  cli: string;
  path?: string | undefined;
  args: string[];
  /**
   * Staged to a temp file by Rust and passed as `--system-prompt-file`. It is
   * not an argv value on purpose: Windows caps a command line near 32k
   * characters, and a TME article window is far longer than that.
   */
  systemPrompt?: string | undefined;
  env: Record<string, string>;
  cwd?: string | undefined;
  /** NDJSON (or a raw prompt) written to stdin right after spawn. */
  stdin?: string | undefined;
  /**
   * Close stdin right after that write. Required for a CLI that reads its
   * prompt to EOF (`codex exec -`); wrong for one that holds the session open
   * for further turns (`claude --input-format stream-json`).
   */
  closeStdin?: boolean | undefined;
};

type TauriInvoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
type ChannelCtor = new <T>() => { onmessage: (msg: T) => void };

let cachedInvoke: TauriInvoke | null = null;
let cachedChannel: ChannelCtor | null = null;

async function getCore(): Promise<{
  invoke: TauriInvoke;
  Channel: ChannelCtor;
} | null> {
  if (cachedInvoke && cachedChannel) {
    return { invoke: cachedInvoke, Channel: cachedChannel };
  }
  if (!isTauriEnvWithOverride()) return null;
  try {
    const mod = (await import("@tauri-apps/api/core")) as {
      invoke: TauriInvoke;
      Channel: ChannelCtor;
    };
    cachedInvoke = mod.invoke;
    cachedChannel = mod.Channel;
    return { invoke: cachedInvoke, Channel: cachedChannel };
  } catch {
    return null;
  }
}

/**
 * Tauri rejects an `invoke` with the raw payload of the Rust `Err` variant.
 * Our commands return `Result<_, String>`, so that payload is a bare string —
 * not an `Error`. A caller testing `err instanceof Error` therefore throws away
 * the one thing worth reporting, which is exactly how "Could not launch
 * claude.exe: ..." reached the user as a generic "Could not start the agent
 * CLI". Normalise here so no call site has to remember.
 */
function invokeErrorMessage(err: unknown): string {
  if (typeof err === "string" && err.trim().length > 0) return err;
  if (err instanceof Error && err.message.length > 0) return err.message;
  if (err && typeof err === "object") {
    const message = (err as { message?: unknown }).message;
    if (typeof message === "string" && message.length > 0) return message;
    try {
      return JSON.stringify(err);
    } catch {
      /* fall through */
    }
  }
  return "The agent CLI command failed with no message";
}

// Test seam — Vitest swaps in fakes so the bridge can be exercised without
// `@tauri-apps/api/core` loaded.
export function _setAgentCliCoreForTests(
  invoke: TauriInvoke | null,
  channel: ChannelCtor | null,
): void {
  cachedInvoke = invoke;
  cachedChannel = channel;
}

/**
 * Locate the CLI and read its version. `null` means "not the desktop build";
 * a `found: false` probe means "desktop, but the CLI is not usable" and carries
 * the reason in `error`. Never throws — a missing CLI is an expected state.
 */
export async function probeAgentCli(
  cli: string,
  path?: string | undefined,
): Promise<AgentCliProbe | null> {
  const core = await getCore();
  if (!core) return null;
  try {
    return await core.invoke<AgentCliProbe>("agent_cli_probe", {
      cli,
      path: path ?? null,
    });
  } catch (err) {
    return {
      found: false,
      path: path ?? null,
      launcher: null,
      version: null,
      error: invokeErrorMessage(err),
    };
  }
}

/**
 * Spawn a session. Resolves once the process is running; output arrives on
 * `onEvent` until an `exit` event. Returns `null` on the web build.
 */
export async function startAgentCli(
  options: AgentCliStartOptions,
  onEvent: (event: AgentCliEvent) => void,
): Promise<string | null> {
  const core = await getCore();
  if (!core) return null;
  const channel = new core.Channel<AgentCliEvent>();
  channel.onmessage = onEvent;
  try {
    return await core.invoke<string>("agent_cli_start", {
      options,
      onEvent: channel,
    });
  } catch (err) {
    // Also to the console: the panel shows one sentence, but diagnosing a start
    // failure usually needs the whole rejection payload. No prompt content is
    // logged — only the rejection.
    console.error("[agent-cli] agent_cli_start rejected:", err);
    // Re-throw as a real Error so the provider's `instanceof Error` check keeps
    // the Rust-side reason instead of falling back to a generic sentence.
    throw new Error(invokeErrorMessage(err));
  }
}

/** Write one NDJSON turn to a running session. */
export async function writeAgentCli(session: string, line: string): Promise<void> {
  const core = await getCore();
  if (!core) return;
  try {
    await core.invoke<void>("agent_cli_write", { session, line });
  } catch (err) {
    throw new Error(invokeErrorMessage(err));
  }
}

/**
 * Kill a session. Safe to call on one that already exited — that is how an
 * aborted turn and a completed one both unwind.
 */
export async function stopAgentCli(session: string): Promise<void> {
  const core = await getCore();
  if (!core) return;
  try {
    await core.invoke<void>("agent_cli_stop", { session });
  } catch {
    // A session that is already gone is the success case, not a failure.
  }
}
