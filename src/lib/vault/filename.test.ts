import { describe, it, expect } from "vitest";
import {
  buildMarkdownFilename,
  MAX_FILENAME_LENGTH,
  MD_EXTENSION,
  slugifyFilename,
} from "./filename";

describe("slugifyFilename", () => {
  it("preserves a clean title", () => {
    expect(slugifyFilename("Hello World")).toBe("Hello World");
  });

  it("preserves Turkish letters", () => {
    expect(slugifyFilename("Çiğ köfte tarifi")).toBe("Çiğ köfte tarifi");
  });

  it("replaces forbidden NTFS chars with hyphens", () => {
    expect(slugifyFilename("Q&A: Why?")).toBe("Q&A- Why-");
  });

  it("collapses consecutive hyphens", () => {
    expect(slugifyFilename("foo??bar")).toBe("foo-bar");
  });

  it("strips control characters", () => {
    expect(slugifyFilename("foobar")).toBe("foo-bar");
  });

  it("returns 'untitled' for empty / whitespace input", () => {
    expect(slugifyFilename("")).toBe("untitled");
    expect(slugifyFilename("   ")).toBe("untitled");
  });

  it("trims NTFS-forbidden trailing dot + space", () => {
    expect(slugifyFilename("Hello. ")).toBe("Hello");
    expect(slugifyFilename("Hello...")).toBe("Hello");
  });

  it("suffixes NTFS reserved names so CON doesn't collide", () => {
    expect(slugifyFilename("CON")).toBe("CON-note");
    expect(slugifyFilename("com1")).toBe("com1-note");
    expect(slugifyFilename("LPT9")).toBe("LPT9-note");
  });

  it("hard caps at MAX_FILENAME_LENGTH", () => {
    const long = "a".repeat(300);
    const slug = slugifyFilename(long);
    expect(slug.length).toBeLessThanOrEqual(MAX_FILENAME_LENGTH);
  });
});

describe("buildMarkdownFilename", () => {
  it("returns `{slug}.md` when under MAX_PATH", () => {
    const out = buildMarkdownFilename("/vault/notes", "topic", "abc123");
    expect(out).toBe(`topic${MD_EXTENSION}`);
  });

  it("returns 'untitled.md' when slug is empty", () => {
    const out = buildMarkdownFilename("/vault/notes", "", "abc123");
    expect(out).toBe(`untitled${MD_EXTENSION}`);
  });

  it("truncates + adds unique suffix when path overflows Windows MAX_PATH", () => {
    const deepDir =
      "C:\\Users\\AVeryLongUserName\\Documents\\TeachMeEverything\\Workspaces\\Project\\Subfolder\\Deeper\\EvenDeeper\\AlmostThere\\Final";
    const longSlug = "a".repeat(220);
    const out = buildMarkdownFilename(deepDir, longSlug, "abcdef");
    expect(out.endsWith(`-abcdef${MD_EXTENSION}`)).toBe(true);
    // The full path stays under 260 - it's a Windows constraint.
    expect((deepDir + "\\" + out).length).toBeLessThanOrEqual(260);
  });

  it("limits unique suffix to 6 chars", () => {
    const deepDir = "C:\\" + "x".repeat(200);
    const longSlug = "a".repeat(80);
    const out = buildMarkdownFilename(
      deepDir,
      longSlug,
      "abcdef123456789",
    );
    // The suffix should be the FIRST 6 chars, so "abcdef".
    expect(out).toMatch(/-abcdef\.md$/);
  });

  it("falls back to a single 'n' when budget runs out", () => {
    // Pathological case — parent dir longer than MAX_PATH itself.
    const insaneDir = "C:\\" + "y".repeat(300);
    const out = buildMarkdownFilename(insaneDir, "title", "abc123");
    expect(out.startsWith("n-")).toBe(true);
    expect(out.endsWith(MD_EXTENSION)).toBe(true);
  });
});
