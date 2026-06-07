import { describe, expect, it } from "vitest";
import {
  findRenameCandidates,
  type RenameCandidate,
} from "./rename-detect";
import type { PathIndex } from "./reconcile";
import type { VaultWatchEvent } from "./watcher";

function mkIndex(entries: Array<[string, string]>): PathIndex {
  return new Map(entries);
}

describe("vault/rename-detect findRenameCandidates", () => {
  it("pairs an indexed remove with an orphan create", () => {
    const events: VaultWatchEvent[] = [
      { kind: "remove", path: "/v/Old.md" },
      { kind: "create", path: "/v/New.md" },
    ];
    const idx = mkIndex([["/v/Old.md", "n1"]]);
    const { candidates, leftover } = findRenameCandidates(events, idx);
    expect(candidates).toEqual<RenameCandidate[]>([
      {
        remove: { kind: "remove", path: "/v/Old.md" },
        create: { kind: "create", path: "/v/New.md" },
        noteId: "n1",
      },
    ]);
    expect(leftover).toEqual([]);
  });

  it("ignores a remove with no path-index entry (must fall through to delete)", () => {
    const events: VaultWatchEvent[] = [
      { kind: "remove", path: "/v/Ghost.md" },
      { kind: "create", path: "/v/Fresh.md" },
    ];
    const { candidates, leftover } = findRenameCandidates(events, new Map());
    expect(candidates).toEqual([]);
    expect(leftover).toEqual(events);
  });

  it("ignores a create whose path is already indexed (defer to standard flow)", () => {
    const events: VaultWatchEvent[] = [
      { kind: "remove", path: "/v/Old.md" },
      { kind: "create", path: "/v/Existing.md" },
    ];
    const idx = mkIndex([
      ["/v/Old.md", "n1"],
      ["/v/Existing.md", "n-other"],
    ]);
    const { candidates, leftover } = findRenameCandidates(events, idx);
    expect(candidates).toEqual([]);
    expect(leftover).toEqual(events);
  });

  it("greedy first-match when multiple creates could pair with one remove", () => {
    const events: VaultWatchEvent[] = [
      { kind: "remove", path: "/v/Old.md" },
      { kind: "create", path: "/v/First.md" },
      { kind: "create", path: "/v/Second.md" },
    ];
    const idx = mkIndex([["/v/Old.md", "n1"]]);
    const { candidates, leftover } = findRenameCandidates(events, idx);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.create.path).toBe("/v/First.md");
    expect(leftover).toEqual([{ kind: "create", path: "/v/Second.md" }]);
  });

  it("pairs each remove with a distinct create when multiple renames happen at once", () => {
    const events: VaultWatchEvent[] = [
      { kind: "remove", path: "/v/A.md" },
      { kind: "remove", path: "/v/B.md" },
      { kind: "create", path: "/v/A2.md" },
      { kind: "create", path: "/v/B2.md" },
    ];
    const idx = mkIndex([
      ["/v/A.md", "n-a"],
      ["/v/B.md", "n-b"],
    ]);
    const { candidates, leftover } = findRenameCandidates(events, idx);
    expect(candidates).toHaveLength(2);
    expect(candidates[0]).toMatchObject({
      remove: { path: "/v/A.md" },
      create: { path: "/v/A2.md" },
      noteId: "n-a",
    });
    expect(candidates[1]).toMatchObject({
      remove: { path: "/v/B.md" },
      create: { path: "/v/B2.md" },
      noteId: "n-b",
    });
    expect(leftover).toEqual([]);
  });

  it("only matches markdown paths (non-`.md` files never participate)", () => {
    const events: VaultWatchEvent[] = [
      { kind: "remove", path: "/v/Old.txt" },
      { kind: "create", path: "/v/New.txt" },
    ];
    const idx = mkIndex([["/v/Old.txt", "n1"]]);
    const { candidates, leftover } = findRenameCandidates(events, idx);
    expect(candidates).toEqual([]);
    expect(leftover).toEqual(events);
  });

  it("leftover preserves modify/other events alongside unmatched pairs", () => {
    const events: VaultWatchEvent[] = [
      { kind: "modify", path: "/v/Live.md" },
      { kind: "remove", path: "/v/Old.md" },
      { kind: "create", path: "/v/New.md" },
      { kind: "other", path: "/v/x" },
    ];
    const idx = mkIndex([
      ["/v/Live.md", "n-live"],
      ["/v/Old.md", "n-old"],
    ]);
    const { candidates, leftover } = findRenameCandidates(events, idx);
    expect(candidates).toHaveLength(1);
    expect(leftover).toEqual([
      { kind: "modify", path: "/v/Live.md" },
      { kind: "other", path: "/v/x" },
    ]);
  });

  it("handles an empty batch", () => {
    expect(findRenameCandidates([], new Map())).toEqual({
      candidates: [],
      leftover: [],
    });
  });

  it("a lonely remove without a matching create stays in leftover", () => {
    const events: VaultWatchEvent[] = [
      { kind: "remove", path: "/v/Old.md" },
    ];
    const idx = mkIndex([["/v/Old.md", "n1"]]);
    const { candidates, leftover } = findRenameCandidates(events, idx);
    expect(candidates).toEqual([]);
    expect(leftover).toEqual(events);
  });

  it("a lonely create without a matching remove stays in leftover", () => {
    const events: VaultWatchEvent[] = [
      { kind: "create", path: "/v/Fresh.md" },
    ];
    const { candidates, leftover } = findRenameCandidates(events, new Map());
    expect(candidates).toEqual([]);
    expect(leftover).toEqual(events);
  });
});
