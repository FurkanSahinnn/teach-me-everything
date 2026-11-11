import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ArticleBriefView } from "./ArticleBriefView";
import type { ArticleAnalysisRecord } from "@/lib/article-analysis/types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/i18n/IntlProvider", () => ({ useLocalePick: () => (_tr: string, en: string) => en }));
vi.mock("@/lib/ai/article-brief-chat", () => ({ runBriefChat: vi.fn() }));
vi.mock("@/lib/db/article-analyses", () => ({
  appendBriefChat: vi.fn(), applyBriefRevision: vi.fn(), undoBriefRevision: vi.fn(), appendExternalNote: vi.fn(),
}));

const analysis = {
  id: "ana-1", workspaceId: "ws-1", sourceId: "src-1", title: "Paper",
  targetLang: "en", status: "ready", modelSnapshot: { extract: "m", synthesize: "m", critique: "m" },
  usage: { inputTokens: 1, outputTokens: 1 }, createdAt: 0, updatedAt: 0,
  brief: {
    version: 2, paperType: "empirical", coverage: { includedChunks: 4, omittedChunks: 0 },
    thesis: { id: "thesis", kind: "prose", text: "A single central claim.", grounding: "source" },
    sections: [{ id: "findings-0", kind: "findings", title: "Evidence", blocks: [{
      id: "findings-0-0", kind: "result", text: "A measured result.", grounding: "source",
      metric: "accuracy", comparison: "baseline", context: "test set",
      citations: [{ quote: "observed a measured result", chunkId: "chunk-1", verification: "exact" }],
    }] }],
  },
} as ArticleAnalysisRecord;

afterEach(cleanup);

describe("ArticleBriefView", () => {
  it("shows one reading flow with evidence detail and opens its assistant", async () => {
    render(<ArticleBriefView analysis={analysis} />);
    expect(screen.getByText("A single central claim.")).toBeInTheDocument();
    expect(screen.getByText("A measured result.")).toBeInTheDocument();
    expect(screen.getByText(/baseline/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Ask about this section/ }));
    expect(screen.getByRole("textbox", { name: /Question or instruction/ })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /Assistant model/ })).toBeInTheDocument();
  });

  it("shows a streaming draft without offering edits before generation finishes", () => {
    render(<ArticleBriefView analysis={{ ...analysis, status: "generating", brief: { ...analysis.brief!, sections: [] } }} />);
    expect(screen.getByText("A single central claim.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Ask about this section|Ask about the analysis/ })).not.toBeInTheDocument();
  });

  it("explains a shallow draft specifically instead of a generic verification warning", () => {
    render(<ArticleBriefView analysis={{ ...analysis, status: "draft", fallbackReason: "insufficient detail: 150 of 1800 words" }} />);
    expect(screen.getByText(/still too brief/)).toBeInTheDocument();
    expect(screen.queryByText(/some sections or source links could not be verified/)).not.toBeInTheDocument();
  });
});
