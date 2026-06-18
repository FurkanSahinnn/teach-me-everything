import { describe, expect, it } from "vitest";
import { balanceCodeFences } from "./balance-code-fences";

describe("balanceCodeFences", () => {
  it("leaves well-formed markdown untouched", () => {
    const src = [
      "## Title",
      "",
      "```python",
      "x = 1",
      "```",
      "",
      "Prose.",
    ].join("\n");
    expect(balanceCodeFences(src)).toBe(src);
  });

  it("never rewrites a balanced block that contains heading-like comments", () => {
    // Regression guard: `## ` and `---` are legal *inside* code. They must only
    // be treated as a forgotten close when the document is already unbalanced.
    const src = [
      "```yaml",
      "## a yaml comment",
      "---",
      "key: value",
      "```",
    ].join("\n");
    expect(balanceCodeFences(src)).toBe(src);
  });

  it("closes an unclosed fence before a following ATX heading", () => {
    const src = [
      "```python",
      "x = tokenize(text)",
      "",
      "## 1.5 Bag of Words",
      "",
      "**Ölümcül problem.**",
      "",
      "```",
      "Cümle 1",
      "```",
    ].join("\n");
    const out = balanceCodeFences(src);
    // The forgotten close lands before the heading, so the heading and bold
    // prose escape the code box and the real block pairs up again.
    expect(out).toContain("```\n\n## 1.5 Bag of Words");
    expect(out.match(/^```/gm)?.length).toBe(4);
  });

  it("closes an unclosed fence at end of document", () => {
    const src = ["Intro", "", "```", "code line", "more code"].join("\n");
    const out = balanceCodeFences(src);
    expect(out.endsWith("```")).toBe(true);
    expect(out.match(/^```/gm)?.length).toBe(2);
  });

  it("handles tilde fences", () => {
    const src = ["~~~", "code", "", "## Heading"].join("\n");
    const out = balanceCodeFences(src);
    expect(out).toContain("~~~\n\n## Heading");
  });
});
