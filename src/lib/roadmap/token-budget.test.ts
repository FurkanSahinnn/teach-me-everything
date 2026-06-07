import { describe, expect, it } from "vitest";
import {
  getMaxOutputTokens,
  getNodeBudget,
  getSubtaskMaxOutputTokens,
  SUBTASK_NODE_BUDGET,
} from "./token-budget";

describe("token-budget", () => {
  it("maps daily / weekly / monthly to the documented node ranges", () => {
    expect(getNodeBudget("daily")).toEqual({ min: 4, max: 6 });
    expect(getNodeBudget("weekly")).toEqual({ min: 8, max: 12 });
    expect(getNodeBudget("monthly")).toEqual({ min: 16, max: 24 });
  });

  it("scales output-token cap roughly with node max", () => {
    expect(getMaxOutputTokens("daily")).toBeGreaterThanOrEqual(800);
    expect(getMaxOutputTokens("weekly")).toBeGreaterThan(
      getMaxOutputTokens("daily"),
    );
    expect(getMaxOutputTokens("monthly")).toBeGreaterThan(
      getMaxOutputTokens("weekly"),
    );
    // Loose upper bound so we don't accidentally ask for 10k+ output tokens.
    expect(getMaxOutputTokens("monthly")).toBeLessThanOrEqual(6000);
  });

  it("subtask budget is independent of roadmap timeframe", () => {
    expect(SUBTASK_NODE_BUDGET).toEqual({ min: 3, max: 5 });
    expect(getSubtaskMaxOutputTokens()).toBeGreaterThanOrEqual(600);
    expect(getSubtaskMaxOutputTokens()).toBeLessThan(
      getMaxOutputTokens("monthly"),
    );
  });
});
