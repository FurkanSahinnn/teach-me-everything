import { describe, expect, it } from "vitest";
import { buildNoteOutline } from "./outline";

describe("buildNoteOutline", () => {
  it("returns empty for empty input", () => {
    expect(buildNoteOutline("")).toEqual([]);
  });

  it("extracts a single H1", () => {
    expect(buildNoteOutline("# Hello world")).toEqual([
      { level: 1, text: "Hello world", line: 1 },
    ]);
  });

  it("extracts headings at every level", () => {
    const md = ["# h1", "## h2", "### h3", "#### h4", "##### h5", "###### h6"].join(
      "\n",
    );
    const out = buildNoteOutline(md);
    expect(out.map((o) => o.level)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(out.map((o) => o.line)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("trims trailing hash markers (closed ATX form)", () => {
    expect(buildNoteOutline("## Topic ##")).toEqual([
      { level: 2, text: "Topic", line: 1 },
    ]);
  });

  it("ignores lines that look like fragments without a space", () => {
    // `#nospace` is not a heading per CommonMark — it's an inline tag.
    expect(buildNoteOutline("#nospace and #another")).toEqual([]);
  });

  it("rejects 7+ hashes", () => {
    expect(buildNoteOutline("####### too deep")).toEqual([]);
  });

  it("rejects empty heading text", () => {
    expect(buildNoteOutline("# ")).toEqual([]);
    expect(buildNoteOutline("##   ")).toEqual([]);
  });

  it("uses 1-based line numbers across multi-line input", () => {
    const md = ["intro line", "# Section one", "body", "## Sub", "more body"].join(
      "\n",
    );
    expect(buildNoteOutline(md)).toEqual([
      { level: 1, text: "Section one", line: 2 },
      { level: 2, text: "Sub", line: 4 },
    ]);
  });

  it("skips headings inside fenced code blocks (backtick)", () => {
    const md = [
      "# Real heading",
      "```",
      "# not a heading",
      "## also not",
      "```",
      "## Real subheading",
    ].join("\n");
    const out = buildNoteOutline(md);
    expect(out.map((o) => o.text)).toEqual(["Real heading", "Real subheading"]);
  });

  it("skips headings inside fenced code blocks (tilde)", () => {
    const md = ["# Top", "~~~", "# inside", "~~~", "## Bottom"].join("\n");
    expect(buildNoteOutline(md).map((o) => o.text)).toEqual(["Top", "Bottom"]);
  });

  it("handles mismatched fence chars correctly", () => {
    // A `~~~` block stays open until the same char closes it; a ``` inside
    // doesn't close it.
    const md = ["~~~", "# inside tilde", "```", "# still inside", "~~~", "## After"].join(
      "\n",
    );
    expect(buildNoteOutline(md).map((o) => o.text)).toEqual(["After"]);
  });

  it("handles CRLF line endings", () => {
    const md = "# h1\r\n## h2\r\nbody";
    expect(buildNoteOutline(md).map((o) => o.line)).toEqual([1, 2]);
  });

  it("preserves trailing inline markdown in heading text", () => {
    expect(buildNoteOutline("## **bold** _italic_")).toEqual([
      { level: 2, text: "**bold** _italic_", line: 1 },
    ]);
  });
});
