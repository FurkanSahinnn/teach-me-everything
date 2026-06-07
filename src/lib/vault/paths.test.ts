import { describe, it, expect } from "vitest";
import {
  detectSeparator,
  isAbsolutePath,
  joinPath,
  resolveVaultPath,
  splitFolderPath,
} from "./paths";

describe("isAbsolutePath", () => {
  it("treats POSIX root as absolute", () => {
    expect(isAbsolutePath("/home/user/notes")).toBe(true);
  });

  it("treats Windows drive letter as absolute", () => {
    expect(isAbsolutePath("C:\\Users\\Alice")).toBe(true);
    expect(isAbsolutePath("D:/Notes")).toBe(true);
  });

  it("treats UNC share as absolute", () => {
    expect(isAbsolutePath("\\\\server\\share\\file")).toBe(true);
  });

  it("rejects relative + empty", () => {
    expect(isAbsolutePath("notes/foo")).toBe(false);
    expect(isAbsolutePath("./foo")).toBe(false);
    expect(isAbsolutePath("")).toBe(false);
  });
});

describe("detectSeparator", () => {
  it("defaults to forward slash for empty input", () => {
    expect(detectSeparator("")).toBe("/");
  });

  it("picks backslash for pure-backslash paths", () => {
    expect(detectSeparator("C:\\Users\\Alice")).toBe("\\");
  });

  it("picks forward slash for POSIX paths", () => {
    expect(detectSeparator("/home/alice/notes")).toBe("/");
  });

  it("counts dominant separator on mixed paths", () => {
    expect(detectSeparator("C:\\Users\\Alice/Notes")).toBe("\\");
    expect(detectSeparator("/home/alice/foo\\bar")).toBe("/");
  });
});

describe("joinPath", () => {
  it("joins POSIX segments with /", () => {
    expect(joinPath("/home/alice", "notes", "topic.md")).toBe(
      "/home/alice/notes/topic.md",
    );
  });

  it("joins Windows segments with \\", () => {
    expect(joinPath("C:\\Users\\Alice", "Notes", "topic.md")).toBe(
      "C:\\Users\\Alice\\Notes\\topic.md",
    );
  });

  it("strips trailing + leading separators inside segments", () => {
    expect(joinPath("/root/", "/a/", "/b/")).toBe("/root/a/b");
  });

  it("drops empty segments", () => {
    expect(joinPath("/root", "", "child")).toBe("/root/child");
  });

  it("returns empty string for all-empty input", () => {
    expect(joinPath("", "", "")).toBe("");
  });
});

describe("splitFolderPath", () => {
  it("returns empty array for empty input", () => {
    expect(splitFolderPath("")).toEqual([]);
  });

  it("splits POSIX paths", () => {
    expect(splitFolderPath("Parent/Child/Grandchild")).toEqual([
      "Parent",
      "Child",
      "Grandchild",
    ]);
  });

  it("splits Windows paths", () => {
    expect(splitFolderPath("Parent\\Child\\Grandchild")).toEqual([
      "Parent",
      "Child",
      "Grandchild",
    ]);
  });

  it("collapses consecutive separators", () => {
    expect(splitFolderPath("Parent//Child")).toEqual(["Parent", "Child"]);
    expect(splitFolderPath("Parent\\\\Child")).toEqual(["Parent", "Child"]);
  });

  it("trims whitespace and drops empties", () => {
    expect(splitFolderPath(" Parent / / Child ")).toEqual(["Parent", "Child"]);
  });
});

describe("resolveVaultPath", () => {
  it("nests note inside folder hierarchy (POSIX)", () => {
    expect(
      resolveVaultPath("/vault", "Parent/Child", "topic.md"),
    ).toBe("/vault/Parent/Child/topic.md");
  });

  it("routes root note straight under vault", () => {
    expect(resolveVaultPath("/vault", "", "topic.md")).toBe("/vault/topic.md");
  });

  it("matches the vault separator on Windows", () => {
    expect(
      resolveVaultPath("C:\\Vault", "Parent/Child", "topic.md"),
    ).toBe("C:\\Vault\\Parent\\Child\\topic.md");
  });
});
