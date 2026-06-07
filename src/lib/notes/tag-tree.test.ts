import { describe, expect, it } from "vitest";
import {
  aggregateTagCounts,
  buildTagTree,
  isTagTreeEmpty,
  type TagTreeNode,
} from "./tag-tree";

function findNode(tree: readonly TagTreeNode[], path: string): TagTreeNode | null {
  for (const node of tree) {
    if (node.fullPath === path) return node;
    const found = findNode(node.children, path);
    if (found) return found;
  }
  return null;
}

describe("buildTagTree", () => {
  it("returns an empty tree for an empty count map", () => {
    const tree = buildTagTree({ tagCounts: new Map() });
    expect(tree).toEqual([]);
    expect(isTagTreeEmpty(tree)).toBe(true);
  });

  it("renders a flat list of single-level tags sorted locale-aware", () => {
    const tree = buildTagTree({
      tagCounts: new Map([
        ["zeta", 1],
        ["alpha", 2],
        ["mü", 3],
      ]),
    });
    expect(tree.map((n) => n.fullPath)).toEqual(["alpha", "mü", "zeta"]);
    expect(tree[0]?.directCount).toBe(2);
    expect(tree[0]?.totalCount).toBe(2);
    expect(tree[0]?.depth).toBe(0);
    expect(tree[0]?.children).toEqual([]);
  });

  it("nests a two-level tag under its parent and aggregates totals", () => {
    const tree = buildTagTree({
      tagCounts: new Map([["kimya/organik", 4]]),
    });
    expect(tree).toHaveLength(1);
    const parent = tree[0]!;
    expect(parent.fullPath).toBe("kimya");
    expect(parent.directCount).toBe(0);
    expect(parent.totalCount).toBe(4);
    expect(parent.children).toHaveLength(1);
    const child = parent.children[0]!;
    expect(child.fullPath).toBe("kimya/organik");
    expect(child.directCount).toBe(4);
    expect(child.totalCount).toBe(4);
    expect(child.depth).toBe(1);
  });

  it("merges sibling leaves under a shared parent", () => {
    const tree = buildTagTree({
      tagCounts: new Map([
        ["kimya/organik", 2],
        ["kimya/anorganik", 3],
      ]),
    });
    const parent = tree[0]!;
    expect(parent.fullPath).toBe("kimya");
    expect(parent.totalCount).toBe(5);
    expect(parent.children.map((c) => c.fullPath)).toEqual([
      "kimya/anorganik",
      "kimya/organik",
    ]);
  });

  it("aggregates totals up three levels", () => {
    const tree = buildTagTree({
      tagCounts: new Map([
        ["kimya/organik/halkalı", 2],
        ["kimya/organik/zincir", 5],
      ]),
    });
    const kimya = tree[0]!;
    expect(kimya.totalCount).toBe(7);
    expect(kimya.directCount).toBe(0);
    const organik = kimya.children[0]!;
    expect(organik.totalCount).toBe(7);
    expect(organik.directCount).toBe(0);
    expect(organik.children.map((c) => c.fullPath)).toEqual([
      "kimya/organik/halkalı",
      "kimya/organik/zincir",
    ]);
  });

  it("keeps both direct count and rolled-up total when a parent has its own count", () => {
    const tree = buildTagTree({
      tagCounts: new Map([
        ["kimya", 4],
        ["kimya/organik", 3],
      ]),
    });
    const kimya = tree[0]!;
    expect(kimya.fullPath).toBe("kimya");
    expect(kimya.directCount).toBe(4);
    expect(kimya.totalCount).toBe(7);
    const organik = kimya.children[0]!;
    expect(organik.directCount).toBe(3);
    expect(organik.totalCount).toBe(3);
  });

  it("ignores zero and negative counts entirely", () => {
    const tree = buildTagTree({
      tagCounts: new Map([
        ["foo", 0],
        ["bar", -1],
        ["baz", 1],
      ]),
    });
    expect(tree.map((n) => n.fullPath)).toEqual(["baz"]);
  });

  it("skips empty path segments like //foo or trailing slash", () => {
    const tree = buildTagTree({
      tagCounts: new Map([
        ["//foo", 1],
        ["bar//", 1],
        ["a//b", 1],
      ]),
    });
    expect(findNode(tree, "foo")).not.toBeNull();
    expect(findNode(tree, "bar")).not.toBeNull();
    const a = findNode(tree, "a")!;
    expect(a.children.map((c) => c.fullPath)).toEqual(["a/b"]);
  });

  it("produces deterministic order — locale segment then fullPath tiebreak", () => {
    const tree = buildTagTree({
      tagCounts: new Map([
        ["x/b", 1],
        ["x/a", 1],
        ["x/c/inner", 1],
      ]),
    });
    const x = tree[0]!;
    expect(x.children.map((c) => c.fullPath)).toEqual(["x/a", "x/b", "x/c"]);
  });
});

describe("aggregateTagCounts", () => {
  it("counts each tag once per note even if listed multiple times", () => {
    const counts = aggregateTagCounts([
      { tags: ["foo", "bar", "foo"] },
      { tags: ["bar"] },
    ]);
    expect(counts.get("foo")).toBe(1);
    expect(counts.get("bar")).toBe(2);
  });

  it("lowercases and trims tags so case mismatches still merge", () => {
    const counts = aggregateTagCounts([
      { tags: ["KIMYA", " kimya "] },
      { tags: ["Kimya"] },
    ]);
    expect(counts.get("kimya")).toBe(2);
  });

  it("ignores empty tag strings without crashing", () => {
    const counts = aggregateTagCounts([{ tags: ["", " ", "foo"] }]);
    expect(counts.size).toBe(1);
    expect(counts.get("foo")).toBe(1);
  });
});
