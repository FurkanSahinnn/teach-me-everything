import { describe, expect, it } from "vitest";
import {
  buildNoteTree,
  DND_MIME_FOLDER,
  DND_MIME_NOTE,
  isDropForbidden,
  isTreeEmpty,
  normalizeSearch,
  readDragPayload,
  setDragPayload,
} from "./tree";
import type { NoteFolderRecord, NoteRecord } from "@/lib/db/types";

function folder(
  id: string,
  parentId: string | null,
  name: string,
  workspaceId = "ws1",
): NoteFolderRecord {
  return {
    id,
    workspaceId,
    parentId,
    name,
    path: name,
    createdAt: 0,
  };
}

function note(
  id: string,
  folderId: string | null,
  title: string,
  content = "",
  workspaceId = "ws1",
): NoteRecord {
  return {
    id,
    workspaceId,
    folderId,
    title,
    content,
    tags: [],
    wikilinks: [],
    path: title,
    createdAt: 0,
    updatedAt: 0,
  };
}

describe("normalizeSearch", () => {
  it("lowercases and trims", () => {
    expect(normalizeSearch("  HeLLo  ")).toBe("hello");
  });

  it("returns empty string for undefined and whitespace", () => {
    expect(normalizeSearch(undefined)).toBe("");
    expect(normalizeSearch("   ")).toBe("");
  });
});

describe("buildNoteTree", () => {
  it("returns empty buckets for empty inputs", () => {
    const tree = buildNoteTree({
      folders: [],
      notes: [],
      expandedFolderIds: new Set(),
    });
    expect(tree.folders).toEqual([]);
    expect(tree.notes).toEqual([]);
    expect(isTreeEmpty(tree)).toBe(true);
  });

  it("groups root folders + notes alphabetically and respects expanded state", () => {
    const tree = buildNoteTree({
      folders: [folder("f-b", null, "Beta"), folder("f-a", null, "Alpha")],
      notes: [note("n-z", null, "Zeta"), note("n-a", null, "Apple")],
      expandedFolderIds: new Set(["f-b"]),
    });
    expect(tree.folders.map((f) => f.name)).toEqual(["Alpha", "Beta"]);
    expect(tree.folders[0]!.expanded).toBe(false);
    expect(tree.folders[1]!.expanded).toBe(true);
    expect(tree.notes.map((n) => n.title)).toEqual(["Apple", "Zeta"]);
    expect(isTreeEmpty(tree)).toBe(false);
  });

  it("nests child folders + notes under their parent with depth", () => {
    const tree = buildNoteTree({
      folders: [
        folder("f-root", null, "Root"),
        folder("f-child", "f-root", "Child"),
      ],
      notes: [note("n-1", "f-child", "Nested")],
      expandedFolderIds: new Set(["f-root", "f-child"]),
    });
    expect(tree.folders).toHaveLength(1);
    const root = tree.folders[0]!;
    expect(root.depth).toBe(0);
    expect(root.children).toHaveLength(1);
    const child = root.children[0]!;
    expect(child.kind).toBe("folder");
    if (child.kind !== "folder") return;
    expect(child.depth).toBe(1);
    expect(child.notes).toHaveLength(1);
    expect(child.notes[0]!.depth).toBe(2);
  });

  it("rescues orphan folders (parentId points at missing folder) to root", () => {
    const tree = buildNoteTree({
      folders: [folder("f-orphan", "f-missing", "Orphan")],
      notes: [],
      expandedFolderIds: new Set(),
    });
    expect(tree.folders).toHaveLength(1);
    expect(tree.folders[0]!.name).toBe("Orphan");
  });

  it("rescues orphan notes (folderId points at missing folder) to root", () => {
    const tree = buildNoteTree({
      folders: [],
      notes: [note("n-orphan", "f-missing", "Orphan note")],
      expandedFolderIds: new Set(),
    });
    expect(tree.notes).toHaveLength(1);
    expect(tree.notes[0]!.title).toBe("Orphan note");
  });

  it("filters by search query (case-insensitive) on title and content", () => {
    const tree = buildNoteTree({
      folders: [],
      notes: [
        note("n-1", null, "Apple"),
        note("n-2", null, "Banana", "rich content about Apple inside body"),
        note("n-3", null, "Carrot"),
      ],
      expandedFolderIds: new Set(),
      searchQuery: "apple",
    });
    expect(tree.notes.map((n) => n.title)).toEqual(["Apple", "Banana"]);
  });

  it("hides folders with no matching descendants when searching", () => {
    const tree = buildNoteTree({
      folders: [
        folder("f-1", null, "Useful"),
        folder("f-2", null, "Random"),
      ],
      notes: [
        note("n-1", "f-1", "Apple report"),
        note("n-2", "f-2", "Carrot"),
      ],
      expandedFolderIds: new Set(),
      searchQuery: "apple",
    });
    expect(tree.folders).toHaveLength(1);
    expect(tree.folders[0]!.name).toBe("Useful");
    // Search forces expansion so the matching note is visible without click.
    expect(tree.folders[0]!.expanded).toBe(true);
    expect(tree.folders[0]!.notes.map((n) => n.title)).toEqual([
      "Apple report",
    ]);
  });

  it("keeps a folder when its own name matches even if children don't", () => {
    const tree = buildNoteTree({
      folders: [folder("f-1", null, "Apples")],
      notes: [note("n-1", "f-1", "Carrot")],
      expandedFolderIds: new Set(),
      searchQuery: "apple",
    });
    expect(tree.folders).toHaveLength(1);
    // Folder matched but no child matched → folder is shown but its notes
    // list is empty for the search.
    expect(tree.folders[0]!.notes).toHaveLength(0);
  });

  it("breaks name ties by id for deterministic ordering", () => {
    const tree = buildNoteTree({
      folders: [
        folder("f-z", null, "Same"),
        folder("f-a", null, "Same"),
      ],
      notes: [],
      expandedFolderIds: new Set(),
    });
    expect(tree.folders.map((f) => f.id)).toEqual(["f-a", "f-z"]);
  });
});

