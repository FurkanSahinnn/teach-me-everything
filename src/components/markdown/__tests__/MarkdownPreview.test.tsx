import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarkdownPreview } from "../MarkdownPreview";

function renderMd(text: string): string {
  return renderToStaticMarkup(createElement(MarkdownPreview, { text }));
}

// Class attribute of the first <hN …> tag in the rendered HTML.
function headingClass(html: string, level: number): string {
  const m = html.match(new RegExp(`<h${level}\\b[^>]*class="([^"]*)"`));
  return m?.[1] ?? "";
}

describe("MarkdownPreview heading scale", () => {
  const html = renderMd(
    ["# One", "## Two", "### Three", "#### Four", "##### Five", "###### Six"].join(
      "\n\n",
    ),
  );

  it("styles every heading level h1–h6 with the shared serif family", () => {
    // Regression guard: h5/h6 previously had no component override, so
    // react-markdown emitted bare tags that CSS preflight flattened to body
    // text — nested headings vanished. Every level must now carry font-serif.
    for (let level = 1; level <= 6; level += 1) {
      expect(html).toContain(`<h${level}`);
      expect(headingClass(html, level)).toContain("font-serif");
    }
  });

  it("keeps h4 a serif heading, not body-sized sans (the reported bug)", () => {
    const cls = headingClass(html, 4);
    expect(cls).toContain("font-serif");
    expect(cls).toContain("text-[17px]");
    expect(cls).not.toContain("text-[15px]");
  });

  it("gives the deep levels a distinct, descending size", () => {
    expect(headingClass(html, 5)).toContain("text-[15px]");
    expect(headingClass(html, 6)).toContain("text-[13.5px]");
  });

  it("never uppercases heading content (Turkish casing safety)", () => {
    for (let level = 1; level <= 6; level += 1) {
      expect(headingClass(html, level)).not.toContain("uppercase");
    }
  });
});
