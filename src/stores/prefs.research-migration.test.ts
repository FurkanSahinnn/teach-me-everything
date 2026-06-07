import { describe, expect, it } from "vitest";
import { migratePrefs, DEFAULT_MODEL_BINDINGS } from "./prefs";

describe("prefs v11 migration — researchProvider", () => {
  it("patches valid v10 modelBindings with researchProvider=readability", () => {
    const v10State = {
      theme: "dark",
      density: "normal",
      locale: "tr",
      modelBindings: {
        chat: "anthropic::claude-sonnet-4-6",
        summary: "anthropic::claude-sonnet-4-6",
        quick: "anthropic::claude-haiku-4-5",
        embedPresetId: "openai-3-small",
        flashcardGen: "anthropic::claude-sonnet-4-6",
      },
    };
    const next = migratePrefs(v10State, 10) as unknown as {
      modelBindings: typeof DEFAULT_MODEL_BINDINGS;
    };
    expect(next.modelBindings.researchProvider).toBe("readability");
    // Other bindings preserved
    expect(next.modelBindings.chat).toBe("anthropic::claude-sonnet-4-6");
    expect(next.modelBindings.embedPresetId).toBe("openai-3-small");
  });

  it("resets bindings entirely when state has no usable modelBindings", () => {
    const v10State = { theme: "dark", modelBindings: { broken: true } };
    const next = migratePrefs(v10State, 10) as unknown as {
      modelBindings: typeof DEFAULT_MODEL_BINDINGS;
    };
    expect(next.modelBindings).toEqual(DEFAULT_MODEL_BINDINGS);
  });

  it("leaves v11+ state untouched", () => {
    const v11State = {
      theme: "dark",
      density: "normal",
      locale: "tr",
      modelBindings: {
        ...DEFAULT_MODEL_BINDINGS,
        researchProvider: "firecrawl",
      },
    };
    const next = migratePrefs(v11State, 11) as unknown as {
      modelBindings: typeof DEFAULT_MODEL_BINDINGS;
    };
    expect(next.modelBindings.researchProvider).toBe("firecrawl");
  });
});
