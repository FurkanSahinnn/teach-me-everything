import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { atomicWriteTextFile } from "./atomic-write";
import {
  _setVaultFsForTests,
  VaultFsError,
  type VaultFsImpl,
} from "./fs-adapter";
import {
  _clearRecentWritesForTests,
  wasRecentlyWritten,
} from "./watcher-suppression";

type Stub = {
  writes: Array<{ path: string; content: string }>;
  renames: Array<{ from: string; to: string }>;
  removes: string[];
  writeShouldFail: boolean;
  renameShouldFail: boolean;
  removeShouldFail: boolean;
};

function makeStub(stub: Stub): Partial<VaultFsImpl> {
  return {
    writeTextFile: async (path, content) => {
      if (stub.writeShouldFail) throw new Error("disk full");
      stub.writes.push({ path, content });
    },
    remove: async (path) => {
      if (stub.removeShouldFail) throw new Error("remove failed");
      stub.removes.push(path);
    },
    rename: async (from, to) => {
      if (stub.renameShouldFail) throw new Error("rename failed");
      stub.renames.push({ from, to });
    },
  };
}

describe("vault/atomic-write", () => {
  let stub: Stub;

  beforeEach(() => {
    stub = {
      writes: [],
      renames: [],
      removes: [],
      writeShouldFail: false,
      renameShouldFail: false,
      removeShouldFail: false,
    };
    _setVaultFsForTests(makeStub(stub));
  });

  afterEach(() => {
    _setVaultFsForTests(null);
    _clearRecentWritesForTests();
  });

  it("writes to tmp path then renames over the destination", async () => {
    await atomicWriteTextFile("/vault/note.md", "hello", { suffix: "abc" });
    expect(stub.writes).toEqual([
      { path: "/vault/note.md.tmp.abc", content: "hello" },
    ]);
    expect(stub.renames).toEqual([
      { from: "/vault/note.md.tmp.abc", to: "/vault/note.md" },
    ]);
    expect(stub.removes).toEqual([]);
  });

  it("uses a generated suffix when none is provided", async () => {
    await atomicWriteTextFile("/vault/n.md", "x");
    expect(stub.writes).toHaveLength(1);
    expect(stub.writes[0]!.path).toMatch(/^\/vault\/n\.md\.tmp\.[\w-]+$/);
    expect(stub.renames).toHaveLength(1);
    expect(stub.renames[0]!.to).toBe("/vault/n.md");
  });

  it("throws VaultFsError and skips rename when tmp write fails", async () => {
    stub.writeShouldFail = true;
    await expect(
      atomicWriteTextFile("/vault/note.md", "hello", { suffix: "abc" }),
    ).rejects.toBeInstanceOf(VaultFsError);
    expect(stub.renames).toEqual([]);
    expect(stub.removes).toEqual([]);
  });

  it("attempts to clean up the tmp file when rename fails", async () => {
    stub.renameShouldFail = true;
    await expect(
      atomicWriteTextFile("/vault/note.md", "hello", { suffix: "abc" }),
    ).rejects.toBeInstanceOf(VaultFsError);
    expect(stub.removes).toEqual(["/vault/note.md.tmp.abc"]);
  });

  it("swallows cleanup error and still surfaces the original rename failure", async () => {
    stub.renameShouldFail = true;
    stub.removeShouldFail = true;
    await expect(
      atomicWriteTextFile("/vault/note.md", "hello", { suffix: "abc" }),
    ).rejects.toBeInstanceOf(VaultFsError);
  });

  it("produces distinct tmp filenames for two concurrent calls on different paths", async () => {
    await Promise.all([
      atomicWriteTextFile("/v/a.md", "1"),
      atomicWriteTextFile("/v/b.md", "2"),
    ]);
    const tmpPaths = stub.writes.map((w) => w.path);
    expect(new Set(tmpPaths).size).toBe(2);
    expect(stub.renames.map((r) => r.to).sort()).toEqual(["/v/a.md", "/v/b.md"]);
  });

  it("marks the destination path for watcher suppression on success", async () => {
    await atomicWriteTextFile("/vault/note.md", "hi");
    expect(wasRecentlyWritten("/vault/note.md")).toBe(true);
    // The tmp path is filtered by the watcher's tempfile predicate, not
    // by suppression, so it should NOT be flagged as suppressed.
    expect(wasRecentlyWritten(stub.writes[0]!.path)).toBe(false);
  });
});
