import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { NoteFolderRecord, NoteRecord } from "@/lib/db/types";
import { _setVaultFsForTests, type VaultFsImpl } from "./fs-adapter";
import {
  dispatchVaultReconciler,
  type ReconcilerOverrides,
} from "./reconcile-dispatch";
import { _setWatcherImplForTests, type VaultWatchEvent, type VaultWatcherImpl } from "./watcher";
import { _clearRecentWritesForTests } from "./watcher-suppression";

type DispatcherStub = {
  folders: NoteFolderRecord[];
  notes: NoteRecord[];
  files: Map<string, string>;
  stats: Map<
    string,
    { size: number; mtimeMs: number | null; isDirectory: boolean; isFile: boolean; isSymlink: boolean }
  >;
  created: Array<{ workspaceId: string; folderId: string | null | undefined; content: string | undefined }>;
  updated: Array<{ id: string; content: string | undefined }>;
  deleted: string[];
  writtenAtomic: Array<{ path: string; content: string }>;
};

function note(over: Partial<NoteRecord>): NoteRecord {
  return {
    id: "n0123456789abcdef",
    workspaceId: "w1",
    folderId: null,
    title: "Topic",
    content: "# Topic\n\nbody",
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

function makeOverrides(
  stub: DispatcherStub,
  trigger: { call?: (events: VaultWatchEvent[]) => void; unwatched: { called: boolean } },
): ReconcilerOverrides {
  return {
    loadFolders: async () => stub.folders,
    loadNotes: async () => stub.notes,
    getNote: async (id) => stub.notes.find((n) => n.id === id),
    createNote: async (input) => {
      const created = note({
        id: `created-${stub.created.length}`,
        workspaceId: input.workspaceId,
        folderId: input.folderId ?? null,
        content: input.content ?? "",
        title: input.title ?? "Untitled",
      });
      stub.created.push({
        workspaceId: input.workspaceId,
        folderId: input.folderId,
        content: input.content,
      });
      stub.notes.push(created);
      return created;
    },
    updateNote: async (id, patch) => {
      stub.updated.push({ id, content: patch.content });
      const existing = stub.notes.find((n) => n.id === id);
      if (existing && patch.content !== undefined) existing.content = patch.content;
    },
    deleteNote: async (id) => {
      stub.deleted.push(id);
      stub.notes = stub.notes.filter((n) => n.id !== id);
    },
    startWatcher: async (opts) => {
      const impl: VaultWatcherImpl = {
        watch: async (_root, cb) => {
          trigger.call = cb;
          return async () => {
            trigger.unwatched.called = true;
          };
        },
      };
      _setWatcherImplForTests(impl);
      // delegate to real startWatcher via the impl just set
      const { startVaultWatcher } = await import("./watcher");
      return startVaultWatcher(opts);
    },
    readTextFile: async (p) => {
      const v = stub.files.get(p);
      if (v === undefined) throw new Error(`no file ${p}`);
      return v;
    },
    statPath: async (p) => {
      const v = stub.stats.get(p);
      if (v === undefined) throw new Error(`no stat ${p}`);
      return v;
    },
    atomicWriteTextFile: async (path, content) => {
      stub.writtenAtomic.push({ path, content });
    },
  };
}

describe("vault/reconcile-dispatch", () => {
  let stub: DispatcherStub;
  let trigger: { call?: (events: VaultWatchEvent[]) => void; unwatched: { called: boolean } };

  beforeEach(() => {
    stub = {
      folders: [],
      notes: [],
      files: new Map(),
      stats: new Map(),
      created: [],
      updated: [],
      deleted: [],
      writtenAtomic: [],
    };
    trigger = { unwatched: { called: false } };
    // Provide a no-op fs adapter for transitive callers.
    _setVaultFsForTests({} satisfies Partial<VaultFsImpl>);
  });

  afterEach(() => {
    _setWatcherImplForTests(null);
    _setVaultFsForTests(null);
    _clearRecentWritesForTests();
  });

  it("builds the path index from current Dexie state on start", async () => {
    stub.notes = [note({ id: "n1", title: "Hello" })];
    const ov = makeOverrides(stub, trigger);
    const handle = await dispatchVaultReconciler({
      workspaceId: "w1",
      vaultRoot: "/vault",
      overrides: ov,
    });
    expect(typeof handle.stop).toBe("function");
    expect(trigger.call).toBeTypeOf("function");
    await handle.stop();
    expect(trigger.unwatched.called).toBe(true);
  });

  it("routes import-update through updateNote", async () => {
    stub.notes = [
      note({ id: "n1", title: "Hello", content: "# Hello\n\nold", updatedAt: 100 }),
    ];
    stub.files.set("/vault/Hello.md", "# Hello\n\nNEW");
    stub.stats.set("/vault/Hello.md", {
      size: 10,
      mtimeMs: 500,
      isDirectory: false,
      isFile: true,
      isSymlink: false,
    });
    const ov = makeOverrides(stub, trigger);
    await dispatchVaultReconciler({
      workspaceId: "w1",
      vaultRoot: "/vault",
      overrides: ov,
    });
    await new Promise<void>((resolve) => {
      trigger.call?.([{ kind: "modify", path: "/vault/Hello.md" }]);
      // Allow microtask + lock chain + reconcile awaits to complete.
      setTimeout(resolve, 20);
    });
    expect(stub.updated).toEqual([{ id: "n1", content: "# Hello\n\nNEW" }]);
  });

  it("routes import-new through createNote and patches the path index", async () => {
    stub.files.set("/vault/Fresh.md", "# Fresh\n\nbody");
    stub.stats.set("/vault/Fresh.md", {
      size: 10,
      mtimeMs: 500,
      isDirectory: false,
      isFile: true,
      isSymlink: false,
    });
    const ov = makeOverrides(stub, trigger);
    await dispatchVaultReconciler({
      workspaceId: "w1",
      vaultRoot: "/vault",
      overrides: ov,
    });
    await new Promise<void>((resolve) => {
      trigger.call?.([{ kind: "create", path: "/vault/Fresh.md" }]);
      setTimeout(resolve, 20);
    });
    expect(stub.created).toHaveLength(1);
    expect(stub.created[0]).toEqual({
      workspaceId: "w1",
      folderId: null,
      content: "# Fresh\n\nbody",
    });
  });

  it("routes delete-note through deleteNote and clears the path index slot", async () => {
    stub.notes = [note({ id: "n1", title: "Hello" })];
    const ov = makeOverrides(stub, trigger);
    await dispatchVaultReconciler({
      workspaceId: "w1",
      vaultRoot: "/vault",
      overrides: ov,
    });
    await new Promise<void>((resolve) => {
      trigger.call?.([{ kind: "remove", path: "/vault/Hello.md" }]);
      setTimeout(resolve, 20);
    });
    expect(stub.deleted).toEqual(["n1"]);
  });

  it("routes conflict-dexie-wins through atomicWriteTextFile with the serialised note", async () => {
    stub.notes = [
      note({
        id: "n1",
        title: "Hello",
        content: "# Hello\n\nDEXIE WON",
        updatedAt: 5_000,
      }),
    ];
    stub.files.set("/vault/Hello.md", "# Hello\n\nstale disk");
    stub.stats.set("/vault/Hello.md", {
      size: 10,
      mtimeMs: 1_000,
      isDirectory: false,
      isFile: true,
      isSymlink: false,
    });
    const ov = makeOverrides(stub, trigger);
    await dispatchVaultReconciler({
      workspaceId: "w1",
      vaultRoot: "/vault",
      overrides: ov,
    });
    await new Promise<void>((resolve) => {
      trigger.call?.([{ kind: "modify", path: "/vault/Hello.md" }]);
      setTimeout(resolve, 20);
    });
    expect(stub.writtenAtomic).toHaveLength(1);
    expect(stub.writtenAtomic[0]?.path).toBe("/vault/Hello.md");
    expect(stub.writtenAtomic[0]?.content).toContain("DEXIE WON");
  });

  it("notifies onAction for each processed event", async () => {
    stub.notes = [
      note({ id: "n1", title: "Hello", content: "# Hello\n\nbody", updatedAt: 100 }),
    ];
    stub.files.set("/vault/Hello.md", "# Hello\n\nbody");
    stub.stats.set("/vault/Hello.md", {
      size: 10,
      mtimeMs: 200,
      isDirectory: false,
      isFile: true,
      isSymlink: false,
    });
    const ov = makeOverrides(stub, trigger);
    const seen: string[] = [];
    await dispatchVaultReconciler({
      workspaceId: "w1",
      vaultRoot: "/vault",
      overrides: ov,
      onAction: (_e, a) => {
        seen.push(a.kind);
      },
    });
    await new Promise<void>((resolve) => {
      trigger.call?.([{ kind: "modify", path: "/vault/Hello.md" }]);
      setTimeout(resolve, 20);
    });
    expect(seen).toEqual(["skip-hash-match"]);
  });

  it("applies always-disk policy so disk wins even when Dexie is newer", async () => {
    stub.notes = [
      note({
        id: "n1",
        title: "Hello",
        content: "# Hello\n\nDEXIE newer",
        updatedAt: 5_000,
      }),
    ];
    stub.files.set("/vault/Hello.md", "# Hello\n\ndisk stale");
    stub.stats.set("/vault/Hello.md", {
      size: 10,
      mtimeMs: 1_000,
      isDirectory: false,
      isFile: true,
      isSymlink: false,
    });
    const ov = makeOverrides(stub, trigger);
    const seen: string[] = [];
    await dispatchVaultReconciler({
      workspaceId: "w1",
      vaultRoot: "/vault",
      overrides: ov,
      getPolicy: () => "always-disk",
      onAction: (_e, a) => {
        seen.push(a.kind);
      },
    });
    await new Promise<void>((resolve) => {
      trigger.call?.([{ kind: "modify", path: "/vault/Hello.md" }]);
      setTimeout(resolve, 20);
    });
    // Under LWW this would be `conflict-dexie-wins`; the policy flips it.
    expect(seen).toEqual(["import-update"]);
    expect(stub.updated).toEqual([{ id: "n1", content: "# Hello\n\ndisk stale" }]);
    expect(stub.writtenAtomic).toEqual([]);
  });

  it("applies always-dexie policy so dexie wins even when disk is newer", async () => {
    stub.notes = [
      note({
        id: "n1",
        title: "Hello",
        content: "# Hello\n\nDEXIE older",
        updatedAt: 500,
      }),
    ];
    stub.files.set("/vault/Hello.md", "# Hello\n\ndisk newer");
    stub.stats.set("/vault/Hello.md", {
      size: 10,
      mtimeMs: 5_000,
      isDirectory: false,
      isFile: true,
      isSymlink: false,
    });
    const ov = makeOverrides(stub, trigger);
    const seen: string[] = [];
    await dispatchVaultReconciler({
      workspaceId: "w1",
      vaultRoot: "/vault",
      overrides: ov,
      getPolicy: () => "always-dexie",
      onAction: (_e, a) => {
        seen.push(a.kind);
      },
    });
    await new Promise<void>((resolve) => {
      trigger.call?.([{ kind: "modify", path: "/vault/Hello.md" }]);
      setTimeout(resolve, 20);
    });
    // Under LWW this would be `import-update`; the policy flips it.
    expect(seen).toEqual(["conflict-dexie-wins"]);
    expect(stub.updated).toEqual([]);
    expect(stub.writtenAtomic).toHaveLength(1);
    expect(stub.writtenAtomic[0]?.content).toContain("DEXIE older");
  });

  it("expands folder-remove events into per-note deletes (Phase 7.4.E cascade)", async () => {
    stub.folders = [
      {
        id: "f-sub",
        workspaceId: "w1",
        parentId: null,
        name: "Sub",
        path: "Sub",
        createdAt: 0,
      },
    ];
    stub.notes = [
      note({ id: "n1", title: "A", folderId: "f-sub" }),
      note({ id: "n2", title: "B", folderId: "f-sub" }),
      note({ id: "n3", title: "C", folderId: "f-sub" }),
      note({ id: "n4", title: "Root", folderId: null }),
    ];
    const ov = makeOverrides(stub, trigger);
    await dispatchVaultReconciler({
      workspaceId: "w1",
      vaultRoot: "/vault",
      overrides: ov,
    });
    await new Promise<void>((resolve) => {
      trigger.call?.([{ kind: "remove", path: "/vault/Sub" }]);
      setTimeout(resolve, 30);
    });
    // All three Sub/ children removed; the Root note (outside the
    // cascaded prefix) is untouched.
    expect(stub.deleted.sort()).toEqual(["n1", "n2", "n3"]);
    expect(stub.notes.map((n) => n.id)).toEqual(["n4"]);
  });

  it("collapses a hash-matching remove+create pair into a single rename (Phase 7.4.F)", async () => {
    stub.notes = [
      note({
        id: "n1",
        title: "Old",
        content: "# Old\n\nsame body",
        updatedAt: 100,
      }),
    ];
    stub.files.set("/vault/New.md", "# Old\n\nsame body");
    stub.stats.set("/vault/New.md", {
      size: 10,
      mtimeMs: 200,
      isDirectory: false,
      isFile: true,
      isSymlink: false,
    });
    const ov = makeOverrides(stub, trigger);
    const seen: string[] = [];
    await dispatchVaultReconciler({
      workspaceId: "w1",
      vaultRoot: "/vault",
      overrides: ov,
      onAction: (_e, a) => {
        seen.push(a.kind);
      },
    });
    await new Promise<void>((resolve) => {
      trigger.call?.([
        { kind: "remove", path: "/vault/Old.md" },
        { kind: "create", path: "/vault/New.md" },
      ]);
      setTimeout(resolve, 30);
    });
    // Rename — one updateNote call, NO create/delete.
    expect(seen).toEqual(["rename"]);
    expect(stub.updated).toEqual([{ id: "n1", content: "# Old\n\nsame body" }]);
    expect(stub.created).toEqual([]);
    expect(stub.deleted).toEqual([]);
  });

  it("falls back to delete + import-new when content hash does NOT match", async () => {
    stub.notes = [
      note({
        id: "n1",
        title: "Old",
        content: "# Old\n\nbody A",
        updatedAt: 100,
      }),
    ];
    stub.files.set("/vault/New.md", "# Old\n\nDIFFERENT body");
    stub.stats.set("/vault/New.md", {
      size: 10,
      mtimeMs: 200,
      isDirectory: false,
      isFile: true,
      isSymlink: false,
    });
    const ov = makeOverrides(stub, trigger);
    const seen: string[] = [];
    await dispatchVaultReconciler({
      workspaceId: "w1",
      vaultRoot: "/vault",
      overrides: ov,
      onAction: (_e, a) => {
        seen.push(a.kind);
      },
    });
    await new Promise<void>((resolve) => {
      trigger.call?.([
        { kind: "remove", path: "/vault/Old.md" },
        { kind: "create", path: "/vault/New.md" },
      ]);
      setTimeout(resolve, 30);
    });
    expect(seen.sort()).toEqual(["delete-note", "import-new"]);
    expect(stub.deleted).toEqual(["n1"]);
    expect(stub.created).toHaveLength(1);
    expect(stub.updated).toEqual([]);
  });

  it("triggerEvent affordance fires a synthetic event through the pipeline", async () => {
    stub.notes = [
      note({ id: "n1", title: "Hello", content: "# Hello\n\nold", updatedAt: 100 }),
    ];
    stub.files.set("/vault/Hello.md", "# Hello\n\nNEW via trigger");
    stub.stats.set("/vault/Hello.md", {
      size: 10,
      mtimeMs: 5_000,
      isDirectory: false,
      isFile: true,
      isSymlink: false,
    });
    const ov = makeOverrides(stub, trigger);
    const handle = await dispatchVaultReconciler({
      workspaceId: "w1",
      vaultRoot: "/vault",
      overrides: ov,
    });
    await handle.triggerEvent({ kind: "modify", path: "/vault/Hello.md" });
    expect(stub.updated).toEqual([
      { id: "n1", content: "# Hello\n\nNEW via trigger" },
    ]);
  });

  it("rebuildIndex re-reads folders and notes from the loaders", async () => {
    stub.notes = [];
    const ov = makeOverrides(stub, trigger);
    const handle = await dispatchVaultReconciler({
      workspaceId: "w1",
      vaultRoot: "/vault",
      overrides: ov,
    });
    stub.notes = [note({ id: "n-late", title: "Late" })];
    await handle.rebuildIndex();
    // Trigger a remove on the newly-indexed path → delete should fire.
    await new Promise<void>((resolve) => {
      trigger.call?.([{ kind: "remove", path: "/vault/Late.md" }]);
      setTimeout(resolve, 20);
    });
    expect(stub.deleted).toEqual(["n-late"]);
  });

  it("undoConflict restores disk content to Dexie and re-exports it", async () => {
    stub.notes = [
      note({
        id: "n1",
        title: "Hello",
        content: "# Hello\n\ndexie version",
        updatedAt: 100,
      }),
    ];
    const ov = makeOverrides(stub, trigger);
    const handle = await dispatchVaultReconciler({
      workspaceId: "w1",
      vaultRoot: "/vault",
      overrides: ov,
    });
    await handle.undoConflict({
      noteId: "n1",
      path: "/vault/Hello.md",
      diskContent: "# Hello\n\ndisk version",
    });
    expect(stub.updated).toEqual([
      { id: "n1", content: "# Hello\n\ndisk version" },
    ]);
    // serializeNote ensures exactly one trailing newline.
    expect(stub.writtenAtomic).toEqual([
      { path: "/vault/Hello.md", content: "# Hello\n\ndisk version\n" },
    ]);
  });

  it("undoConflict updates Dexie but skips re-export when the note is gone", async () => {
    stub.notes = []; // no note record
    const ov = makeOverrides(stub, trigger);
    const handle = await dispatchVaultReconciler({
      workspaceId: "w1",
      vaultRoot: "/vault",
      overrides: ov,
    });
    await handle.undoConflict({
      noteId: "missing",
      path: "/vault/Missing.md",
      diskContent: "disk",
    });
    expect(stub.updated).toEqual([{ id: "missing", content: "disk" }]);
    expect(stub.writtenAtomic).toEqual([]);
  });
});
