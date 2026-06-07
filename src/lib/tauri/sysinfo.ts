// Phase 11.B — System probe bridge.
//
// Thin TypeScript wrapper around the Rust `sysinfo_probe` + `sysinfo_gpu`
// commands. The compatibility evaluator (`lib/podcast/compatibility.ts`)
// reads these to decide green/yellow/red against a provider's hardware
// requirements; the `useSystemCheck` hook caches the result for the UI.
//
// Pattern mirrors `lib/podcast/adapters/piper.ts`: a lazy `getInvoke()`
// resolves the Tauri global once per session, returning `null` on the
// web build so the caller can route to the "desktop-only" branch.
// Tests inject a fake invoke via `_setSysInfoInvokeForTests` to exercise
// the bridge without spinning up Tauri.
//
// On the web build *both* probes resolve to `null` (not an error) — the
// hook then surfaces a "not supported on web" signal to the chip
// component. Throwing here would force every caller to wrap in
// try/catch for the common "browser, not desktop" case.

import { isTauriEnvWithOverride } from "@/lib/tauri/env";

export type SysInfo = {
  totalRamBytes: number;
  availableRamBytes: number;
  cpuCores: number;
  freeDiskBytes: number;
  osName: string;
  osVersion: string;
  arch: string;
};

export type GpuInfo = {
  present: boolean;
  names: string[];
  totalVramBytes: number | null;
};

type TauriInvoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
let cachedInvoke: TauriInvoke | null = null;

async function getInvoke(): Promise<TauriInvoke | null> {
  if (cachedInvoke) return cachedInvoke;
  if (!isTauriEnvWithOverride()) return null;
  try {
    const mod = (await import("@tauri-apps/api/core")) as {
      invoke: TauriInvoke;
    };
    cachedInvoke = mod.invoke;
    return cachedInvoke;
  } catch {
    return null;
  }
}

// Test seam — Vitest swaps in a fake invoke so the bridge can be
// exercised without `@tauri-apps/api/core` loaded.
export function _setSysInfoInvokeForTests(fn: TauriInvoke | null): void {
  cachedInvoke = fn;
}

/**
 * Read aggregate system info (RAM / CPU / disk / OS / arch). Returns
 * `null` on the web build (no Tauri available) — the caller renders a
 * "desktop-only" branch instead of mocking a fake system.
 */
export async function getSysInfo(): Promise<SysInfo | null> {
  const invoke = await getInvoke();
  if (!invoke) return null;
  try {
    return await invoke<SysInfo>("sysinfo_probe");
  } catch {
    // A probe failure is treated as "unknown system" — the compatibility
    // chip renders the conservative red verdict rather than masking the
    // failure with a green false-positive.
    return null;
  }
}

/**
 * Enumerate GPU adapter names. Returns `null` on the web build; returns
 * `{present: false, names: []}` on desktop when the platform's GPU probe
 * is unavailable (e.g. wmic stripped on Windows 11 builds + PowerShell
 * fallback also missing).
 */
export async function getGpuInfo(): Promise<GpuInfo | null> {
  const invoke = await getInvoke();
  if (!invoke) return null;
  try {
    return await invoke<GpuInfo>("sysinfo_gpu");
  } catch {
    return { present: false, names: [], totalVramBytes: null };
  }
}
