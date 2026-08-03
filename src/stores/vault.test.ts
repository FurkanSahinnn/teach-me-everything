// Phase 9 — Master-password vault removed. The store collapses to a trivial
// always-unlocked stub kept for source-compat with legacy consumers that read
// `isUnlocked` / call `unlock` / `lock` / `setRecoveryKey`. These tests pin
// the post-Phase-9 contract so a future "tidy up" pass cannot silently make
// the stub gate-able again.

import { describe, expect, it } from "vitest";
import { _recomputeVaultGatingForTests, useVault } from "@/stores/vault";

describe("useVault store (Phase 9 stub)", () => {
  it("is always unlocked at module load", () => {
    expect(useVault.getState().isUnlocked).toBe(true);
  });

  it("exposes a non-null sentinel masterKey so legacy `!masterKey` gates fall through", () => {
    const k = useVault.getState().masterKey;
    expect(k).not.toBeNull();
    expect(Boolean(k)).toBe(true);
  });

  it("`unlock` is a no-op — store stays unlocked with the same sentinel", () => {
    const before = useVault.getState().masterKey;
    useVault.getState().unlock();
    const after = useVault.getState();
    expect(after.isUnlocked).toBe(true);
    expect(after.masterKey).toBe(before);
  });

  it("`lock` is a no-op — store cannot be flipped off by stray legacy calls", () => {
    useVault.getState().lock();
    expect(useVault.getState().isUnlocked).toBe(true);
  });

  it("`setRecoveryKey` is a no-op", () => {
    const fake = {} as CryptoKey;
    useVault.getState().setRecoveryKey(fake);
    expect(useVault.getState().recoveryKey).toBeNull();
    useVault.getState().setRecoveryKey(null);
    expect(useVault.getState().recoveryKey).toBeNull();
  });

  it("_recomputeVaultGatingForTests reseats the stub state (always-unlocked)", () => {
    _recomputeVaultGatingForTests();
    const state = useVault.getState();
    expect(state.isUnlocked).toBe(true);
    expect(state.masterKey).not.toBeNull();
    expect(state.recoveryKey).toBeNull();
  });
});
