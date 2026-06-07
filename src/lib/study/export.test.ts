import { describe, expect, it } from "vitest";
import type {
  CurriculumItemRecord,
  LessonNoteRecord,
  StudyJournalEntryRecord,
} from "./types";
import {
  lessonNoteToMarkdown,
  safeMarkdownFilename,
  studyJournalToMarkdown,
} from "./export";

const now = Date.UTC(2026, 4, 5, 9, 30);

const item: CurriculumItemRecord = {
  id: "item_1",
  workspaceId: "ws_1",
  curriculumId: "cur_1",
  order: 1,
  title: "Wave functions",
  objective: "Understand state representation.",
  sourceRefs: [{ sourceId: "src_1", chunkIds: ["ck_1"] }],
  prerequisites: [],
  status: "active",
  estimatedMinutes: 35,
  createdAt: now,
  updatedAt: now,
};

const note: LessonNoteRecord = {
  id: "note_1",
  workspaceId: "ws_1",
  curriculumItemId: "item_1",
  title: "Wave functions",
  format: "markdown",
  contentMarkdown: "# Wave functions\n\nA state vector description. [§ck_1]",
  sourceRefs: [
    { sourceId: "src_1", chunkIds: ["ck_1", "ck_2"], section: "State vectors" },
    { sourceId: "src_2", quote: "Normalization rule" },
  ],
  generationPromptVersion: "lesson-note.v1",
  modelId: "local",
  status: "ready",
  createdAt: now,
  updatedAt: now,
};

const journal: StudyJournalEntryRecord[] = [
  {
    id: "journal_1",
    workspaceId: "ws_1",
    lessonNoteId: "note_1",
    question: "What does psi encode?",
    answerMarkdown: "It encodes the quantum state.",
    sourceRefs: [{ sourceId: "src_1", chunkIds: ["ck_1"] }],
    tags: ["wave-functions"],
    createdAt: now,
  },
];

describe("lessonNoteToMarkdown", () => {
  it("exports note body with metadata, sources, and attached journal entries", () => {
    const markdown = lessonNoteToMarkdown(note, {
      item,
      journalEntries: journal,
      exportedAt: now,
    });

    expect(markdown).toContain("# Wave functions");
    expect(markdown).toContain("Objective: Understand state representation.");
    expect(markdown).toContain("Exported: 2026-05-05T09:30:00.000Z");
    expect(markdown).toContain("A state vector description. [§ck_1]");
    expect(markdown).toContain("## Sources");
    expect(markdown).toContain("- `src_1` · State vectors · chunks: `ck_1`, `ck_2`");
    expect(markdown).toContain("- `src_2` · quote: Normalization rule");
    expect(markdown).toContain("## Study Journal");
    expect(markdown).toContain("### What does psi encode?");
    expect(markdown).toContain("It encodes the quantum state.");
  });
});

describe("studyJournalToMarkdown", () => {
  it("exports journal entries independently", () => {
    const markdown = studyJournalToMarkdown(journal, {
      title: "Wave functions journal",
      exportedAt: now,
    });

    expect(markdown).toContain("# Wave functions journal");
    expect(markdown).toContain("Exported: 2026-05-05T09:30:00.000Z");
    expect(markdown).toContain("## What does psi encode?");
    expect(markdown).toContain("Tags: `wave-functions`");
  });
});

describe("safeMarkdownFilename", () => {
  it("normalizes unsafe filename characters and keeps markdown extension", () => {
    expect(safeMarkdownFilename("Wave functions: ψ / notes?")).toBe(
      "wave-functions-notes.md",
    );
    expect(safeMarkdownFilename("   ")).toBe("study-note.md");
  });
});
