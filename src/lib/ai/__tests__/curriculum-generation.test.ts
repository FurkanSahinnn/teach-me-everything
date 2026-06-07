import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CurriculumGenError,
  estimateCurriculumCost,
  generateCurriculum,
  mapParsedItemsToInput,
  type CurriculumGenSource,
} from "../curriculum-generation";
import { encodeChatModelBinding } from "../model-options";
import type {
  ChatProvider,
  ChatStreamHandle,
  ProviderCapabilities,
  StreamEvent,
} from "../providers/types";
import { db } from "@/lib/db/schema";
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
    streamChat(): ChatStreamHandle {
      async function* gen() {
        for (const ev of events) yield ev;
      }
      return { events: gen(), abort: () => {} };
    },
  };
}

function fakeProviderSequence(batches: StreamEvent[][]): ChatProvider {
  const capabilities: ProviderCapabilities = {
    cacheControl: true,
    toolUse: "native",
    streaming: true,
    vision: false,
  };
  let call = 0;
  return {
    id: "anthropic",
    capabilities,
    streamChat(): ChatStreamHandle {
      const events = batches[call] ?? [];
      call += 1;
      async function* gen() {
        for (const ev of events) yield ev;
      }
      return { events: gen(), abort: () => {} };
    },
  };
}

function buildSource(): CurriculumGenSource {
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
        text: "Wave functions represent quantum states.",
        section: "Wave functions",
      } as CurriculumGenSource["chunks"][number],
      {
        id: "ck_2",
        index: 1,
        text: "The uncertainty principle links position and momentum.",
        section: "Uncertainty",
      } as CurriculumGenSource["chunks"][number],
    ],
  };
}

const VALID_JSON = JSON.stringify({
  title: "Quantum mechanics roadmap",
  goal: "Master the basics",
  level: "beginner",
  items: [
    {
      title: "Wave functions",
      objective: "Explain how wave functions encode quantum state.",
      sourceRefs: [{ sourceId: "src_1", chunkIds: ["ck_1"], section: "Wave functions" }],
      prerequisites: [],
      estimatedMinutes: 30,
    },
    {
      title: "Uncertainty principle",
      objective: "Derive the position-momentum bound.",
      sourceRefs: [{ sourceId: "src_1", chunkIds: ["ck_2"] }],
      prerequisites: ["Wave functions"],
      estimatedMinutes: 40,
    },
  ],
});

function streamEvents(text: string): StreamEvent[] {
  return [
    { kind: "start", model: "claude-sonnet-4-6", usage: { input_tokens: 1000 } },
    { kind: "text", delta: text },
    {
      kind: "delta",
      stopReason: "end_turn",
      usage: { input_tokens: 1000, output_tokens: 500 },
    },
    { kind: "stop" },
  ];
}

describe("mapParsedItemsToInput", () => {
  it("drops items whose sourceRefs reference unknown source ids", () => {
    const out = mapParsedItemsToInput(
      [
        {
          order: 0,
          title: "Real",
          objective: "Real objective",
          sourceRefs: [{ sourceId: "src_1" }],
          prerequisites: [],
          status: "not_started",
          estimatedMinutes: 30,
        },
        {
          order: 1,
          title: "Hallucinated",
          objective: "Bogus",
          sourceRefs: [{ sourceId: "src_ghost" }],
          prerequisites: [],
          status: "not_started",
          estimatedMinutes: 30,
        },
      ],
      new Set(["src_1"]),
      new Set(),
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.title).toBe("Real");
  });

  it("filters chunkIds to only known ids and omits the array when empty", () => {
    const out = mapParsedItemsToInput(
      [
        {
          order: 0,
          title: "Mixed refs",
          objective: "obj",
          sourceRefs: [
            { sourceId: "src_1", chunkIds: ["ck_1", "ck_ghost"] },
            { sourceId: "src_1", chunkIds: ["ck_ghost"] },
          ],
          prerequisites: [],
          status: "not_started",
          estimatedMinutes: 30,
        },
      ],
      new Set(["src_1"]),
      new Set(["ck_1"]),
    );
    expect(out[0]?.sourceRefs).toEqual([
      { sourceId: "src_1", chunkIds: ["ck_1"] },
      { sourceId: "src_1" }, // chunkIds key omitted when no valid ids survive
    ]);
  });

  it("preserves section + quote + prerequisites + estimatedMinutes", () => {
    const out = mapParsedItemsToInput(
      [
        {
          order: 0,
          title: "T",
          objective: "O",
          sourceRefs: [
            { sourceId: "src_1", section: "Sec", quote: "Q" },
          ],
          prerequisites: ["Earlier"],
          status: "not_started",
          estimatedMinutes: 55,
        },
      ],
      new Set(["src_1"]),
      new Set(),
    );
    expect(out[0]).toMatchObject({
      title: "T",
      prerequisites: ["Earlier"],
      estimatedMinutes: 55,
      sourceRefs: [{ sourceId: "src_1", section: "Sec", quote: "Q" }],
    });
  });
});

