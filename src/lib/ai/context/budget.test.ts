import { describe, expect, it } from "vitest";
import {
  CONTEXT_TOKEN_BUDGETS,
  clampToBudget,
  tokensToChars,
} from "./budget";

describe("context budget — clampToBudget", () => {
  it("returns text unchanged when under the budget", () => {
    const text = "short text well within budget";
    expect(clampToBudget(text, 100)).toBe(text);
  });

  it("returns empty string for a non-positive budget", () => {
    expect(clampToBudget("anything", 0)).toBe("");
    expect(clampToBudget("anything", -5)).toBe("");
  });

  it("truncates and appends a single ellipsis when over budget", () => {
    // 1 token ≈ 4 chars → maxChars = 8.
    const text = "aaaa bbbb cccc dddd";
    const out = clampToBudget(text, 2);
    expect(out.endsWith("…")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(tokensToChars(2) + 1);
    expect(out).not.toContain("dddd");
  });

  it("prefers a whitespace boundary near the cap so words aren't sliced", () => {
    // maxChars = 16. "hello world foobar" → boundary at index 11 (the space
    // after "world") is >= 60% of 16, so it cuts there.
    const out = clampToBudget("hello world foobar baz", 4);
    expect(out).toBe("hello world…");
  });

  it("falls back to a hard cut when the only boundary is too early", () => {
    // A single very long unbroken token: no late whitespace boundary, so the
    // hard cut wins rather than collapsing the block to almost nothing.
    const text = "supercalifragilisticexpialidocious";
    const out = clampToBudget(text, 3); // maxChars = 12
    expect(out.endsWith("…")).toBe(true);
    // 12 chars + ellipsis, no early collapse.
    expect(out.length).toBe(13);
  });

  it("is deterministic for the same input", () => {
    const text = "the quick brown fox jumps over the lazy dog repeatedly";
    expect(clampToBudget(text, 5)).toBe(clampToBudget(text, 5));
  });
});

describe("context budget — tokensToChars + caps", () => {
  it("converts tokens to chars at ~4 chars/token", () => {
    expect(tokensToChars(10)).toBe(40);
    expect(tokensToChars(0)).toBe(0);
    expect(tokensToChars(-3)).toBe(0);
  });

  it("defines a cap for every prose block kind", () => {
    expect(CONTEXT_TOKEN_BUDGETS.notes).toBeGreaterThan(0);
    expect(CONTEXT_TOKEN_BUDGETS.concepts).toBeGreaterThan(0);
    expect(CONTEXT_TOKEN_BUDGETS.roadmap).toBeGreaterThan(0);
    expect(CONTEXT_TOKEN_BUDGETS.performance).toBeGreaterThan(0);
  });
});
