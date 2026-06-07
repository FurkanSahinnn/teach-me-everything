import { describe, expect, it } from "vitest";

import { humanizeModelId, inferModelTier } from "../tier-infer";

describe("inferModelTier — capability ranking", () => {
  it("classifies flagship models from id alone", () => {
    expect(inferModelTier("claude-opus-4-7")).toBe("flagship");
    expect(inferModelTier("gpt-5")).toBe("flagship");
    expect(inferModelTier("gpt-5-pro")).toBe("flagship");
    expect(inferModelTier("o3")).toBe("flagship");
    expect(inferModelTier("o1")).toBe("flagship");
    expect(inferModelTier("gemini-3-pro")).toBe("flagship");
    expect(inferModelTier("gemini-2.5-pro")).toBe("flagship");
    expect(inferModelTier("grok-4")).toBe("flagship");
    expect(inferModelTier("deepseek-reasoner")).toBe("flagship");
    expect(inferModelTier("mistral-large-latest")).toBe("flagship");
    expect(inferModelTier("pixtral-large-latest")).toBe("flagship");
    expect(inferModelTier("sonar-pro")).toBe("flagship");
    expect(inferModelTier("sonar-deep-research")).toBe("flagship");
  });

  it("classifies fast / small models from id alone", () => {
    expect(inferModelTier("gpt-5-mini")).toBe("fast");
    expect(inferModelTier("gpt-5-nano")).toBe("fast");
    expect(inferModelTier("claude-haiku-4-5")).toBe("fast");
    expect(inferModelTier("o3-mini")).toBe("fast");
    expect(inferModelTier("gemini-3-flash-lite")).toBe("fast");
    expect(inferModelTier("grok-3-mini")).toBe("fast");
    expect(inferModelTier("mistral-small-latest")).toBe("fast");
    expect(inferModelTier("ministral-3b-latest")).toBe("fast");
    expect(inferModelTier("llama-3.1-8b-instant")).toBe("fast");
    expect(inferModelTier("gemma2-9b-it")).toBe("fast");
  });

  it("returns 'free' when pricing is 0/0 regardless of tier name", () => {
    expect(
      inferModelTier("gemini-2.5-flash", {
        pricing: { input: 0, output: 0 },
      }),
    ).toBe("free");
    // Even a "flagship" name with 0/0 pricing reads as free — zero-cost wins.
    expect(
      inferModelTier("gemini-3-pro", { pricing: { input: 0, output: 0 } }),
    ).toBe("free");
  });

  it("returns 'free' when explicit isFree flag is set", () => {
    expect(inferModelTier("any-model", { isFree: true })).toBe("free");
  });

  it("returns 'free' for ':free' suffix slugs (OpenRouter)", () => {
    expect(inferModelTier("deepseek/deepseek-r1:free")).toBe("free");
    expect(inferModelTier("meta-llama/llama-3.3-70b:free")).toBe("free");
  });

  it("falls back to 'balanced' for ambiguous slugs", () => {
    expect(inferModelTier("glm-4.6")).toBe("balanced");
    expect(inferModelTier("deepseek-chat")).toBe("balanced");
    expect(inferModelTier("mistral-medium-latest")).toBe("balanced");
    expect(inferModelTier("grok-3")).toBe("balanced");
    expect(inferModelTier("claude-sonnet-4-6")).toBe("balanced");
  });

  it("free check wins over flagship + fast checks", () => {
    expect(
      inferModelTier("gpt-5-mini", { pricing: { input: 0, output: 0 } }),
    ).toBe("free");
  });

  it("non-zero pricing keeps tier intact", () => {
    expect(
      inferModelTier("gpt-5", { pricing: { input: 1.25, output: 10 } }),
    ).toBe("flagship");
    expect(
      inferModelTier("gpt-5-mini", { pricing: { input: 0.25, output: 2 } }),
    ).toBe("fast");
  });
});

describe("humanizeModelId", () => {
  it("title-cases a single-segment hyphen slug", () => {
    expect(humanizeModelId("gemini-2.5-flash")).toBe("Gemini 2.5 Flash");
    expect(humanizeModelId("claude-opus-4-7")).toBe("Claude Opus 4 7");
  });

  it("surfaces model first, org second for slash-namespaced ids", () => {
    // titleCase splits on hyphens so "glm-4.6" reads as two tokens — model
    // surface ends up space-separated, org stays raw inside parens.
    expect(humanizeModelId("z-ai/glm-4.6")).toBe("Glm 4.6 (z-ai)");
    expect(humanizeModelId("anthropic/claude-sonnet-4.5")).toBe(
      "Claude Sonnet 4.5 (anthropic)",
    );
  });

  it("uppercases common acronyms", () => {
    expect(humanizeModelId("gpt-5")).toBe("GPT 5");
    expect(humanizeModelId("api-llm")).toBe("API LLM");
  });

  it("keeps version-like tokens lowercase after the first char", () => {
    expect(humanizeModelId("gemini-2.5-pro")).toBe("Gemini 2.5 Pro");
  });
});
