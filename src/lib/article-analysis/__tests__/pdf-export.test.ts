import { describe, expect, it } from "vitest";
import { analysisToHtml } from "@/lib/article-analysis/pdf-export";
import type {
  ArticleAnalysisPayload,
  ArticleAnalysisRecord,
} from "@/lib/article-analysis/types";

function payload(): ArticleAnalysisPayload {
  return {
    tldr: "Bu makale <transformer> mimarisini anlatır.",
    ataGlance: {
      paperType: "prototype",
      field: "ML",
      purpose: "image classification",
      headlineFinding: "SOTA on ImageNet",
    },
    fiveCs: {
      category: "c",
      context: "ctx",
      correctness: "ok",
      contributions: "ViT",
      clarity: "clear",
    },
    problemMotivation: [
      { text: "CNNs are local", grounding: "source", citations: [{ quote: "locality" }] },
    ],
    priorWorkGap: [{ text: "no global attention", grounding: "general" }],
    contributions: [{ text: "pure transformer", grounding: "source" }],
    keyIdea: "patches as tokens",
    methodWalkthrough: [{ step: "split into patches", why: "tokenization" }],
    howItSolves: [{ text: "global attention", grounding: "source" }],
    keyResults: [{ text: "88% top-1", grounding: "source", citations: [{ quote: "88.55%", page: 7 }] }],
    critique: {
      soundness: "s",
      novelty: "n",
      significance: "sig",
      clarity: "cl",
      weakestLink: "needs huge data",
    },
    assumptionsLimitations: [{ text: "data hungry", grounding: "general" }],
    reproducibility: "code released",
    questionsToAsk: ["does it scale down?"],
    soWhat: "shifts vision to transformers",
    whatToReadNext: [{ title: "DeiT", why: "data-efficient" }],
    glossary: [{ term: "ablation", tr: "bileşen çıkarma deneyi", en: "component-removal study" }],
  };
}

function record(over: Partial<ArticleAnalysisRecord> = {}): ArticleAnalysisRecord {
  return {
    id: "ana_1",
    workspaceId: "w1",
    sourceId: "s1",
    title: "An Image is Worth 16x16 Words",
    targetLang: "tr",
    status: "ready",
    modelSnapshot: { extract: "a::h", synthesize: "a::s", critique: "a::s" },
    usage: { inputTokens: 1, outputTokens: 1 },
    payload: payload(),
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

describe("analysisToHtml", () => {
  it("renders the title, layered sections and the bilingual glossary", () => {
    const html = analysisToHtml(record(), { theme: "white", exportedAt: 0 });
    expect(html).toContain("An Image is Worth 16x16 Words");
    expect(html).toContain("Problem ve motivasyon"); // TR section label
    expect(html).toContain("Terim sözlüğü"); // glossary heading
    expect(html).toContain("ablation");
    expect(html).toContain("bileşen çıkarma deneyi");
    expect(html).toContain("component-removal study");
    // citation quote + page surfaced
    expect(html).toContain("88.55%");
    expect(html).toContain("(s.7)");
  });

  it("flags general-knowledge claims and escapes HTML", () => {
    const html = analysisToHtml(record(), { exportedAt: 0 });
    expect(html).toContain("genel bilgi"); // [G] flag (TR)
    // angle brackets in the TL;DR must be escaped, not injected as a tag
    expect(html).toContain("&lt;transformer&gt;");
    expect(html).not.toContain("<transformer>");
  });

  it("shows a draft banner with the fallback reason when status is draft", () => {
    const html = analysisToHtml(
      record({ status: "draft", fallbackReason: "critique" }),
      { exportedAt: 0 },
    );
    expect(html).toContain("taslak"); // draft note (TR, lowercased substring)
    expect(html).toContain("critique");
  });

  it("uses English section labels for an EN analysis", () => {
    const html = analysisToHtml(record({ targetLang: "en" }), { exportedAt: 0 });
    expect(html).toContain("Problem &amp; motivation");
    expect(html).toContain("Glossary");
    expect(html).toContain("general knowledge");
  });
});
