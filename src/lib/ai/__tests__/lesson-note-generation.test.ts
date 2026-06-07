import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  estimateLessonNoteCost,
  filterValidRefs,
  generateLessonNote,
  LESSON_NOTE_PROMPT_VERSION,
  LessonNoteGenError,
  type LessonNoteGenSource,
} from "../lesson-note-generation";
import { encodeChatModelBinding } from "../model-options";
import type {
  ChatProvider,
  ChatRequest,
  ChatStreamHandle,
  ProviderCapabilities,
  StreamEvent,
} from "../providers/types";
import { db } from "@/lib/db/schema";
import { createCurriculum, createLessonNote } from "@/lib/db/study";
import { createWorkspace } from "@/lib/db/workspaces";

const SONNET = encodeChatModelBinding("anthropic", "claude-sonnet-4-6");

beforeEach(async () => {
  await db.delete();
  await db.open();
});

afterEach(async () => {
  await db.delete();
});

function fakeProvider(events: StreamEvent[]): ChatProvider {
  const capabilities: ProviderCapabilities = {
    cacheControl: true,
    toolUse: "native",
    streaming: true,
    vision: false,
  };
  return {
    id: "anthropic",
    capabilities,
    streamChat(_req: ChatRequest): ChatStreamHandle {
      async function* gen() {
        for (const ev of events) yield ev;
      }
      return { events: gen(), abort: () => {} };
    },
  };
}

function buildSource(): LessonNoteGenSource {
  return {
    id: "src_1",
    title: "QM notes",
    titleEn: null as unknown as undefined,
    type: "pdf",
    author: null as unknown as undefined,
    chunks: [
      {
        id: "ck_1",
        index: 0,
        text: "Wave functions encode quantum state.",
        section: "Wave functions",
      } as LessonNoteGenSource["chunks"][number],
    ],
  };
}

const VALID_JSON = JSON.stringify({
  title: "Wave functions: a primer",
  contentMarkdown:
    "## Overview\n\nWave functions encode the quantum state of a particle [§ck_1].\n\n## Recap\n\nThey are complex-valued amplitudes whose squared modulus gives probability density.",
  sourceRefs: [{ sourceId: "src_1", chunkIds: ["ck_1"], section: "Wave functions" }],
});

function streamEvents(text: string): StreamEvent[] {
  return [
    { kind: "start", model: "claude-sonnet-4-6", usage: { input_tokens: 800 } },
    { kind: "text", delta: text },
    {
      kind: "delta",
      stopReason: "end_turn",
      usage: { input_tokens: 800, output_tokens: 300 },
    },
    { kind: "stop" },
  ];
}

async function makeCurriculumItem(workspaceId: string): Promise<string> {
  const created = await createCurriculum({
    workspaceId,
    title: "Test curriculum",
    sourceIds: ["src_1"],
    items: [
      {
        title: "Wave functions",
        objective: "Explain quantum state encoding.",
        sourceRefs: [{ sourceId: "src_1", chunkIds: ["ck_1"] }],
        prerequisites: [],
        estimatedMinutes: 30,
      },
    ],
  });
  return created.items[0]!.id;
}

describe("filterValidRefs", () => {
  it("drops refs whose sourceId is unknown", () => {
    const out = filterValidRefs(
      [{ sourceId: "src_1" }, { sourceId: "src_ghost" }],
      new Set(["src_1"]),
      new Set(),
    );
    expect(out).toEqual([{ sourceId: "src_1" }]);
  });

  it("filters chunkIds to known ids and omits the array if none survive", () => {
    const out = filterValidRefs(
      [
        { sourceId: "src_1", chunkIds: ["ck_1", "ck_ghost"] },
        { sourceId: "src_1", chunkIds: ["ck_ghost"] },
      ],
      new Set(["src_1"]),
      new Set(["ck_1"]),
    );
    expect(out).toEqual([
      { sourceId: "src_1", chunkIds: ["ck_1"] },
      { sourceId: "src_1" },
    ]);
  });

  it("preserves section and quote", () => {
    const out = filterValidRefs(
      [{ sourceId: "src_1", section: "Sec", quote: "Q" }],
      new Set(["src_1"]),
      new Set(),
    );
    expect(out).toEqual([{ sourceId: "src_1", section: "Sec", quote: "Q" }]);
  });
});

