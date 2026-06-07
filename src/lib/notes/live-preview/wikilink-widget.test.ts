import { describe, expect, it } from "vitest";
import { parseWikilinkTarget, scanWikilinks } from "./wikilink-widget";

describe("parseWikilinkTarget", () => {
  it("treats bare text as a note target", () => {
    expect(parseWikilinkTarget("My Note")).toEqual({ kind: "note", target: "My Note", alias: null });
  });

  it("splits an alias on `|`", () => {
    expect(parseWikilinkTarget("My Note|Alias")).toEqual({
      kind: "note",
      target: "My Note",
      alias: "Alias",
    });
  });

  it("ignores an empty alias", () => {
    expect(parseWikilinkTarget("Note|").alias).toBeNull();
  });

  it("recognizes the `source:` prefix", () => {
    expect(parseWikilinkTarget("source:abc123")).toEqual({
      kind: "source",
      target: "abc123",
      alias: null,
    });
  });

  it("recognizes the `concept:` prefix", () => {
    expect(parseWikilinkTarget("concept:photosynthesis")).toEqual({
      kind: "concept",
      target: "photosynthesis",
      alias: null,
    });
  });

  it("strips a redundant `note:` prefix", () => {
    expect(parseWikilinkTarget("note:Day One")).toEqual({
      kind: "note",
      target: "Day One",
      alias: null,
    });
  });

  it("keeps an unknown prefix as part of the note target", () => {
    expect(parseWikilinkTarget("tag:foo")).toEqual({
      kind: "note",
      target: "tag:foo",
      alias: null,
    });
  });

  it("combines prefix with alias", () => {
    expect(parseWikilinkTarget("source:abc|See the paper")).toEqual({
      kind: "source",
      target: "abc",
      alias: "See the paper",
    });
  });

  it("trims surrounding whitespace from target and alias", () => {
    expect(parseWikilinkTarget("  My Note  |  My Alias  ")).toEqual({
      kind: "note",
      target: "My Note",
      alias: "My Alias",
    });
  });
});

describe("scanWikilinks", () => {
  it("returns nothing on empty input", () => {
    expect(scanWikilinks("")).toEqual([]);
  });

  it("yields a single match with the correct byte range", () => {
    const text = "hello [[Note]] world";
    const matches = scanWikilinks(text);
    expect(matches).toHaveLength(1);
    const m = matches[0]!;
    expect(m.from).toBe(6);
    expect(m.to).toBe(14);
    expect(m.raw).toBe("[[Note]]");
    expect(m.target).toBe("Note");
  });

  it("parses adjacent wikilinks as separate matches", () => {
    const matches = scanWikilinks("[[A]][[B]]");
    expect(matches.map((m) => m.target)).toEqual(["A", "B"]);
  });

  it("skips backslash-escaped wikilinks", () => {
    const matches = scanWikilinks("plain \\[[Skip]] [[Keep]]");
    expect(matches.map((m) => m.target)).toEqual(["Keep"]);
  });

  it("preserves duplicates so backlink counts add up correctly", () => {
    const matches = scanWikilinks("[[X]] and [[X]] again");
    expect(matches.map((m) => m.target)).toEqual(["X", "X"]);
  });

  it("does not match a wikilink that spans a newline", () => {
    expect(scanWikilinks("[[\nNote\n]]")).toEqual([]);
  });

  it("skips empty bracket pairs", () => {
    expect(scanWikilinks("[[]] [[  ]] [[ok]]")).toEqual([
      expect.objectContaining({ target: "ok" }),
    ]);
  });

  it("does not greedily consume across the next pair (lazy match)", () => {
    const matches = scanWikilinks("[[a]] [[b]]");
    expect(matches[0]!.raw).toBe("[[a]]");
    expect(matches[1]!.raw).toBe("[[b]]");
  });

  it("extracts kind + alias for prefixed targets", () => {
    const matches = scanWikilinks("see [[source:abc|the paper]] for context");
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      kind: "source",
      target: "abc",
      alias: "the paper",
    });
  });

  it("treats a triple-bracket suffix as not matching (negative lookahead)", () => {
    // `[[Note]]]` — the `]` immediately after should disqualify per parser
    // semantics so unfinished syntax doesn't render mid-edit.
    expect(scanWikilinks("[[Note]]]")).toEqual([]);
  });
});
