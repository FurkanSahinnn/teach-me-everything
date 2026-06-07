import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createNoteSource,
  createSource,
  listNoteSourcesByWorkspace,
} from "./sources";
import { createNote } from "./notes";
import { db } from "./schema";
import { createWorkspace } from "./workspaces";

beforeEach(async () => {
  await db.delete();
  await db.open();
});

afterEach(async () => {
  await db.delete();
});

describe("listNoteSourcesByWorkspace (Phase 6.9.8)", () => {
  it("returns only sources whose type is 'note' for the given workspace", async () => {
    const ws = await createWorkspace({
      name: "Phys",
      color: "#000",
      initials: "PH",
    });
    const otherWs = await createWorkspace({
      name: "Bio",
      color: "#111",
      initials: "BI",
    });

    const note1 = await createNote({
      workspaceId: ws.id,
      content: "# Note one\n\nbody",
    });
    const note2 = await createNote({
      workspaceId: ws.id,
      content: "# Note two\n\nbody",
    });
    await createNoteSource({ noteId: note1.id, workspaceId: ws.id });
    await createNoteSource({ noteId: note2.id, workspaceId: ws.id });

    // Mix in a PDF + a URL source in the same workspace so we can prove the
    // filter actually narrows by type, not workspace alone.
    await createSource({
      workspaceId: ws.id,
      type: "pdf",
      title: "Decoy PDF",
    });
    await createSource({
      workspaceId: ws.id,
      type: "url",
      title: "Decoy URL",
      url: "https://example.com",
    });

    // A note in a sibling workspace must not leak in.
    const stranger = await createNote({
      workspaceId: otherWs.id,
      content: "# Sibling note\n\n",
    });
    await createNoteSource({ noteId: stranger.id, workspaceId: otherWs.id });

    const rows = await listNoteSourcesByWorkspace(ws.id);
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.type).toBe("note");
      expect(r.workspaceId).toBe(ws.id);
    }
    const noteIds = new Set(rows.map((r) => r.noteId));
    expect(noteIds).toEqual(new Set([note1.id, note2.id]));
  });

  it("returns an empty array when the workspace has no note-sources", async () => {
    const ws = await createWorkspace({
      name: "Empty",
      color: "#000",
      initials: "EM",
    });
    await createSource({ workspaceId: ws.id, type: "pdf", title: "Just PDF" });
    expect(await listNoteSourcesByWorkspace(ws.id)).toEqual([]);
  });
});
