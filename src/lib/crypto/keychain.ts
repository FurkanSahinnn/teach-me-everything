// Phase 8.A — BYOK keychain TypeScript wrapper.
//
// Thin facade over the four Rust commands defined in
// src-tauri/src/keychain.rs. Callers stay agnostic of Tauri internals:
// they import these functions and we lazy-load the Tauri `invoke` API
// only when actually running inside the Tauri runtime. On the web we
// throw `KeychainUnavailableError` so the higher-level credential
// store can pick the IndexedDB+AES-GCM path instead.
//
// The `_setKeychainInvokeForTests` seam lets Vitest inject a mocked
// invoke without standing up the Tauri runtime. Mirrors the
// `_setTauriEnvForTests` / `_setVaultFsForTests` pattern used
// throughout the rest of the codebase.

import { isTauriEnvWithOverride } from "@/lib/tauri/env";

export class KeychainUnavailableError extends Error {
  constructor() {
    super("Keychain is only available in the Tauri runtime");
    this.name = "KeychainUnavailableError";
  }
}

type InvokeFn = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

let cachedInvoke: InvokeFn | null = null;
let invokeOverride: InvokeFn | null = null;

async function getInvoke(): Promise<InvokeFn> {
  if (invokeOverride) return invokeOverride;
  if (cachedInvoke) return cachedInvoke;
  if (!isTauriEnvWithOverride()) throw new KeychainUnavailableError();
  const mod = await import("@tauri-apps/api/core");
  cachedInvoke = mod.invoke as InvokeFn;
  return cachedInvoke;
}

/**
 * Test seam — flip the underlying invoke without touching the Tauri
 * runtime detection. Pass `null` to clear and re-resolve on the next
 * call.
 */
export function _setKeychainInvokeForTests(fn: InvokeFn | null): void {
  invokeOverride = fn;
  cachedInvoke = null;
}

/**
 * Returns the secret string stored under `provider`, or `null` when the
 * keychain has no entry for it. Throws on unexpected OS-level errors
 * (e.g. user denied keychain access on macOS).
 */
export async function keychainGet(provider: string): Promise<string | null> {
  const invoke = await getInvoke();
  const result = await invoke<string | null>("keychain_get", { provider });
  return typeof result === "string" ? result : null;
}

/**
 * Writes `secret` under `provider`, replacing any existing value.
 * Idempotent. Updates the internal `__registry__` entry so subsequent
 * `keychainList()` calls reflect the addition.
 */
export async function keychainSet(
  provider: string,
  secret: string,
): Promise<void> {
  const invoke = await getInvoke();
  await invoke<void>("keychain_set", { provider, secret });
}

/**
 * Removes the `provider` entry. Idempotent — succeeds even when no
 * entry exists.
 */
export async function keychainDelete(provider: string): Promise<void> {
  const invoke = await getInvoke();
  await invoke<void>("keychain_delete", { provider });
}

/**
 * Lists every provider currently stored. Reads from the Rust-side
 * registry entry; never enumerates the OS credential store directly,
 * so the answer is deterministic regardless of platform.
 */
export async function keychainList(): Promise<string[]> {
  const invoke = await getInvoke();
  const result = await invoke<string[]>("keychain_list");
  return Array.isArray(result)
    ? result.filter((x): x is string => typeof x === "string")
    : [];
}

/**
 * Cheap sync check for callers that want to branch UI without
 * triggering the lazy import. Mirrors `isTauriEnv()` but expresses the
 * keychain semantic (will be the only differentiator if future
 * variants land — e.g. web-platform `CredentialManager` API).
 */
export function isKeychainAvailable(): boolean {
  return isTauriEnvWithOverride();
}
