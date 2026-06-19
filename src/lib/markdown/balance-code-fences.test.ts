import { describe, expect, it } from "vitest";
import { balanceCodeFences } from "./balance-code-fences";

const fenceLines = (s: string) => s.match(/^(```|~~~)/gm)?.length ?? 0;

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
    const src = [
      "```yaml",
      "## a yaml comment",
      "---",
      "key: value",
      "```",
    ].join("\n");
    expect(balanceCodeFences(src)).toBe(src);
  });

  it("drops an orphan closing fence that wraps real markdown (reader chunk split)", () => {
    // A chunk that began mid-code: it starts with an orphan ``` then prose.
    const src = [
      "loss = compute()", // tail of code from the previous chunk
      "```", // orphan close → micromark/markdown-it read it as an OPEN
      "",
      "**Avantaj:** Stabil",
      "**Dezavantaj:** yavaş",
      "### Epoch vs Iteration",
      "Bu üç kavram bağlı:",
      "",
      "```",
      "Iteration = Toplam / Batch",
      "```",
    ].join("\n");
    const out = balanceCodeFences(src);
    const code = out.match(/```[\s\S]*?```/g)?.join(" ") ?? "";
    // The prose region must NOT be inside a code block any more...
    expect(code).not.toContain("Avantaj");
    expect(code).not.toContain("### Epoch");
    // ...while the genuine code block survives.
    expect(code).toContain("Iteration = Toplam / Batch");
  });

  it("drops a trailing unclosed fence that wraps prose", () => {
    const src = [
      "Intro.",
      "```",
      "## A heading that escaped a missing close",
      "**bold** prose continues",
    ].join("\n");
    const out = balanceCodeFences(src);
    expect(out).not.toMatch(/```[\s\S]*A heading/);
  });

  it("closes a genuinely unclosed code block at EOF", () => {
    const src = ["Intro", "", "```", "real_code()", "more_code()"].join("\n");
    const out = balanceCodeFences(src);
    expect(out.endsWith("```")).toBe(true);
    expect(fenceLines(out)).toBe(2);
  });

  it("handles tilde fences", () => {
    const src = ["~~~", "real_code()", "more()"].join("\n");
    const out = balanceCodeFences(src);
    expect(out.endsWith("~~~")).toBe(true);
  });
});
