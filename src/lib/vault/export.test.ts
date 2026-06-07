import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { NoteFolderRecord, NoteRecord } from "@/lib/db/types";
import { exportVault } from "./export";
import { _setVaultFsForTests, type VaultFsImpl } from "./fs-adapter";

type Recorded = { writes: Array<{ path: string; content: string }>; mkdirs: string[] };

function fakeFs(rec: Recorded, opts?: { failOn?: string }): Partial<VaultFsImpl> {
  return {
    writeTextFile: async (path, content) => {
      if (opts?.failOn && path.includes(opts.failOn)) {
        throw new Error("EPERM");
      }
      rec.writes.push({ path, content });
    },
    mkdir: async (path) => {
      rec.mkdirs.push(path);
    },
    exists: async () => true,
    openDirectoryDialog: async () => null,
    documentDir: async () => "/docs",
    homeDir: async () => "/home",
    sep: () => "/",
  };
}

function note(over: Partial<NoteRecord>): NoteRecord {
  return {
    id: "n1abcdef",
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

describe("exportVault", () => {
  let rec: Recorded;

  beforeEach(() => {
    rec = { writes: [], mkdirs: [] };
  });

  afterEach(() => {
    _setVaultFsForTests(null);
  });

  it("writes a root note straight under the vault dir", async () => {
    _setVaultFsForTests(fakeFs(rec));
    const result = await exportVault({
      workspaceId: "w1",
      vaultRoot: "/vault",
      loaders: {
        folders: async () => [],
        notes: async () => [note({})],
      },
    });
    expect(result.notesWritten).toBe(1);
    expect(result.errors).toEqual([]);
    expect(rec.writes[0]?.path).toBe("/vault/Topic.md");
    expect(rec.writes[0]?.content).toBe("# Topic\n\nBody\n");
  });

  it("creates folder hierarchy + nests notes inside", async () => {
    _setVaultFsForTests(fakeFs(rec));
    const f = folder({ id: "f1", path: "Parent/Child" });
    await exportVault({
      workspaceId: "w1",
      vaultRoot: "/vault",
      loaders: {
        folders: async () => [f],
        notes: async () => [note({ folderId: "f1", title: "Nested" })],
      },
    });
    expect(rec.mkdirs).toContain("/vault/Parent");
    expect(rec.mkdirs).toContain("/vault/Parent/Child");
    expect(rec.writes[0]?.path).toBe("/vault/Parent/Child/Nested.md");
  });

  it("routes daily notes to Daily/ regardless of in-Dexie folder", async () => {
    _setVaultFsForTests(fakeFs(rec));
    const gunluk = folder({ id: "f-gunluk", path: "Günlük", name: "Günlük" });
    await exportVault({
      workspaceId: "w1",
      vaultRoot: "/vault",
      loaders: {
        folders: async () => [gunluk],
        notes: async () => [
          note({ folderId: "f-gunluk", title: "Daily-2026-05-17" }),
        ],
      },
    });
    expect(rec.mkdirs).toContain("/vault/Daily");
    expect(rec.writes[0]?.path).toBe("/vault/Daily/Daily-2026-05-17.md");
  });

  it("captures per-note errors without aborting", async () => {
    _setVaultFsForTests(fakeFs(rec, { failOn: "Boom" }));
    const result = await exportVault({
      workspaceId: "w1",
      vaultRoot: "/vault",
      loaders: {
        folders: async () => [],
        notes: async () => [
          note({ id: "ok-id", title: "Good" }),
          note({ id: "bad-id", title: "Boom" }),
          note({ id: "ok-id-2", title: "Also Good" }),
        ],
      },
    });
    expect(result.notesWritten).toBe(2);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.noteTitle).toBe("Boom");
  });

  it("calls onProgress for each note", async () => {
    _setVaultFsForTests(fakeFs(rec));
    const seen: number[] = [];
    await exportVault({
      workspaceId: "w1",
      vaultRoot: "/vault",
      onProgress: (p) => seen.push(p.done),
      loaders: {
        folders: async () => [],
        notes: async () => [
          note({ id: "a", title: "A" }),
          note({ id: "b", title: "B" }),
        ],
      },
    });
    // Three progress ticks: before(0), before(1), final(2).
    expect(seen).toEqual([0, 1, 2]);
  });

  it("returns 0 written + no errors for an empty workspace", async () => {
    _setVaultFsForTests(fakeFs(rec));
    const result = await exportVault({
      workspaceId: "w1",
      vaultRoot: "/vault",
      loaders: {
        folders: async () => [],
        notes: async () => [],
      },
    });
    expect(result.notesWritten).toBe(0);
    expect(result.errors).toEqual([]);
    // vault root still mkdir'd
    expect(rec.mkdirs).toContain("/vault");
  });
});
