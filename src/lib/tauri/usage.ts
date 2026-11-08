// Usage scan bridge.
//
// Thin wrapper around the Rust `usage_scan` command (`src-tauri/src/usage.rs`),
// which reads the local Claude Code / Codex session logs and returns compact
// aggregated buckets. Returns `null` on the web build so callers can render a
// "desktop-only" state. Mirrors `lib/tauri/agent-cli.ts`.

import { isTauriEnvWithOverride } from "@/lib/tauri/env";
import type { UsageScanArgs, UsageScanResult } from "@/lib/usage/types";

type TauriInvoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

let cachedInvoke: TauriInvoke | null = null;

async function getInvoke(): Promise<TauriInvoke | null> {
  if (cachedInvoke) return cachedInvoke;
  if (!isTauriEnvWithOverride()) return null;
  try {
    const mod = (await import("@tauri-apps/api/core")) as { invoke: TauriInvoke };
    cachedInvoke = mod.invoke;
    return cachedInvoke;
  } catch {
    return null;
  }
}

/** `null` when not running inside the desktop shell. Rejects with an Error. */
export async function scanUsage(args: UsageScanArgs): Promise<UsageScanResult | null> {
  const invoke = await getInvoke();
  if (!invoke) return null;
  try {
    return await invoke<UsageScanResult>("usage_scan", { args: { ...args } });
  } catch (e) {
    // Result<_, String> rejects with a bare string.
    throw e instanceof Error ? e : new Error(String(e));
  }
}
