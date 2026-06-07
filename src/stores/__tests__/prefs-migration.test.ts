import { describe, expect, it } from "vitest";
import {
  DEFAULT_CURRICULUM_GENERATION_PREFS,
  DEFAULT_MODEL_BINDINGS,
  DEFAULT_SRS_PREFS,
  migratePrefs,
  usePrefs,
  type CurriculumGenerationPrefs,
  type ModelBindings,
  type SrsPrefs,
} from "../prefs";

const PRE_V8_BASE = {
  theme: "white",
  themeFollowsSystem: false,
  density: "normal",
  locale: "tr",
  preferredAnthropicAuth: "oauth",
  strictAnthropicAuth: false,
  aiResponseLocale: "follow_source",
  customEndpoints: [],
};

describe("migratePrefs v7 → v8", () => {
  it("injects DEFAULT_MODEL_BINDINGS when modelBindings is missing", () => {
    const out = migratePrefs({ ...PRE_V8_BASE }, 7) as { modelBindings: ModelBindings };
    expect(out.modelBindings).toEqual(DEFAULT_MODEL_BINDINGS);
  });

  it("leaves a fully-valid modelBindings object intact", () => {
    const custom: ModelBindings = {
      chat: "gpt-5-mini",
      summary: "claude-haiku-4-5",
      quick: "claude-haiku-4-5",
      embedPresetId: "gemini-004",
      flashcardGen: "claude-sonnet-4-6",
      roadmapGen: "claude-opus-4-7",
      researchProvider: "firecrawl",
    };
    const out = migratePrefs(
      { ...PRE_V8_BASE, modelBindings: custom },
      7,
    ) as { modelBindings: ModelBindings };
    expect(out.modelBindings).toEqual(custom);
  });

  it("replaces malformed modelBindings with defaults", () => {
    const cases: unknown[] = [
      "not-an-object",
      42,
      [],
      { chat: 1 },
      { chat: "x", summary: "y", quick: "z" },
      { ...DEFAULT_MODEL_BINDINGS, chat: 123 },
    ];
    for (const bad of cases) {
      const out = migratePrefs(
        { ...PRE_V8_BASE, modelBindings: bad },
        7,
      ) as { modelBindings: ModelBindings };
      expect(out.modelBindings).toEqual(DEFAULT_MODEL_BINDINGS);
    }
  });

  it("walks v6 → v9 in one call (customEndpoints + modelBindings + srs injected)", () => {
    const v6State = {
      theme: "white",
      themeFollowsSystem: false,
      density: "normal",
      locale: "tr",
      preferredAnthropicAuth: "oauth",
      strictAnthropicAuth: false,
      aiResponseLocale: "follow_source",
    };
    const out = migratePrefs(v6State, 6) as {
      customEndpoints: unknown[];
      modelBindings: ModelBindings;
      srs: SrsPrefs;
    };
    expect(Array.isArray(out.customEndpoints)).toBe(true);
    expect(out.customEndpoints).toEqual([]);
    expect(out.modelBindings).toEqual(DEFAULT_MODEL_BINDINGS);
    expect(out.srs).toEqual(DEFAULT_SRS_PREFS);
  });
});

describe("migratePrefs v8 → v9 (srs)", () => {
  const PRE_V9_BASE = {
    theme: "white",
    themeFollowsSystem: false,
    density: "normal",
    locale: "tr",
    preferredAnthropicAuth: "oauth",
    strictAnthropicAuth: false,
    aiResponseLocale: "follow_source",
    customEndpoints: [],
    modelBindings: { ...DEFAULT_MODEL_BINDINGS },
  };

  it("injects DEFAULT_SRS_PREFS when srs is missing", () => {
    const out = migratePrefs({ ...PRE_V9_BASE }, 8) as { srs: SrsPrefs };
    expect(out.srs).toEqual(DEFAULT_SRS_PREFS);
  });

  it("clamps out-of-range srs limits into [0, 200]", () => {
    const out = migratePrefs(
      { ...PRE_V9_BASE, srs: { dailyNew: -50, dailyReview: 5_000 } },
      8,
    ) as { srs: SrsPrefs };
    expect(out.srs.dailyNew).toBe(0);
    expect(out.srs.dailyReview).toBe(200);
  });

  it("replaces malformed srs (string fields, missing keys) with defaults", () => {
    const out = migratePrefs(
      { ...PRE_V9_BASE, srs: { dailyNew: "twenty" } },
      8,
    ) as { srs: SrsPrefs };
    expect(out.srs).toEqual(DEFAULT_SRS_PREFS);
  });
});

describe("curriculum generation prefs", () => {
  it("injects defaults when upgrading older prefs", () => {
    const out = migratePrefs({ ...PRE_V8_BASE }, 19) as {
      curriculumGeneration: CurriculumGenerationPrefs;
    };

    expect(out.curriculumGeneration).toEqual(
      DEFAULT_CURRICULUM_GENERATION_PREFS,
    );
  });

  it("clamps chunk detail changes into the supported range", () => {
    usePrefs.setState({
      curriculumGeneration: { ...DEFAULT_CURRICULUM_GENERATION_PREFS },
    });

    usePrefs.getState().setCurriculumChunkDetail(99);
    expect(usePrefs.getState().curriculumGeneration.chunkDetailLevel).toBe(5);

    usePrefs.getState().setCurriculumChunkDetail(-99);
    expect(usePrefs.getState().curriculumGeneration.chunkDetailLevel).toBe(1);
  });
});

describe("migratePrefs v20 → v21 (roadmapGen binding)", () => {
  it("backfills roadmapGen from summary, preserving other bindings", () => {
    const v20bindings = {
      chat: "anthropic::claude-opus-4-7",
      summary: "anthropic::claude-haiku-4-5",
      quick: "anthropic::claude-haiku-4-5",
      embedPresetId: "openai-3-small",
      flashcardGen: "anthropic::claude-sonnet-4-6",
      researchProvider: "firecrawl",
    };
    const out = migratePrefs(
      { ...PRE_V8_BASE, modelBindings: { ...v20bindings } },
      20,
    ) as { modelBindings: ModelBindings };
    expect(out.modelBindings.roadmapGen).toBe("anthropic::claude-haiku-4-5");
    expect(out.modelBindings.chat).toBe("anthropic::claude-opus-4-7");
    expect(out.modelBindings.flashcardGen).toBe("anthropic::claude-sonnet-4-6");
  });

  it("falls back to the default roadmapGen when summary is also absent", () => {
    const out = migratePrefs(
      { ...PRE_V8_BASE, modelBindings: { chat: "x" } },
      20,
    ) as { modelBindings: ModelBindings };
    expect(out.modelBindings.roadmapGen).toBe(
      DEFAULT_MODEL_BINDINGS.roadmapGen,
    );
  });
});
