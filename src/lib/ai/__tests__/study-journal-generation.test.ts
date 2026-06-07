import { describe, expect, it } from "vitest";
import {
  estimateStudyJournalCost,
  generateStudyJournalMeta,
  STUDY_JOURNAL_PROMPT_VERSION,
  StudyJournalGenError,
} from "../study-journal-generation";
import { encodeChatModelBinding } from "../model-options";
import type {
  ChatProvider,
  ChatRequest,
  ChatStreamHandle,
  ProviderCapabilities,
  StreamEvent,
} from "../providers/types";

const SONNET = encodeChatModelBinding("anthropic", "claude-sonnet-4-6");

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

function fakeProviderEcho(captureRef: { request?: ChatRequest }, events: StreamEvent[]): ChatProvider {
  const capabilities: ProviderCapabilities = {
    cacheControl: true,
    toolUse: "native",
    streaming: true,
    vision: false,
  };
  return {
    id: "anthropic",
    capabilities,
    streamChat(req: ChatRequest): ChatStreamHandle {
      captureRef.request = req;
      async function* gen() {
        for (const ev of events) yield ev;
      }
      return { events: gen(), abort: () => {} };
    },
  };
}

const VALID_JSON = JSON.stringify({
  title: "How wave functions encode state",
  tags: ["wave-functions", "quantum-state"],
  summaryMarkdown:
    "Wave functions are complex-valued amplitudes whose squared modulus gives probability density.",
});

function streamEvents(text: string): StreamEvent[] {
  return [
    { kind: "start", model: "claude-sonnet-4-6", usage: { input_tokens: 200 } },
    { kind: "text", delta: text },
    {
      kind: "delta",
      stopReason: "end_turn",
      usage: { input_tokens: 200, output_tokens: 80 },
    },
    { kind: "stop" },
  ];
}

const BASE_ARGS = {
  workspace: { name: "Physics" },
  question: "What is a wave function?",
  answerMarkdown:
    "A wave function ψ(x) is a complex-valued amplitude whose |ψ|² gives the probability density.",
  modelId: SONNET,
  apiKey: "sk-test",
  locale: "en" as const,
};

describe("STUDY_JOURNAL_PROMPT_VERSION", () => {
  it("is a stable, namespaced string", () => {
    expect(STUDY_JOURNAL_PROMPT_VERSION).toMatch(/^study-journal-v\d+$/);
  });
});

describe("estimateStudyJournalCost", () => {
  it("returns 0 for unknown models", () => {
    expect(estimateStudyJournalCost("totally-fake", { input_tokens: 10 })).toBe(0);
  });
  it("returns positive cost for known models with usage", () => {
    expect(
      estimateStudyJournalCost("claude-sonnet-4-6", {
        input_tokens: 200,
        output_tokens: 80,
      }),
    ).toBeGreaterThan(0);
  });
});

describe("generateStudyJournalMeta", () => {
  it("returns parsed metadata + usage + cost from a valid stream", async () => {
    const result = await generateStudyJournalMeta({
      ...BASE_ARGS,
      chatProvider: fakeProvider(streamEvents(VALID_JSON)),
    });

    expect(result.parsed.title).toBe("How wave functions encode state");
    expect(result.parsed.tags).toEqual(["wave-functions", "quantum-state"]);
    expect(result.parsed.summaryMarkdown).toContain("squared modulus");
    expect(result.usage.input_tokens).toBe(200);
    expect(result.usage.output_tokens).toBe(80);
    expect(result.estimatedCostUsd).toBeGreaterThan(0);
    expect(result.model).toBe("claude-sonnet-4-6");
  });

  it("forwards source title + cited sections to the system prompt", async () => {
    const captured: { request?: ChatRequest } = {};
    await generateStudyJournalMeta({
      ...BASE_ARGS,
      source: { title: "QM notes", author: "Griffiths" },
      citedSections: ["State vectors"],
      chatProvider: fakeProviderEcho(captured, streamEvents(VALID_JSON)),
    });

    const systemBlocks = captured.request?.system ?? [];
    expect(systemBlocks).toHaveLength(2);
    const payload = systemBlocks[1]?.text ?? "";
    expect(payload).toContain("Griffiths");
    expect(payload).toContain("State vectors");
    expect(payload).toContain("wave function");
  });

  it("throws empty_input when question or answer is blank", async () => {
    await expect(
      generateStudyJournalMeta({
        ...BASE_ARGS,
        question: "   ",
        chatProvider: fakeProvider([]),
      }),
    ).rejects.toMatchObject({
      name: "StudyJournalGenError",
      code: "empty_input",
    });
    await expect(
      generateStudyJournalMeta({
        ...BASE_ARGS,
        answerMarkdown: "",
        chatProvider: fakeProvider([]),
      }),
    ).rejects.toMatchObject({ code: "empty_input" });
  });

  it("throws aborted when signal is already aborted", async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(
      generateStudyJournalMeta({
        ...BASE_ARGS,
        signal: ac.signal,
        chatProvider: fakeProvider(streamEvents(VALID_JSON)),
      }),
    ).rejects.toMatchObject({ code: "aborted" });
  });

  it("throws unknown_model for an unregistered presetId", async () => {
    await expect(
      generateStudyJournalMeta({
        ...BASE_ARGS,
        modelId: "nonexistent-preset:foo",
        chatProvider: fakeProvider(streamEvents(VALID_JSON)),
      }),
    ).rejects.toMatchObject({
      name: "StudyJournalGenError",
      code: "unknown_model",
    });
  });

  it("wraps stream-error events as StudyJournalGenError(stream_error)", async () => {
    await expect(
      generateStudyJournalMeta({
        ...BASE_ARGS,
        chatProvider: fakeProvider([
          { kind: "start", model: "claude-sonnet-4-6", usage: {} },
          { kind: "error", status: 429, message: "rate limited" },
        ]),
      }),
    ).rejects.toMatchObject({ code: "stream_error" });
  });

  it("wraps malformed payloads as parse_error", async () => {
    await expect(
      generateStudyJournalMeta({
        ...BASE_ARGS,
        chatProvider: fakeProvider(streamEvents("nope, not json")),
      }),
    ).rejects.toMatchObject({ code: "parse_error" });
  });

  it("wraps abort events as aborted", async () => {
    await expect(
      generateStudyJournalMeta({
        ...BASE_ARGS,
        chatProvider: fakeProvider([
          { kind: "start", model: "claude-sonnet-4-6", usage: {} },
          { kind: "abort" },
        ]),
      }),
    ).rejects.toMatchObject({ code: "aborted" });
  });
});
