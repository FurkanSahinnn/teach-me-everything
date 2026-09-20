// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chooseRechunkStrategy, runRechunk } from "./rechunk";
import { db } from "@/lib/db/schema";
import { fetchResearchContent } from "@/lib/research/ingest";
import { resolveResearchCredential } from "@/lib/research/credential";

vi.mock("@/lib/research/ingest", () => ({ fetchResearchContent: vi.fn() }));
vi.mock("@/lib/research/credential", () => ({ resolveResearchCredential: vi.fn() }));

describe("runRechunk", () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    await db.delete();
    await db.open();
    vi.mocked(resolveResearchCredential).mockImplementation(async (id) => `key-${id}`);
    vi.mocked(fetchResearchContent).mockResolvedValue({ sourceType: "url", displayUrl: "https://example.com",
      result: { url: "https://example.com", title: "Updated", markdown: "# Updated\n\nNew body.", providerId: "firecrawl", byteSize: 26 } });
  });
  afterEach(async () => { vi.restoreAllMocks(); await db.delete(); });

  async function source(id = "source", provider = "firecrawl") {
    await db.sources.put({ id, workspaceId: "workspace", title: id, type: "url", url: `https://example.com/${id}`,
      meta: { researchProvider: provider }, ingestStatus: "ready", embeddingStatus: "ready", createdAt: 1, updatedAt: 1 });
    await db.chunks.put({ id: `${id}-old`, sourceId: id, workspaceId: "workspace", index: 0,
      text: "Old body.", tokenCount: 3, createdAt: 1, embedding: new Float32Array([1]) });
  }

  it("resolves each source's provider key and replaces chunks atomically", async () => {
    await source("a", "firecrawl");
    await source("b", "exa");
    const report = await runRechunk("workspace");
    expect(report.failed).toEqual([]);
    expect(report.done).toHaveLength(2);
    for (const provider of ["firecrawl", "exa"]) {
      expect(fetchResearchContent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
        webProvider: provider, apiKey: `key-${provider}`,
      }));
    }
    expect(await db.chunks.get("a-old")).toBeUndefined();
    expect((await db.chunks.toArray()).every((c) => c.text.includes("New body") && !c.embedding)).toBe(true);
    expect((await db.sources.get("a"))?.embeddingStatus).toBe("missing");
  });

  it("keeps old chunks and vectors when fetching fails", async () => {
    await source();
    vi.mocked(fetchResearchContent).mockRejectedValue(new Error("missing key"));
    const report = await runRechunk("workspace");
    expect(report.failed[0]?.message).toBe("missing key");
    expect((await db.chunks.get("source-old"))?.embedding).toBeDefined();
    expect((await db.sources.get("source"))?.embeddingStatus).toBe("ready");
  });

  it("rolls back deletion and insertion if the status update fails", async () => {
    await source();
    vi.spyOn(db.sources, "update").mockRejectedValueOnce(new Error("storage failed"));
    const report = await runRechunk("workspace");
    expect(report.failed).toHaveLength(1);
    expect((await db.chunks.toArray()).map((c) => c.id)).toEqual(["source-old"]);
  });

  it("does not overwrite a source that starts embedding during the fetch", async () => {
    await source();
    const fetched = vi.mocked(fetchResearchContent).getMockImplementation()!;
    vi.mocked(fetchResearchContent).mockImplementation(async (...args) => {
      await db.sources.update("source", { embeddingStatus: "embedding" });
      return fetched(...args);
    });
    const report = await runRechunk("workspace");
    expect(report.failed[0]?.message).toContain("embedding");
    expect(await db.chunks.get("source-old")).toBeDefined();
  });

  it("honours cancellation after fetching, before deleting any rows", async () => {
    await source();
    const controller = new AbortController();
    const fetched = vi.mocked(fetchResearchContent).getMockImplementation()!;
    vi.mocked(fetchResearchContent).mockImplementation(async (...args) => {
      controller.abort();
      return fetched(...args);
    });
    expect((await runRechunk("workspace", { signal: controller.signal })).done).toEqual([]);
    expect(await db.chunks.get("source-old")).toBeDefined();
  });
});

describe("chooseRechunkStrategy", () => {
  it("rebuilds uploads from their stored blob", () => {
    expect(chooseRechunkStrategy({ type: "pdf" }, true)).toEqual({ strategy: "blob" });
    expect(chooseRechunkStrategy({ type: "md" }, true)).toEqual({ strategy: "blob" });
  });

  it("asks for a re-upload when the blob was never stored", () => {
    // txt/md uploads before 2026-09 did not persist the file.
    expect(chooseRechunkStrategy({ type: "md" }, false)).toEqual({
      strategy: "unsupported",
      reason: "no_blob",
    });
  });

  it("re-fetches research sources by URL", () => {
    expect(chooseRechunkStrategy({ type: "url", url: "https://x.test" }, false)).toEqual({
      strategy: "refetch",
    });
    expect(chooseRechunkStrategy({ type: "arxiv" }, false)).toEqual({
      strategy: "unsupported",
      reason: "no_url",
    });
  });

  it("re-reads note sources from the live note", () => {
    expect(chooseRechunkStrategy({ type: "note", noteId: "n1" }, false)).toEqual({
      strategy: "note",
    });
  });

  it("leaves formats it cannot re-parse alone", () => {
    expect(chooseRechunkStrategy({ type: "epub" }, true)).toEqual({
      strategy: "unsupported",
      reason: "type",
    });
  });
});
