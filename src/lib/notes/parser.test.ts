import { describe, expect, it } from "vitest";
import { extractTags, extractTitle, extractWikilinks } from "./parser";

describe("extractWikilinks", () => {
  it("parses a single bare wikilink", () => {
    expect(extractWikilinks("See [[Quantum Field Theory]] for details.")).toEqual([
      { target: "Quantum Field Theory", kind: "note" },
    ]);
  });

  it("parses aliased wikilinks", () => {
    expect(extractWikilinks("Refer to [[Wilsonian RG|the RG flow]].")).toEqual([
      { target: "Wilsonian RG", kind: "note", alias: "the RG flow" },
    ]);
  });

  it("parses namespaced wikilinks (source/concept/note prefixes)", () => {
    const refs = extractWikilinks(
      "From [[source:abc]] and [[concept:xyz]] and [[note:def]].",
    );
    expect(refs).toEqual([
      { target: "abc", kind: "source" },
      { target: "xyz", kind: "concept" },
      { target: "def", kind: "note" },
    ]);
  });

  it("unknown prefixes keep the colon as part of the target and default to note kind", () => {
    expect(extractWikilinks("[[tag:foo]]")).toEqual([
      { target: "tag:foo", kind: "note" },
    ]);
  });

  it("ignores escaped wikilinks", () => {
    expect(extractWikilinks("This \\[[Not a link]] survives as-is.")).toEqual(
      [],
    );
  });

  it("ignores wikilinks inside fenced code blocks", () => {
    const md = "before\n```\n[[NotALink]]\n```\nafter [[Real]]";
    expect(extractWikilinks(md)).toEqual([{ target: "Real", kind: "note" }]);
  });

  it("ignores wikilinks inside inline code", () => {
    expect(extractWikilinks("Try `[[NotALink]]` here, but [[Real]] counts.")).toEqual([
      { target: "Real", kind: "note" },
    ]);
  });

  it("parses adjacent wikilinks separately", () => {
    expect(extractWikilinks("[[A]][[B]][[C]]")).toEqual([
      { target: "A", kind: "note" },
      { target: "B", kind: "note" },
      { target: "C", kind: "note" },
    ]);
  });

  it("skips empty bracket pairs", () => {
    expect(extractWikilinks("[[]] then [[Real]] then [[ ]].")).toEqual([
      { target: "Real", kind: "note" },
    ]);
  });

  it("preserves order of appearance with duplicates", () => {
    // Backlinks intentionally keep duplicates so a note that mentions [[X]]
    // twice still surfaces both occurrences if a caller cares about counts.
    expect(extractWikilinks("[[X]] then [[Y]] then [[X]].")).toEqual([
      { target: "X", kind: "note" },
      { target: "Y", kind: "note" },
      { target: "X", kind: "note" },
    ]);
  });

  it("does not match across newlines", () => {
    expect(extractWikilinks("[[broken\nstill broken]]")).toEqual([]);
  });

  it("alias with pipe inside the alias text keeps the trailing pipes", () => {
    expect(extractWikilinks("[[Foo|bar|baz]]")).toEqual([
      { target: "Foo", kind: "note", alias: "bar|baz" },
    ]);
  });
});

describe("extractTags", () => {
  it("parses simple tags", () => {
    expect(extractTags("Today I learned about #kimya and #fizik.")).toEqual([
      "kimya",
      "fizik",
    ]);
  });

  it("parses tags with hyphens and underscores", () => {
    expect(extractTags("#tag-name and #snake_case work.")).toEqual([
      "tag-name",
      "snake_case",
    ]);
  });

  it("parses nested tags", () => {
    expect(extractTags("Topic: #kimya/organik/halkalı")).toEqual([
      "kimya/organik/halkalı",
    ]);
  });

  it("ignores tags inside code blocks", () => {
    const md = "before\n```\n#NotATag\n```\nafter #real";
    expect(extractTags(md)).toEqual(["real"]);
  });

  it("ignores tags inside inline code", () => {
    expect(extractTags("Use `#NotATag` and #realtag.")).toEqual(["realtag"]);
  });

  it("rejects digit-only tags (section numbers, not tags)", () => {
    expect(extractTags("Chapter #1 and #2 and #abc and #3rd")).toEqual([
      "abc",
      "3rd",
    ]);
  });

  it("rejects mid-word `#` (URL fragments, arithmetic)", () => {
    expect(extractTags("https://example.com#section is not a #realtag")).toEqual(
      ["realtag"],
    );
  });

  it("lowercases tags and dedupes", () => {
    expect(extractTags("#Kimya and #KIMYA and #kimya are one tag")).toEqual([
      "kimya",
    ]);
  });

  it("returns an empty array when no tags are present", () => {
    expect(extractTags("just plain text without any pound signs")).toEqual([]);
  });
});

describe("extractTitle", () => {
  it("picks the first H1", () => {
    expect(extractTitle("# Quantum Field Theory\n\nSome content.")).toBe(
      "Quantum Field Theory",
    );
  });

  it("ignores H2 and deeper", () => {
    expect(extractTitle("## Not the title\n# Real Title")).toBe("Real Title");
  });

  it("falls back to first non-empty non-heading line when no H1 exists", () => {
    expect(extractTitle("\n\nFirst real line\n\nmore")).toBe("First real line");
  });

  it("returns empty string for empty content", () => {
    expect(extractTitle("")).toBe("");
    expect(extractTitle("\n\n   \n")).toBe("");
  });

  it("trims trailing whitespace on the heading", () => {
    expect(extractTitle("#   Spaced Heading   ")).toBe("Spaced Heading");
  });
});
