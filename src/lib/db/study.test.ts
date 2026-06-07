import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bulkAddChunks } from "./chunks";
import { createSource } from "./sources";
import {
  createCurriculum,
  createLessonNote,
  createStudyJournalEntry,
  getCurriculum,
  getLessonNote,
  listCurriculumItems,
  listCurriculaByWorkspace,
  listLessonNotesByWorkspace,
  listStudyJournalEntries,
  setCurriculumItemStatus,
  createDraftCurriculumForWorkspace,
  createDraftLessonNoteForItem,
  updateLessonNote,
} from "./study";
import { createWorkspace, deleteWorkspace } from "./workspaces";
import { db } from "./schema";

beforeEach(async () => {
  await db.delete();
  await db.open();
});

afterEach(async () => {
  await db.delete();
});

describe("study repos", () => {
  it("creates a curriculum with ordered items and lists it by workspace", async () => {
    const ws = await createWorkspace({
      name: "AI",
      color: "#000",
      initials: "AI",
    });
    const src = await createSource({
      workspaceId: ws.id,
      type: "pdf",
      title: "notes.pdf",
    });
    const [chunk] = await bulkAddChunks([
      {
        workspaceId: ws.id,
        sourceId: src.id,
        index: 0,
        text: "Transformers use attention.",
        tokenCount: 4,
      },
    ]);

    const created = await createCurriculum({
      workspaceId: ws.id,
      title: "AI foundations",
      goal: "Read the notes",
      level: "beginner",
      sourceIds: [src.id],
      items: [
        {
          title: "Attention",
          objective: "Explain self-attention.",
          sourceRefs: [{ sourceId: src.id, chunkIds: [chunk!.id] }],
          prerequisites: [],
          estimatedMinutes: 30,
        },
        {
          title: "Transformers",
          objective: "Connect attention to blocks.",
          sourceRefs: [{ sourceId: src.id, chunkIds: [chunk!.id] }],
          prerequisites: ["Attention"],
          estimatedMinutes: 45,
        },
      ],
    });

    expect(created.items).toHaveLength(2);
    expect(created.items[0]?.order).toBe(0);
    expect(created.items[0]?.status).toBe("not_started");
    expect(await getCurriculum(created.curriculum.id)).toMatchObject({
      title: "AI foundations",
      status: "draft",
    });
    expect(await listCurriculaByWorkspace(ws.id)).toHaveLength(1);
    expect((await listCurriculumItems(created.curriculum.id))[1]?.title).toBe(
      "Transformers",
    );
  });

  it("updates item status and persists lesson notes plus journal entries", async () => {
    const ws = await createWorkspace({
      name: "Math",
      color: "#000",
      initials: "M",
    });
    const created = await createCurriculum({
      workspaceId: ws.id,
      title: "Linear algebra",
      sourceIds: [],
      items: [
        {
          title: "Eigenvectors",
          objective: "Explain eigenvectors.",
          sourceRefs: [{ sourceId: "src_external" }],
          prerequisites: [],
          estimatedMinutes: 25,
        },
      ],
    });
    const item = created.items[0]!;

    await setCurriculumItemStatus(item.id, "active");
    expect((await listCurriculumItems(created.curriculum.id))[0]?.status).toBe(
      "active",
    );

    const note = await createLessonNote({
      workspaceId: ws.id,
      curriculumItemId: item.id,
      title: "Eigenvectors",
      contentMarkdown: "## Eigenvectors\n\nThey keep direction. [§src_external]",
      sourceRefs: [{ sourceId: "src_external" }],
      generationPromptVersion: "lesson-note-v1",
      modelId: "claude-sonnet-4-6",
      usage: { inputTokens: 100, outputTokens: 40 },
      status: "ready",
    });

    await createStudyJournalEntry({
      workspaceId: ws.id,
      lessonNoteId: note.id,
      question: "What stays fixed?",
      answerMarkdown: "Direction stays fixed.",
      sourceRefs: [{ sourceId: "src_external" }],
      tags: ["linear-algebra"],
    });

    expect((await getLessonNote(note.id))?.status).toBe("ready");
    expect(await listLessonNotesByWorkspace(ws.id)).toHaveLength(1);
    const entries = await listStudyJournalEntries(ws.id);
    expect(entries[0]).toMatchObject({
      lessonNoteId: note.id,
      question: "What stays fixed?",
    });
  });

  it("deleteWorkspace cascades guided-study records", async () => {
    const ws = await createWorkspace({
      name: "Delete me",
      color: "#000",
      initials: "D",
    });
    const created = await createCurriculum({
      workspaceId: ws.id,
      title: "Path",
      sourceIds: [],
      items: [
        {
          title: "Topic",
          objective: "Learn it",
          sourceRefs: [{ sourceId: "s" }],
          prerequisites: [],
          estimatedMinutes: 10,
        },
      ],
    });
    const note = await createLessonNote({
      workspaceId: ws.id,
      curriculumItemId: created.items[0]!.id,
      title: "Topic",
      contentMarkdown: "Body",
      sourceRefs: [{ sourceId: "s" }],
      generationPromptVersion: "lesson-note-v1",
      modelId: "model",
      status: "ready",
    });
    await createStudyJournalEntry({
      workspaceId: ws.id,
      lessonNoteId: note.id,
      question: "Q",
      answerMarkdown: "A",
      sourceRefs: [{ sourceId: "s" }],
      tags: [],
    });

    await deleteWorkspace(ws.id);

    expect(await db.curricula.where("workspaceId").equals(ws.id).count()).toBe(0);
    expect(await db.curriculumItems.where("workspaceId").equals(ws.id).count()).toBe(0);
    expect(await db.lessonNotes.where("workspaceId").equals(ws.id).count()).toBe(0);
    expect(await db.studyJournalEntries.where("workspaceId").equals(ws.id).count()).toBe(0);
  });

  it("creates a deterministic draft curriculum from ready sources and chunks", async () => {
    const ws = await createWorkspace({
      name: "Physics",
      color: "#000",
      initials: "P",
    });
    const source = await createSource({
      workspaceId: ws.id,
      type: "pdf",
      title: "QM notes",
      ingestStatus: "ready",
    });
    const chunks = await bulkAddChunks([
      {
        workspaceId: ws.id,
        sourceId: source.id,
        index: 0,
        text: "Wave functions represent states.",
        tokenCount: 4,
        section: "Wave functions",
      },
      {
        workspaceId: ws.id,
        sourceId: source.id,
        index: 1,
        text: "Uncertainty links position and momentum.",
        tokenCount: 5,
        section: "Uncertainty principle",
      },
    ]);

    const created = await createDraftCurriculumForWorkspace(ws.id);

    expect(created.curriculum.title).toBe("Physics curriculum");
    expect(created.curriculum.sourceIds).toEqual([source.id]);
    expect(created.items.map((item) => item.title)).toEqual([
      "Wave functions",
      "Uncertainty principle",
    ]);
    expect(created.items[0]?.sourceRefs).toEqual([
      { sourceId: source.id, chunkIds: [chunks[0]!.id], section: "Wave functions" },
    ]);
  });

  it("creates a draft curriculum from only selected ready sources", async () => {
    const ws = await createWorkspace({
      name: "Physics",
      color: "#000",
      initials: "P",
    });
    const sourceA = await createSource({
      workspaceId: ws.id,
      type: "pdf",
      title: "QM notes",
      ingestStatus: "ready",
    });
    const sourceB = await createSource({
      workspaceId: ws.id,
      type: "pdf",
      title: "Thermo notes",
      ingestStatus: "ready",
    });
    const chunks = await bulkAddChunks([
      {
        workspaceId: ws.id,
        sourceId: sourceA.id,
        index: 0,
        text: "Wave functions represent states.",
        tokenCount: 4,
        section: "Wave functions",
      },
      {
        workspaceId: ws.id,
        sourceId: sourceB.id,
        index: 0,
        text: "Entropy measures microstate uncertainty.",
        tokenCount: 5,
        section: "Entropy",
      },
    ]);

    const created = await createDraftCurriculumForWorkspace(ws.id, {
      sourceIds: [sourceB.id],
    });

    expect(created.curriculum.sourceIds).toEqual([sourceB.id]);
    expect(created.items.map((item) => item.title)).toEqual(["Entropy"]);
    expect(created.items[0]?.sourceRefs).toEqual([
      { sourceId: sourceB.id, chunkIds: [chunks[1]!.id], section: "Entropy" },
    ]);
  });

  it("creates or reuses a deterministic lesson note for a curriculum item", async () => {
    const ws = await createWorkspace({
      name: "Physics",
      color: "#000",
      initials: "P",
    });
    const source = await createSource({
      workspaceId: ws.id,
      type: "pdf",
      title: "QM notes",
      ingestStatus: "ready",
    });
    const [chunk] = await bulkAddChunks([
      {
        workspaceId: ws.id,
        sourceId: source.id,
        index: 0,
        text: "Wave functions represent states.",
        tokenCount: 4,
        section: "Wave functions",
      },
    ]);
    const curriculum = await createCurriculum({
      workspaceId: ws.id,
      title: "Physics curriculum",
      sourceIds: [source.id],
      items: [
        {
          title: "Wave functions",
          objective: "Explain state representation.",
          sourceRefs: [
            { sourceId: source.id, chunkIds: [chunk!.id], section: "Wave functions" },
          ],
          prerequisites: [],
          estimatedMinutes: 20,
        },
      ],
    });

    const first = await createDraftLessonNoteForItem(curriculum.items[0]!.id);
    const second = await createDraftLessonNoteForItem(curriculum.items[0]!.id);

    expect(first.id).toBe(second.id);
    expect(first.status).toBe("ready");
    expect(first.contentMarkdown).toContain("# Wave functions");
    expect(first.contentMarkdown).toContain("## Goal");
    expect(first.contentMarkdown).toContain("## What to learn");
    expect(first.contentMarkdown).toContain("## Check yourself");
    expect(first.contentMarkdown).toContain("Explain state representation.");
    expect(first.contentMarkdown).toContain(`[§${chunk!.id}]`);
    expect(first.sourceRefs).toEqual([
      { sourceId: source.id, chunkIds: [chunk!.id], section: "Wave functions" },
    ]);
  });

  it("updateLessonNote patches contentMarkdown and advances updatedAt", async () => {
    const ws = await createWorkspace({ name: "W", color: "#000", initials: "W" });
    const note = await createLessonNote({
      workspaceId: ws.id,
      curriculumItemId: "ci_test",
      title: "Initial",
      contentMarkdown: "Initial body",
      sourceRefs: [{ sourceId: "src_a" }],
      generationPromptVersion: "draft-v1",
      modelId: "local-draft",
    });
    const beforeUpdatedAt = note.updatedAt;
    // Sleep a tick so Date.now() definitely advances even on fast machines.
    await new Promise((resolve) => setTimeout(resolve, 5));

    await updateLessonNote(note.id, { contentMarkdown: "Edited body" });
    const after = await getLessonNote(note.id);

    expect(after?.contentMarkdown).toBe("Edited body");
    expect(after?.title).toBe("Initial");
    expect((after?.updatedAt ?? 0) > beforeUpdatedAt).toBe(true);
  });

  it("updateLessonNote ignores undefined fields and supports full overwrite", async () => {
    const ws = await createWorkspace({ name: "W", color: "#000", initials: "W" });
    const note = await createLessonNote({
      workspaceId: ws.id,
      curriculumItemId: "ci_test",
      title: "Initial",
      contentMarkdown: "Initial body",
      sourceRefs: [{ sourceId: "src_a" }],
      generationPromptVersion: "draft-v1",
      modelId: "local-draft",
    });

    await updateLessonNote(note.id, {
      title: "Renamed",
      contentMarkdown: "New body",
      sourceRefs: [{ sourceId: "src_b", chunkIds: ["ck_1"] }],
      generationPromptVersion: "lesson-note-v1",
      modelId: "claude-sonnet-4-6",
      status: "ready",
      usage: { inputTokens: 10, outputTokens: 20 },
    });
    const after = await getLessonNote(note.id);

    expect(after?.title).toBe("Renamed");
    expect(after?.contentMarkdown).toBe("New body");
    expect(after?.sourceRefs).toEqual([
      { sourceId: "src_b", chunkIds: ["ck_1"] },
    ]);
    expect(after?.modelId).toBe("claude-sonnet-4-6");
    expect(after?.status).toBe("ready");
    expect(after?.usage?.inputTokens).toBe(10);
  });
});
