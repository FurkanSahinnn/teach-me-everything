// Phase 9 — Master-password vault removed.
//
// API keys live in the OS-native keychain on Tauri (Phase 8) and in plaintext
// in Dexie on web (dev-only; web build is not distributed). There is no longer
// a master password to gate access. The store is preserved as a trivial
// constant-isUnlocked stub so the ~30 legacy consumer call sites that read
// `useVault((s) => s.isUnlocked)` continue to type-check; the legacy `unlock`
// / `lock` / `setRecoveryKey` methods are no-ops in dead branches.
//
// The `__useVault` window handle is kept for devtools parity with prior
// phases and for E2E tests that may still walk through it.

import { create } from "zustand";

type VaultState = {
  isUnlocked: boolean;
  /**
   * @deprecated Phase 9 — master-password vault removed.
   * Holds an opaque sentinel object so legacy `if (!masterKey)` gates fall
   * through (they used to early-return when the vault was locked; nothing is
   * ever locked anymore). The sentinel is identity-stable across renders so
   * `useCallback` deps that include `masterKey` never re-fire.
   */
  masterKey: CryptoKey;
  /** @deprecated Phase 9 — always null. */
  recoveryKey: CryptoKey | null;
  /** @deprecated Phase 9 — no-op. */
  unlock: (key?: CryptoKey) => void;
  /** @deprecated Phase 9 — no-op. */
  setRecoveryKey: (key: CryptoKey | null) => void;
  /** @deprecated Phase 9 — no-op. */
  lock: () => void;
};

// Sentinel CryptoKey used to keep legacy `!masterKey` gates falsy. Cast
// because nothing actually calls Web Crypto with it post-Phase-9.
const PHASE9_SENTINEL_KEY = {} as CryptoKey;

export const useVault = create<VaultState>(() => ({
  isUnlocked: true,
  masterKey: PHASE9_SENTINEL_KEY,
  recoveryKey: null,
  unlock: () => {},
  setRecoveryKey: () => {},
  lock: () => {},
}));

if (typeof window !== "undefined") {
  (window as Window & { __useVault?: typeof useVault }).__useVault = useVault;
}

/**
 * Test-only seam preserved from Phase 8.D. After Phase 9 it is a no-op
 * (the store has no environmental gating to recompute). Kept exported so
 * existing test imports continue to compile.
 */
export function _recomputeVaultGatingForTests(): void {
  useVault.setState({
    isUnlocked: true,
    masterKey: PHASE9_SENTINEL_KEY,
    recoveryKey: null,
  });
}
