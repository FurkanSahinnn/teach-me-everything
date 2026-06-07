/** @vitest-environment jsdom */
import { describe, it, expect, afterEach } from "vitest";
import {
  isTauriEnv,
  isTauriEnvWithOverride,
  _setTauriEnvForTests,
} from "./env";

const w = window as unknown as Window;

afterEach(() => {
  _setTauriEnvForTests(null);
  delete w.__TAURI__;
  delete w.__TAURI_INTERNALS__;
});

describe("isTauriEnv", () => {
  it("returns false when neither __TAURI__ nor __TAURI_INTERNALS__ is set", () => {
    expect(isTauriEnv()).toBe(false);
  });

  it("returns true when Tauri 2.x __TAURI_INTERNALS__ is set", () => {
    w.__TAURI_INTERNALS__ = { invoke: () => Promise.resolve() };
    expect(isTauriEnv()).toBe(true);
  });

  it("returns true when legacy 1.x __TAURI__ is set (forward-compat)", () => {
    w.__TAURI__ = {};
    expect(isTauriEnv()).toBe(true);
  });
});

describe("isTauriEnvWithOverride", () => {
  it("honours test override (true)", () => {
    _setTauriEnvForTests(true);
    expect(isTauriEnvWithOverride()).toBe(true);
  });

  it("honours test override (false) even when __TAURI__ is set", () => {
    w.__TAURI__ = {};
    _setTauriEnvForTests(false);
    expect(isTauriEnvWithOverride()).toBe(false);
  });

  it("falls back to real detection when override cleared", () => {
    _setTauriEnvForTests(null);
    expect(isTauriEnvWithOverride()).toBe(false);
  });
});
