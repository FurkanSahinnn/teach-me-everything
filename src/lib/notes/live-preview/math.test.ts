import { describe, expect, it } from "vitest";
import { findMathBlocks, scanInlineMath } from "./math";

describe("scanInlineMath", () => {
  it("finds simple spans", () => {
    expect(scanInlineMath("a $x^2$ b")).toEqual([{ from: 2, to: 7, src: "x^2" }]);
  });
  it("ignores currency, leading space and escapes", () => {
    expect(scanInlineMath("costs $5 and $10")).toEqual([]);
    expect(scanInlineMath("$ x$")).toEqual([]);
    expect(scanInlineMath("\\$x$")).toEqual([]);
  });
  it("ignores $$ delimiters", () => {
    expect(scanInlineMath("$$x$$")).toEqual([]);
  });
});

describe("findMathBlocks", () => {
  it("finds single and multi-line blocks", () => {
    const blocks = findMathBlocks(["$$ a $$", "text", "$$", "b", "c", "$$"]);
    expect(blocks).toEqual([
      { fromLine: 1, toLine: 1, src: "a" },
      { fromLine: 3, toLine: 6, src: "b\nc" },
    ]);
  });
  it("skips fenced code", () => {
    expect(findMathBlocks(["```", "$$", "x", "$$", "```"])).toEqual([]);
  });
});