describe("estimateCurriculumCost", () => {
  it("returns 0 for unknown models (no PRICING entry)", () => {
    expect(estimateCurriculumCost("totally-fake-model", { input_tokens: 10 })).toBe(0);
  });

  it("multiplies tokens by per-million pricing for known models", () => {
    const cost = estimateCurriculumCost("claude-sonnet-4-6", {
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
    });
    // Sonnet 4.6: $3 input + $15 output per 1M = $18 for this exact mix
    expect(cost).toBeGreaterThan(0);
    expect(cost).toBeLessThan(50); // sanity guard against decimal regressions
  });
});

describe("generateCurriculum", () => {
  it("throws no_sources when sources array is empty", async () => {
    const ws = await createWorkspace({ name: "W", color: "#000", initials: "W" });
    await expect(
      generateCurriculum({
        workspaceId: ws.id,
        workspace: { name: "W" },
        sources: [],
        modelId: SONNET,
        apiKey: "sk-test",
        locale: "en",
        chatProvider: fakeProvider([]),
      }),
    ).rejects.toBeInstanceOf(CurriculumGenError);
  });

  it("throws no_chunks when supplied sources have no chunks", async () => {
    const ws = await createWorkspace({ name: "W", color: "#000", initials: "W" });
    await expect(
      generateCurriculum({
        workspaceId: ws.id,
        workspace: { name: "W" },
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
        chatProvider: fakeProvider([]),
      }),
    ).rejects.toMatchObject({ code: "no_chunks" });
  });

  it("persists a curriculum from a valid model response", async () => {
    const ws = await createWorkspace({
      name: "Quantum",
      color: "#000",
      initials: "Q",
    });
    const result = await generateCurriculum({
      workspaceId: ws.id,
      workspace: { name: "Quantum" },
      sources: [buildSource()],
      modelId: SONNET,
      apiKey: "sk-test",
      locale: "en",
      chatProvider: fakeProvider(streamEvents(VALID_JSON)),
    });

    expect(result.curriculum.title).toBe("Quantum mechanics roadmap");
    expect(result.refineStatus).toBe("refined");
    expect(result.curriculum.status).toBe("draft");
    expect(result.items).toHaveLength(2);
    expect(result.items[0]?.title).toBe("Wave functions");
    expect(result.items[1]?.prerequisites).toEqual(["Wave functions"]);
    expect(result.usage.output_tokens).toBe(500);
    expect(result.estimatedCostUsd).toBeGreaterThan(0);

    const persisted = await db.curricula
      .where("workspaceId")
      .equals(ws.id)
      .toArray();
    expect(persisted).toHaveLength(1);
    expect(persisted[0]?.id).toBe(result.curriculum.id);
  });

  it("wraps provider errors as stream_error", async () => {
    const ws = await createWorkspace({ name: "W", color: "#000", initials: "W" });
    await expect(
      generateCurriculum({
        workspaceId: ws.id,
        workspace: { name: "W" },
        sources: [buildSource()],
        modelId: SONNET,
        apiKey: "sk-test",
        locale: "en",
        chatProvider: fakeProvider([
          { kind: "start", model: "claude-sonnet-4-6", usage: {} },
          { kind: "error", status: 500, message: "upstream broke" },
        ]),
      }),
    ).rejects.toMatchObject({ code: "stream_error" });
  });

  it("falls back to a deterministic draft when retry also returns non-JSON", async () => {
    const ws = await createWorkspace({ name: "W", color: "#000", initials: "W" });
    const result = await generateCurriculum({
      workspaceId: ws.id,
      workspace: { name: "W" },
      sources: [buildSource()],
      modelId: SONNET,
      apiKey: "sk-test",
      locale: "en",
      chatProvider: fakeProvider(streamEvents("here is no json at all")),
    });

    expect(result.fallbackReason).toBe("parse_error");
    expect(result.refineStatus).toBe("draft");
    expect(result.curriculum.title).toBe("W curriculum");
    expect(result.items.map((item) => item.title)).toEqual([
      "Wave functions",
      "Uncertainty",
    ]);
  });

  it("retries once with strict JSON instructions after non-JSON output", async () => {
    const ws = await createWorkspace({ name: "W", color: "#000", initials: "W" });
    const result = await generateCurriculum({
      workspaceId: ws.id,
      workspace: { name: "W" },
      sources: [buildSource()],
      modelId: SONNET,
      apiKey: "sk-test",
      locale: "en",
      chatProvider: fakeProviderSequence([
        streamEvents("I can help with a study plan, but first..."),
        streamEvents(VALID_JSON),
      ]),
    });

    expect(result.items).toHaveLength(2);
    expect(result.usage.input_tokens).toBe(2000);
    expect(result.usage.output_tokens).toBe(1000);
  });

  it("keeps the deterministic draft when model refs are hallucinated", async () => {
    const ws = await createWorkspace({ name: "W", color: "#000", initials: "W" });
    const ghostJson = JSON.stringify({
      title: "Ghost",
      items: [
        {
          title: "Hallucinated topic",
          objective: "Uses references that do not exist.",
          sourceRefs: [{ sourceId: "src_ghost", chunkIds: ["ck_ghost"] }],
          prerequisites: [],
          estimatedMinutes: 10,
        },
      ],
    });

    const result = await generateCurriculum({
      workspaceId: ws.id,
      workspace: { name: "W" },
      sources: [buildSource()],
      modelId: SONNET,
      apiKey: "sk-test",
      locale: "en",
      chatProvider: fakeProvider(streamEvents(ghostJson)),
    });

    expect(result.fallbackReason).toBe("invalid_ref");
    expect(result.refineStatus).toBe("draft");
    expect(result.items.map((item) => item.title)).toEqual([
      "Wave functions",
      "Uncertainty",
    ]);
    expect(result.items[0]?.sourceRefs).toEqual([
      { sourceId: "src_1", chunkIds: ["ck_1"], section: "Wave functions" },
    ]);
  });

  it("preserves draft source and chunk ids when applying a valid refine", async () => {
    const ws = await createWorkspace({ name: "W", color: "#000", initials: "W" });
    const hallucinatedChunkJson = JSON.stringify({
      title: "Improved roadmap",
      items: [
        {
          title: "State vectors",
          objective: "Explain quantum state vectors.",
          sourceRefs: [{ sourceId: "src_1", chunkIds: ["ck_ghost"] }],
          prerequisites: [],
          estimatedMinutes: 35,
        },
        {
          title: "Measurement limits",
          objective: "Explain position and momentum limits.",
          sourceRefs: [{ sourceId: "src_1", chunkIds: ["ck_ghost_2"] }],
          prerequisites: ["State vectors"],
          estimatedMinutes: 45,
        },
      ],
    });

    const result = await generateCurriculum({
      workspaceId: ws.id,
      workspace: { name: "W" },
      sources: [buildSource()],
      modelId: SONNET,
      apiKey: "sk-test",
      locale: "en",
      chatProvider: fakeProvider(streamEvents(hallucinatedChunkJson)),
    });

    expect(result.refineStatus).toBe("refined");
    expect(result.items.map((item) => item.title)).toEqual([
      "State vectors",
      "Measurement limits",
    ]);
    expect(result.items[0]?.sourceRefs).toEqual([
      { sourceId: "src_1", chunkIds: ["ck_1"], section: "Wave functions" },
    ]);
    expect(result.items[1]?.sourceRefs).toEqual([
      { sourceId: "src_1", chunkIds: ["ck_2"], section: "Uncertainty" },
    ]);
  });

  it("falls back to draft when every model item references unknown sources", async () => {
    const ws = await createWorkspace({ name: "W", color: "#000", initials: "W" });
    const ghostJson = JSON.stringify({
      title: "Ghost",
      items: [
        {
          title: "G",
          objective: "G obj",
          sourceRefs: [{ sourceId: "src_ghost" }],
          prerequisites: [],
          estimatedMinutes: 10,
        },
      ],
    });
    const result = await generateCurriculum({
      workspaceId: ws.id,
      workspace: { name: "W" },
      sources: [buildSource()],
      modelId: SONNET,
      apiKey: "sk-test",
      locale: "en",
      chatProvider: fakeProvider(streamEvents(ghostJson)),
    });

    expect(result.fallbackReason).toBe("invalid_ref");
    expect(result.items).toHaveLength(2);
  });

  it("throws unknown_model when modelId is not in the registry", async () => {
    const ws = await createWorkspace({ name: "W", color: "#000", initials: "W" });
    await expect(
      generateCurriculum({
        workspaceId: ws.id,
        workspace: { name: "W" },
        sources: [buildSource()],
        modelId: "nonexistent::model",
        apiKey: "sk-test",
        locale: "en",
        chatProvider: fakeProvider(streamEvents(VALID_JSON)),
      }),
    ).rejects.toMatchObject({ code: "unknown_model" });
  });
});
