import { describe, expect, it } from "vitest";
import { expandFolderRemoves } from "./cascade";
import type { PathIndex } from "./reconcile";
import type { VaultWatchEvent } from "./watcher";

function mkIndex(entries: Array<[string, string]>): PathIndex {
  return new Map(entries);
}

describe("vault/cascade expandFolderRemoves", () => {
  it("passes a markdown remove event through unchanged", () => {
    const events: VaultWatchEvent[] = [
      { kind: "remove", path: "/v/Hello.md" },
    ];
    const idx = mkIndex([["/v/Hello.md", "n1"]]);
    expect(expandFolderRemoves(events, idx)).toEqual(events);
  });

  it("expands a folder remove into one synthetic remove per indexed child", () => {
    const events: VaultWatchEvent[] = [{ kind: "remove", path: "/v/Sub" }];
    const idx = mkIndex([
      ["/v/Sub/A.md", "n1"],
      ["/v/Sub/B.md", "n2"],
      ["/v/Sub/C.md", "n3"],
      ["/v/Root.md", "n4"],
    ]);
    const out = expandFolderRemoves(events, idx);
    expect(out).toEqual([
      { kind: "remove", path: "/v/Sub/A.md" },
      { kind: "remove", path: "/v/Sub/B.md" },
      { kind: "remove", path: "/v/Sub/C.md" },
    ]);
  });

  it("does not match prefix-only collisions (Sub vs Subscript)", () => {
    const events: VaultWatchEvent[] = [{ kind: "remove", path: "/v/Sub" }];
    const idx = mkIndex([
      ["/v/Subscript.md", "n1"],
      ["/v/Sub/Real.md", "n2"],
    ]);
    expect(expandFolderRemoves(events, idx)).toEqual([
      { kind: "remove", path: "/v/Sub/Real.md" },
    ]);
  });

  it("handles nested folder hierarchies", () => {
    const events: VaultWatchEvent[] = [{ kind: "remove", path: "/v/Parent" }];
    const idx = mkIndex([
      ["/v/Parent/A.md", "n1"],
      ["/v/Parent/Child/B.md", "n2"],
      ["/v/Parent/Child/GrandChild/C.md", "n3"],
    ]);
    expect(expandFolderRemoves(events, idx)).toEqual([
      { kind: "remove", path: "/v/Parent/A.md" },
      { kind: "remove", path: "/v/Parent/Child/B.md" },
      { kind: "remove", path: "/v/Parent/Child/GrandChild/C.md" },
    ]);
  });

  it("normalises separators so Windows folder paths match POSIX-indexed children", () => {
    const events: VaultWatchEvent[] = [
      { kind: "remove", path: "C:\\v\\Sub" },
    ];
    const idx = mkIndex([
      ["C:/v/Sub/A.md", "n1"],
      ["C:/v/Sub/B.md", "n2"],
    ]);
    expect(expandFolderRemoves(events, idx)).toEqual([
      { kind: "remove", path: "C:/v/Sub/A.md" },
      { kind: "remove", path: "C:/v/Sub/B.md" },
    ]);
  });

  it("drops a non-`.md` remove event with no matching indexed children", () => {
    const events: VaultWatchEvent[] = [
      { kind: "remove", path: "/v/Stale" },
    ];
    const idx = mkIndex([["/v/Other.md", "n1"]]);
    expect(expandFolderRemoves(events, idx)).toEqual([]);
  });

  it("dedupes when a folder remove + an explicit child remove arrive together", () => {
    const events: VaultWatchEvent[] = [
      { kind: "remove", path: "/v/Sub" },
      { kind: "remove", path: "/v/Sub/A.md" },
    ];
    const idx = mkIndex([
      ["/v/Sub/A.md", "n1"],
      ["/v/Sub/B.md", "n2"],
    ]);
    expect(expandFolderRemoves(events, idx)).toEqual([
      { kind: "remove", path: "/v/Sub/A.md" },
      { kind: "remove", path: "/v/Sub/B.md" },
    ]);
  });

  it("passes non-remove events through untouched", () => {
    const events: VaultWatchEvent[] = [
      { kind: "create", path: "/v/Hello.md" },
      { kind: "modify", path: "/v/Hello.md" },
      { kind: "other", path: "/v/Hello.md" },
    ];
    const idx = mkIndex([["/v/Hello.md", "n1"]]);
    expect(expandFolderRemoves(events, idx)).toEqual(events);
  });

  it("preserves order: pass-throughs, then expanded children", () => {
    const events: VaultWatchEvent[] = [
      { kind: "modify", path: "/v/Top.md" },
      { kind: "remove", path: "/v/Sub" },
      { kind: "create", path: "/v/New.md" },
    ];
    const idx = mkIndex([
      ["/v/Top.md", "n1"],
      ["/v/Sub/A.md", "n2"],
    ]);
    expect(expandFolderRemoves(events, idx)).toEqual([
      { kind: "modify", path: "/v/Top.md" },
      { kind: "remove", path: "/v/Sub/A.md" },
      { kind: "create", path: "/v/New.md" },
    ]);
  });

  it("empty input returns an empty array", () => {
    expect(expandFolderRemoves([], new Map())).toEqual([]);
  });

  it("idempotent on an already-expanded batch", () => {
    const events: VaultWatchEvent[] = [
      { kind: "remove", path: "/v/Sub/A.md" },
      { kind: "remove", path: "/v/Sub/B.md" },
    ];
    const idx = mkIndex([
      ["/v/Sub/A.md", "n1"],
      ["/v/Sub/B.md", "n2"],
    ]);
    expect(expandFolderRemoves(events, idx)).toEqual(events);
  });
});
