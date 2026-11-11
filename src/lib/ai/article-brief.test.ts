import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChunkRecord, SourceRecord } from "@/lib/db/types";
import type { ChatRequest, StreamEvent } from "./providers/types";

const requests: ChatRequest[] = [];
let shortRepair = false;
let repairWithUnmatched = false;
const getSourceMock = vi.fn();
const listChunksMock = vi.fn();
vi.mock("./providers/registry", () => ({
  getChatProvider: () => ({
    streamChat: (request: ChatRequest) => {
      requests.push(request);
      const prompt = request.system.map((block) => block.text).join("\n");
      const output = prompt.includes("PREVIOUS BRIEF WAS TOO SHALLOW") && !shortRepair
        ? JSON.stringify({
          paperType: "empirical",
          thesis: { kind: "prose", text: "The study compares a proposed method against a baseline and explains why the comparison matters.", grounding: "source", citations: [{ quote: "compared the proposed method with a baseline" }] },
          sections: (["context", "method", "findings", "critical"] as const).map((kind) => ({
            kind, title: kind,
            blocks: [0, 1, 2].map((index) => ({
              kind: kind === "method" ? "step" : "prose",
              text: Array(9).fill(`Part ${index + 1} explains that we compared the proposed method with a baseline on the same samples.`).join(" "),
              grounding: "source", citations: [{ quote: repairWithUnmatched && kind === "critical" && index === 2
                ? "This quote does not appear in the source"
                : "compared the proposed method with a baseline" }],
            })),
          })),
        })
        : prompt.includes("SECTION EXTRACTION NOTES")
        ? JSON.stringify({
          paperType: "empirical",
          thesis: { kind: "prose", text: "The paper compares two methods.", grounding: "source", citations: [{ quote: "compared the proposed method with a baseline" }] },
          sections: [{ kind: "findings", title: "Findings", blocks: [{ kind: "result", text: "A comparison was made.", grounding: "source", citations: [{ quote: "compared the proposed method with a baseline" }] }] }],
        })
        : JSON.stringify({ sectionTitle: "Results", summary: "The study compares methods.", keyQuotes: [{ quote: "compared the proposed method with a baseline" }] });
      return {
        abort: () => undefined,
        events: (async function* (): AsyncGenerator<StreamEvent> {
          yield { kind: "start", model: request.model, usage: { input_tokens: 100 } };
          if (prompt.includes("SECTION EXTRACTION NOTES")) {
            for (let i = 0; i < output.length; i += 23) {
              yield { kind: "text", delta: output.slice(i, i + 23) };
            }
          } else {
            yield { kind: "text", delta: output };
          }
          yield { kind: "delta", stopReason: "end_turn", usage: { output_tokens: 100 } };
        })(),
      };
    },
  }),
}));
vi.mock("@/lib/ai/anthropic-credential", () => ({ resolveChatCredentialForPreset: async () => ({ apiKey: "test-key" }) }));
vi.mock("@/lib/db/sources", () => ({ getSource: (...args: unknown[]) => getSourceMock(...args) }));
vi.mock("@/lib/db/chunks", () => ({ listChunksBySource: (...args: unknown[]) => listChunksMock(...args) }));

const { runArticleBrief } = await import("./article-analysis");
const binding = "anthropic::claude-sonnet-4-6";
const args = {
  workspaceId: "ws", sourceId: "src", targetLang: "en" as const,
  models: { extract: binding, synthesize: binding, critique: binding },
};
const chunk = (index: number, tokenCount: number): ChunkRecord => ({
  id: `chunk-${index}`, sourceId: "src", workspaceId: "ws", index,
  text: "We compared the proposed method with a baseline on 100 samples.",
  tokenCount, createdAt: 0,
});

beforeEach(() => {
  requests.length = 0;
  shortRepair = false;
  repairWithUnmatched = false;
  getSourceMock.mockResolvedValue({ id: "src" } as SourceRecord);
});

describe("adaptive article brief generation", () => {
  it("uses one writing call for a paper that fits and verifies its source quote", async () => {
    listChunksMock.mockResolvedValue([chunk(0, 100)]);
    const result = await runArticleBrief({ ...args, models: { ...args.models, critique: "missing::model" } });
    expect(requests).toHaveLength(1);
    expect(result.brief.thesis.citations?.[0]).toMatchObject({ chunkId: "chunk-0", verification: "exact" });
    expect(result.payload.keyResults).toHaveLength(1);
  });

  it("publishes a grounded thesis and then a complete section as tokens arrive", async () => {
    listChunksMock.mockResolvedValue([chunk(0, 100)]);
    const drafts: { sections: number; quote: string | undefined }[] = [];
    await runArticleBrief({ ...args, onDraft: (brief) => {
      drafts.push({ sections: brief.sections.length, quote: brief.thesis.citations?.[0]?.verification });
    } });
    expect(drafts).toEqual([
      { sections: 0, quote: "exact" },
      { sections: 1, quote: "exact" },
    ]);
  });

  it("previews incomplete prose only as transient stream text", async () => {
    listChunksMock.mockResolvedValue([chunk(0, 100)]);
    const previews: string[] = [];
    await runArticleBrief({ ...args, onStreamText: (text) => previews.push(text) });
    expect(previews.some((text) => text.includes("The paper"))).toBe(true);
    expect(previews.at(-1)).toBe("");
  });

  it("extracts long-paper sections before writing one coherent brief", async () => {
    listChunksMock.mockResolvedValue([chunk(0, 20_000), chunk(1, 20_000)]);
    const result = await runArticleBrief(args);
    expect(requests).toHaveLength(3);
    expect(result.brief.coverage.omittedChunks).toBe(1);
  });

  it("expands an overly short full-paper brief once before returning it", async () => {
    const text = Array(220).fill("We compared the proposed method with a baseline on 100 samples.").join(" ");
    listChunksMock.mockResolvedValue([{ ...chunk(0, 4_000), text }]);
    const result = await runArticleBrief(args);
    expect(requests).toHaveLength(2);
    expect(requests[1]?.system.map((block) => block.text).join("\n")).toContain("PREVIOUS BRIEF WAS TOO SHALLOW");
    expect(result.brief.sections).toHaveLength(4);
    expect(result.status).toBe("ready");
  });

  it("labels a still-shallow brief as a draft after one bounded repair", async () => {
    shortRepair = true;
    const text = Array(220).fill("We compared the proposed method with a baseline on 100 samples.").join(" ");
    listChunksMock.mockResolvedValue([{ ...chunk(0, 4_000), text }]);
    const result = await runArticleBrief(args);
    expect(requests).toHaveLength(2);
    expect(result.status).toBe("draft");
    expect(result.fallbackReason).toContain("insufficient detail");
  });

  it("keeps a substantive expansion with one unmatched quote and flags that claim", async () => {
    repairWithUnmatched = true;
    const text = Array(220).fill("We compared the proposed method with a baseline on 100 samples.").join(" ");
    listChunksMock.mockResolvedValue([{ ...chunk(0, 4_000), text }]);
    const result = await runArticleBrief(args);
    expect(result.brief.sections.flatMap((section) => section.blocks)).toHaveLength(12);
    expect(result.status).toBe("draft");
    expect(result.fallbackReason).toContain("1 source claim(s) have no matching passage");
  });
});