describe("DnD payload helpers", () => {
  // Minimal DataTransfer stub — we only need getData/setData.
  function dt(): DataTransfer {
    const store = new Map<string, string>();
    return {
      getData: (k: string) => store.get(k) ?? "",
      setData: (k: string, v: string) => {
        store.set(k, v);
      },
      // Unused bits; cast keeps the type checker happy at the call sites.
    } as unknown as DataTransfer;
  }

  it("round-trips a note payload via the custom MIME", () => {
    const t = dt();
    setDragPayload(t, { kind: "note", id: "n1" });
    expect(t.getData(DND_MIME_NOTE)).toBe("n1");
    expect(readDragPayload(t)).toEqual({ kind: "note", id: "n1" });
  });

  it("round-trips a folder payload via the custom MIME", () => {
    const t = dt();
    setDragPayload(t, { kind: "folder", id: "f1" });
    expect(t.getData(DND_MIME_FOLDER)).toBe("f1");
    expect(readDragPayload(t)).toEqual({ kind: "folder", id: "f1" });
  });

  it("falls back to text/plain when the custom MIME was stripped", () => {
    const t = dt();
    t.setData("text/plain", "note:abc");
    expect(readDragPayload(t)).toEqual({ kind: "note", id: "abc" });
  });

  it("returns null for foreign drags", () => {
    const t = dt();
    t.setData("text/plain", "https://example.com");
    expect(readDragPayload(t)).toBeNull();
  });
});

