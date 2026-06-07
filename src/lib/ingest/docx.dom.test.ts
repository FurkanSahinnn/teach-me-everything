// jsdom-driven tests for the DOCX HTML→ChunkerPage transform. Mammoth itself
// is integration-tested only behind a real worker; the transform is a pure
// function fed the same HTML mammoth would emit, so we drive it directly with
// representative fixtures.

import { describe, it, expect } from "vitest";
import { htmlToPages } from "./docx-html";
import { chunkPages } from "./chunker";

describe("htmlToPages", () => {
  it("returns an empty array for empty input", () => {
    expect(htmlToPages("")).toEqual([]);
    expect(htmlToPages("   ")).toEqual([]);
  });

  it("transforms a simple section with h1, h2, and paragraphs", () => {
    const html = "<h1>Section A</h1><p>Para1</p><h2>Sub</h2><p>Para2</p>";
    const pages = htmlToPages(html);
    expect(pages).toHaveLength(1);
    const first = pages[0];
    expect(first?.text).toContain("Section A");
    expect(first?.text).toContain("Para1");
    expect(first?.text).toContain("Sub");
    expect(first?.text).toContain("Para2");
    expect(first?.headings).toEqual(["Section A", "Sub"]);
  });

  it("returns an empty array when body has no element children", () => {
    expect(htmlToPages("<!-- comment only -->")).toEqual([]);
  });

  it("splits multiple h1 sections into separate ChunkerPages", () => {
    const html =
      "<h1>Alpha</h1><p>Body1</p><h1>Beta</h1><p>Body2</p><h1>Gamma</h1><p>Body3</p>";
    const pages = htmlToPages(html);
    expect(pages).toHaveLength(3);
    expect(pages[0]?.headings).toEqual(["Alpha"]);
    expect(pages[1]?.headings).toEqual(["Beta"]);
    expect(pages[2]?.headings).toEqual(["Gamma"]);
    expect(pages[0]?.text).toContain("Body1");
    expect(pages[1]?.text).toContain("Body2");
    expect(pages[2]?.text).toContain("Body3");
  });

  it("captures h1/h2/h3/h4 in the headings list of the active page", () => {
    const html =
      "<h1>Top</h1><h2>L2</h2><h3>L3</h3><h4>L4</h4><p>body</p>";
    const pages = htmlToPages(html);
    expect(pages).toHaveLength(1);
    expect(pages[0]?.headings).toEqual(["Top", "L2", "L3", "L4"]);
  });

  it("flattens unordered and ordered lists into bullet lines", () => {
    const html =
      "<h1>List Section</h1><ul><li>Apple</li><li>Banana</li></ul><ol><li>One</li></ol>";
    const pages = htmlToPages(html);
    expect(pages).toHaveLength(1);
    expect(pages[0]?.text).toContain("- Apple");
    expect(pages[0]?.text).toContain("- Banana");
    expect(pages[0]?.text).toContain("- One");
  });

  it("flattens table rows into pipe-separated lines", () => {
    const html =
      "<h1>Table Section</h1><table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>";
    const pages = htmlToPages(html);
    expect(pages).toHaveLength(1);
    expect(pages[0]?.text).toContain("A | B");
    expect(pages[0]?.text).toContain("1 | 2");
  });

  it("ignores empty paragraphs and pure-whitespace nodes", () => {
    const html = "<h1>X</h1><p></p><p>   </p><p>real</p>";
    const pages = htmlToPages(html);
    expect(pages).toHaveLength(1);
    expect(pages[0]?.text.split("\n")).toEqual(["X", "real"]);
  });

  it("groups leading paragraphs without an h1 into the first page", () => {
    const html = "<p>orphan body line</p><p>second line</p>";
    const pages = htmlToPages(html);
    expect(pages).toHaveLength(1);
    expect(pages[0]?.text).toContain("orphan body line");
    expect(pages[0]?.text).toContain("second line");
    expect(pages[0]?.headings).toBeUndefined();
  });
});

describe("htmlToPages → chunkPages integration", () => {
  it("produces chunks whose first chunk reflects the source heading", () => {
    const body = Array.from({ length: 20 })
      .map((_, i) => `<p>Paragraph number ${i} with enough text to count.</p>`)
      .join("");
    const html = `<h1>Quantum Field Theory</h1>${body}`;
    const pages = htmlToPages(html);
    const chunks = chunkPages({ pages });
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    const head = chunks[0];
    expect(head?.text).toContain("Quantum Field Theory");
    expect(head?.headings).toContain("Quantum Field Theory");
  });

  it("yields zero chunks for empty HTML", () => {
    const pages = htmlToPages("");
    expect(chunkPages({ pages })).toEqual([]);
  });
});
