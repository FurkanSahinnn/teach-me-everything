import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AnalysisDetailView } from "./AnalysisDetailView";
import type {
  AnalysisClaim,
  ArticleAnalysisPayload,
  ArticleAnalysisRecord,
} from "@/lib/article-analysis/types";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));
// The view only needs a TR/EN picker; assertions below read the English side.
vi.mock("@/i18n/IntlProvider", () => ({
  useLocalePick: () => (_tr: string, en: string) => en,
}));

afterEach(() => {
  cleanup();
  pushMock.mockReset();
});

const EMPTY_PAYLOAD: ArticleAnalysisPayload = {
  tldr: "",
  ataGlance: { paperType: "", field: "", purpose: "", headlineFinding: "" },
  fiveCs: {
    category: "",
    context: "",
    correctness: "",
    contributions: "",
    clarity: "",
  },
  problemMotivation: [],
  priorWorkGap: [],
  contributions: [],
  keyIdea: "",
  methodWalkthrough: [],
  howItSolves: [],
  keyResults: [],
  critique: {
    soundness: "",
    novelty: "",
    significance: "",
    clarity: "",
    weakestLink: "",
  },
  assumptionsLimitations: [],
  reproducibility: "",
  questionsToAsk: [],
  soWhat: "",
  whatToReadNext: [],
  glossary: [],
};

function analysis(claims: AnalysisClaim[]): ArticleAnalysisRecord {
  return {
    id: "an_1",
    workspaceId: "ws_1",
    sourceId: "src_1",
    title: "A Paper",
    targetLang: "en",
    status: "ready",
    modelSnapshot: { extract: "m", synthesize: "m", critique: "m" },
    usage: { inputTokens: 1, outputTokens: 1 },
    payload: { ...EMPTY_PAYLOAD, problemMotivation: claims },
    createdAt: 0,
    updatedAt: 0,
  };
}

// The Understanding layer is collapsed by default; open it so claim chips
// are in the DOM.
async function openUnderstanding(): Promise<void> {
  await userEvent.click(
    screen.getByRole("button", { name: /2 · Understanding/ }),
  );
}

describe("AnalysisDetailView citation verification", () => {
  it("renders a verified quote as an active chip that deep-links to its chunk", async () => {
    render(
      <AnalysisDetailView
        analysis={analysis([
          {
            text: "The problem is hard.",
            grounding: "source",
            citations: [
              {
                quote: "a genuinely hard problem in the field",
                chunkId: "ck_7",
                verification: "exact",
              },
            ],
          },
        ])}
      />,
    );
    await openUnderstanding();

    const chip = screen.getByRole("button", {
      name: /a genuinely hard problem/,
    });
    expect(chip).toBeEnabled();
    expect(chip).toHaveAttribute("data-citation-tone", "default");

    await userEvent.click(chip);
    expect(pushMock).toHaveBeenCalledWith(
      "/w/ws_1/read/src_1?chunk=ck_7",
    );
  });

  it("renders an unverified quote as a disabled warn chip that cannot jump", async () => {
    render(
      <AnalysisDetailView
        analysis={analysis([
          {
            text: "The problem is hard.",
            grounding: "source",
            citations: [
              {
                quote: "a sentence the model invented wholesale",
                verification: "unverified",
              },
            ],
          },
        ])}
      />,
    );
    await openUnderstanding();

    const chip = screen.getByRole("button", { name: /invented wholesale/ });
    expect(chip).toBeDisabled();
    expect(chip).toHaveAttribute("data-citation-tone", "unverified");

    await userEvent.click(chip);
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("marks an approximate match distinctly from an exact one", async () => {
    render(
      <AnalysisDetailView
        analysis={analysis([
          {
            text: "The problem is hard.",
            grounding: "source",
            citations: [
              {
                quote: "a lightly reflowed span",
                chunkId: "ck_2",
                verification: "fuzzy",
              },
            ],
          },
        ])}
      />,
    );
    await openUnderstanding();

    const chip = screen.getByRole("button", { name: /lightly reflowed span/ });
    expect(chip).toHaveAttribute("data-citation-tone", "approx");
    expect(chip).toBeEnabled();
  });

  it("flags a source-tagged claim that carries no citation at all", async () => {
    render(
      <AnalysisDetailView
        analysis={analysis([
          { text: "Backed by the paper, allegedly.", grounding: "source" },
        ])}
      />,
    );
    await openUnderstanding();
    expect(screen.getByText("uncited")).toBeInTheDocument();
  });

  it("summarizes how much of the analysis is source-verified", () => {
    render(
      <AnalysisDetailView
        analysis={analysis([
          {
            text: "Verified claim.",
            grounding: "source",
            citations: [{ quote: "real span", chunkId: "ck_1", verification: "exact" }],
          },
          {
            text: "Fabricated claim.",
            grounding: "source",
            citations: [{ quote: "fake span", verification: "unverified" }],
          },
          { text: "Model context.", grounding: "general" },
        ])}
      />,
    );
    // 1 of 2 source claims verified — general claims are not counted.
    expect(
      screen.getByText("Source-verified: 1/2 claims (50%)"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("1 exact · 0 approx · 1 not found"),
    ).toBeInTheDocument();
  });

  it("treats a legacy citation with a chunkId but no verdict as verified", () => {
    render(
      <AnalysisDetailView
        analysis={analysis([
          {
            text: "Old analysis claim.",
            grounding: "source",
            citations: [{ quote: "some span", chunkId: "ck_9" }],
          },
        ])}
      />,
    );
    expect(
      screen.getByText("Source-verified: 1/1 claims (100%)"),
    ).toBeInTheDocument();
  });
});
