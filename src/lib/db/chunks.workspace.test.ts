import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bulkAddChunks, listChunksByWorkspace } from "./chunks";
import { db } from "./schema";

beforeEach(async () => {
  await db.delete();
  await db.open();
});

afterEach(async () => {
  await db.delete();
});

describe("listChunksByWorkspace", () => {
  it("returns every chunk across all sources in the workspace", async () => {
    await bulkAddChunks([
      { sourceId: "src-a", workspaceId: "ws-1", index: 0, text: "a0", tokenCount: 2 },
      { sourceId: "src-a", workspaceId: "ws-1", index: 1, text: "a1", tokenCount: 2 },
      { sourceId: "src-b", workspaceId: "ws-1", index: 0, text: "b0", tokenCount: 2 },
    ]);

    const got = await listChunksByWorkspace("ws-1");
    expect(got).toHaveLength(3);
    expect(got.map((c) => c.text).sort()).toEqual(["a0", "a1", "b0"]);
  });

  it("excludes chunks from other workspaces", async () => {
    await bulkAddChunks([
      { sourceId: "src-a", workspaceId: "ws-1", index: 0, text: "keep", tokenCount: 1 },
      { sourceId: "src-z", workspaceId: "ws-2", index: 0, text: "drop", tokenCount: 1 },
    ]);

    const got = await listChunksByWorkspace("ws-1");
    expect(got).toHaveLength(1);
    expect(got[0]?.text).toBe("keep");
  });

  it("sorts by (sourceId, index) for stable in-document re-grouping", async () => {
    // Insert out of order across two sources; the helper must return a stable
    // (sourceId asc, index asc) ordering so the runner can re-group retrieved
    // chunks back by source without re-sorting the whole set.
    await bulkAddChunks([
      { sourceId: "src-b", workspaceId: "ws-1", index: 1, text: "b1", tokenCount: 1 },
      { sourceId: "src-a", workspaceId: "ws-1", index: 2, text: "a2", tokenCount: 1 },
      { sourceId: "src-b", workspaceId: "ws-1", index: 0, text: "b0", tokenCount: 1 },
      { sourceId: "src-a", workspaceId: "ws-1", index: 0, text: "a0", tokenCount: 1 },
    ]);

    const got = await listChunksByWorkspace("ws-1");
    expect(got.map((c) => c.text)).toEqual(["a0", "a2", "b0", "b1"]);
  });

  it("returns an empty array for a workspace with no chunks", async () => {
    expect(await listChunksByWorkspace("ws-empty")).toEqual([]);
  });
});
