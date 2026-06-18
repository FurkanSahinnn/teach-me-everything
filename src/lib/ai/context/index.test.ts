import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ContextBlock } from "./types";

const buildNotesContext = vi.fn<() => Promise<ContextBlock | null>>();
const buildConceptsContext = vi.fn<() => Promise<ContextBlock | null>>();
const buildRoadmapContext = vi.fn<() => Promise<ContextBlock | null>>();
const buildPerformanceContext = vi.fn<() => Promise<ContextBlock | null>>();

vi.mock("./notes", () => ({ buildNotesContext: () => buildNotesContext() }));
vi.mock("./concepts", () => ({
  buildConceptsContext: () => buildConceptsContext(),
}));
vi.mock("./roadmap", () => ({
  buildRoadmapContext: () => buildRoadmapContext(),
}));
vi.mock("./performance", () => ({
  buildPerformanceContext: () => buildPerformanceContext(),
}));

const { gatherContextBlocks } = await import("./index");

beforeEach(() => {
  buildNotesContext.mockReset().mockResolvedValue({ kind: "notes", text: "N" });
  buildConceptsContext
    .mockReset()
    .mockResolvedValue({ kind: "concepts", text: "C" });
  buildRoadmapContext
    .mockReset()
    .mockResolvedValue({ kind: "roadmap", text: "R" });
  buildPerformanceContext
    .mockReset()
    .mockResolvedValue({ kind: "performance", text: "P" });
});

describe("gatherContextBlocks", () => {
  it("ignores sources and web scopes (no prose block produced)", async () => {
    const blocks = await gatherContextBlocks("ws_1", ["sources", "web"]);
    expect(blocks).toEqual([]);
    expect(buildNotesContext).not.toHaveBeenCalled();
  });

  it("dispatches only the toggled scopes", async () => {
    const blocks = await gatherContextBlocks("ws_1", ["sources", "notes"]);
    expect(blocks.map((b) => b.kind)).toEqual(["notes"]);
    expect(buildConceptsContext).not.toHaveBeenCalled();
  });

  it("emits in canonical order regardless of toggle order", async () => {
    const blocks = await gatherContextBlocks("ws_1", [
      "performance",
      "roadmap",
      "concepts",
      "notes",
    ]);
    expect(blocks.map((b) => b.kind)).toEqual([
      "notes",
      "concepts",
      "roadmap",
      "performance",
    ]);
  });

  it("drops builders that return null", async () => {
    buildConceptsContext.mockResolvedValue(null);
    const blocks = await gatherContextBlocks("ws_1", [
      "notes",
      "concepts",
      "roadmap",
    ]);
    expect(blocks.map((b) => b.kind)).toEqual(["notes", "roadmap"]);
  });

  it("returns an empty array when no prose scopes are active", async () => {
    await expect(gatherContextBlocks("ws_1", [])).resolves.toEqual([]);
  });
});