describe("estimateLessonNoteCost", () => {
  it("returns 0 for unknown models", () => {
    expect(estimateLessonNoteCost("totally-fake", { input_tokens: 10 })).toBe(0);
  });
  it("returns positive cost for known models with usage", () => {
    expect(
      estimateLessonNoteCost("claude-sonnet-4-6", {
        input_tokens: 1000,
        output_tokens: 500,
      }),
    ).toBeGreaterThan(0);
  });
});

describe("generateLessonNote", () => {
  it("persists a lesson note from a valid response", async () => {
    const ws = await createWorkspace({ name: "Q", color: "#000", initials: "Q" });
    const itemId = await makeCurriculumItem(ws.id);

    const result = await generateLessonNote({
      workspaceId: ws.id,
      curriculumItemId: itemId,
      workspace: { name: "Q" },
      item: {
        title: "Wave functions",
        objective: "Explain.",
        sourceRefs: [{ sourceId: "src_1", chunkIds: ["ck_1"] }],
      },
      sources: [buildSource()],
      modelId: SONNET,
      apiKey: "sk-test",
      locale: "en",
      chatProvider: fakeProvider(streamEvents(VALID_JSON)),
    });

    expect(result.note.title).toBe("Wave functions: a primer");
    expect(result.note.contentMarkdown).toContain("[§ck_1]");
    expect(result.note.curriculumItemId).toBe(itemId);
    expect(result.note.generationPromptVersion).toBe(LESSON_NOTE_PROMPT_VERSION);
    expect(result.note.usage?.outputTokens).toBe(300);

    const persisted = await db.lessonNotes.get(result.note.id);
    expect(persisted?.contentMarkdown).toContain("Wave functions encode");
  });

  it("wraps provider errors as stream_error", async () => {
    const ws = await createWorkspace({ name: "W", color: "#000", initials: "W" });
    const itemId = await makeCurriculumItem(ws.id);

    await expect(
      generateLessonNote({
        workspaceId: ws.id,
        curriculumItemId: itemId,
        workspace: { name: "W" },
        item: {
          title: "T",
          objective: "O",
          sourceRefs: [{ sourceId: "src_1" }],
        },
        sources: [buildSource()],
        modelId: SONNET,
        apiKey: "sk-test",
        locale: "en",
        chatProvider: fakeProvider([
          { kind: "start", model: "claude-sonnet-4-6", usage: {} },
          { kind: "error", status: 429, message: "rate limited" },
        ]),
      }),
    ).rejects.toMatchObject({ code: "stream_error" });
  });

  it("throws parse_error for non-JSON garbage", async () => {
    const ws = await createWorkspace({ name: "W", color: "#000", initials: "W" });
    const itemId = await makeCurriculumItem(ws.id);

    await expect(
      generateLessonNote({
        workspaceId: ws.id,
        curriculumItemId: itemId,
        workspace: { name: "W" },
        item: {
          title: "T",
          objective: "O",
          sourceRefs: [{ sourceId: "src_1" }],
        },
        sources: [buildSource()],
        modelId: SONNET,
        apiKey: "sk-test",
        locale: "en",
        chatProvider: fakeProvider(streamEvents("totally not json")),
      }),
    ).rejects.toBeInstanceOf(LessonNoteGenError);
  });

  it("throws no_refs when the model cites no known sources", async () => {
    const ws = await createWorkspace({ name: "W", color: "#000", initials: "W" });
    const itemId = await makeCurriculumItem(ws.id);

    const ghostJson = JSON.stringify({
      title: "T",
      contentMarkdown: "Body",
      sourceRefs: [{ sourceId: "src_ghost" }],
    });

    await expect(
      generateLessonNote({
        workspaceId: ws.id,
        curriculumItemId: itemId,
        workspace: { name: "W" },
        item: {
          title: "T",
          objective: "O",
          sourceRefs: [{ sourceId: "src_1" }],
        },
        sources: [buildSource()],
        modelId: SONNET,
        apiKey: "sk-test",
        locale: "en",
        chatProvider: fakeProvider(streamEvents(ghostJson)),
      }),
    ).rejects.toMatchObject({ code: "no_refs" });
  });

  it("throws no_chunks when the supplied source has empty chunks", async () => {
    const ws = await createWorkspace({ name: "W", color: "#000", initials: "W" });
    const itemId = await makeCurriculumItem(ws.id);

    await expect(
      generateLessonNote({
        workspaceId: ws.id,
        curriculumItemId: itemId,
        workspace: { name: "W" },
        item: {
          title: "T",
          objective: "O",
          sourceRefs: [{ sourceId: "src_1" }],
        },
        sources: [
          {
            id: "src_1",
            title: "Empty",
            titleEn: null as unknown as undefined,
            type: "pdf",
            author: null as unknown as undefined,
            chunks: [],
          },
        ],
        modelId: SONNET,
        apiKey: "sk-test",
        locale: "en",
        chatProvider: fakeProvider(streamEvents(VALID_JSON)),
      }),
    ).rejects.toMatchObject({ code: "no_chunks" });
  });

  it("updates an existing lesson note in place when existingNoteId is supplied", async () => {
    const ws = await createWorkspace({ name: "Q", color: "#000", initials: "Q" });
    const itemId = await makeCurriculumItem(ws.id);
    const initial = await createLessonNote({
      workspaceId: ws.id,
      curriculumItemId: itemId,
      title: "Old title",
      contentMarkdown: "Old body",
      sourceRefs: [{ sourceId: "src_1" }],
      generationPromptVersion: "draft-v1",
      modelId: "local-draft",
      status: "draft",
    });

    const result = await generateLessonNote({
      workspaceId: ws.id,
      curriculumItemId: itemId,
      existingNoteId: initial.id,
      workspace: { name: "Q" },
      item: {
        title: "Wave functions",
        objective: "Explain.",
        sourceRefs: [{ sourceId: "src_1", chunkIds: ["ck_1"] }],
      },
      sources: [buildSource()],
      modelId: SONNET,
      apiKey: "sk-test",
      locale: "en",
      chatProvider: fakeProvider(streamEvents(VALID_JSON)),
    });

    // ID stays stable; everything else is overwritten.
    expect(result.note.id).toBe(initial.id);
    expect(result.note.title).toBe("Wave functions: a primer");
    expect(result.note.contentMarkdown).toContain("Wave functions encode");
    expect(result.note.modelId).toBe("claude-sonnet-4-6");
    expect(result.note.generationPromptVersion).toBe(LESSON_NOTE_PROMPT_VERSION);
    expect(result.note.status).toBe("ready");

    // Only one row in the table — no orphan create on the in-place path.
    const all = await db.lessonNotes
      .where("curriculumItemId")
      .equals(itemId)
      .toArray();
    expect(all).toHaveLength(1);
  });

  it("throws not_found when existingNoteId points at a missing row", async () => {
    const ws = await createWorkspace({ name: "Q", color: "#000", initials: "Q" });
    const itemId = await makeCurriculumItem(ws.id);

    await expect(
      generateLessonNote({
        workspaceId: ws.id,
        curriculumItemId: itemId,
        existingNoteId: "les_does_not_exist",
        workspace: { name: "Q" },
        item: {
          title: "T",
          objective: "O",
          sourceRefs: [{ sourceId: "src_1" }],
        },
        sources: [buildSource()],
        modelId: SONNET,
        apiKey: "sk-test",
        locale: "en",
        chatProvider: fakeProvider(streamEvents(VALID_JSON)),
      }),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});
