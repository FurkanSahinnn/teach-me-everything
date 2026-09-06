import { describe, expect, it, vi } from "vitest";

// Importing the module pulls Dexie (api-keys-repo) and zustand-persist (prefs),
// neither of which the node test environment provides. presetIsKeyless itself
// touches neither.
vi.mock("@/lib/db/api-keys-repo", () => ({ getApiKey: vi.fn() }));
vi.mock("@/stores/prefs", () => ({
  usePrefs: {
    getState: () => ({
      preferredAnthropicAuth: "oauth",
      strictAnthropicAuth: false,
    }),
  },
}));

import { presetIsKeyless } from "./anthropic-credential";

describe("presetIsKeyless", () => {
  it("clears a provider that authenticates outside the app", () => {
    // The regression this exists for: the local CLI has no URL at all, so the
    // old `isLocalUrl(baseUrl)` check returned false and every chat entry point
    // demanded an API key that can never exist.
    expect(presetIsKeyless("claude-cli", "")).toBe(true);
  });

  it("still clears self-hosted endpoints on the user's machine", () => {
    expect(presetIsKeyless("ollama", "http://localhost:11434/v1")).toBe(true);
    expect(presetIsKeyless("lm-studio", "http://127.0.0.1:1234/v1")).toBe(true);
  });

  it("keeps demanding a key for cloud providers", () => {
    expect(presetIsKeyless("anthropic", "https://api.anthropic.com")).toBe(false);
    expect(presetIsKeyless("openai", "https://api.openai.com/v1")).toBe(false);
  });

  it("treats an unknown preset with no URL as needing a key", () => {
    // Fail closed: an empty baseUrl is only safe to wave through when the
    // preset explicitly declares external auth.
    expect(presetIsKeyless("custom:whatever", "")).toBe(false);
  });
});