describe("isDropForbidden", () => {
  const noDescendants = () => new Set<string>();

  it("rejects dropping a note onto its current folder (no-op)", () => {
    expect(
      isDropForbidden(
        { kind: "note", id: "n1" },
        "f1",
        { folderIdOfNote: "f1" },
        noDescendants,
      ),
    ).toBe(true);
  });

  it("allows dropping a note onto a different folder", () => {
    expect(
      isDropForbidden(
        { kind: "note", id: "n1" },
        "f2",
        { folderIdOfNote: "f1" },
        noDescendants,
      ),
    ).toBe(false);
  });

  it("allows dropping a root note onto a folder", () => {
    expect(
      isDropForbidden(
        { kind: "note", id: "n1" },
        "f1",
        { folderIdOfNote: null },
        noDescendants,
      ),
    ).toBe(false);
  });

  it("rejects dropping a folder onto itself", () => {
    expect(
      isDropForbidden(
        { kind: "folder", id: "f1" },
        "f1",
        { parentIdOfFolder: null },
        noDescendants,
      ),
    ).toBe(true);
  });

  it("rejects dropping a folder onto its current parent", () => {
    expect(
      isDropForbidden(
        { kind: "folder", id: "f1" },
        "f-parent",
        { parentIdOfFolder: "f-parent" },
        noDescendants,
      ),
    ).toBe(true);
  });

  it("rejects dropping a folder into one of its own descendants", () => {
    expect(
      isDropForbidden(
        { kind: "folder", id: "f1" },
        "f-grandchild",
        { parentIdOfFolder: null },
        (id) => (id === "f1" ? new Set(["f-child", "f-grandchild"]) : new Set()),
      ),
    ).toBe(true);
  });

  it("allows moving a folder to root from a non-root parent", () => {
    expect(
      isDropForbidden(
        { kind: "folder", id: "f1" },
        null,
        { parentIdOfFolder: "f-parent" },
        noDescendants,
      ),
    ).toBe(false);
  });
});

describe("buildNoteTree activeTagFilter", () => {
  function tagged(
    id: string,
    folderId: string | null,
    title: string,
    tags: string[],
  ): NoteRecord {
    return { ...note(id, folderId, title), tags };
  }

  it("returns only notes carrying the active tag at root", () => {
    const tree = buildNoteTree({
      folders: [],
      notes: [
        tagged("n1", null, "A", ["kimya"]),
        tagged("n2", null, "B", ["biyoloji"]),
        tagged("n3", null, "C", ["kimya", "fizik"]),
      ],
      expandedFolderIds: new Set(),
      activeTagFilter: "kimya",
    });
    expect(tree.notes.map((n) => n.id).sort()).toEqual(["n1", "n3"]);
  });

  it("prunes folders that no longer have matching descendants", () => {
    const folders = [folder("fA", null, "A"), folder("fB", null, "B")];
    const notes = [
      tagged("n1", "fA", "x", ["kimya"]),
      tagged("n2", "fB", "y", ["fizik"]),
    ];
    const tree = buildNoteTree({
      folders,
      notes,
      expandedFolderIds: new Set(),
      activeTagFilter: "kimya",
    });
    expect(tree.folders.map((f) => f.id)).toEqual(["fA"]);
    expect(tree.folders[0]!.notes.map((n) => n.id)).toEqual(["n1"]);
  });

  it("keeps a folder whose own name matches the search but only when its notes also match the tag", () => {
    const folders = [folder("fK", null, "kimya")];
    const notes = [tagged("n1", "fK", "x", ["biyoloji"])];
    const tree = buildNoteTree({
      folders,
      notes,
      expandedFolderIds: new Set(),
      searchQuery: "kimya",
      activeTagFilter: "kimya",
    });
    expect(tree.folders).toEqual([]);
  });

  it("force-expands ancestor folders when only the tag filter is set", () => {
    const folders = [folder("fP", null, "parent")];
    const notes = [tagged("n1", "fP", "deep", ["kimya"])];
    const tree = buildNoteTree({
      folders,
      notes,
      expandedFolderIds: new Set(),
      activeTagFilter: "kimya",
    });
    expect(tree.folders[0]?.expanded).toBe(true);
  });

  it("returns an empty bucket when no note carries the active tag", () => {
    const tree = buildNoteTree({
      folders: [],
      notes: [tagged("n1", null, "A", ["fizik"])],
      expandedFolderIds: new Set(),
      activeTagFilter: "kimya",
    });
    expect(tree.notes).toEqual([]);
    expect(tree.folders).toEqual([]);
  });

  it("treats an empty-string filter as no filter applied", () => {
    const tree = buildNoteTree({
      folders: [],
      notes: [tagged("n1", null, "A", ["fizik"])],
      expandedFolderIds: new Set(),
      activeTagFilter: "",
    });
    expect(tree.notes.map((n) => n.id)).toEqual(["n1"]);
  });
});
