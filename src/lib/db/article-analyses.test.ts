import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createAnalysis,
  deleteAnalysis,
  getAnalysis,
  listAnalysesBySource,
  listAnalysesByWorkspace,
  setAnalysisStatus,
  updateAnalysis,
  applyBriefRevision,
  undoBriefRevision,
  appendExternalNote,
} from "./article-analyses";
import { projectBriefToLegacy, type ArticleBrief } from "@/lib/article-analysis/brief";
import { db } from "./schema";
import type {
  AnalysisModelSnapshot,
  ArticleAnalysisPayload,
} from "@/lib/article-analysis/types";
import type { CreateAnalysisInput as RepoCreateInput } from "./article-analyses";

const MODELS: AnalysisModelSnapshot = {
  extract: "anthropic::claude-haiku-4-5-20251001",
  synthesize: "anthropic::claude-sonnet-4-6",
  critique: "anthropic::claude-opus-4-7",
};

function makeInput(
  over: Partial<RepoCreateInput> = {},
): RepoCreateInput {
  return {
    workspaceId: "ws-1",
    sourceId: "src-1",
    title: "Attention Is All You Need",
    targetLang: "tr",
    modelSnapshot: MODELS,
    ...over,
  };
}

const PAYLOAD: ArticleAnalysisPayload = {
  tldr: "A transformer.",
  ataGlance: {
    paperType: "method",
    field: "ML",
    purpose: "seq2seq",
    headlineFinding: "attention wins",
  },
  fiveCs: {
    category: "c",
    context: "c",
    correctness: "c",
    contributions: "c",
    clarity: "c",
  },
  problemMotivation: [],
  priorWorkGap: [],
  contributions: [],
  keyIdea: "self-attention",
  methodWalkthrough: [],
  howItSolves: [],
  keyResults: [],
  critique: {
    soundness: "ok",
    novelty: "high",
    significance: "high",
    clarity: "ok",
    weakestLink: "ablations",
  },
  assumptionsLimitations: [],
  reproducibility: "good",
  questionsToAsk: [],
  soWhat: "matters",
  whatToReadNext: [],
  glossary: [],
};

beforeEach(async () => {
  await db.delete();
  await db.open();
});

afterEach(async () => {
  await db.delete();
});

