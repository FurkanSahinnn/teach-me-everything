// Phase 8.A — Vitest coverage for the keychain TS wrapper.
//
// Mocks the `@tauri-apps/api/core` invoke entry by way of the
// `_setKeychainInvokeForTests` seam so we never need a live Tauri
// runtime. Also exercises the isTauriEnv gate via _setTauriEnvForTests.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _setTauriEnvForTests,
  isTauriEnvWithOverride,
} from "@/lib/tauri/env";
import {
  KeychainUnavailableError,
  _setKeychainInvokeForTests,
  isKeychainAvailable,
  keychainDelete,
  keychainGet,
  keychainList,
  keychainSet,
} from "../keychain";

describe("keychain TS wrapper", () => {
  beforeEach(() => {
    _setTauriEnvForTests(true);
    _setKeychainInvokeForTests(null);
  });

  afterEach(() => {
    _setTauriEnvForTests(null);
    _setKeychainInvokeForTests(null);
  });

  describe("isKeychainAvailable", () => {
    it("mirrors isTauriEnv when override is true", () => {
      _setTauriEnvForTests(true);
      expect(isKeychainAvailable()).toBe(true);
    });

    it("returns false on web", () => {
      _setTauriEnvForTests(false);
      expect(isKeychainAvailable()).toBe(false);
    });
  });

  describe("getInvoke gating", () => {
    it("keychainGet throws KeychainUnavailableError on web", async () => {
      _setTauriEnvForTests(false);
      await expect(keychainGet("anthropic")).rejects.toBeInstanceOf(
        KeychainUnavailableError,
      );
    });

    it("test invoke override bypasses isTauriEnv check", async () => {
      _setTauriEnvForTests(false);
      const invoke = vi.fn().mockResolvedValue("hunter2");
      _setKeychainInvokeForTests(invoke);
      await expect(keychainGet("anthropic")).resolves.toBe("hunter2");
      expect(invoke).toHaveBeenCalledWith("keychain_get", {
        provider: "anthropic",
      });
    });
  });

  describe("keychainGet", () => {
    it("returns the secret string", async () => {
      const invoke = vi.fn().mockResolvedValue("sk-abc123");
      _setKeychainInvokeForTests(invoke);
      const value = await keychainGet("openai");
      expect(value).toBe("sk-abc123");
      expect(invoke).toHaveBeenCalledWith("keychain_get", {
        provider: "openai",
      });
    });

    it("returns null when the Rust side reports no entry", async () => {
      const invoke = vi.fn().mockResolvedValue(null);
      _setKeychainInvokeForTests(invoke);
      const value = await keychainGet("anthropic");
      expect(value).toBeNull();
    });

    it("coalesces non-string returns to null", async () => {
      const invoke = vi.fn().mockResolvedValue(42);
      _setKeychainInvokeForTests(invoke);
      const value = await keychainGet("brave");
      expect(value).toBeNull();
    });

    it("propagates invoke errors", async () => {
      const invoke = vi.fn().mockRejectedValue(new Error("user denied"));
      _setKeychainInvokeForTests(invoke);
      await expect(keychainGet("anthropic")).rejects.toThrow("user denied");
    });
  });

  describe("keychainSet", () => {
    it("forwards provider + secret", async () => {
      const invoke = vi.fn().mockResolvedValue(undefined);
      _setKeychainInvokeForTests(invoke);
      await keychainSet("anthropic", "sk-secret");
      expect(invoke).toHaveBeenCalledWith("keychain_set", {
        provider: "anthropic",
        secret: "sk-secret",
      });
    });

    it("forwards an empty-string secret (caller's responsibility to validate)", async () => {
      const invoke = vi.fn().mockResolvedValue(undefined);
      _setKeychainInvokeForTests(invoke);
      await keychainSet("custom:my-endpoint", "");
      expect(invoke).toHaveBeenCalledWith("keychain_set", {
        provider: "custom:my-endpoint",
        secret: "",
      });
    });

    it("surfaces Rust validation errors verbatim", async () => {
      const invoke = vi
        .fn()
        .mockRejectedValue(new Error("provider id is reserved"));
      _setKeychainInvokeForTests(invoke);
      await expect(
        keychainSet("__registry__", "x"),
      ).rejects.toThrow("provider id is reserved");
    });
  });

  describe("keychainDelete", () => {
    it("forwards the provider id", async () => {
      const invoke = vi.fn().mockResolvedValue(undefined);
      _setKeychainInvokeForTests(invoke);
      await keychainDelete("openai");
      expect(invoke).toHaveBeenCalledWith("keychain_delete", {
        provider: "openai",
      });
    });

    it("does not throw when Rust reports idempotent success", async () => {
      const invoke = vi.fn().mockResolvedValue(undefined);
      _setKeychainInvokeForTests(invoke);
      await expect(keychainDelete("never-set")).resolves.toBeUndefined();
    });
  });

  describe("keychainList", () => {
    it("returns the array of provider ids", async () => {
      const invoke = vi
        .fn()
        .mockResolvedValue(["anthropic", "openai", "brave"]);
      _setKeychainInvokeForTests(invoke);
      const list = await keychainList();
      expect(list).toEqual(["anthropic", "openai", "brave"]);
      expect(invoke).toHaveBeenCalledWith("keychain_list");
    });

    it("returns empty array on first launch (no entries yet)", async () => {
      const invoke = vi.fn().mockResolvedValue([]);
      _setKeychainInvokeForTests(invoke);
      const list = await keychainList();
      expect(list).toEqual([]);
    });

    it("filters non-string entries defensively", async () => {
      const invoke = vi
        .fn()
        .mockResolvedValue(["anthropic", 42, null, "openai", undefined]);
      _setKeychainInvokeForTests(invoke);
      const list = await keychainList();
      expect(list).toEqual(["anthropic", "openai"]);
    });

    it("returns empty array when result is not an array", async () => {
      const invoke = vi.fn().mockResolvedValue("not-an-array");
      _setKeychainInvokeForTests(invoke);
      const list = await keychainList();
      expect(list).toEqual([]);
    });
  });

  describe("invoke caching", () => {
    it("calling _setKeychainInvokeForTests(null) re-resolves the next call", async () => {
      const invoke1 = vi.fn().mockResolvedValue("first");
      _setKeychainInvokeForTests(invoke1);
      await keychainGet("a");
      expect(invoke1).toHaveBeenCalledTimes(1);

      const invoke2 = vi.fn().mockResolvedValue("second");
      _setKeychainInvokeForTests(invoke2);
      await keychainGet("b");
      expect(invoke2).toHaveBeenCalledTimes(1);
      expect(invoke1).toHaveBeenCalledTimes(1);
    });
  });

  describe("KeychainUnavailableError", () => {
    it("has the expected name", () => {
      const err = new KeychainUnavailableError();
      expect(err.name).toBe("KeychainUnavailableError");
      expect(err.message).toMatch(/Tauri/);
    });
  });

  it("isTauriEnvWithOverride resets cleanly between tests", () => {
    _setTauriEnvForTests(true);
    expect(isTauriEnvWithOverride()).toBe(true);
    _setTauriEnvForTests(null);
    expect(isTauriEnvWithOverride()).toBe(false);
  });
});
