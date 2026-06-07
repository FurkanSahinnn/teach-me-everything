import { describe, expect, it } from "vitest";
import { parseHtmlToMarkdown } from "./readability";

describe("parseHtmlToMarkdown (pure helper)", () => {
  it("extracts <title> from raw HTML", () => {
    const html = `<!doctype html><html><head><title>Hello   World</title></head><body><p>x</p></body></html>`;
    const out = parseHtmlToMarkdown(html, "https://example.org");
    expect(out.title).toBe("Hello World");
  });

  it("falls back to the URL when no <title> is present", () => {
    const html = `<html><body><p>x</p></body></html>`;
    const out = parseHtmlToMarkdown(html, "https://example.org/page");
    expect(out.title).toBe("https://example.org/page");
  });

  it("strips script and style blocks from the fallback text", () => {
    const html = `<html><body>
      <script>var a = 1;</script>
      <style>.x { color: red; }</style>
      <p>Visible content</p>
    </body></html>`;
    const out = parseHtmlToMarkdown(html, "https://x");
    expect(out.fallbackText).not.toContain("var a = 1");
    expect(out.fallbackText).not.toContain("color: red");
    expect(out.fallbackText).toContain("Visible content");
  });

  it("collapses whitespace in fallback text", () => {
    const html = `<html><body><p>a  b   c\n\nd</p></body></html>`;
    const out = parseHtmlToMarkdown(html, "https://x");
    expect(out.fallbackText).toBe("a b c d");
  });
});