describe("article-analyses repo", () => {
  it("applies a section proposal and restores the previous version", async () => {
    const rec = await createAnalysis(makeInput());
    const brief: ArticleBrief = {
      version: 2,
      paperType: "method",
      thesis: { id: "thesis", kind: "prose", text: "A method", grounding: "source" },
      sections: [{ id: "method-0", kind: "method", title: "Method", blocks: [{ id: "method-0-0", kind: "step", text: "Old text", grounding: "source" }] }],
      coverage: { includedChunks: 1, omittedChunks: 0 },
    };
    await updateAnalysis(rec.id, { brief, payload: projectBriefToLegacy(brief) });
    const next = { ...brief.sections[0]!, blocks: [{ ...brief.sections[0]!.blocks[0]!, text: "New text" }] };
    await applyBriefRevision(rec.id, next);
    expect((await getAnalysis(rec.id))?.brief?.sections[0]?.blocks[0]?.text).toBe("New text");
    await undoBriefRevision(rec.id, "method-0");
    expect((await getAnalysis(rec.id))?.brief?.sections[0]?.blocks[0]?.text).toBe("Old text");
  });

  it("attaches outside research to the focused section with undo", async () => {
    const rec = await createAnalysis(makeInput());
    const brief: ArticleBrief = {
      version: 2, paperType: "method", coverage: { includedChunks: 1, omittedChunks: 0 },
      thesis: { id: "thesis", kind: "prose", text: "A method", grounding: "source" },
      sections: [{ id: "method-0", kind: "method", title: "Method", blocks: [{ id: "method-0-0", kind: "step", text: "Original", grounding: "source" }] }],
    };
    await updateAnalysis(rec.id, { brief, payload: projectBriefToLegacy(brief) });
    await appendExternalNote(rec.id, "Outside context", [{ title: "Source", url: "https://example.org" }], "method-0");
    expect((await getAnalysis(rec.id))?.brief?.sections[0]?.blocks[1]?.grounding).toBe("external");
    await undoBriefRevision(rec.id, "method-0");
    expect((await getAnalysis(rec.id))?.brief?.sections[0]?.blocks).toHaveLength(1);
  });

  it("can undo an added outside-research section", async () => {
    const rec = await createAnalysis(makeInput());
    const brief: ArticleBrief = {
      version: 2, paperType: "method", coverage: { includedChunks: 1, omittedChunks: 0 },
      thesis: { id: "thesis", kind: "prose", text: "A method", grounding: "source" },
      sections: [],
    };
    await updateAnalysis(rec.id, { brief, payload: projectBriefToLegacy(brief) });
    await appendExternalNote(rec.id, "Outside context", [{ title: "Source", url: "https://example.org" }]);
    const added = (await getAnalysis(rec.id))?.brief?.sections[0];
    expect(added?.kind).toBe("external");
    await undoBriefRevision(rec.id, added!.id);
    expect((await getAnalysis(rec.id))?.brief?.sections).toHaveLength(0);
  });
  it("create → get round-trip with generating defaults", async () => {
    const rec = await createAnalysis(makeInput());
    expect(rec.id).toMatch(/^ana/);
    expect(rec.status).toBe("generating");
    expect(rec.payload).toBeUndefined();
    expect(rec.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
    expect(rec.createdAt).toBe(rec.updatedAt);

    const got = await getAnalysis(rec.id);
    expect(got).toEqual(rec);
  });

  it("lists by workspace newest-first", async () => {
    const a = await createAnalysis(makeInput({ title: "A" }));
    const b = await createAnalysis(makeInput({ title: "B" }));
    // Force distinct, descending createdAt regardless of clock resolution.
    await db.articleAnalyses.update(a.id, { createdAt: 1000 });
    await db.articleAnalyses.update(b.id, { createdAt: 2000 });

    const list = await listAnalysesByWorkspace("ws-1");
    expect(list.map((r) => r.title)).toEqual(["B", "A"]);
  });

  it("lists by source newest-first and scopes correctly", async () => {
    const a = await createAnalysis(makeInput({ sourceId: "src-A" }));
    const b = await createAnalysis(makeInput({ sourceId: "src-A" }));
    await createAnalysis(makeInput({ sourceId: "src-B" }));
    await db.articleAnalyses.update(a.id, { createdAt: 10 });
    await db.articleAnalyses.update(b.id, { createdAt: 20 });

    const list = await listAnalysesBySource("src-A");
    expect(list.map((r) => r.id)).toEqual([b.id, a.id]);
  });

  it("setAnalysisStatus flips generating → ready with payload + usage", async () => {
    const rec = await createAnalysis(makeInput());
    const before = rec.updatedAt;
    await setAnalysisStatus(rec.id, "ready", {
      payload: PAYLOAD,
      usage: { inputTokens: 100, outputTokens: 50, costUsd: 0.01 },
    });

    const got = await getAnalysis(rec.id);
    expect(got?.status).toBe("ready");
    expect(got?.payload).toEqual(PAYLOAD);
    expect(got?.usage.inputTokens).toBe(100);
    expect(got?.updatedAt).toBeGreaterThanOrEqual(before);
  });

  it("setAnalysisStatus records an error message on fatal failure", async () => {
    const rec = await createAnalysis(makeInput());
    await setAnalysisStatus(rec.id, "error", {
      errorMessage: "credential missing",
    });

    const got = await getAnalysis(rec.id);
    expect(got?.status).toBe("error");
    expect(got?.errorMessage).toBe("credential missing");
  });

  it("updateAnalysis clears a field when patched with null", async () => {
    const rec = await createAnalysis(makeInput());
    await setAnalysisStatus(rec.id, "draft", {
      payload: PAYLOAD,
      fallbackReason: "critique stage degraded",
    });
    expect((await getAnalysis(rec.id))?.fallbackReason).toBe(
      "critique stage degraded",
    );

    await updateAnalysis(rec.id, { status: "ready", fallbackReason: null });
    const got = await getAnalysis(rec.id);
    expect(got?.status).toBe("ready");
    expect(got?.fallbackReason).toBeUndefined();
    expect("fallbackReason" in (got as object)).toBe(false);
  });

  it("deleteAnalysis removes the row", async () => {
    const rec = await createAnalysis(makeInput());
    await deleteAnalysis(rec.id);
    expect(await getAnalysis(rec.id)).toBeUndefined();
    expect(await listAnalysesByWorkspace("ws-1")).toEqual([]);
  });
});
