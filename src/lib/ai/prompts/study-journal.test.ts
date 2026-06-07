import { describe, expect, it } from "vitest";
import {
  buildStudyJournalSystem,
  parseStudyJournalOutput,
} from "./study-journal";

const VALID = JSON.stringify({
  title: "How wave functions encode quantum state",
  tags: ["wave-functions", "quantum-state", "qm-basics"],
  summaryMarkdown:
    "Wave functions are complex-valued amplitudes whose squared modulus gives the position probability density.",
});

describe("buildStudyJournalSystem", () => {
  it("emits rules + cacheable Q&A payload with workspace + source context", () => {
    const blocks = buildStudyJournalSystem({
      workspace: { name: "Physics", goal: "Master QM fundamentals" },
      source: { title: "QM notes", author: "Griffiths" },
      question: "What is a wave function?",
      answerMarkdown:
        "A wave function ψ(x) is a complex-valued amplitude whose squared modulus |ψ|² is the probability density for finding the particle at x.",
      locale: "en",
      citedSections: ["State vectors", "Postulates"],
    });

    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.text).toContain("study-journal librarian");
    expect(blocks[0]?.text).toContain("Schema:");
    expect(blocks[1]?.cache_control).toEqual({ type: "ephemeral" });
    expect(blocks[1]?.text).toContain("<question>");
    expect(blocks[1]?.text).toContain("wave function");
    expect(blocks[1]?.text).toContain("Griffiths");
    expect(blocks[1]?.text).toContain("State vectors");
    expect(blocks[1]?.text).toContain("Master QM fundamentals");
  });

  it("uses Turkish rules block when locale=tr", () => {
    const blocks = buildStudyJournalSystem({
      workspace: { name: "Fizik" },
      question: "Dalga fonksiyonu nedir?",
      answerMarkdown: "Karmaşık değerli olasılık genliği.",
      locale: "tr",
    });
    expect(blocks[0]?.text).toContain("kütüphanecisi");
    expect(blocks[0]?.text).not.toContain("librarian");
  });

  it("omits source line when no source supplied", () => {
    const blocks = buildStudyJournalSystem({
      workspace: { name: "Physics" },
      question: "Q?",
      answerMarkdown: "A.",
      locale: "en",
    });
    expect(blocks[1]?.text).not.toContain("<source ");
    expect(blocks[1]?.text).not.toContain("<cited_sections>");
  });
});

describe("parseStudyJournalOutput", () => {
  it("parses a clean metadata payload", () => {
    const parsed = parseStudyJournalOutput(VALID);

    expect(parsed.title).toBe("How wave functions encode quantum state");
    expect(parsed.tags).toEqual([
      "wave-functions",
      "quantum-state",
      "qm-basics",
    ]);
    expect(parsed.summaryMarkdown).toContain("squared modulus");
  });

  it("tolerates markdown fences, leading prose, and trailing chatter", () => {
    const parsed = parseStudyJournalOutput(
      "Sure:\n```json\n" + VALID + "\n```\nDone.",
    );

    expect(parsed.title).toBe("How wave functions encode quantum state");
  });

  it("normalises tags to kebab-case, drops empties, dedups, caps at 5", () => {
    const parsed = parseStudyJournalOutput(
      JSON.stringify({
        title: "Title",
        tags: [
          "Quantum State",
          "quantum state",
          " ",
          "Wave Functions",
          "wave-functions",
          "extra-1",
          "extra-2",
          "extra-3",
          "should-be-dropped",
        ],
      }),
    );

    expect(parsed.tags).toEqual([
      "quantum-state",
      "wave-functions",
      "extra-1",
      "extra-2",
      "extra-3",
    ]);
  });

  it("strips wrapping quotes and trailing punctuation from title", () => {
    const parsed = parseStudyJournalOutput(
      JSON.stringify({
        title: '"How wave functions encode quantum state."',
        tags: ["t"],
      }),
    );
    expect(parsed.title).toBe("How wave functions encode quantum state");
  });

  it("truncates very long titles with ellipsis", () => {
    const longTitle = "Word ".repeat(40).trim();
    const parsed = parseStudyJournalOutput(
      JSON.stringify({ title: longTitle, tags: ["t"] }),
    );
    expect(parsed.title.length).toBeLessThanOrEqual(120);
    expect(parsed.title.endsWith("…")).toBe(true);
  });

  it("omits summaryMarkdown when absent or blank", () => {
    const parsed = parseStudyJournalOutput(
      JSON.stringify({ title: "Title", tags: ["t"], summaryMarkdown: "  " }),
    );
    expect(parsed.summaryMarkdown).toBeUndefined();
  });

  it("returns empty tags array when tags malformed", () => {
    const parsed = parseStudyJournalOutput(
      JSON.stringify({ title: "Title", tags: "not-an-array" }),
    );
    expect(parsed.tags).toEqual([]);
  });

  it("throws when no JSON object found", () => {
    expect(() => parseStudyJournalOutput("not json at all")).toThrow(/no JSON/);
  });

  it("throws when title is missing", () => {
    expect(() =>
      parseStudyJournalOutput(JSON.stringify({ tags: ["t"] })),
    ).toThrow(/title/);
    expect(() =>
      parseStudyJournalOutput(JSON.stringify({ title: "  ", tags: ["t"] })),
    ).toThrow(/title/);
  });

  it("recovers when JSON is wrapped in code fence with trailing prose", () => {
    const parsed = parseStudyJournalOutput(
      "Sure, here you go:\n```json\n" + VALID + "\n```\nLet me know if you need anything else.",
    );
    expect(parsed.title).toBe("How wave functions encode quantum state");
  });
});
