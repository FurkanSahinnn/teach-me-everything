import { describe, expect, it } from "vitest";
import { renderMarkdownToHtml } from "./render";

describe("renderMarkdownToHtml — Obsidian extensions", () => {
  it("terminates footnotes at sibling definitions, headings and lists", () => {
    const html = renderMarkdownToHtml("Claim[^1].\n[^1]: First.\n[^2]: Second.\n# Heading\n- item");
    expect(html).toContain('id="fn-1"');
    expect(html).toContain('id="fn-2"');
    expect(html).toContain('Second.</p>');
    expect(html).toContain('<h1>Heading</h1>');
    expect(html).toContain('<li>item</li>');
  });

  it("marks the containing ordered task list, not a previous closed list", () => {
    const html = renderMarkdownToHtml("- plain\n- other\n\n1. [ ] task");
    expect(html).toContain('<ul>');
    expect(html).not.toContain('<ul class="contains-task-list">');
    expect(html).toContain('<ol class="contains-task-list">');
  });
  it("renders task lists as disabled checkboxes", () => {
    const html = renderMarkdownToHtml("- [ ] todo\n- [x] done");
    expect(html).toContain('class="contains-task-list"');
    expect(html).toMatch(/<li class="task-list-item"><input type="checkbox" class="task-list-checkbox" disabled> todo/);
    expect(html).toMatch(/disabled checked> done/);
  });

  it("renders callouts with a typed class and a title", () => {
    const html = renderMarkdownToHtml("> [!WARNING] Dikkat\n> Gövde metni.");
    expect(html).toContain('class="callout callout-warning" data-callout="warning"');
    expect(html).toContain('<div class="callout-title">Dikkat</div>');
    expect(html).toContain("<p>Gövde metni.</p>");
  });

  it("uses the callout type as the title when none is given", () => {
    const html = renderMarkdownToHtml("> [!note]\n> Body");
    expect(html).toContain('<div class="callout-title">Note</div>');
    expect(html).toContain("<p>Body</p>");
  });

  it("renders wikilinks and embeds without exposing raw brackets", () => {
    const html = renderMarkdownToHtml("See [[Softmax|the softmax note]] and ![[img.png]].");
    expect(html).toContain('<a class="wikilink" href="#" data-wikilink="Softmax">the softmax note</a>');
    expect(html).toContain('<span class="wikilink-embed" data-wikilink="img.png">img.png</span>');
    expect(html).not.toContain("[[");
  });

  it("escapes HTML inside wikilink targets", () => {
    const html = renderMarkdownToHtml('[[<img src=x onerror=alert(1)>]]');
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("renders footnote references and definitions in place", () => {
    const html = renderMarkdownToHtml("Claim[^1].\n\n[^1]: Source text.");
    expect(html).toContain('<sup class="footnote-ref"><a href="#fn-1">1</a></sup>');
    expect(html).toMatch(
      /<p class="footnote-def" id="fn-1">\s*<sup class="footnote-label">1<\/sup> Source text\.<\/p>/,
    );
  });

  it("renders ==highlight== as <mark>", () => {
    const html = renderMarkdownToHtml("A ==key idea== here.");
    expect(html).toContain("<mark>key idea</mark>");
  });

  it("still renders plain CommonMark exactly as before", () => {
    const html = renderMarkdownToHtml("Para one.\n\nPara two.\n\n---\n\n## H2");
    expect(html).toContain("<p>Para one.</p>");
    expect(html).toContain("<p>Para two.</p>");
    expect(html).toContain("<hr>");
    expect(html).toContain("<h2>H2</h2>");
  });
});
