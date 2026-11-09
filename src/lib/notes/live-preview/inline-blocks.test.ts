import { describe, expect, it } from "vitest";
import { frontmatterEndLine, parseImageAlt, scanFootnotes, scanImages } from "./inline-blocks";

describe("parseImageAlt", () => {
  it("reads Obsidian width syntax", () => {
    expect(parseImageAlt("cat|300")).toEqual({ alt: "cat", width: 300, height: null });
    expect(parseImageAlt("cat|300x200")).toEqual({ alt: "cat", width: 300, height: 200 });
    expect(parseImageAlt("plain")).toEqual({ alt: "plain", width: null, height: null });
  });
});

describe("scanImages", () => {
  it("accepts http(s) and data:image only", () => {
    expect(scanImages("![a](https://x.io/a.png)")).toHaveLength(1);
    expect(scanImages("![a](data:image/png;base64,AAA)")).toHaveLength(1);
    expect(scanImages("![a](javascript:alert(1))")).toEqual([]);
    expect(scanImages("![a](./local.png)")).toEqual([]);
  });
  it("strips an optional title", () => {
    expect(scanImages('![a|10](https://x.io/a.png "t")')[0]).toMatchObject({ url: "https://x.io/a.png", width: 10 });
  });
});

describe("scanFootnotes", () => {
  it("separates references and definitions", () => {
    expect(scanFootnotes("text[^1] more")).toEqual([{ from: 4, to: 8, id: "1", isDefinition: false }]);
    expect(scanFootnotes("[^note]: body")).toEqual([{ from: 0, to: 8, id: "note", isDefinition: true }]);
  });
});

describe("frontmatterEndLine", () => {
  it("finds the closing fence", () => {
    expect(frontmatterEndLine(["---", "a: 1", "---", "x"])).toBe(3);
    expect(frontmatterEndLine(["text", "---"])).toBe(0);
    expect(frontmatterEndLine(["---", "a"])).toBe(0);
  });
});
