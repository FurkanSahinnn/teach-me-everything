import { describe, expect, it } from "vitest";
import { composeLessonNote } from "./lesson-gen";

describe("composeLessonNote", () => {
  it("prepends the canonical title as the H1", () => {
    const out = composeLessonNote("Transformers", "## Overview\nText.");
    expect(out.startsWith("# Transformers\n\n## Overview")).toBe(true);
    expect(out.endsWith("\n")).toBe(true);
  });

  it("replaces a leading H1 the model emitted with the canonical title", () => {
    const out = composeLessonNote(
      "Transformers",
      "# Some other title\n\n## Overview\nText.",
    );
    expect(out).toContain("# Transformers");
    expect(out).not.toContain("Some other title");
    expect(out).toContain("## Overview");
  });

  it("unwraps a ```markdown code fence", () => {
    const out = composeLessonNote("T", "```markdown\n## A\nb\n```");
    expect(out).toBe("# T\n\n## A\nb\n");
    expect(out).not.toContain("```");
  });
});
