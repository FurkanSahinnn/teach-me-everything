import { describe, expect, it } from "vitest";
import { renderStyledFence, splitHighlightedLines } from "./code-styler";
import { renderMarkdownToHtml } from "./render";

describe("splitHighlightedLines", () => {
  it("closes and reopens spans that cross a newline", () => {
    expect(splitHighlightedLines('<span class="c">a\nb</span>')).toEqual([
      '<span class="c">a</span>',
      '<span class="c">b</span>',
    ]);
  });
});

describe("renderStyledFence", () => {
  it("highlights using only the first info token and numbers lines", () => {
    const html = renderStyledFence("const a = 1;\nconst b = 2;\n", "js title:x");
    expect(html).toContain("language-js");
    expect(html).toContain("hljs-keyword");
    expect(html).toContain('data-ln="1"');
    expect(html).toContain('data-ln="2"');
    expect(html).toContain('class="md-codeblock-title">x<');
    expect(html).toContain("data-code-copy");
    expect(html).toContain("markdown-code-block");
  });

  it("applies ln start, ln:false and highlighted lines", () => {
    const html = renderStyledFence("a\nb\nc", "text ln:10 hl:2");
    expect(html).toContain('data-ln="10"');
    expect(html.match(/md-code-line--hl/g)).toHaveLength(1);
    expect(renderStyledFence("a", "text ln:false")).not.toContain("data-ln");
  });

  it("wraps folded blocks in a closed details element with a placeholder", () => {
    const html = renderStyledFence("a", 'js fold:"Hidden"');
    expect(html).toContain("<details");
    expect(html).not.toContain("<details open");
    expect(html).toContain(">Hidden<");
    expect(renderStyledFence("a", "js fold")).toContain(">Collapsed code<");
  });

  it("renders ignore blocks as a plain fence", () => {
    const html = renderStyledFence("a\nb", "js ignore title:x");
    expect(html.startsWith('<pre class="markdown-code-block">')).toBe(true);
    expect(html).not.toContain("md-code-line");
  });

  it("uses overridable labels", () => {
    const html = renderStyledFence("a", "js", { copy: "Kopyala", copied: "Kopyalandı" });
    expect(html).toContain(">Kopyala<");
    expect(html).toContain('data-copied-label="Kopyalandı"');
  });

  it("escapes code, title, language and placeholder", () => {
    const html = renderStyledFence('<img src=x onerror=1>', 'x"><b> title:"<script>" fold:"<i>"');
    expect(html).not.toMatch(/<(img|script|b|i)[ >]/);
  });
});

describe("renderMarkdownToHtml with code styler", () => {
  it("renders fences through the styler and keeps html escaped", () => {
    const html = renderMarkdownToHtml("```python title:a.py\nprint(1)\n```", undefined, {
      labels: { copy: "Kopyala" },
    });
    expect(html).toContain("md-codeblock-header");
    expect(html).toContain(">Kopyala<");
    expect(html).toContain("language-python");
  });

  it("strips the {lang} prefix of inline code", () => {
    expect(renderMarkdownToHtml("`{python} print(1)`")).toContain(">print(1)</code>");
  });
});
