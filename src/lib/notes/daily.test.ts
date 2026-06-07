import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildDailyTitle,
  buildHighlightExtractContent,
  findOrCreateDailyNote,
  formatDateForLocale,
  getDefaultDailyFolderName,
  getDefaultDailyTemplate,
  renderDailyTemplate,
} from "./daily";
import { db } from "@/lib/db/schema";
import { createWorkspace } from "@/lib/db/workspaces";

describe("daily / pure helpers", () => {
  describe("formatDateForLocale", () => {
    it("formats TR as DD-MM-YYYY with zero-padding", () => {
      const d = new Date(2026, 4, 7); // 7 May 2026 (local time)
      expect(formatDateForLocale(d, "tr")).toBe("07-05-2026");
    });

    it("formats EN as YYYY-MM-DD with zero-padding", () => {
      const d = new Date(2026, 0, 3); // 3 Jan 2026
      expect(formatDateForLocale(d, "en")).toBe("2026-01-03");
    });

    it("zero-pads single-digit day + month", () => {
      const d = new Date(2026, 8, 9); // 9 Sept 2026
      expect(formatDateForLocale(d, "tr")).toBe("09-09-2026");
      expect(formatDateForLocale(d, "en")).toBe("2026-09-09");
    });

    it("preserves four-digit year for far-future dates", () => {
      const d = new Date(3000, 11, 31);
      expect(formatDateForLocale(d, "en")).toBe("3000-12-31");
      expect(formatDateForLocale(d, "tr")).toBe("31-12-3000");
    });
  });

  describe("getDefaultDailyFolderName", () => {
    it("returns Günlük for TR", () => {
      expect(getDefaultDailyFolderName("tr")).toBe("Günlük");
    });
    it("returns Daily for EN", () => {
      expect(getDefaultDailyFolderName("en")).toBe("Daily");
    });
  });

  describe("getDefaultDailyTemplate", () => {
    it("includes Bugün öğrendiklerim for TR", () => {
      expect(getDefaultDailyTemplate("tr")).toContain("Bugün öğrendiklerim");
      expect(getDefaultDailyTemplate("tr")).toContain("# Daily-{{date}}");
    });
    it("includes What I learned today for EN", () => {
      expect(getDefaultDailyTemplate("en")).toContain("What I learned today");
      expect(getDefaultDailyTemplate("en")).toContain("# Daily-{{date}}");
    });
  });

  describe("renderDailyTemplate", () => {
    it("substitutes {{date}} once", () => {
      const out = renderDailyTemplate("Hello {{date}}", {
        dateString: "07-05-2026",
        locale: "tr",
      });
      expect(out).toBe("Hello 07-05-2026");
    });

    it("substitutes multiple {{date}} occurrences", () => {
      const out = renderDailyTemplate("{{date}} / {{date}} again", {
        dateString: "2026-05-07",
        locale: "en",
      });
      expect(out).toBe("2026-05-07 / 2026-05-07 again");
    });

    it("substitutes {{locale}}", () => {
      const out = renderDailyTemplate("Locale: {{locale}}", {
        dateString: "x",
        locale: "tr",
      });
      expect(out).toBe("Locale: tr");
    });

    it("tolerates whitespace inside {{ ... }}", () => {
      const out = renderDailyTemplate("[{{ date }}] - {{  locale  }}", {
        dateString: "07-05-2026",
        locale: "tr",
      });
      expect(out).toBe("[07-05-2026] - tr");
    });

    it("leaves unknown tokens intact", () => {
      const out = renderDailyTemplate("{{custom}} {{date}}", {
        dateString: "07-05-2026",
        locale: "tr",
      });
      expect(out).toBe("{{custom}} 07-05-2026");
    });

    it("renders the default TR template into a valid markdown H1", () => {
      const out = renderDailyTemplate(getDefaultDailyTemplate("tr"), {
        dateString: "07-05-2026",
        locale: "tr",
      });
      expect(out.startsWith("# Daily-07-05-2026\n")).toBe(true);
    });
  });

  describe("buildDailyTitle", () => {
    it("prefixes Daily-", () => {
      expect(buildDailyTitle("07-05-2026")).toBe("Daily-07-05-2026");
      expect(buildDailyTitle("2026-05-07")).toBe("Daily-2026-05-07");
    });
  });

  describe("buildHighlightExtractContent", () => {
    it("uses the excerpt as title when ≤80 chars", () => {
      const out = buildHighlightExtractContent({
        excerpt: "Quantum field theory is hard.",
        sourceId: "src-1",
      });
      expect(out).toContain("# Quantum field theory is hard.");
      expect(out).toContain("> Quantum field theory is hard.");
      expect(out).toContain("Source: [[source:src-1]]");
    });

    it("truncates excerpt past 80 chars with ellipsis", () => {
      const long = "a".repeat(200);
      const out = buildHighlightExtractContent({
        excerpt: long,
        sourceId: "src-1",
      });
      const titleLine = out.split("\n")[0]!;
      expect(titleLine.startsWith("# ")).toBe(true);
      expect(titleLine.length).toBeLessThanOrEqual(2 + 80 + 1); // "# " + 80 + "…"
      expect(titleLine.endsWith("…")).toBe(true);
    });

    it("collapses internal whitespace + newlines in title only", () => {
      const out = buildHighlightExtractContent({
        excerpt: "line one\n\nline   two",
        sourceId: "src-2",
      });
      const titleLine = out.split("\n")[0]!;
      expect(titleLine).toBe("# line one line two");
      // body preserves line break (quoted)
      expect(out).toContain("> line one");
      expect(out).toContain("> line   two");
    });

    it("uses fallback title when excerpt is empty", () => {
      const out = buildHighlightExtractContent({
        excerpt: "",
        sourceId: "src-3",
        fallbackTitle: "Adsız vurgu",
      });
      expect(out.startsWith("# Adsız vurgu")).toBe(true);
    });

    it("emits a quote block per line", () => {
      const out = buildHighlightExtractContent({
        excerpt: "first\nsecond\nthird",
        sourceId: "src-4",
      });
      expect(out).toContain("> first\n> second\n> third");
    });

    it("strips trailing whitespace before the ellipsis at the 80-char cut", () => {
      const excerpt = `${"x".repeat(78)}    end`;
      const out = buildHighlightExtractContent({
        excerpt,
        sourceId: "src-5",
      });
      const titleLine = out.split("\n")[0]!;
      // Title is `# ` + truncated + `…`. Expect no whitespace right before `…`.
      expect(/[^\s]…$/.test(titleLine)).toBe(true);
    });
  });
});

