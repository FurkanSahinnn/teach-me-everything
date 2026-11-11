import { describe, it, expect } from "vitest";
import {
  QUICK_START_PRESETS,
  getQuickStartPreset,
  type QuickStartPresetId,
} from "./quick-start-presets";
import { PROVIDER_PRESETS } from "./providers/presets";
import { EMBED_PRESETS } from "./providers/embed-presets";

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

  it("every preset populates all 8 chat/task model bindings with valid catalog models", () => {
    const chatTaskKeys = [
      "chat",
      "summary",
      "quick",
      "flashcardGen",
      "roadmapGen",
      "analysisExtract",
      "analysisSynthesize",
      "analysisCritique",
    ] as const;

    for (const qs of QUICK_START_PRESETS) {
      const full = PROVIDER_PRESETS[qs.providerId as keyof typeof PROVIDER_PRESETS]!;
      const validModelIds = new Set<string>([
        ...(full.availableModels?.map((m) => m.id) ?? []),
        ...(full.defaultModels.chat ? [full.defaultModels.chat] : []),
      ]);

      for (const taskKey of chatTaskKeys) {
        const binding = qs.defaultBindings[taskKey];
        expect(binding, `${qs.id}.${taskKey} should be set`).toBeTruthy();
        expect(typeof binding).toBe("string");
        const prefix = `${qs.providerId}::`;
        expect(binding!.startsWith(prefix)).toBe(true);
        const modelId = binding!.slice(prefix.length);
        expect(
          validModelIds.has(modelId),
          `model "${modelId}" for ${qs.id}.${taskKey} must exist in PROVIDER_PRESETS[${qs.providerId}]`,
        ).toBe(true);
      }
    }
  });

  it("when embedPresetId is set, it points to a real, non-deprecated EMBED_PRESETS entry", () => {
    for (const qs of QUICK_START_PRESETS) {
      const eid = qs.defaultBindings.embedPresetId;
      if (!eid) continue;
      const exists = (
        EMBED_PRESETS as Record<string, { deprecated?: boolean } | undefined>
      )[eid];
      expect(exists, `embed preset "${eid}" missing for ${qs.id}`).toBeDefined();
      expect(
        exists?.deprecated,
        `embed preset "${eid}" for ${qs.id} must not be retired/deprecated`,
      ).not.toBe(true);
    }
  });

  it("chat-only providers without an embed endpoint (groq/anthropic) leave embedPresetId unset", () => {
    const chatOnly = QUICK_START_PRESETS.filter((p) =>
      ["groq", "anthropic"].includes(p.id),
    );
    for (const qs of chatOnly) {
      expect(qs.defaultBindings.embedPresetId).toBeUndefined();
    }
  });

  it("providers with embedding support (gemini/ollama/openrouter) set embedPresetId", () => {
    expect(getQuickStartPreset("gemini")?.defaultBindings.embedPresetId).toBe(
      "gemini-embed-2",
    );
    expect(getQuickStartPreset("ollama")?.defaultBindings.embedPresetId).toBe(
      "ollama-nomic",
    );
    expect(
      getQuickStartPreset("openrouter")?.defaultBindings.embedPresetId,
    ).toBe("openrouter-3-small");
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
