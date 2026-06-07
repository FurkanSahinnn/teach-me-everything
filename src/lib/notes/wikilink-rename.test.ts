import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renameNoteTitleWithSweep, renameWikilink } from "./wikilink-rename";
import { createNote, getNote } from "@/lib/db/notes";
import {
  createNoteSource,
  getNoteSourceByNoteId,
} from "@/lib/db/sources";
import { db } from "@/lib/db/schema";
import { createWorkspace } from "@/lib/db/workspaces";

describe("renameWikilink — pure", () => {
  it("rewrites a bare [[old]] to [[new]]", () => {
    const out = renameWikilink("see [[Old Note]] for context", "Old Note", "New Note");
    expect(out).toBe("see [[New Note]] for context");
  });

  it("rewrites every occurrence in the document", () => {
    const out = renameWikilink(
      "[[Old]] said [[Old]] again, then [[Old]]",
      "Old",
      "Renamed",
    );
    expect(out).toBe("[[Renamed]] said [[Renamed]] again, then [[Renamed]]");
  });

  it("preserves the alias when present", () => {
    const out = renameWikilink("[[Old|see this]]", "Old", "New");
    expect(out).toBe("[[New|see this]]");
  });

  it("matches case-insensitively but emits the new title verbatim", () => {
    const out = renameWikilink("[[old NOTE]]", "Old Note", "NEW title");
    expect(out).toBe("[[NEW title]]");
  });

  it("leaves non-matching wikilinks alone", () => {
    const out = renameWikilink("[[Other]] and [[Old]]", "Old", "New");
    expect(out).toBe("[[Other]] and [[New]]");
  });

  it("leaves escaped wikilinks (\\[[old]]) alone", () => {
    const out = renameWikilink("\\[[Old]] is literal, [[Old]] is real", "Old", "New");
    expect(out).toBe("\\[[Old]] is literal, [[New]] is real");
  });

  it("does not touch wikilinks inside fenced code blocks", () => {
    const input = "```\n[[Old]]\n```\n[[Old]] outside";
    const out = renameWikilink(input, "Old", "New");
    expect(out).toBe("```\n[[Old]]\n```\n[[New]] outside");
  });

  it("does not touch wikilinks inside inline code spans", () => {
    const out = renameWikilink("a `[[Old]]` b [[Old]] c", "Old", "New");
    expect(out).toBe("a `[[Old]]` b [[New]] c");
  });

  it("never rewrites kind-prefixed targets (source:/concept:/note:)", () => {
    const out = renameWikilink(
      "[[source:Old]] [[concept:Old]] [[note:Old]] [[Old]]",
      "Old",
      "New",
    );
    expect(out).toBe("[[source:Old]] [[concept:Old]] [[note:Old]] [[New]]");
  });

  it("does not partial-match a substring inside another title", () => {
    const out = renameWikilink("[[OldX]] [[XOld]] [[Old]]", "Old", "New");
    expect(out).toBe("[[OldX]] [[XOld]] [[New]]");
  });

  it("returns input unchanged when oldTitle is empty", () => {
    const out = renameWikilink("[[Old]]", "", "New");
    expect(out).toBe("[[Old]]");
  });

  it("returns input unchanged when old equals new", () => {
    const out = renameWikilink("[[Old]]", "Old", "Old");
    expect(out).toBe("[[Old]]");
  });

  it("preserves whitespace inside the brackets", () => {
    const out = renameWikilink("[[  Old  ]]", "Old", "New");
    expect(out).toBe("[[  New  ]]");
  });

  it("handles Turkish characters", () => {
    const out = renameWikilink("[[Çoklu İşlemci]]", "Çoklu İşlemci", "Paralel İşlemci");
    expect(out).toBe("[[Paralel İşlemci]]");
  });

  it("does not rewrite [[]]  (empty target)", () => {
    const out = renameWikilink("[[]] vs [[Old]]", "Old", "New");
    expect(out).toBe("[[]] vs [[New]]");
  });

  it("handles adjacent wikilinks ([[a]][[b]]) without joining them", () => {
    const out = renameWikilink("[[Old]][[Old]]", "Old", "New");
    expect(out).toBe("[[New]][[New]]");
  });
});

// Phase 6.9 — Notes-as-Source. The rename-sweep already keeps the renamed
// note's H1 and every backlink in sync; this block locks in the third leg:
// any linked SourceRecord (a note embedded as a source via Phase 6.9
// editor toolbar) must follow the new title atomically, inside the same
// rw transaction.
describe("renameNoteTitleWithSweep — Dexie", () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
  });

  afterEach(async () => {
    await db.delete();
  });

  it("updates a linked note-source's title in the same transaction as the H1 swap", async () => {
    const ws = await createWorkspace({
      name: "Physics",
      color: "#000",
      initials: "PH",
    });
    const note = await createNote({
      workspaceId: ws.id,
      content: "# Original Title\n\nBody.",
    });
    const source = await createNoteSource({
      noteId: note.id,
      workspaceId: ws.id,
    });
    expect(source.title).toBe("Original Title");

    const result = await renameNoteTitleWithSweep(note.id, "Renamed Title");
    expect(result.oldTitle).toBe("Original Title");

    const renamedSource = await getNoteSourceByNoteId(note.id);
    expect(renamedSource?.title).toBe("Renamed Title");

    // Sanity: the note itself also picked up the new title via H1 swap.
    const renamedNote = await getNote(note.id);
    expect(renamedNote?.title).toBe("Renamed Title");
  });
});
