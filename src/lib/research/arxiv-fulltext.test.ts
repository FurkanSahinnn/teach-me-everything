import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bulkAddChunks, listChunksBySource } from "@/lib/db/chunks";
import { createSource, getSource } from "@/lib/db/sources";
import { db } from "@/lib/db/schema";

const fetchMock = vi.fn();
const parseMock = vi.fn();
vi.mock("@/lib/tauri/fetch", () => ({ smartFetch: (...args: unknown[]) => fetchMock(...args) }));
vi.mock("@/lib/ingest/pdf", () => ({ parsePdf: (...args: unknown[]) => parseMock(...args) }));
vi.mock("@/lib/db/source-blobs", () => ({ saveSourceBlob: vi.fn() }));

const { ensureArxivFullText } = await import("./arxiv-fulltext");

beforeEach(async () => {
  await db.delete();
  await db.open();
  fetchMock.mockReset();
  parseMock.mockReset();
});
afterEach(async () => { await db.delete(); });

describe("arXiv full text upgrade", () => {
  it("appends PDF pages to an abstract source and preserves old citation IDs", async () => {
    const source = await createSource({ workspaceId: "ws", type: "arxiv", title: "Paper", ingestStatus: "ready", meta: { extractor: "arxiv-api", arxivId: "2509.05691v1" } });
    const [abstract] = await bulkAddChunks([{ sourceId: source.id, workspaceId: "ws", index: 0, text: "Abstract only", tokenCount: 3 }]);
    fetchMock.mockResolvedValue(new Response(new Blob(["%PDF-fake"], { type: "application/pdf" }), { status: 200 }));
    parseMock.mockReturnValue({ promise: Promise.resolve({
      meta: { pageCount: 2, byteSize: 9, contentHash: "hash" },
      chunks: [{ index: 0, text: "Full methods and experimental results", tokenCount: 8, page: 2 }],
    }), cancel: vi.fn() });

    const chunks = await ensureArxivFullText(source, await listChunksBySource(source.id));
    expect(fetchMock).toHaveBeenCalledWith("https://arxiv.org/pdf/2509.05691v1", {});
    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.id).toBe(abstract?.id);
    expect(chunks[1]).toMatchObject({ index: 1, page: 2 });
    expect((await getSource(source.id))?.meta?.extractor).toBe("arxiv-pdf");
    expect((await getSource(source.id))?.embeddingStatus).toBe("missing");
    await ensureArxivFullText((await getSource(source.id))!, chunks);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not replace the abstract when the download is not a PDF", async () => {
    const source = await createSource({ workspaceId: "ws", type: "arxiv", title: "Paper", ingestStatus: "ready", meta: { extractor: "arxiv-api", arxivId: "2509.05691" } });
    await bulkAddChunks([{ sourceId: source.id, workspaceId: "ws", index: 0, text: "Abstract only", tokenCount: 3 }]);
    fetchMock.mockResolvedValue(new Response("<html>error</html>", { status: 200 }));
    await expect(ensureArxivFullText(source, await listChunksBySource(source.id))).rejects.toThrow("did not return a PDF");
    expect(await listChunksBySource(source.id)).toHaveLength(1);
    expect((await getSource(source.id))?.meta?.extractor).toBe("arxiv-api");
  });
});
