import { describe, expect, it } from "vitest";
import {
  lessonNoteToHtml,
  studyJournalToHtml,
  safePdfFilename,
} from "../pdf-export";
import type {
  CurriculumItemRecord,
  LessonNoteRecord,
  StudyJournalEntryRecord,
} from "../types";

const baseNote: LessonNoteRecord = {
  id: "n1",
  workspaceId: "w1",
  curriculumItemId: "c1",
  title: "Quantum Field Theory",
  format: "markdown",
  contentMarkdown:
    "# Quantum Field Theory\n\nThis lesson [§1.2] introduces QFT.\n\n## Section 2\n\nFollow-up paragraph.",
  sourceRefs: [{ sourceId: "s1", section: "Chapter 1" }],
  generationPromptVersion: "v1",
  modelId: "claude-sonnet-4-6",
  status: "ready",
  createdAt: 1700000000000,
  updatedAt: 1700000000000,
};

const baseItem: CurriculumItemRecord = {
  id: "c1",
  workspaceId: "w1",
  curriculumId: "cur1",
  order: 0,
  title: "QFT intro",
  objective: "Understand scale transformations",
  sourceRefs: [],
  prerequisites: [],
  status: "active",
  estimatedMinutes: 30,
  createdAt: 0,
  updatedAt: 0,
};

const baseEntries: StudyJournalEntryRecord[] = [
  {
    id: "e1",
    workspaceId: "w1",
    lessonNoteId: "n1",
    question: "What is renormalization?",
    answerMarkdown: "Renormalization is the process of...",
    sourceRefs: [{ sourceId: "s1" }],
    tags: ["qft", "renormalization"],
    createdAt: 1700000000000,
  },
];

describe("safePdfFilename", () => {
  it("converts title to slug + .pdf", () => {
    expect(safePdfFilename("Hello World")).toBe("hello-world.pdf");
  });

  it("falls back when title is empty", () => {
    expect(safePdfFilename("   ")).toBe("study-note.pdf");
  });

  it("strips Turkish diacritics", () => {
    expect(safePdfFilename("Çalışma Günlüğü")).toBe("calisma-gunlugu.pdf");
  });

  it("caps slug length at 80 chars before .pdf", () => {
    const result = safePdfFilename("a".repeat(120));
    expect(result.endsWith(".pdf")).toBe(true);
    // slug portion (everything before ".pdf") should be <= 80
    const slug = result.slice(0, -4);
    expect(slug.length).toBeLessThanOrEqual(80);
  });
});

describe("lessonNoteToHtml", () => {
  it("returns a full HTML document", () => {
    const html = lessonNoteToHtml(baseNote, { exportedAt: 1700000000000 });
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain("<html");
    expect(html).toContain("</html>");
    expect(html).toContain('class="tme-pdf-doc"');
  });

  it("includes the lesson title in the document head", () => {
    const html = lessonNoteToHtml(baseNote);
    expect(html).toContain("<title>Quantum Field Theory</title>");
  });

  it("converts citation tokens to footnote sup markers", () => {
    const html = lessonNoteToHtml(baseNote);
    expect(html).toContain('<sup class="cit-mark">[1.2]</sup>');
    // raw [§1.2] token should no longer appear in body text
    expect(html).not.toContain("[§1.2]");
  });

  it("renders the meta row when an item is provided", () => {
    const html = lessonNoteToHtml(baseNote, {
      item: baseItem,
      exportedAt: 1700000000000,
    });
    expect(html).toContain('class="pdf-meta"');
    expect(html).toContain("Objective");
    expect(html).toContain("Status");
    expect(html).toContain("Model");
    expect(html).toContain("Exported");
    // meta row should NOT also appear inline as a paragraph
    expect(html).not.toMatch(/<p>Status: ready/);
  });

  it("emits semantic HTML for nested headings and paragraphs", () => {
    const html = lessonNoteToHtml(baseNote);
    // h2 from "## Section 2"
    expect(html).toMatch(/<h2>\s*Section 2\s*<\/h2>/);
    // first paragraph wraps the citation marker
    expect(html).toMatch(/<p>This lesson .*cit-mark/);
  });

  it("uses white theme palette by default", () => {
    const html = lessonNoteToHtml(baseNote);
    expect(html).toContain("--bg: #fdfbf6;");
    expect(html).toContain("--ink: #1a1a1a;");
  });

  it("switches palette for sepia theme", () => {
    const html = lessonNoteToHtml(baseNote, { theme: "sepia" });
    expect(html).toContain("--bg: #f4ecd8;");
  });

  it("switches palette for dark theme", () => {
    const html = lessonNoteToHtml(baseNote, { theme: "dark" });
    expect(html).toContain("--bg: #1c1a17;");
  });

  it("appends journal entries when provided", () => {
    const html = lessonNoteToHtml(baseNote, {
      journalEntries: baseEntries,
    });
    expect(html).toContain("Study Journal");
    expect(html).toContain("What is renormalization?");
  });
});

describe("studyJournalToHtml", () => {
  it("returns a full HTML document", () => {
    const html = studyJournalToHtml(baseEntries);
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain('class="tme-pdf-doc"');
  });

  it("uses provided title", () => {
    const html = studyJournalToHtml(baseEntries, { title: "My Notes" });
    expect(html).toContain("<title>My Notes</title>");
    expect(html).toMatch(/<h1>\s*My Notes\s*<\/h1>/);
  });

  it("falls back to default title", () => {
    const html = studyJournalToHtml(baseEntries);
    expect(html).toContain("<title>Study Journal</title>");
  });

  it("renders question heading and answer text", () => {
    const html = studyJournalToHtml(baseEntries);
    expect(html).toContain("What is renormalization?");
    expect(html).toContain("Renormalization is the process of...");
  });

  it("renders empty-state placeholder when no entries", () => {
    const html = studyJournalToHtml([], { title: "Empty Journal" });
    expect(html).toContain("No journal entries yet.");
  });

  it("escapes special characters in titles", () => {
    const html = studyJournalToHtml(baseEntries, {
      title: 'Notes & "stuff" <ish>',
    });
    expect(html).toContain(
      "<title>Notes &amp; &quot;stuff&quot; &lt;ish&gt;</title>",
    );
  });
});
