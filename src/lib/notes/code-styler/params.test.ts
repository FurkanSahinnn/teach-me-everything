import { describe, expect, it } from "vitest";
import { isLineHighlighted, parseFenceInfo } from "./params";

const sorted = (s: Set<number>): number[] => [...s].sort((a, b) => a - b);

describe("parseFenceInfo", () => {
  it("returns defaults for an empty or plain info string", () => {
    const p = parseFenceInfo("");
    expect(p.language).toBe("");
    expect(p.title).toBeNull();
    expect(p.lineNumbers).toBe(true);
    expect(p.lineStart).toBe(1);
    expect(p.fold).toBe(false);
    expect(p.wrap).toBeNull();
    expect(p.ignore).toBe(false);
    expect(parseFenceInfo("python").language).toBe("python");
  });

  it("parses titles bare and quoted, with : or =", () => {
    expect(parseFenceInfo("js title:app.js").title).toBe("app.js");
    expect(parseFenceInfo('js title:"my file.js"').title).toBe("my file.js");
    expect(parseFenceInfo("js title='a b'").title).toBe("a b");
    expect(parseFenceInfo("js title=x").title).toBe("x");
  });

  it("treats a param-first info string as having no language", () => {
    const p = parseFenceInfo(' title:"x"');
    expect(p.language).toBe("");
    expect(p.title).toBe("x");
    expect(parseFenceInfo("fold").language).toBe("");
  });

  it("parses line numbers", () => {
    expect(parseFenceInfo("py ln:false").lineNumbers).toBe(false);
    const p = parseFenceInfo("py ln:27");
    expect(p.lineNumbers).toBe(true);
    expect(p.lineStart).toBe(27);
    expect(parseFenceInfo("py ln=true").lineNumbers).toBe(true);
  });

  it("parses highlight lines and ranges", () => {
    expect(sorted(parseFenceInfo("py hl:1,3-5").highlights.lines)).toEqual([1, 3, 4, 5]);
    expect(sorted(parseFenceInfo("py {2,4-5}").highlights.lines)).toEqual([2, 4, 5]);
    const inline = parseFenceInfo("py{1,2}");
    expect(inline.language).toBe("py");
    expect(inline.highlights.lines.has(2)).toBe(true);
  });

  it("parses highlight words and regexes", () => {
    const p = parseFenceInfo('py hl:foo,"bar baz",/ab+c/i title:t');
    expect(p.highlights.words).toEqual(["foo", "bar baz"]);
    expect(p.highlights.regexes).toHaveLength(1);
    expect(p.title).toBe("t");
    expect(isLineHighlighted(p, 99, "xx ABBC")).toBe(true);
    expect(isLineHighlighted(p, 99, "nothing")).toBe(false);
    expect(isLineHighlighted(p, 99, "has bar baz here")).toBe(true);
  });

  it("ignores invalid regexes and reversed or huge ranges safely", () => {
    const p = parseFenceInfo("py hl:/(/,5-3,1-99999999");
    expect(p.highlights.regexes).toHaveLength(0);
    expect(p.highlights.lines.has(4)).toBe(true);
    expect(p.highlights.lines.has(1)).toBe(false);
  });

  it("parses fold, wrap, unwrap, ignore", () => {
    expect(parseFenceInfo("py fold").fold).toBe(true);
    const f = parseFenceInfo('py fold:"Hidden stuff"');
    expect(f.fold).toBe(true);
    expect(f.foldPlaceholder).toBe("Hidden stuff");
    expect(parseFenceInfo("py fold:false").fold).toBe(false);
    expect(parseFenceInfo("py wrap").wrap).toBe(true);
    expect(parseFenceInfo("py unwrap").wrap).toBe(false);
    expect(parseFenceInfo("py ignore").ignore).toBe(true);
  });

  it("never throws on malformed input", () => {
    const bad = ['title:"unterminated', "hl:/unterminated", "{1,2", ":::", "=", "hl:", "ln:abc", "{", '"'];
    for (const s of bad) expect(() => parseFenceInfo(s)).not.toThrow();
    expect(() => parseFenceInfo(undefined as unknown as string)).not.toThrow();
  });
});

describe("isLineHighlighted", () => {
  it("matches explicit line numbers", () => {
    const p = parseFenceInfo("py hl:2");
    expect(isLineHighlighted(p, 2, "")).toBe(true);
    expect(isLineHighlighted(p, 1, "")).toBe(false);
  });
});
