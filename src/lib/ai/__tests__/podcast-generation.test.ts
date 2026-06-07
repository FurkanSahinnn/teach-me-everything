import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  estimatePodcastScriptCost,
  generatePodcastScript,
  mapParsedScriptToInput,
  PodcastGenError,
  type PodcastGenSource,
} from "../podcast-generation";
import { encodeChatModelBinding } from "../model-options";
import { PODCAST_SCRIPT_PROMPT_VERSION } from "../prompts/podcast-script";
import type {
  ChatProvider,
  ChatRequest,
  ChatStreamHandle,
  ProviderCapabilities,
  StreamEvent,
} from "../providers/types";
import { db } from "@/lib/db/schema";
import { createWorkspace } from "@/lib/db/workspaces";
import type { PodcastVoice } from "@/lib/podcast/types";

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

function fakeProviderSequence(eventBatches: StreamEvent[][]): {
  provider: ChatProvider;
  requests: ChatRequest[];
} {
  const requests: ChatRequest[] = [];
  const capabilities: ProviderCapabilities = {
    cacheControl: true,
    toolUse: "native",
    streaming: true,
    vision: false,
  };
  return {
    requests,
    provider: {
      id: "anthropic",
      capabilities,
      streamChat(req: ChatRequest): ChatStreamHandle {
        requests.push(req);
        const events = eventBatches[Math.min(requests.length - 1, eventBatches.length - 1)] ?? [];
        async function* gen() {
          for (const ev of events) yield ev;
        }
        return { events: gen(), abort: () => {} };
      },
    },
  };
}

function buildSource(): PodcastGenSource {
  return {
    id: "src_1",
    title: "QFT notes",
    type: "pdf",
    chunks: [
      {
        id: "ck_1",
        index: 0,
        text: "Renormalization absorbs UV divergences.",
        section: "12.1",
        headings: ["Chapter 12"],
        page: 401,
      },
      {
        id: "ck_2",
        index: 1,
        text: "Fixed points sit where the β function vanishes.",
        section: "12.4",
        headings: ["Chapter 12"],
        page: 414,
      },
    ],
  };
}

const VOICES: PodcastVoice[] = [
  { speaker: "alev", name: "Alev", voiceId: "voice_alev", role: "learner" },
  { speaker: "deniz", name: "Deniz", voiceId: "voice_deniz", role: "expert" },
];

const VALID_OUTPUT = JSON.stringify({
  title: "Renormalizasyon, bir diyalogda",
  description: "RG akışı sezgisel anlatılır.",
  chapters: [
    { title: "Cutoff", segmentIndex: 0 },
    { title: "Fixed points", segmentIndex: 2 },
  ],
  segments: [
    {
      speaker: "alev",
      text: "Renormalizasyon neden gerekli?",
      sourceRefs: [{ sourceId: "src_1", chunkIds: ["ck_1"] }],
    },
    {
      speaker: "deniz",
      text: "UV sonsuzlukları emen bir hesap aracıdır.",
      sourceRefs: [{ sourceId: "src_1", chunkIds: ["ck_1"] }],
    },
    {
      speaker: "alev",
      text: "Peki β = 0 olan yer ne?",
      sourceRefs: [{ sourceId: "src_1", chunkIds: ["ck_2"] }],
    },
  ],
});

function streamEvents(text: string): StreamEvent[] {
  return [
    { kind: "start", model: "claude-sonnet-4-6", usage: { input_tokens: 1500 } },
    { kind: "text", delta: text },
    {
      kind: "delta",
      stopReason: "end_turn",
      usage: { input_tokens: 1500, output_tokens: 700 },
    },
    { kind: "stop" },
  ];
}

describe("estimatePodcastScriptCost", () => {
  it("returns 0 for unknown models", () => {
    expect(estimatePodcastScriptCost("totally-fake", { input_tokens: 10 })).toBe(0);
  });
  it("returns positive cost for known models with usage", () => {
    expect(
      estimatePodcastScriptCost("claude-sonnet-4-6", {
        input_tokens: 1000,
        output_tokens: 500,
      }),
    ).toBeGreaterThan(0);
  });
});

describe("mapParsedScriptToInput", () => {
  it("strips refs that point at unknown source ids", () => {
    const { segments } = mapParsedScriptToInput(
      {
        title: "T",
        chapters: [{ title: "C", segmentIndex: 0 }],
        segments: [
          {
            speaker: "alev",
            text: "x",
            sourceRefs: [
              { sourceId: "src_KNOWN", chunkIds: ["ck_ok"] },
              { sourceId: "src_UNKNOWN", chunkIds: ["ck_ok"] },
            ],
          },
        ],
      },
      new Set(["src_KNOWN"]),
      new Set(["ck_ok"]),
    );
    expect(segments[0]?.sourceRefs).toHaveLength(1);
    expect(segments[0]?.sourceRefs?.[0]?.sourceId).toBe("src_KNOWN");
  });

  it("clamps chapter indices into the segment range", () => {
    const { chapters } = mapParsedScriptToInput(
      {
        title: "T",
        chapters: [
          { title: "A", segmentIndex: 0 },
          { title: "Past end", segmentIndex: 9 },
        ],
        segments: [
          { speaker: "alev", text: "x", sourceRefs: [] },
          { speaker: "deniz", text: "y", sourceRefs: [] },
        ],
      },
      new Set(),
      new Set(),
    );
    expect(chapters.map((c) => c.segmentIndex)).toEqual([0, 1]);
  });

  it("omits sourceRefs on segments that resolved to none", () => {
    const { segments } = mapParsedScriptToInput(
      {
        title: "T",
        chapters: [{ title: "C", segmentIndex: 0 }],
        segments: [
          {
            speaker: "alev",
            text: "x",
            sourceRefs: [{ sourceId: "src_UNKNOWN" }],
          },
        ],
      },
      new Set(),
      new Set(),
    );
    expect(segments[0]?.sourceRefs).toBeUndefined();
  });
});

