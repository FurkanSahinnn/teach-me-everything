import { describe, expect, it } from "vitest";
import type { NoteFolderRecord, NoteRecord } from "@/lib/db/types";
import {
  buildNoteAbsolutePath,
  parseAbsolutePathToVaultRelative,
} from "./note-path";

function note(over: Partial<NoteRecord>): NoteRecord {
  return {
    id: "n0123456789abcdef",
    workspaceId: "w1",
    folderId: null,
    title: "My Note",
    content: "# My Note\n\nbody",
    tags: [],
    wikilinks: [],
    path: "My Note.md",
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

describe("vault/note-path buildNoteAbsolutePath", () => {
  it("places root notes directly under the vault root with POSIX separator", () => {
    const result = buildNoteAbsolutePath({
      note: note({ title: "Topic" }),
      foldersById: new Map(),
      vaultRoot: "/vault",
    });
    expect(result.absPath).toBe("/vault/Topic.md");
    expect(result.folderPath).toBe("");
    expect(result.parentDir).toBe("/vault");
    expect(result.filename).toBe("Topic.md");
  });

  it("places folder notes under the folder hierarchy", () => {
    const f = folder({ id: "f1", path: "Parent" });
    const result = buildNoteAbsolutePath({
      note: note({ title: "Child", folderId: "f1" }),
      foldersById: new Map([["f1", f]]),
      vaultRoot: "/vault",
    });
    expect(result.absPath).toBe("/vault/Parent/Child.md");
    expect(result.folderPath).toBe("Parent");
    expect(result.parentDir).toBe("/vault/Parent");
  });

  it("daily notes route to Daily/ regardless of the in-Dexie folder name", () => {
    const f = folder({ id: "f1", path: "Günlük" });
    const result = buildNoteAbsolutePath({
      note: note({ title: "Daily-2026-05-17", folderId: "f1" }),
      foldersById: new Map([["f1", f]]),
      vaultRoot: "/vault",
    });
    expect(result.absPath).toBe("/vault/Daily/Daily-2026-05-17.md");
    expect(result.folderPath).toBe("Daily");
  });

  it("preserves Windows-style separator when vault root uses backslashes", () => {
    const result = buildNoteAbsolutePath({
      note: note({ title: "Hello" }),
      foldersById: new Map(),
      vaultRoot: "C:\\vault",
    });
    expect(result.absPath).toBe("C:\\vault\\Hello.md");
  });

  it("walks deep folder paths splitting on POSIX `/`", () => {
    const f = folder({ id: "f1", path: "A/B/C" });
    const result = buildNoteAbsolutePath({
      note: note({ title: "Leaf", folderId: "f1" }),
      foldersById: new Map([["f1", f]]),
      vaultRoot: "/vault",
    });
    expect(result.absPath).toBe("/vault/A/B/C/Leaf.md");
  });

  it("strips NTFS-forbidden chars from the title before joining", () => {
    const result = buildNoteAbsolutePath({
      note: note({ title: "A:B?C" }),
      foldersById: new Map(),
      vaultRoot: "/vault",
    });
    expect(result.absPath).toBe("/vault/A-B-C.md");
  });
});

describe("vault/note-path parseAbsolutePathToVaultRelative", () => {
  it("decomposes a root-level POSIX path", () => {
    expect(parseAbsolutePathToVaultRelative("/vault/Topic.md", "/vault")).toEqual({
      folderPath: "",
      filename: "Topic.md",
    });
  });

  it("decomposes a nested POSIX path with multi-segment folder", () => {
    expect(
      parseAbsolutePathToVaultRelative("/vault/Parent/Child/Note.md", "/vault"),
    ).toEqual({ folderPath: "Parent/Child", filename: "Note.md" });
  });

  it("decomposes a Windows backslash path into POSIX folder form", () => {
    expect(
      parseAbsolutePathToVaultRelative(
        "C:\\vault\\Folder\\Note.md",
        "C:\\vault",
      ),
    ).toEqual({ folderPath: "Folder", filename: "Note.md" });
  });

  it("handles vault roots with trailing separator", () => {
    expect(
      parseAbsolutePathToVaultRelative("/vault/Note.md", "/vault/"),
    ).toEqual({ folderPath: "", filename: "Note.md" });
  });

  it("returns null for paths outside the vault", () => {
    expect(
      parseAbsolutePathToVaultRelative("/elsewhere/Note.md", "/vault"),
    ).toBeNull();
  });

  it("returns null for the vault root itself (no filename)", () => {
    expect(parseAbsolutePathToVaultRelative("/vault", "/vault")).toBeNull();
  });

  it("returns null for empty paths defensively", () => {
    expect(parseAbsolutePathToVaultRelative("", "/vault")).toBeNull();
    expect(parseAbsolutePathToVaultRelative("/vault/Note.md", "")).toBeNull();
  });

  it("does not match prefix-only collisions like /vault2 vs /vault", () => {
    expect(
      parseAbsolutePathToVaultRelative("/vault2/Note.md", "/vault"),
    ).toBeNull();
  });

  it("collapses mixed-separator paths to single POSIX form", () => {
    expect(
      parseAbsolutePathToVaultRelative("/vault\\Parent/Note.md", "/vault"),
    ).toEqual({ folderPath: "Parent", filename: "Note.md" });
  });
});
