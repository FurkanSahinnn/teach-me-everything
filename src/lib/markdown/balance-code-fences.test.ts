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

  it("repairs an orphan close that fakes a balanced count (the SGD bug)", () => {
    // Even fence count, but inverted: the orphan ``` pairs with the SGD block's
    // close and ```python is swallowed as body, so a naive counter sees it as
    // balanced while the SGD code is actually trapped.
    const src = [
      "optimizer.zero_grad()", // tail of code from the previous chunk
      "```", // orphan close
      "",
      "### SGD",
      "",
      "```python",
      "optimizer = torch.optim.SGD(model.parameters(), lr=0.01)",
      "```",
      "",
      "### Adam",
      "",
      "```python",
      "optimizer = torch.optim.Adam(model.parameters(), lr=0.001)",
      "```",
    ].join("\n");
    const out = balanceCodeFences(src);
    const codeBlocks = out.match(/```[\s\S]*?```/g) ?? [];
    // Two real code blocks, each holding exactly its optimizer line.
    expect(codeBlocks.length).toBe(2);
    expect(codeBlocks.some((b) => b.includes("optim.SGD"))).toBe(true);
    expect(codeBlocks.some((b) => b.includes("optim.Adam"))).toBe(true);
    // The headings are no longer trapped inside a code box.
    expect(out).toContain("\n### SGD\n");
    expect(out).toContain("\n### Adam\n");
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
