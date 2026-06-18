import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { describe, expect, it } from "vitest";
import { remarkNoIndentedCode } from "./remark-no-indented-code";

function render(src: string, withFix: boolean): string {
  return renderToStaticMarkup(
    createElement(ReactMarkdown, {
      remarkPlugins: withFix
        ? [remarkGfm, remarkMath, remarkNoIndentedCode]
        : [remarkGfm, remarkMath],
      children: src,
    }),
  );
}

// Reproduces the "everything turned into a code block" bug: a chunk of prose
// indented by four spaces (left) and by a single tab (right). Math sits at
// column 0 and a real fenced block is nested inside the indented region.
const fourSpace = [
  "$$ReLU(x) = max(0, x)$$",
  "",
  "    Bu kadar basit:",
  "    - `x > 0` ise cikti `x`",
  "    ### Turevi",
  "",
  "    **Devrimsel fark:** pozitif bolgede turev tam 1.",
  "    ```python",
  "    relu = nn.ReLU()",
  "    ```",
].join("\n");

const tabIndented = fourSpace.replace(/^ {4}/gm, "\t");

const preCount = (html: string) => (html.match(/<pre>/g) ?? []).length;

describe("remarkNoIndentedCode", () => {
  it("default parser swallows indented prose into code boxes (the bug)", () => {
    const html = render(fourSpace, false);
    // The whole indented region collapses into an indented code box, so the
    // heading, list and bold never render — they're trapped as raw text.
    expect(preCount(html)).toBeGreaterThanOrEqual(1);
    expect(html).not.toContain("<h3>");
    expect(html).not.toContain("<ul>");
    expect(html).not.toContain("<strong>");
  });

  it("renders indented prose as real markdown once codeIndented is disabled", () => {
    const html = render(fourSpace, true);
    expect(html).toContain("<h3>Turevi</h3>");
    expect(html).toContain("<ul>");
    expect(html).toContain("<strong>Devrimsel fark:</strong>");
    // The single legitimate fenced block survives as the only <pre>.
    expect(preCount(html)).toBe(1);
    expect(html).toContain('class="language-python"');
  });

  it("handles tab indentation identically", () => {
    const html = render(tabIndented, true);
    expect(html).toContain("<h3>Turevi</h3>");
    expect(html).toContain("<ul>");
    expect(preCount(html)).toBe(1);
  });

  it("leaves a genuine fenced code block alone (no false positives)", () => {
    const fenced = ["```python", "relu = nn.ReLU()", "```"].join("\n");
    const html = render(fenced, true);
    expect(preCount(html)).toBe(1);
    expect(html).toContain('class="language-python"');
    expect(html).toContain("relu = nn.ReLU()");
  });
});
