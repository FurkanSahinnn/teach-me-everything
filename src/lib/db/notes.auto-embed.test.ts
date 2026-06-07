/**
 * Phase 6.9.5 — `setNoteAutoEmbed` repo helper.
 *
 * The setter has two contracts the auto-sync timer relies on:
 *   1. it round-trips the boolean into Dexie without touching title /
 *      tags / wikilinks / path (those projections are content-derived;
 *      flipping the flag must not nudge them),
 *   2. it bumps `updatedAt` on every flip so cross-tab live queries
 *      reactively pick up the change.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createNote, getNote, setNoteAutoEmbed } from "./notes";
import { db } from "./schema";
import { createWorkspace } from "./workspaces";

beforeEach(async () => {
  await db.delete();
  await db.open();
});

afterEach(async () => {
  await db.delete();
});

describe("setNoteAutoEmbed", () => {
  it("defaults to undefined and flips to true on demand", async () => {
    const ws = await createWorkspace({
      name: "W",
      color: "#000",
      initials: "W",
    });
    const note = await createNote({
      workspaceId: ws.id,
      content: "# Hello\n\n[[Friend]]",
    });
    expect(note.autoEmbedOnSave).toBeUndefined();

    await setNoteAutoEmbed(note.id, true);
    const after = await getNote(note.id);
    expect(after?.autoEmbedOnSave).toBe(true);
  });

  it("flips back to false on a subsequent call", async () => {
    const ws = await createWorkspace({
      name: "W",
      color: "#000",
      initials: "W",
    });
    const note = await createNote({ workspaceId: ws.id, content: "# Hi" });

    await setNoteAutoEmbed(note.id, true);
    await setNoteAutoEmbed(note.id, false);

    const after = await getNote(note.id);
    expect(after?.autoEmbedOnSave).toBe(false);
  });

  it("preserves title + tags + wikilinks + path (no content reprojection)", async () => {
    const ws = await createWorkspace({
      name: "W",
      color: "#000",
      initials: "W",
    });
    const note = await createNote({
      workspaceId: ws.id,
      content: "# Quantum\n\n[[Source A]]\n\n#fizik",
    });
    const titleBefore = note.title;
    const tagsBefore = note.tags;
    const wikilinksBefore = note.wikilinks;
    const pathBefore = note.path;

    await setNoteAutoEmbed(note.id, true);
    const after = await getNote(note.id);
    expect(after?.title).toBe(titleBefore);
    expect(after?.tags).toEqual(tagsBefore);
    expect(after?.wikilinks).toEqual(wikilinksBefore);
    expect(after?.path).toBe(pathBefore);
  });

  it("bumps updatedAt", async () => {
    const ws = await createWorkspace({
      name: "W",
      color: "#000",
      initials: "W",
    });
    const note = await createNote({ workspaceId: ws.id, content: "# Hi" });
    const before = note.updatedAt;
    await new Promise((r) => setTimeout(r, 5));
    await setNoteAutoEmbed(note.id, true);
    const after = await getNote(note.id);
    expect(after?.updatedAt).toBeGreaterThan(before);
  });

  it("is a no-op for an unknown note id", async () => {
    // No-op contract — never throws, never inserts a phantom row. The
    // auto-sync timer relies on this when a note is deleted mid-debounce.
    await expect(setNoteAutoEmbed("note_does_not_exist", true)).resolves.toBeUndefined();
    const fetched = await getNote("note_does_not_exist");
    expect(fetched).toBeUndefined();
  });
});