describe("generatePodcastScript", () => {
  it("rejects empty source list", async () => {
    await expect(
      generatePodcastScript({
        workspaceId: "w_x",
        workspace: { name: "X" },
        sources: [],
        voices: VOICES,
        modelId: SONNET,
        apiKey: "k",
        locale: "tr",
        chatProvider: fakeProvider([]),
      }),
    ).rejects.toMatchObject({ code: "no_sources" });
  });

  it("rejects empty voice list", async () => {
    await expect(
      generatePodcastScript({
        workspaceId: "w_x",
        workspace: { name: "X" },
        sources: [buildSource()],
        voices: [],
        modelId: SONNET,
        apiKey: "k",
        locale: "tr",
        chatProvider: fakeProvider([]),
      }),
    ).rejects.toMatchObject({ code: "no_voices" });
  });

  it("rejects sources whose chunks are all empty", async () => {
    await expect(
      generatePodcastScript({
        workspaceId: "w_x",
        workspace: { name: "X" },
        sources: [{ ...buildSource(), chunks: [] }],
        voices: VOICES,
        modelId: SONNET,
        apiKey: "k",
        locale: "tr",
        chatProvider: fakeProvider([]),
      }),
    ).rejects.toMatchObject({ code: "no_chunks" });
  });

  it("wraps a parse failure as PodcastGenError(parse_error)", async () => {
    const ws = await createWorkspace({
      name: "QFT",
      color: "#000",
      initials: "QF",
    });
    await expect(
      generatePodcastScript({
        workspaceId: ws.id,
        workspace: { name: ws.name },
        sources: [buildSource()],
        voices: VOICES,
        modelId: SONNET,
        apiKey: "k",
        locale: "tr",
        chatProvider: fakeProvider(streamEvents("not json at all")),
      }),
    ).rejects.toBeInstanceOf(PodcastGenError);
  });

  it("repairs a non-JSON first response with one follow-up JSON-only call", async () => {
    const ws = await createWorkspace({
      name: "QFT",
      color: "#000",
      initials: "QF",
    });
    const { provider, requests } = fakeProviderSequence([
      streamEvents("Alev asks what renormalization is. Deniz answers from the notes."),
      streamEvents(VALID_OUTPUT),
    ]);
    const onRepairAttempt = vi.fn();

    const result = await generatePodcastScript({
      workspaceId: ws.id,
      workspace: { name: ws.name },
      sources: [buildSource()],
      voices: VOICES,
      modelId: SONNET,
      apiKey: "k",
      locale: "tr",
      chatProvider: provider,
      onRepairAttempt,
    });

    expect(result.podcast.status).toBe("scripted");
    expect(result.podcast.segments).toHaveLength(3);
    expect(requests).toHaveLength(2);
    expect(String(requests[1]?.messages[0]?.content)).toContain("Repair");
    expect(onRepairAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        parseError: expect.stringContaining("no JSON object"),
        preview: expect.stringContaining("Alev asks"),
      }),
    );
  });

  it("persists a PodcastRecord with status=scripted on the happy path", async () => {
    const ws = await createWorkspace({
      name: "QFT",
      color: "#000",
      initials: "QF",
    });
    const result = await generatePodcastScript({
      workspaceId: ws.id,
      workspace: { name: ws.name },
      sources: [buildSource()],
      voices: VOICES,
      modelId: SONNET,
      apiKey: "k",
      locale: "tr",
      chatProvider: fakeProvider(streamEvents(VALID_OUTPUT)),
    });

    expect(result.podcast.status).toBe("scripted");
    expect(result.podcast.workspaceId).toBe(ws.id);
    expect(result.podcast.segments).toHaveLength(3);
    expect(result.podcast.voices).toHaveLength(2);
    expect(result.podcast.generationPromptVersion).toBe(
      PODCAST_SCRIPT_PROMPT_VERSION,
    );
    expect(result.podcast.modelId).toBe("claude-sonnet-4-6");
    expect(result.podcast.sourceIds).toEqual(["src_1"]);
    expect(result.estimatedCostUsd).toBeGreaterThan(0);

    const persisted = await db.podcasts.get(result.podcast.id);
    expect(persisted?.id).toBe(result.podcast.id);
  });

  it("signals abort when signal is already aborted before streaming", async () => {
    const ws = await createWorkspace({
      name: "QFT",
      color: "#000",
      initials: "QF",
    });
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(
      generatePodcastScript({
        workspaceId: ws.id,
        workspace: { name: ws.name },
        sources: [buildSource()],
        voices: VOICES,
        modelId: SONNET,
        apiKey: "k",
        locale: "tr",
        chatProvider: fakeProvider(streamEvents(VALID_OUTPUT)),
        signal: ctrl.signal,
      }),
    ).rejects.toMatchObject({ code: "aborted" });
  });
});
