import { describe, expect, it } from "vitest";
import {
  clearFormatting,
  detectFormats,
  isSafeCssColor,
  removeColorAt,
  setAlignment,
  toggleHighlightMarks,
  toggleHtmlTag,
  wrapWithBackground,
  wrapWithColor,
} from "./format-edits";

const sel = (r: { text: string; from: number; to: number }): string => r.text.slice(r.from, r.to);

describe("isSafeCssColor", () => {
  it.each(["#f00", "#f00a", "#ff0000", "#ff0000aa", "red", "Red", "rgb(1,2,3)", "rgba(255, 0, 0, 0.5)"])(
    "accepts %s",
    (v) => expect(isSafeCssColor(v)).toBe(true),
  );
  it.each([
    "red;background:url(x)",
    "expression(alert(1))",
    "javascript:alert(1)",
    "url(x)",
    "#ggg",
    "#12345",
    "rgb(1,2,3);x",
    "rgb(a,b,c)",
    "var(--x)",
    "",
    'red"',
    "notacolor",
  ])("rejects %s", (v) => expect(isSafeCssColor(v)).toBe(false));
});

describe("wrapWithColor", () => {
  it("wraps a selection", () => {
    const r = wrapWithColor("a word b", 2, 6, "#ff0000");
    expect(r.text).toBe('a <span style="color:#ff0000">word</span> b');
    expect(sel(r)).toBe("word");
  });

  it("inserts an empty wrapper for a caret and puts the caret inside", () => {
    const r = wrapWithColor("ab", 1, 1, "red");
    expect(r.text).toBe('a<span style="color:red"></span>b');
    expect(r.from).toBe(r.to);
    expect(r.text.slice(r.from)).toBe("</span>b");
  });

  it("replaces an existing colour instead of nesting", () => {
    const first = wrapWithColor("word", 0, 4, "#ff0000");
    const second = wrapWithColor(first.text, first.from, first.to, "#00ff00");
    expect(second.text).toBe('<span style="color:#00ff00">word</span>');
  });

  it("splits an outer span when only part of it is recoloured", () => {
    const text = '<span style="color:red">abc</span>';
    const r = wrapWithColor(text, 25, 26, "blue");
    expect(r.text).toBe(
      '<span style="color:red">a</span><span style="color:blue">b</span><span style="color:red">c</span>',
    );
  });

  it("wraps each line separately and keeps block markers outside", () => {
    const text = "- one\n- two\n> three\n1. four\n- [ ] five";
    const r = wrapWithColor(text, 0, text.length, "red");
    const o = '<span style="color:red">';
    expect(r.text).toBe(
      `- ${o}one</span>\n- ${o}two</span>\n> ${o}three</span>\n1. ${o}four</span>\n- [ ] ${o}five</span>`,
    );
  });

  it("refuses an unsafe colour", () => {
    const r = wrapWithColor("abc", 0, 3, "red;background:url(x)");
    expect(r.text).toBe("abc");
  });
});

describe("wrapWithBackground", () => {
  it("wraps with mark/background and nests inside a colour span", () => {
    const c = wrapWithColor("hi", 0, 2, "red");
    const r = wrapWithBackground(c.text, c.from, c.to, "#ffff00");
    expect(r.text).toBe('<span style="color:red"><mark style="background:#ffff00">hi</mark></span>');
  });
});

describe("removeColorAt", () => {
  it("unwraps the span under the caret", () => {
    const text = 'a <span style="color:red">word</span> b';
    const r = removeColorAt(text, 30, 30);
    expect(r.text).toBe("a word b");
  });

  it("removes colours, fonts and backgrounds in a selection", () => {
    const text = '<span style="color:red">a</span> <font color="#00f">b</font> <mark style="background:#ff0">c</mark>';
    expect(removeColorAt(text, 0, text.length).text).toBe("a b c");
  });

  it("leaves plain text alone", () => {
    expect(removeColorAt("abc", 1, 1).text).toBe("abc");
  });
});

describe("toggleHtmlTag", () => {
  it("wraps and unwraps underline", () => {
    const on = toggleHtmlTag("abc", 0, 3, "u");
    expect(on.text).toBe("<u>abc</u>");
    expect(toggleHtmlTag(on.text, on.from, on.to, "u").text).toBe("abc");
  });

  it("toggles off when the caret is inside", () => {
    expect(toggleHtmlTag("<sup>2</sup>", 6, 6, "sup").text).toBe("2");
  });

  it("inserts an empty pair at a caret", () => {
    const r = toggleHtmlTag("x", 1, 1, "sub");
    expect(r.text).toBe("x<sub></sub>");
    expect(r.from).toBe(6);
  });
});

describe("toggleHighlightMarks", () => {
  it("unwraps when the selection itself holds the markers", () => {
    const r = toggleHighlightMarks("a ==b== c", 2, 7);
    expect(r.text).toBe("a b c");
  });
});

describe("clearFormatting", () => {
  it("strips markers, tags, links and wikilinks", () => {
    const text =
      '**b** *i* ~~s~~ ==h== `c` <u>u</u> <span style="color:red">r</span> [l](http://x) [[Note|alias]] [[Plain]]';
    expect(clearFormatting(text, 0, text.length).text).toBe("b i s h c u r l alias Plain");
  });

  it("removes formatting wrapping the selection from outside", () => {
    expect(clearFormatting("**word**", 2, 6).text).toBe("word");
  });

  it("clears the whole line for a caret but keeps the list marker", () => {
    expect(clearFormatting("- **a** b", 4, 4).text).toBe("- a b");
  });
});

describe("setAlignment", () => {
  it("wraps, re-aligns and clears", () => {
    const c = setAlignment("hello", "center");
    expect(c).toBe('<p align="center">hello</p>');
    expect(setAlignment(c, "right")).toBe('<p align="right">hello</p>');
    expect(setAlignment(c, null)).toBe("hello");
  });

  it("reads <center> and keeps list markers outside", () => {
    expect(setAlignment("<center>x</center>", null)).toBe("x");
    expect(setAlignment("- item", "center")).toBe('- <p align="center">item</p>');
  });
});

describe("detectFormats", () => {
  it("reports inline and block state", () => {
    const text = '## **bold** <u><span style="color:#f00">x</span></u>';
    const bold = detectFormats(text, 5, 5);
    expect(bold.bold).toBe(true);
    expect(bold.heading).toBe(2);
    const x = text.indexOf("x</span>");
    const f = detectFormats(text, x, x + 1);
    expect(f.underline).toBe(true);
    expect(f.color).toBe("#f00");
    expect(f.background).toBeNull();
  });

  it("detects list kinds and quotes", () => {
    expect(detectFormats("- [ ] a", 0, 0).list).toBe("task");
    expect(detectFormats("1. a", 0, 0).list).toBe("ol");
    expect(detectFormats("- a", 0, 0).list).toBe("ul");
    expect(detectFormats("> a", 0, 0).quote).toBe(true);
  });

  it("distinguishes bold from italic", () => {
    const f = detectFormats("**a** *b*", 2, 3);
    expect(f.bold).toBe(true);
    expect(f.italic).toBe(false);
    const g = detectFormats("**a** *b*", 8, 9);
    expect(g.italic).toBe(true);
    expect(g.bold).toBe(false);
  });
});
