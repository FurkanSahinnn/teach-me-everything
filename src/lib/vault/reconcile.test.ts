import { describe, expect, it } from "vitest";
import type { NoteFolderRecord, NoteRecord } from "@/lib/db/types";
import { VaultFsError, type VaultFileStat } from "./fs-adapter";
import { hashNormalizedContent } from "./hash";
import {
  buildFolderPathIndex,
  buildPathIndex,
  reconcileWatchEvent,
  type ReconcileDeps,
  type ReconcileNoteSlice,
} from "./reconcile";
import type { VaultWatchEvent } from "./watcher";

function note(over: Partial<NoteRecord>): NoteRecord {
  return {
    id: "n0123456789abcdef",
    workspaceId: "w1",
    folderId: null,
    title: "Topic",
    content: "# Topic\n\nBody",
    tags: [],
    wikilinks: [],
    path: "Topic.md",
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

function folder(over: Partial<NoteFolderRecord>): NoteFolderRecord {
  return {
    id: "f1",
    workspaceId: "w1",
    parentId: null,
    name: "Folder",
    path: "Folder",
    createdAt: 0,
    ...over,
  };
}

function stat(over: Partial<VaultFileStat>): VaultFileStat {
  return {
    size: 100,
    mtimeMs: 1_000,
    isDirectory: false,
    isFile: true,
    isSymlink: false,
    ...over,
  };
}

type StubFs = {
  files: Map<string, string>;
  stats: Map<string, VaultFileStat>;
  readErr?: Error;
  statErr?: Error;
};

function makeDeps(stub: StubFs, over: Partial<ReconcileDeps> = {}): ReconcileDeps {
  return {
    pathIndex: new Map(),
    folderPathIndex: new Map(),
    vaultRoot: "/vault",
    getNote: async () => undefined,
    readTextFile: async (p) => {
      if (stub.readErr) throw stub.readErr;
      const v = stub.files.get(p);
      if (v === undefined) throw new VaultFsError(`not found ${p}`, { path: p });
      return v;
    },
    statPath: async (p) => {
      if (stub.statErr) throw stub.statErr;
      const v = stub.stats.get(p);
      if (v === undefined) throw new VaultFsError(`stat not found ${p}`, { path: p });
      return v;
    },
    ...over,
  };
}

describe("vault/reconcile buildPathIndex", () => {
  it("indexes a root-level note", () => {
    const idx = buildPathIndex({
      notes: [note({ id: "n1", title: "Hello" })],
      foldersById: new Map(),
      vaultRoot: "/vault",
    });
    expect(idx.size).toBe(1);
    expect(idx.get("/vault/Hello.md")).toBe("n1");
  });

  it("indexes notes inside folders", () => {
    const f = folder({ id: "f1", path: "Parent" });
    const idx = buildPathIndex({
      notes: [note({ id: "n1", title: "Child", folderId: "f1" })],
      foldersById: new Map([["f1", f]]),
      vaultRoot: "/vault",
    });
    expect(idx.get("/vault/Parent/Child.md")).toBe("n1");
  });

  it("routes daily notes through Daily/ regardless of folder name", () => {
    const f = folder({ id: "f1", path: "Günlük" });
    const idx = buildPathIndex({
      notes: [note({ id: "n1", title: "Daily-2026-05-17", folderId: "f1" })],
      foldersById: new Map([["f1", f]]),
      vaultRoot: "/vault",
    });
    expect(idx.get("/vault/Daily/Daily-2026-05-17.md")).toBe("n1");
  });

  it("handles multiple notes spanning root + folders", () => {
    const f = folder({ id: "f1", path: "Folder" });
    const idx = buildPathIndex({
      notes: [
        note({ id: "n1", title: "Root" }),
        note({ id: "n2", title: "Inside", folderId: "f1" }),
      ],
      foldersById: new Map([["f1", f]]),
      vaultRoot: "/vault",
    });
    expect(idx.size).toBe(2);
    expect(idx.get("/vault/Root.md")).toBe("n1");
    expect(idx.get("/vault/Folder/Inside.md")).toBe("n2");
  });
});

describe("vault/reconcile buildFolderPathIndex", () => {
  it("indexes folders by POSIX path", () => {
    const idx = buildFolderPathIndex({
      folders: [
        folder({ id: "f1", path: "Parent" }),
        folder({ id: "f2", path: "Parent/Child" }),
      ],
    });
    expect(idx.get("Parent")).toBe("f1");
    expect(idx.get("Parent/Child")).toBe("f2");
  });

  it("skips folders with empty path defensively", () => {
    const idx = buildFolderPathIndex({
      folders: [folder({ id: "f1", path: "" }), folder({ id: "f2", path: "Real" })],
    });
    expect(idx.size).toBe(1);
    expect(idx.get("Real")).toBe("f2");
  });
});

describe("vault/reconcile reconcileWatchEvent — remove", () => {
  it("delete-note when path is known", async () => {
    const deps = makeDeps({ files: new Map(), stats: new Map() }, {
      pathIndex: new Map([["/vault/Topic.md", "n1"]]),
    });
    const event: VaultWatchEvent = { kind: "remove", path: "/vault/Topic.md" };
    const action = await reconcileWatchEvent(event, deps);
    expect(action).toEqual({ kind: "delete-note", noteId: "n1" });
  });

  it("noop when path is unknown", async () => {
    const deps = makeDeps({ files: new Map(), stats: new Map() });
    const event: VaultWatchEvent = { kind: "remove", path: "/vault/Other.md" };
    const action = await reconcileWatchEvent(event, deps);
    expect(action.kind).toBe("noop");
    if (action.kind === "noop") expect(action.reason).toMatch(/unknown/);
  });
});

describe("vault/reconcile reconcileWatchEvent — modify (hash compare)", () => {
  it("skip-hash-match when disk and Dexie content are identical", async () => {
    const noteContent = "# Topic\n\nbody";
    const deps = makeDeps(
      {
        files: new Map([["/vault/Topic.md", noteContent]]),
        stats: new Map([["/vault/Topic.md", stat({ mtimeMs: 500 })]]),
      },
      {
        pathIndex: new Map([["/vault/Topic.md", "n1"]]),
        getNote: async (id) =>
          id === "n1"
            ? ({ id: "n1", content: noteContent, updatedAt: 100 } as ReconcileNoteSlice)
            : undefined,
      },
    );
    const event: VaultWatchEvent = { kind: "modify", path: "/vault/Topic.md" };
    const action = await reconcileWatchEvent(event, deps);
    expect(action).toEqual({ kind: "skip-hash-match", noteId: "n1" });
  });

  it("normalises CRLF and BOM before hashing so round-trips match", async () => {
    const dexieContent = "# Topic\n\nbody";
    const diskContent = "﻿# Topic\r\n\r\nbody";
    const deps = makeDeps(
      {
        files: new Map([["/vault/Topic.md", diskContent]]),
        stats: new Map([["/vault/Topic.md", stat({ mtimeMs: 500 })]]),
      },
      {
        pathIndex: new Map([["/vault/Topic.md", "n1"]]),
        getNote: async () =>
          ({ id: "n1", content: dexieContent, updatedAt: 100 } as ReconcileNoteSlice),
      },
    );
    const action = await reconcileWatchEvent(
      { kind: "modify", path: "/vault/Topic.md" },
      deps,
    );
    expect(action).toEqual({ kind: "skip-hash-match", noteId: "n1" });
  });

  it("import-update when disk content differs and mtime is newer", async () => {
    const deps = makeDeps(
      {
        files: new Map([["/vault/Topic.md", "# Topic\n\nNEW body"]]),
        stats: new Map([["/vault/Topic.md", stat({ mtimeMs: 1_500 })]]),
      },
      {
        pathIndex: new Map([["/vault/Topic.md", "n1"]]),
        getNote: async () =>
          ({ id: "n1", content: "# Topic\n\nold body", updatedAt: 1_000 } as ReconcileNoteSlice),
      },
    );
    const action = await reconcileWatchEvent(
      { kind: "modify", path: "/vault/Topic.md" },
      deps,
    );
    expect(action.kind).toBe("import-update");
    if (action.kind === "import-update") {
      expect(action.noteId).toBe("n1");
      expect(action.content).toBe("# Topic\n\nNEW body");
      expect(action.mtimeMs).toBe(1_500);
    }
  });

  it("import-update when mtime equals updatedAt (disk wins on tie)", async () => {
    const deps = makeDeps(
      {
        files: new Map([["/vault/Topic.md", "# Topic\n\nNEW"]]),
        stats: new Map([["/vault/Topic.md", stat({ mtimeMs: 1_000 })]]),
      },
      {
        pathIndex: new Map([["/vault/Topic.md", "n1"]]),
        getNote: async () =>
          ({ id: "n1", content: "# Topic\n\nold", updatedAt: 1_000 } as ReconcileNoteSlice),
      },
    );
    const action = await reconcileWatchEvent(
      { kind: "modify", path: "/vault/Topic.md" },
      deps,
    );
    expect(action.kind).toBe("import-update");
  });

  it("conflict-dexie-wins when Dexie's updatedAt is newer", async () => {
    const deps = makeDeps(
      {
        files: new Map([["/vault/Topic.md", "# Topic\n\nstale disk"]]),
        stats: new Map([["/vault/Topic.md", stat({ mtimeMs: 500 })]]),
      },
      {
        pathIndex: new Map([["/vault/Topic.md", "n1"]]),
        getNote: async () =>
          ({ id: "n1", content: "# Topic\n\nnew dexie", updatedAt: 2_000 } as ReconcileNoteSlice),
      },
    );
    const action = await reconcileWatchEvent(
      { kind: "modify", path: "/vault/Topic.md" },
      deps,
    );
    expect(action.kind).toBe("conflict-dexie-wins");
    if (action.kind === "conflict-dexie-wins") {
      expect(action.noteId).toBe("n1");
      expect(action.diskContent).toBe("# Topic\n\nstale disk");
      expect(action.diskMtimeMs).toBe(500);
      expect(action.noteUpdatedAt).toBe(2_000);
    }
  });

  it("noop when path-index has the id but getNote returns undefined", async () => {
    const deps = makeDeps(
      { files: new Map(), stats: new Map() },
      {
        pathIndex: new Map([["/vault/Topic.md", "n-ghost"]]),
        getNote: async () => undefined,
      },
    );
    const action = await reconcileWatchEvent(
      { kind: "modify", path: "/vault/Topic.md" },
      deps,
    );
    expect(action.kind).toBe("noop");
    if (action.kind === "noop") expect(action.reason).toMatch(/stale/);
  });

  it("noop with stat-failure reason when stat throws VaultFsError", async () => {
    const deps = makeDeps(
      {
        files: new Map([["/vault/Topic.md", "x"]]),
        stats: new Map(),
        statErr: new VaultFsError("ENOENT", { path: "/vault/Topic.md" }),
      },
      {
        pathIndex: new Map([["/vault/Topic.md", "n1"]]),
        getNote: async () =>
          ({ id: "n1", content: "y", updatedAt: 0 } as ReconcileNoteSlice),
      },
    );
    const action = await reconcileWatchEvent(
      { kind: "modify", path: "/vault/Topic.md" },
      deps,
    );
    expect(action.kind).toBe("noop");
    if (action.kind === "noop") expect(action.reason).toMatch(/stat failed/);
  });

  it("noop when stat reports the path is not a regular file", async () => {
    const deps = makeDeps(
      {
        files: new Map([["/vault/Topic.md", "x"]]),
        stats: new Map([
          ["/vault/Topic.md", stat({ isFile: false, isDirectory: true })],
        ]),
      },
      {
        pathIndex: new Map([["/vault/Topic.md", "n1"]]),
        getNote: async () =>
          ({ id: "n1", content: "y", updatedAt: 0 } as ReconcileNoteSlice),
      },
    );
    const action = await reconcileWatchEvent(
      { kind: "modify", path: "/vault/Topic.md" },
      deps,
    );
    expect(action.kind).toBe("noop");
  });

  it("re-throws non-VaultFsError errors so the dispatcher can route them", async () => {
    const deps = makeDeps(
      {
        files: new Map(),
        stats: new Map(),
        statErr: new TypeError("unexpected"),
      },
      {
        pathIndex: new Map([["/vault/Topic.md", "n1"]]),
        getNote: async () =>
          ({ id: "n1", content: "y", updatedAt: 0 } as ReconcileNoteSlice),
      },
    );
    await expect(
      reconcileWatchEvent({ kind: "modify", path: "/vault/Topic.md" }, deps),
    ).rejects.toThrow(TypeError);
  });
});

describe("vault/reconcile reconcileWatchEvent — create/import-new", () => {
  it("import-new with null folderId for a root-level file", async () => {
    const deps = makeDeps(
      {
        files: new Map([["/vault/Fresh.md", "# Fresh\n\nbody"]]),
        stats: new Map([["/vault/Fresh.md", stat({ mtimeMs: 1_000 })]]),
      },
      { pathIndex: new Map(), folderPathIndex: new Map() },
    );
    const action = await reconcileWatchEvent(
      { kind: "create", path: "/vault/Fresh.md" },
      deps,
    );
    expect(action.kind).toBe("import-new");
    if (action.kind === "import-new") {
      expect(action.absPath).toBe("/vault/Fresh.md");
      expect(action.content).toBe("# Fresh\n\nbody");
      expect(action.folderId).toBeNull();
    }
  });

  it("import-new resolves folderId via the folder path index", async () => {
    const deps = makeDeps(
      {
        files: new Map([["/vault/Parent/Fresh.md", "body"]]),
        stats: new Map([["/vault/Parent/Fresh.md", stat({})]]),
      },
      {
        pathIndex: new Map(),
        folderPathIndex: new Map([["Parent", "f-parent"]]),
      },
    );
    const action = await reconcileWatchEvent(
      { kind: "create", path: "/vault/Parent/Fresh.md" },
      deps,
    );
    expect(action.kind).toBe("import-new");
    if (action.kind === "import-new") expect(action.folderId).toBe("f-parent");
  });

  it("import-new with null folderId when the folder isn't indexed yet", async () => {
    const deps = makeDeps(
      {
        files: new Map([["/vault/Untracked/Fresh.md", "body"]]),
        stats: new Map([["/vault/Untracked/Fresh.md", stat({})]]),
      },
      { pathIndex: new Map(), folderPathIndex: new Map() },
    );
    const action = await reconcileWatchEvent(
      { kind: "create", path: "/vault/Untracked/Fresh.md" },
      deps,
    );
    expect(action.kind).toBe("import-new");
    if (action.kind === "import-new") expect(action.folderId).toBeNull();
  });

  it("noop when the create path is outside the vault root", async () => {
    const deps = makeDeps(
      {
        files: new Map([["/elsewhere/Fresh.md", "body"]]),
        stats: new Map([["/elsewhere/Fresh.md", stat({})]]),
      },
      { pathIndex: new Map(), folderPathIndex: new Map() },
    );
    const action = await reconcileWatchEvent(
      { kind: "create", path: "/elsewhere/Fresh.md" },
      deps,
    );
    expect(action.kind).toBe("noop");
    if (action.kind === "noop") expect(action.reason).toMatch(/outside vault/);
  });

  it("noop when stat reports the create path is a directory", async () => {
    const deps = makeDeps(
      {
        files: new Map(),
        stats: new Map([
          ["/vault/NewFolder", stat({ isFile: false, isDirectory: true })],
        ]),
      },
      { pathIndex: new Map() },
    );
    const action = await reconcileWatchEvent(
      { kind: "create", path: "/vault/NewFolder" },
      deps,
    );
    expect(action.kind).toBe("noop");
  });

  it("noop with read-failed reason when readTextFile throws VaultFsError", async () => {
    const deps = makeDeps(
      {
        files: new Map(),
        stats: new Map([["/vault/Fresh.md", stat({})]]),
        readErr: new VaultFsError("EACCES", { path: "/vault/Fresh.md" }),
      },
      { pathIndex: new Map() },
    );
    const action = await reconcileWatchEvent(
      { kind: "create", path: "/vault/Fresh.md" },
      deps,
    );
    expect(action.kind).toBe("noop");
    if (action.kind === "noop") expect(action.reason).toMatch(/read failed/);
  });
});

describe("vault/reconcile reconcileWatchEvent — other kind", () => {
  it("noop for `other` events", async () => {
    const deps = makeDeps({ files: new Map(), stats: new Map() });
    const action = await reconcileWatchEvent(
      { kind: "other", path: "/vault/something" },
      deps,
    );
    expect(action.kind).toBe("noop");
    if (action.kind === "noop") expect(action.reason).toMatch(/other/);
  });
});

describe("vault/reconcile end-to-end hash truthiness", () => {
  it("computes distinct hashes for distinct content (sanity)", async () => {
    const a = await hashNormalizedContent("foo");
    const b = await hashNormalizedContent("bar");
    expect(a).not.toBe(b);
  });
});
