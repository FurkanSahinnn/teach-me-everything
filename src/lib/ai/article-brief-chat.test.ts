import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ArticleAnalysisRecord } from "@/lib/article-analysis/types";
import type { StreamEvent } from "./providers/types";

let response = "";
vi.mock("./providers/registry", () => ({
  getChatProvider: () => ({ streamChat: () => ({
    abort: () => undefined,
    events: (async function* (): AsyncGenerator<StreamEvent> { yield { kind: "text", delta: response }; })(),
  }) }),
}));
vi.mock("@/lib/ai/anthropic-credential", () => ({ resolveChatCredentialForPreset: async () => ({ apiKey: "test-key" }) }));
vi.mock("@/lib/db/chunks", () => ({ listChunksBySource: async () => [{
  id: "chunk-1", sourceId: "src", workspaceId: "ws", index: 0,
  text: "We compared the proposed method with a baseline.", tokenCount: 15, createdAt: 0,
}] }));

const { runBriefChat } = await import("./article-brief-chat");
const analysis = {
  id: "ana", workspaceId: "ws", sourceId: "src", title: "Paper", targetLang: "en", status: "ready",
  modelSnapshot: { extract: "anthropic::claude-sonnet-4-6", synthesize: "anthropic::claude-sonnet-4-6", critique: "anthropic::claude-sonnet-4-6" },
  usage: { inputTokens: 0, outputTokens: 0 }, createdAt: 0, updatedAt: 0,
  brief: {
    version: 2, paperType: "empirical", coverage: { includedChunks: 1, omittedChunks: 0 },
    thesis: { id: "thesis", kind: "prose", text: "A comparison", grounding: "source" },
    sections: [{ id: "method-0", kind: "method", title: "Method", blocks: [{ id: "method-0-0", kind: "step", text: "Compare", grounding: "source" }] }],
  },
} as ArticleAnalysisRecord;

beforeEach(() => { response = ""; });

describe("analysis assistant", () => {
  it("answers with locally checked paper passages", async () => {
    response = JSON.stringify({ text: "It compares methods.", quotes: ["compared the proposed method with a baseline"] });
    const result = await runBriefChat({ analysis, question: "What did it compare?", mode: "answer" });
    expect(result.kind).toBe("answer");
    if (result.kind === "answer") expect(result.citations[0]?.verification).toBe("exact");
  });

  it("returns a section proposal without modifying the stored brief", async () => {
    response = JSON.stringify({ title: "Method explained", blocks: [{ kind: "step", text: "The methods are compared.", grounding: "source", citations: [{ quote: "compared the proposed method with a baseline" }] }] });
    const result = await runBriefChat({ analysis, question: "Make this clearer", mode: "rewrite", sectionId: "method-0" });
    expect(result.kind).toBe("rewrite");
    if (result.kind === "rewrite") expect(result.section.blocks[0]?.citations?.[0]?.chunkId).toBe("chunk-1");
    expect(analysis.brief?.sections[0]?.title).toBe("Method");
  });
});
