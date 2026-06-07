// Pure tag-tree builder (Phase 6.6). Tags arrive as a flat list (or
// `Map<tag, count>` for sidebar usage); the UI needs nested structure so
// `#kimya/organik/halkalı` renders under a collapsible `#kimya` parent with
// child `organik` and grandchild `halkalı`. We keep this pure (no React,
// no Dexie) so every edge case (orphan parents, count rollup, locale sort)
// can be Vitest'ed without renderer overhead.

export type TagTreeNode = {
  /** Full tag path (lowercased), e.g. `"kimya/organik"`. Used as React key
   *  and as the active-tag-filter value. */
  fullPath: string;
  /** Just this level's label, e.g. `"organik"` for `kimya/organik`. */
  segment: string;
  /** Depth in the tree (0 = root). */
  depth: number;
  /** Notes tagged with this exact path (NOT rolled up from children). */
  directCount: number;
  /** Notes tagged with this path or any descendant. */
  totalCount: number;
  /** Child nodes, locale-sorted by `segment`. */
  children: TagTreeNode[];
};

export type BuildTagTreeOptions = {
  /** Map of `lowercasedTag → noteCount`. Tags coming from `extractTags`
   *  are already lowercased and deduplicated per note; the caller sums
   *  counts across the workspace. */
  tagCounts: ReadonlyMap<string, number>;
};

type Mutable = {
  fullPath: string;
  segment: string;
  depth: number;
  directCount: number;
  totalCount: number;
  children: Map<string, Mutable>;
};

function emptyNode(fullPath: string, segment: string, depth: number): Mutable {
  return {
    fullPath,
    segment,
    depth,
    directCount: 0,
    totalCount: 0,
    children: new Map(),
  };
}

/**
 * Build a hierarchical tag tree from a flat `tagCounts` map.
 *
 * Rules:
 *   • `kimya/organik` walks the path and creates intermediate nodes if
 *     they don't exist (their `directCount` stays 0; only their
 *     descendant subtree contributes to `totalCount`).
 *   • Empty segments (`#//foo`) are skipped — parser already rejects
 *     these, but defensive in case of stale data.
 *   • Sort: locale-aware by `segment`, ties broken by `fullPath` so the
 *     tree order is fully deterministic.
 *   • Counts are non-negative; a `0` count from the input is ignored.
 */
export function buildTagTree(opts: BuildTagTreeOptions): TagTreeNode[] {
  const root = new Map<string, Mutable>();

  for (const [tag, count] of opts.tagCounts.entries()) {
    if (count <= 0) continue;
    const segments = tag.split("/").filter((s) => s.length > 0);
    if (segments.length === 0) continue;

    let bucket = root;
    let pathSoFar = "";
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]!;
      pathSoFar = pathSoFar.length === 0 ? seg : `${pathSoFar}/${seg}`;
      let node = bucket.get(seg);
      if (!node) {
        node = emptyNode(pathSoFar, seg, i);
        bucket.set(seg, node);
      }
      node.totalCount += count;
      if (i === segments.length - 1) {
        node.directCount += count;
      }
      bucket = node.children;
    }
  }

  return finalize(root);
}

function finalize(bucket: Map<string, Mutable>): TagTreeNode[] {
  const out: TagTreeNode[] = [];
  for (const m of bucket.values()) {
    out.push({
      fullPath: m.fullPath,
      segment: m.segment,
      depth: m.depth,
      directCount: m.directCount,
      totalCount: m.totalCount,
      children: finalize(m.children),
    });
  }
  out.sort((a, b) => {
    const cmp = a.segment.localeCompare(b.segment);
    if (cmp !== 0) return cmp;
    return a.fullPath.localeCompare(b.fullPath);
  });
  return out;
}

/** True when the tree has no nodes at all. */
export function isTagTreeEmpty(tree: readonly TagTreeNode[]): boolean {
  return tree.length === 0;
}

/**
 * Aggregate `notes` into a `Map<tag, noteCount>` by counting how many
 * notes contain each tag (a tag listed twice on one note still counts
 * once because `extractTags` already deduplicates per note).
 */
export function aggregateTagCounts(
  notes: ReadonlyArray<{ tags: readonly string[] }>,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const n of notes) {
    const seen = new Set<string>();
    for (const raw of n.tags) {
      const tag = raw.toLowerCase().trim();
      if (tag.length === 0) continue;
      if (seen.has(tag)) continue;
      seen.add(tag);
      out.set(tag, (out.get(tag) ?? 0) + 1);
    }
  }
  return out;
}
