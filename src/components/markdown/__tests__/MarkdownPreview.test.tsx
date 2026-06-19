import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarkdownPreview } from "../MarkdownPreview";
import type { ChunkRecord } from "@/lib/db/types";

function renderMd(text: string, chunks?: ChunkRecord[]): string {
  return renderToStaticMarkup(
    createElement(MarkdownPreview, {
      text,
      ...(chunks ? { citationChunks: chunks, onCitationClick: () => {} } : {}),
    }),
  );
}

function pres(html: string): string[] {
  return html.match(/<pre[\s\S]*?<\/pre>/g) ?? [];
}

describe("MarkdownPreview (markdown-it engine)", () => {
  it("renders every heading level as a real heading element", () => {
    const html = renderMd(
      ["# One", "## Two", "### Three", "#### Four", "##### Five", "###### Six"].join(
        "\n\n",
      ),
    );
    for (let level = 1; level <= 6; level += 1) {
      expect(html).toContain(`<h${level}>`);
    }
  });

  it("renders fenced code as a styled, highlightable block", () => {
    const html = renderMd(["```js", "const x = 1;", "```"].join("\n"));
    expect(html).toContain('class="markdown-code-block"');
    expect(html).toContain("hljs");
    expect(html).toContain("language-js");
  });

  it("leaves a bare ``` block plain (no auto-detected colouring), like VS Code", () => {
    const html = renderMd(["```", "just some text", "```"].join("\n"));
    expect(pres(html).length).toBe(1);
    // No language class and no hljs token spans for an unlabelled block.
    expect(html).not.toContain("language-");
    expect(html).not.toContain("hljs-");
  });

  it("renders inline code with the inline-code class", () => {
    const html = renderMd("use `npm install` first");
    expect(html).toContain('class="markdown-inline-code"');
  });

  it("renders KaTeX for inline and display math", () => {
    const html = renderMd(
      ["Inline $x^2$ here.", "", "$$\\frac{a}{b} = c$$"].join("\n"),
    );
    expect(html).toContain("katex");
  });

  it("opens external links in a new tab", () => {
    const html = renderMd("[site](https://example.com)");
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noreferrer"');
  });
});

describe("MarkdownPreview unbalanced fences", () => {
  // Regression guard for the inverted-markdown bug: an unclosed ``` fence above
  // a section used to flip every fence below it, trapping prose, headings,
  // blockquotes and $$ math inside code boxes. markdown-it tolerates it and the
  // fence balancer closes it at the heading.
  const html = renderMd(
    [
      "```python",
      "x = tokenize(text)", // fence the LLM forgot to close
      "",
      "## Bag of Words",
      "",
      "**Sıra kaybolur.**",
      "",
      "$$\\frac{\\partial h_i}{\\partial h_{i-1}} = W_h$$",
      "",
      "```",
      "Cümle 1",
      "```",
      "",
      "> Önemli not.",
    ].join("\n"),
  );

  it("keeps prose, headings, blockquotes and math out of code boxes", () => {
    const code = pres(html).join(" ");
    expect(code).not.toContain("Sıra kaybolur");
    expect(html).toContain("<h2>");
    expect(html).toContain("<blockquote>");
    expect(html).toContain("katex");
  });

  it("renders the real fenced block as code", () => {
    expect(pres(html).some((b) => b.includes("Cümle 1"))).toBe(true);
  });
});

describe("MarkdownPreview citations", () => {
  const chunk = {
    id: "c1",
    sourceId: "s1",
    workspaceId: "w1",
    index: 0,
    text: "body",
    section: "Intro",
  } as unknown as ChunkRecord;

  it("renders a resolvable [§ref] as an active citation button", () => {
    const html = renderMd("See [§Intro] for details.", [chunk]);
    expect(html).toContain('data-citation-ref="Intro"');
    expect(html).toContain("<button");
    expect(html).not.toContain("disabled");
  });

  it("renders an unresolvable citation as a disabled button", () => {
    const html = renderMd("See [§Nowhere] for details.", [chunk]);
    expect(html).toContain('data-citation-ref="Nowhere"');
    expect(html).toContain("disabled");
  });
});
