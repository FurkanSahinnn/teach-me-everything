import { describe, it, expect } from "vitest";
import {
  QUICK_START_PRESETS,
  getQuickStartPreset,
  type QuickStartPresetId,
} from "../quick-start-presets";
import { PROVIDER_PRESETS } from "../providers/presets";
import { EMBED_PRESETS } from "../providers/embed-presets";

describe("quick-start-presets registry", () => {
  it("exposes exactly 5 curated presets", () => {
    expect(QUICK_START_PRESETS).toHaveLength(5);
  });

  it("ids match the documented set (gemini/ollama/groq/anthropic/openrouter)", () => {
    const ids = QUICK_START_PRESETS.map((p) => p.id).sort();
    expect(ids).toEqual([
      "anthropic",
      "gemini",
      "groq",
      "ollama",
      "openrouter",
    ]);
  });

  it("each providerId resolves to an entry in PROVIDER_PRESETS", () => {
    for (const qs of QUICK_START_PRESETS) {
      const full = PROVIDER_PRESETS[qs.providerId as keyof typeof PROVIDER_PRESETS];
      expect(full, `expected ${qs.providerId} in PROVIDER_PRESETS`).toBeDefined();
    }
  });

  it("ollama is the only requiresKey:false preset", () => {
    const noKey = QUICK_START_PRESETS.filter((p) => !p.requiresKey).map(
      (p) => p.id,
    );
    expect(noKey).toEqual(["ollama"]);
  });

  it("ollama is the only isLocal:true preset", () => {
    const local = QUICK_START_PRESETS.filter((p) => p.isLocal).map((p) => p.id);
    expect(local).toEqual(["ollama"]);
  });

  it("freeTier flag matches PROVIDER_PRESETS source of truth", () => {
    for (const qs of QUICK_START_PRESETS) {
      const full = PROVIDER_PRESETS[qs.providerId as keyof typeof PROVIDER_PRESETS];
      // Anthropic is paid; others curated here are free or have free tiers.
      expect(qs.freeTier).toBe(full?.freeTier ?? false);
    }
  });

  it("every defaultBindings.chat is a non-empty string", () => {
    for (const qs of QUICK_START_PRESETS) {
      expect(qs.defaultBindings.chat).toBeTruthy();
      expect(typeof qs.defaultBindings.chat).toBe("string");
    }
  });

  it("when embedPresetId is set, it points to a real EMBED_PRESETS entry", () => {
    for (const qs of QUICK_START_PRESETS) {
      const eid = qs.defaultBindings.embedPresetId;
      if (!eid) continue;
      // Type narrow — EMBED_PRESETS is keyed by EmbedPresetId, but quick-start
      // stores it as `EmbedPresetId | string`. Index defensively.
      const exists = (EMBED_PRESETS as Record<string, unknown>)[eid];
      expect(exists, `embed preset "${eid}" missing for ${qs.id}`).toBeDefined();
    }
  });

  it("chat-only providers (groq/anthropic/openrouter) leave embedPresetId unset", () => {
    const chatOnly = QUICK_START_PRESETS.filter((p) =>
      ["groq", "anthropic", "openrouter"].includes(p.id),
    );
    for (const qs of chatOnly) {
      expect(qs.defaultBindings.embedPresetId).toBeUndefined();
    }
  });

  it("providerHomeUrl is a valid https URL for every preset", () => {
    for (const qs of QUICK_START_PRESETS) {
      expect(qs.providerHomeUrl).toMatch(/^https:\/\//);
    }
  });

  it("each preset has bilingual tagline (tr + en non-empty)", () => {
    for (const qs of QUICK_START_PRESETS) {
      expect(qs.tagline.tr.length).toBeGreaterThan(0);
      expect(qs.tagline.en.length).toBeGreaterThan(0);
    }
  });

  it("getQuickStartPreset returns the matching entry by id", () => {
    const ollama = getQuickStartPreset("ollama");
    expect(ollama?.providerId).toBe("ollama");
    expect(ollama?.requiresKey).toBe(false);
  });

  it("getQuickStartPreset returns undefined for unknown id", () => {
    const got = getQuickStartPreset(
      "nonexistent" as unknown as QuickStartPresetId,
    );
    expect(got).toBeUndefined();
  });
});
