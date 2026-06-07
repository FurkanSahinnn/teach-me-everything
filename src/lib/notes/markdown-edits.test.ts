import { describe, expect, it } from "vitest";
import {
  setHeadingLevel,
  toggleBlockquoteLine,
  toggleCheckboxLine,
  toggleInlineWrap,
  toggleOrderedListLine,
  toggleUnorderedListLine,
} from "./markdown-edits";

describe("setHeadingLevel", () => {
  it("adds a fresh heading", () => {
    expect(setHeadingLevel("Hello", 2)).toBe("## Hello");
  });

  it("replaces an existing heading at any level", () => {
    expect(setHeadingLevel("### Title", 1)).toBe("# Title");
    expect(setHeadingLevel("###### Deep", 4)).toBe("#### Deep");
  });

  it("strips the heading when level is 0", () => {
    expect(setHeadingLevel("## Heading", 0)).toBe("Heading");
    expect(setHeadingLevel("Plain", 0)).toBe("Plain");
  });

  it("does not touch lines that merely begin with # but no space", () => {
    expect(setHeadingLevel("#nospace", 3)).toBe("### #nospace");
  });
});

describe("toggleUnorderedListLine", () => {
  it("adds a bullet to a plain line", () => {
    expect(toggleUnorderedListLine("note")).toBe("- note");
  });

  it("removes an existing bullet", () => {
    expect(toggleUnorderedListLine("- note")).toBe("note");
    expect(toggleUnorderedListLine("* note")).toBe("note");
  });

  it("converts an ordered item to bullet", () => {
    expect(toggleUnorderedListLine("1. step")).toBe("- step");
    expect(toggleUnorderedListLine("12. step")).toBe("- step");
  });

  it("strips checkbox markers when toggling off list state", () => {
    expect(toggleUnorderedListLine("- [ ] todo")).toBe("todo");
    expect(toggleUnorderedListLine("- [x] done")).toBe("done");
  });
});

describe("toggleOrderedListLine", () => {
  it("adds an ordered marker to a plain line", () => {
    expect(toggleOrderedListLine("step", 1)).toBe("1. step");
  });

  it("removes an existing ordered marker", () => {
    expect(toggleOrderedListLine("1. step", 1)).toBe("step");
    expect(toggleOrderedListLine("42. step", 1)).toBe("step");
  });

  it("converts bullet to ordered with the supplied index", () => {
    expect(toggleOrderedListLine("- step", 3)).toBe("3. step");
  });
});

describe("toggleCheckboxLine", () => {
  it("adds an unchecked checkbox to a plain line", () => {
    expect(toggleCheckboxLine("task")).toBe("- [ ] task");
  });

  it("checks an unchecked box", () => {
    expect(toggleCheckboxLine("- [ ] task")).toBe("- [x] task");
  });

  it("removes a checked box on third toggle", () => {
    expect(toggleCheckboxLine("- [x] task")).toBe("task");
    expect(toggleCheckboxLine("- [X] task")).toBe("task");
  });

  it("converts a bullet item to an unchecked checkbox", () => {
    expect(toggleCheckboxLine("- item")).toBe("- [ ] item");
  });

  it("converts an ordered item to an unchecked checkbox", () => {
    expect(toggleCheckboxLine("1. item")).toBe("- [ ] item");
  });
});

describe("toggleBlockquoteLine", () => {
  it("adds a blockquote marker", () => {
    expect(toggleBlockquoteLine("quote")).toBe("> quote");
  });

  it("removes a blockquote marker", () => {
    expect(toggleBlockquoteLine("> quote")).toBe("quote");
  });
});

describe("toggleInlineWrap", () => {
  it("wraps the selection with the marker", () => {
    const r = toggleInlineWrap("hello world", "**", 6, 11);
    expect(r.text).toBe("hello **world**");
    expect(r.from).toBe(8);
    expect(r.to).toBe(13);
  });

  it("unwraps when the selection is already surrounded by the marker", () => {
    const r = toggleInlineWrap("hello **world**", "**", 8, 13);
    expect(r.text).toBe("hello world");
    expect(r.from).toBe(6);
    expect(r.to).toBe(11);
  });

  it("wraps zero-width selection (caret) leaving the caret between the markers", () => {
    const r = toggleInlineWrap("hello world", "*", 5, 5);
    expect(r.text).toBe("hello** world");
    expect(r.from).toBe(6);
    expect(r.to).toBe(6);
  });

  it("supports single-character markers (italic with _)", () => {
    const r = toggleInlineWrap("a b", "_", 0, 1);
    expect(r.text).toBe("_a_ b");
  });

  it("supports triple-character markers (strike with ~~)", () => {
    const r = toggleInlineWrap("ok", "~~", 0, 2);
    expect(r.text).toBe("~~ok~~");
    const back = toggleInlineWrap(r.text, "~~", r.from, r.to);
    expect(back.text).toBe("ok");
  });

  it("returns the input unchanged when the range is invalid", () => {
    const r = toggleInlineWrap("x", "*", 5, 7);
    expect(r.text).toBe("x");
  });
});