describe("daily / findOrCreateDailyNote", () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
  });

  afterEach(async () => {
    await db.delete();
  });

  it("creates folder + note on cold start", async () => {
    const ws = await createWorkspace({
      name: "Physics",
      color: "#000",
      initials: "PH",
    });
    const { note, created } = await findOrCreateDailyNote({
      workspaceId: ws.id,
      folderName: "Günlük",
      dateString: "07-05-2026",
      template: getDefaultDailyTemplate("tr"),
      locale: "tr",
    });

    expect(created).toBe(true);
    expect(note.title).toBe("Daily-07-05-2026");
    expect(note.path).toBe("Günlük/Daily-07-05-2026.md");
    expect(note.content).toContain("# Daily-07-05-2026");
    expect(note.content).toContain("## Bugün öğrendiklerim");

    const folders = await db.noteFolders.toArray();
    expect(folders).toHaveLength(1);
    expect(folders[0]?.name).toBe("Günlük");
    expect(folders[0]?.path).toBe("Günlük");
  });

  it("is idempotent — second call returns same note", async () => {
    const ws = await createWorkspace({
      name: "Physics",
      color: "#000",
      initials: "PH",
    });
    const first = await findOrCreateDailyNote({
      workspaceId: ws.id,
      folderName: "Günlük",
      dateString: "07-05-2026",
      template: getDefaultDailyTemplate("tr"),
      locale: "tr",
    });
    const second = await findOrCreateDailyNote({
      workspaceId: ws.id,
      folderName: "Günlük",
      dateString: "07-05-2026",
      template: getDefaultDailyTemplate("tr"),
      locale: "tr",
    });

    expect(second.created).toBe(false);
    expect(second.note.id).toBe(first.note.id);

    const all = await db.notes.toArray();
    expect(all).toHaveLength(1);
    const folders = await db.noteFolders.toArray();
    expect(folders).toHaveLength(1);
  });

  it("reuses an existing folder by path", async () => {
    const ws = await createWorkspace({
      name: "Physics",
      color: "#000",
      initials: "PH",
    });
    // First call creates folder + note for day 1.
    await findOrCreateDailyNote({
      workspaceId: ws.id,
      folderName: "Daily",
      dateString: "2026-05-07",
      template: getDefaultDailyTemplate("en"),
      locale: "en",
    });
    // Second call (different day) reuses the folder.
    const day2 = await findOrCreateDailyNote({
      workspaceId: ws.id,
      folderName: "Daily",
      dateString: "2026-05-08",
      template: getDefaultDailyTemplate("en"),
      locale: "en",
    });

    expect(day2.created).toBe(true);
    expect(day2.note.path).toBe("Daily/Daily-2026-05-08.md");
    const folders = await db.noteFolders.toArray();
    expect(folders).toHaveLength(1);
    const notes = await db.notes.toArray();
    expect(notes).toHaveLength(2);
  });

  it("places the note at the vault root when folderName is empty", async () => {
    const ws = await createWorkspace({
      name: "Physics",
      color: "#000",
      initials: "PH",
    });
    const { note, created } = await findOrCreateDailyNote({
      workspaceId: ws.id,
      folderName: "   ", // whitespace-only treated as empty
      dateString: "2026-05-07",
      template: getDefaultDailyTemplate("en"),
      locale: "en",
    });

    expect(created).toBe(true);
    expect(note.folderId).toBeNull();
    expect(note.path).toBe("Daily-2026-05-07.md");
    const folders = await db.noteFolders.toArray();
    expect(folders).toHaveLength(0);
  });

  it("scopes daily notes per workspace", async () => {
    const ws1 = await createWorkspace({
      name: "Physics",
      color: "#000",
      initials: "PH",
    });
    const ws2 = await createWorkspace({
      name: "Chemistry",
      color: "#000",
      initials: "CH",
    });
    const a = await findOrCreateDailyNote({
      workspaceId: ws1.id,
      folderName: "Daily",
      dateString: "2026-05-07",
      template: getDefaultDailyTemplate("en"),
      locale: "en",
    });
    const b = await findOrCreateDailyNote({
      workspaceId: ws2.id,
      folderName: "Daily",
      dateString: "2026-05-07",
      template: getDefaultDailyTemplate("en"),
      locale: "en",
    });

    expect(a.note.id).not.toBe(b.note.id);
    expect(a.note.workspaceId).toBe(ws1.id);
    expect(b.note.workspaceId).toBe(ws2.id);
    expect(await db.noteFolders.count()).toBe(2);
  });
});
