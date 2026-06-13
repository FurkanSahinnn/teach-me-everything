import { describe, it, expect } from "vitest";
import { resolveRouteParams } from "./route-params";

describe("resolveRouteParams", () => {
  it("recovers the workspace id from the pathname when useParams is the placeholder", () => {
    expect(resolveRouteParams({ id: "_" }, "/w/ws-real/")).toEqual({
      id: "ws-real",
    });
  });

  it("recovers id when useParams is missing entirely", () => {
    expect(resolveRouteParams({}, "/w/ws-real")).toEqual({ id: "ws-real" });
  });

  it("recovers the workspace id from a static shell query param", () => {
    expect(resolveRouteParams({ id: "_" }, "/w/_", "workspaceId=ws-real")).toEqual({
      id: "ws-real",
    });
  });

  it("keeps a real useParams id in dev (no override needed)", () => {
    expect(resolveRouteParams({ id: "ws-dev" }, "/w/ws-dev/cards/")).toEqual({
      id: "ws-dev",
    });
  });

  it("does NOT override a real param even if the path looks like the shell", () => {
    // Defensive: a real value always wins; only `_`/missing triggers recovery.
    expect(resolveRouteParams({ id: "ws-dev" }, "/w/_/cards")).toEqual({
      id: "ws-dev",
    });
  });

  it("recovers a deep sourceId after /read/", () => {
    expect(
      resolveRouteParams({ id: "_", sourceId: "_" }, "/w/ws1/read/src-9/"),
    ).toEqual({ id: "ws1", sourceId: "src-9" });
  });

  it("recovers deep params from static shell query params", () => {
    expect(
      resolveRouteParams(
        { id: "_", sourceId: "_" },
        "/w/_/read/_/",
        "workspaceId=ws1&sourceId=src-9",
      ),
    ).toEqual({ id: "ws1", sourceId: "src-9" });
  });

  it("recovers a deep roadmapId after /roadmap/", () => {
    expect(
      resolveRouteParams({ id: "_", roadmapId: "_" }, "/w/ws1/roadmap/rm-2"),
    ).toEqual({ id: "ws1", roadmapId: "rm-2" });
  });

  it("recovers a deep lessonId after /study/", () => {
    expect(
      resolveRouteParams({ id: "_", lessonId: "_" }, "/w/ws1/study/les-3"),
    ).toEqual({ id: "ws1", lessonId: "les-3" });
  });

  it("recovers a deep podcastId after /audio/", () => {
    expect(
      resolveRouteParams({ id: "_", podcastId: "_" }, "/w/ws1/audio/pod-4"),
    ).toEqual({ id: "ws1", podcastId: "pod-4" });
  });

  it("treats /study/journal (a static sibling route) without breaking the id", () => {
    // journal is a static route, not a lessonId — id recovery must still work.
    expect(resolveRouteParams({ id: "_" }, "/w/ws1/study/journal")).toEqual({
      id: "ws1",
    });
  });

  it("does not recover journal as a lessonId", () => {
    expect(
      resolveRouteParams(
        { id: "_", lessonId: "_" },
        "/w/ws1/study/journal",
      ),
    ).toEqual({ id: "ws1", lessonId: "_" });
  });

  it("recovers the setup step", () => {
    expect(resolveRouteParams({ step: "_" }, "/setup/3/")).toEqual({
      step: "3",
    });
  });

  it("passes through untouched on non-dynamic routes", () => {
    expect(resolveRouteParams({}, "/dashboard")).toEqual({});
    expect(resolveRouteParams({}, "/settings/")).toEqual({});
  });

  it("collapses array-valued params to their first entry", () => {
    expect(resolveRouteParams({ id: ["a", "b"] }, "/w/a")).toEqual({ id: "a" });
  });

  it("handles the placeholder shell url itself (no real workspace)", () => {
    // /w/_/ with placeholder param stays `_` (there is no real id in the URL).
    expect(resolveRouteParams({ id: "_" }, "/w/_/")).toEqual({ id: "_" });
  });
});
