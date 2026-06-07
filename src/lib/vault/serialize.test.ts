import { describe, it, expect } from "vitest";
import type { NoteFolderRecord, NoteRecord } from "@/lib/db/types";
import { isDailyNote, resolveNoteFolderPath, serializeNote } from "./serialize";

function note(over: Partial<NoteRecord>): NoteRecord {
  return {
    id: "n1",
    workspaceId: "w1",
    folderId: null,
    title: "Untitled",
    content: "",
    tags: [],
    wikilinks: [],
    path: "Untitled.md",
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

describe("isDailyNote", () => {
  it("matches the EN daily title shape", () => {
    expect(isDailyNote({ title: "Daily-2026-05-17" })).toBe(true);
  });

  it("matches the TR daily title shape", () => {
    expect(isDailyNote({ title: "Daily-17-05-2026" })).toBe(true);
  });

  it("rejects non-daily titles", () => {
    expect(isDailyNote({ title: "Daily standup" })).toBe(false);
    expect(isDailyNote({ title: "Daily-foo" })).toBe(false);
    expect(isDailyNote({ title: "Random Note" })).toBe(false);
  });
});

describe("resolveNoteFolderPath", () => {
  it("routes daily notes to Daily/ regardless of in-Dexie folder", () => {
    const f = folder({ id: "f-tr", name: "Günlük", path: "Günlük" });
    const path = resolveNoteFolderPath(
      { title: "Daily-2026-05-17", folderId: "f-tr" },
      new Map([[f.id, f]]),
    );
    expect(path).toBe("Daily");
  });

  it("uses the Dexie folder path for non-daily notes", () => {
    const f = folder({ id: "f1", path: "Parent/Child" });
    const path = resolveNoteFolderPath(
      { title: "Topic", folderId: "f1" },
      new Map([[f.id, f]]),
    );
    expect(path).toBe("Parent/Child");
  });

  it("returns empty for root (no folder) notes", () => {
    const path = resolveNoteFolderPath(
      { title: "Topic", folderId: null },
      new Map(),
    );
    expect(path).toBe("");
  });

  it("falls back to empty when folder id is unknown", () => {
    const path = resolveNoteFolderPath(
      { title: "Topic", folderId: "ghost" },
      new Map(),
    );
    expect(path).toBe("");
  });
});

describe("serializeNote", () => {
  it("appends exactly one trailing newline", () => {
    expect(serializeNote(note({ content: "# H1" }))).toBe("# H1\n");
  });

  it("normalises multi-trailing-newline content", () => {
    expect(serializeNote(note({ content: "# H1\n\n\n\n" }))).toBe("# H1\n");
  });

  it("emits single-newline file for empty content", () => {
    expect(serializeNote(note({ content: "" }))).toBe("\n");
  });

  it("preserves wikilinks verbatim", () => {
    const body = serializeNote(
      note({ content: "Linked: [[Topic]] and [[source:abc]] and [[concept:xyz|alias]]" }),
    );
    expect(body).toContain("[[Topic]]");
    expect(body).toContain("[[source:abc]]");
    expect(body).toContain("[[concept:xyz|alias]]");
  });

  it("preserves multi-line markdown structure", () => {
    const md = "# Heading\n\n- item 1\n- item 2\n\n## Sub\n\n> quote";
    expect(serializeNote(note({ content: md }))).toBe(md + "\n");
  });
});
