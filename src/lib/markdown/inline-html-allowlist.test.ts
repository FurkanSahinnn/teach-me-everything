import { describe, expect, it } from "vitest";
import { renderMarkdownToHtml } from "./render";

describe("inline HTML allowlist", () => {
  it("renders a validated colour span", () => {
    const html = renderMarkdownToHtml('a <span style="color:#ff0000">red</span> b');
    expect(html).toContain('<span class="md-color" style="color:#ff0000">red</span>');
  });

  it("reads Editing Toolbar font tags", () => {
    const html = renderMarkdownToHtml('<font color="#00f">blue</font>');
    expect(html).toContain('<span class="md-color" style="color:#00f">blue</span>');
  });

  it("renders background marks, accepting background-color and rgba", () => {
    expect(renderMarkdownToHtml('<mark style="background:#ffff00">y</mark>')).toContain(
      '<mark class="md-bg" style="background:#ffff00">y</mark>',
    );
    expect(renderMarkdownToHtml('<mark style="background-color: rgba(1, 2, 3, 0.5)">y</mark>')).toContain(
      'style="background:rgba(1, 2, 3, 0.5)"',
    );
  });

  it("nests a colour span inside a background mark", () => {
    const html = renderMarkdownToHtml(
      '<mark style="background:#ff0"><span style="color:red">x</span></mark>',
    );
    expect(html).toContain(
      '<mark class="md-bg" style="background:#ff0"><span class="md-color" style="color:red">x</span></mark>',
    );
  });

  it("renders u, sup and sub", () => {
    const html = renderMarkdownToHtml("<u>a</u> x<sup>2</sup> H<sub>2</sub>O");
    expect(html).toContain("<u>a</u>");
    expect(html).toContain("<sup>2</sup>");
    expect(html).toContain("<sub>2</sub>");
  });

  it("aligns a paragraph with p align and center", () => {
    expect(renderMarkdownToHtml('<p align="center">hi</p>')).toContain(
      '<p class="md-align-center">hi</p>',
    );
    expect(renderMarkdownToHtml("<center>hi</center>")).toContain('<p class="md-align-center">hi</p>');
    expect(renderMarkdownToHtml('<p align="right">**b**</p>')).toContain(
      '<p class="md-align-right"><strong>b</strong></p>',
    );
  });

  it("keeps markdown working inside the span", () => {
    const html = renderMarkdownToHtml('<span style="color:red">**b**</span>');
    expect(html).toContain('style="color:red"><strong>b</strong></span>');
  });
});

describe("inline HTML allowlist — hostile input stays escaped", () => {
  it("escapes script tags", () => {
    const html = renderMarkdownToHtml("<script>alert(1)</script>");
    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;script&gt;");
  });

  it("escapes img onerror", () => {
    const html = renderMarkdownToHtml("<img src=x onerror=alert(1)>");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("escapes a span whose style smuggles a second declaration", () => {
    const html = renderMarkdownToHtml('<span style="color:red;background:url(x)">t</span>');
    expect(html).not.toContain("<span");
    expect(html).not.toContain("md-color");
    expect(html).toContain("&lt;span");
  });

  it("escapes an invalid colour value", () => {
    const html = renderMarkdownToHtml('<span style="color:expression(alert(1))">t</span>');
    expect(html).not.toContain("<span");
  });

  it("escapes extra attributes on an allowed tag", () => {
    const html = renderMarkdownToHtml('<u onclick="x()">t</u>');
    expect(html).not.toContain("<u");
    expect(html).toContain("&lt;u");
  });

  it("escapes unbalanced tags", () => {
    const html = renderMarkdownToHtml("a <u>b and </sup> c");
    expect(html).not.toContain("<u>");
    expect(html).not.toContain("</sup>");
    expect(html).toContain("&lt;u&gt;");
  });

  it("does not treat an align wrapper with extra attributes as alignment", () => {
    const html = renderMarkdownToHtml('<p align="center" onclick="x()">hi</p>');
    expect(html).not.toContain("md-align");
    expect(html).toContain("&lt;p");
  });
});
