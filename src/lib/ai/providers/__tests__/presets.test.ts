import { describe, expect, it } from "vitest";
import { PROVIDER_PRESETS, getPreset, isCloudProviderId, listPresets } from "../presets";
import type { CloudProviderId, ProviderFamily, ProviderId, ToolUseStrategy } from "../types";

const VALID_FAMILIES: ProviderFamily[] = ["anthropic", "openai-compat", "gemini"];
const VALID_TOOL_USE: ToolUseStrategy[] = ["native", "json", "none"];

const LOCAL_IDS: CloudProviderId[] = ["ollama", "lm-studio", "llama-cpp"];

describe("PROVIDER_PRESETS", () => {
  it("contains exactly 15 presets (12 cloud + 3 local)", () => {
    expect(Object.keys(PROVIDER_PRESETS).length).toBe(15);
    const expected: CloudProviderId[] = [
      "anthropic",
      "openai",
      "google-gemini",
      "openrouter",
      "groq",
      "deepseek",
      "glm",
      "xai",
      "mistral",
      "together",
      "cerebras",
      "perplexity",
      "ollama",
      "lm-studio",
      "llama-cpp",
    ];
    for (const id of expected) {
      expect(PROVIDER_PRESETS[id]).toBeDefined();
    }
  });

  it("preset.id matches record key", () => {
    for (const [key, preset] of Object.entries(PROVIDER_PRESETS)) {
      expect(preset.id).toBe(key);
    }
  });

  it("all preset ids are unique", () => {
    const ids = listPresets().map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("baseUrl is a valid http(s) URL — cloud presets use https, local presets use http", () => {
    for (const preset of listPresets()) {
      expect(() => new URL(preset.baseUrl)).not.toThrow();
      const url = new URL(preset.baseUrl);
      const isLocal = (LOCAL_IDS as readonly string[]).includes(preset.id);
      expect(url.protocol).toBe(isLocal ? "http:" : "https:");
    }
  });

  it("defaultModels.chat is a non-empty string when kind is chat or both", () => {
    for (const preset of listPresets()) {
      if (preset.kind === "chat" || preset.kind === "both") {
        expect(typeof preset.defaultModels.chat).toBe("string");
        expect((preset.defaultModels.chat ?? "").length).toBeGreaterThan(0);
      }
    }
  });

  it("family is one of the valid ProviderFamily values", () => {
    for (const preset of listPresets()) {
      expect(VALID_FAMILIES).toContain(preset.family);
    }
  });

  it("capabilities fields are properly typed", () => {
    for (const preset of listPresets()) {
      expect(typeof preset.capabilities.cacheControl).toBe("boolean");
      expect(typeof preset.capabilities.streaming).toBe("boolean");
      expect(typeof preset.capabilities.vision).toBe("boolean");
      expect(typeof preset.capabilities.toolUse).toBe("string");
    }
  });

  it("toolUse strategy is valid for every preset", () => {
    for (const preset of listPresets()) {
      expect(VALID_TOOL_USE).toContain(preset.capabilities.toolUse);
    }
  });

  it("auth shape is valid (bearer or header with non-empty headerName)", () => {
    for (const preset of listPresets()) {
      if (preset.auth.kind === "bearer") {
        expect(preset.auth.kind).toBe("bearer");
      } else {
        expect(preset.auth.kind).toBe("header");
        expect(typeof preset.auth.headerName).toBe("string");
        expect(preset.auth.headerName.length).toBeGreaterThan(0);
      }
    }
  });

  it("only the anthropic preset has family=anthropic", () => {
    const count = Object.values(PROVIDER_PRESETS).filter((p) => p.family === "anthropic").length;
    expect(count).toBe(1);
  });

  it("only google-gemini has family=gemini", () => {
    const count = Object.values(PROVIDER_PRESETS).filter((p) => p.family === "gemini").length;
    expect(count).toBe(1);
  });

  it("exactly 13 presets have family=openai-compat (10 cloud + 3 local)", () => {
    const count = Object.values(PROVIDER_PRESETS).filter((p) => p.family === "openai-compat").length;
    expect(count).toBe(13);
  });

  it("at least 4 presets advertise freeTier=true (gemini, openrouter, groq, cerebras)", () => {
    const freeIds = listPresets()
      .filter((p) => p.freeTier === true)
      .map((p) => p.id);
    expect(freeIds.length).toBeGreaterThanOrEqual(4);
    expect(freeIds).toContain("google-gemini");
    expect(freeIds).toContain("openrouter");
    expect(freeIds).toContain("groq");
    expect(freeIds).toContain("cerebras");
  });

  it("docsUrl starts with https:// for every preset", () => {
    for (const preset of listPresets()) {
      expect(preset.docsUrl.startsWith("https://")).toBe(true);
    }
  });

  it("local presets target loopback hosts and advertise freeTier", () => {
    for (const id of LOCAL_IDS) {
      const preset = PROVIDER_PRESETS[id]!;
      expect(preset.family).toBe("openai-compat");
      expect(preset.freeTier).toBe(true);
      expect(new URL(preset.baseUrl).hostname).toBe("localhost");
    }
  });

  it("local presets use bearer auth so apiKey is optional at the adapter layer", () => {
    for (const id of LOCAL_IDS) {
      const preset = PROVIDER_PRESETS[id]!;
      expect(preset.auth.kind).toBe("bearer");
    }
  });

  it("ollama is the only local preset that exposes embeddings (kind=both)", () => {
    expect(PROVIDER_PRESETS.ollama!.kind).toBe("both");
    expect(PROVIDER_PRESETS["lm-studio"]!.kind).toBe("chat");
    expect(PROVIDER_PRESETS["llama-cpp"]!.kind).toBe("chat");
  });
});

describe("getPreset", () => {
  it("returns the preset for a known cloud id", () => {
    const preset = getPreset("anthropic");
    expect(preset).toBeDefined();
    expect(preset?.id).toBe("anthropic");
  });

  it("returns undefined for an unknown id", () => {
    expect(getPreset("xyz" as ProviderId)).toBeUndefined();
  });

  it("returns undefined for any custom: prefix id", () => {
    expect(getPreset("custom:foo" as ProviderId)).toBeUndefined();
  });
});

describe("isCloudProviderId", () => {
  it("returns true for a valid cloud preset id", () => {
    expect(isCloudProviderId("groq")).toBe(true);
  });

  it("returns false for an unknown id", () => {
    expect(isCloudProviderId("xyz")).toBe(false);
  });

  it("returns false for a custom: prefix id", () => {
    expect(isCloudProviderId("custom:foo")).toBe(false);
  });
});
