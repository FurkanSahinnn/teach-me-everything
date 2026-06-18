import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  RoadmapNodeRecord,
  RoadmapRecord,
} from "@/lib/roadmap/types";

const listRoadmapsByWorkspace =
  vi.fn<(ws: string) => Promise<RoadmapRecord[]>>();
const listRoadmapNodes =
  vi.fn<(id: string) => Promise<RoadmapNodeRecord[]>>();
const listCompleteRoadmapNodeIds =
  vi.fn<(id: string) => Promise<string[]>>();

vi.mock("@/lib/db/roadmaps", () => ({
  listRoadmapsByWorkspace: (ws: string) => listRoadmapsByWorkspace(ws),
  listRoadmapNodes: (id: string) => listRoadmapNodes(id),
  listCompleteRoadmapNodeIds: (id: string) => listCompleteRoadmapNodeIds(id),
}));

const { buildRoadmapContext } = await import("./roadmap");

function roadmap(partial: Partial<RoadmapRecord>): RoadmapRecord {
  return {
    id: partial.id ?? "rmp_1",
    workspaceId: "ws_1",
    title: partial.title ?? "Roadmap",
    topic: "topic",
    timeframe: partial.timeframe ?? "weekly",
    level: partial.level ?? "beginner",
    usedSources: false,
    model: "claude-sonnet-4-6",
    createdAt: 1,
    updatedAt: 1,
    ...partial,
  };
}

function node(partial: Partial<RoadmapNodeRecord>): RoadmapNodeRecord {
  return {
    id: partial.id ?? "rmn_1",
    roadmapId: "rmp_1",
    parentId: partial.parentId ?? null,
    depth: partial.depth ?? 0,
    title: partial.title ?? "Node",
    description: partial.description ?? "",
    status: partial.status ?? "todo",
    createdAt: partial.createdAt ?? 1,
    updatedAt: 1,
    ...partial,
  };
}

beforeEach(() => {
  listRoadmapsByWorkspace.mockReset();
  listRoadmapNodes.mockReset();
  listCompleteRoadmapNodeIds.mockReset();
});

describe("buildRoadmapContext", () => {
  it("returns null when there is no roadmap", async () => {
    listRoadmapsByWorkspace.mockResolvedValue([]);
    await expect(buildRoadmapContext("ws_1")).resolves.toBeNull();
  });

  it("returns null when the active roadmap has no nodes", async () => {
    listRoadmapsByWorkspace.mockResolvedValue([roadmap({})]);
    listRoadmapNodes.mockResolvedValue([]);
    listCompleteRoadmapNodeIds.mockResolvedValue([]);
    await expect(buildRoadmapContext("ws_1")).resolves.toBeNull();
  });

  it("annotates done / next / todo and counts progress", async () => {
    listRoadmapsByWorkspace.mockResolvedValue([
      roadmap({ id: "rmp_1", title: "ML Basics" }),
    ]);
    listRoadmapNodes.mockResolvedValue([
      node({ id: "n1", title: "Linear Algebra", createdAt: 1 }),
      node({ id: "n2", title: "Calculus", createdAt: 2, parentId: "n1" }),
      node({ id: "n3", title: "Gradient Descent", createdAt: 3, parentId: "n2" }),
    ]);
    // n1 is complete; n2's prereq (n1) is done so n2 is "next".
    listCompleteRoadmapNodeIds.mockResolvedValue(["n1"]);

    const block = await buildRoadmapContext("ws_1");
    expect(block?.kind).toBe("roadmap");
    expect(block?.text).toContain('"ML Basics"');
    expect(block?.text).toContain("1/3 done");
    expect(block?.text).toContain("[done] Linear Algebra");
    expect(block?.text).toContain("[next] Calculus");
    expect(block?.text).toContain("[todo] Gradient Descent");
  });

  it("uses the newest roadmap (index 0 of the newest-first list)", async () => {
    listRoadmapsByWorkspace.mockResolvedValue([
      roadmap({ id: "rmp_new", title: "Newest" }),
      roadmap({ id: "rmp_old", title: "Older" }),
    ]);
    listRoadmapNodes.mockResolvedValue([node({ id: "n1", title: "Topic" })]);
    listCompleteRoadmapNodeIds.mockResolvedValue([]);
    await buildRoadmapContext("ws_1");
    expect(listRoadmapNodes).toHaveBeenCalledWith("rmp_new");
  });
});
