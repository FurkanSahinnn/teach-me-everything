// Tauri runtime detection. In Tauri 2.x the runtime exposes
// `window.__TAURI_INTERNALS__`; legacy 1.x used `window.__TAURI__`. We
// accept either so the helper is forward-compat with both major lines.
//
// Pure detection — no module imports from `@tauri-apps/*` because this
// helper has to be safe to call from the web bundle where the Tauri
// runtime is absent. Heavy plugin imports are deferred to the call sites
// that already gated on `isTauriEnv()`.

declare global {
  interface Window {
    __TAURI__?: unknown;
    __TAURI_INTERNALS__?: unknown;
  }
}

export function isTauriEnv(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean(window.__TAURI_INTERNALS__ ?? window.__TAURI__);
}

// Test seam — flip the detection for unit tests without touching `window`.
let testOverride: boolean | null = null;

export function _setTauriEnvForTests(value: boolean | null): void {
  testOverride = value;
}

export function isTauriEnvWithOverride(): boolean {
  if (testOverride !== null) return testOverride;
  return isTauriEnv();
}
