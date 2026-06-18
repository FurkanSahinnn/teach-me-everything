import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NoteRecord } from "@/lib/db/types";

const listNotesByWorkspace = vi.fn<(ws: string) => Promise<NoteRecord[]>>();

vi.mock("@/lib/db/notes", () => ({
  listNotesByWorkspace: (ws: string) => listNotesByWorkspace(ws),
}));

const { buildNotesContext } = await import("./notes");

function note(partial: Partial<NoteRecord>): NoteRecord {
  return {
    id: partial.id ?? "note_1",
    workspaceId: "ws_1",
    folderId: null,
    title: partial.title ?? "Untitled",
    content: partial.content ?? "",
    tags: partial.tags ?? [],
    wikilinks: [],
    path: "untitled.md",
    createdAt: 1,
    updatedAt: partial.updatedAt ?? 1,
    ...partial,
  };
}

beforeEach(() => {
  listNotesByWorkspace.mockReset();
});

describe("buildNotesContext", () => {
  it("returns null on an empty workspace (no throw)", async () => {
    listNotesByWorkspace.mockResolvedValue([]);
    await expect(buildNotesContext("ws_1")).resolves.toBeNull();
  });

  it("renders title + excerpt + tags and strips the leading H1", async () => {
    listNotesByWorkspace.mockResolvedValue([
      note({
        title: "Quantum Field Theory",
        tags: ["fizik", "qft"],
        content:
          "# Quantum Field Theory\n\nA framework combining classical fields, special relativity, and quantum mechanics.",
      }),
    ]);
    const block = await buildNotesContext("ws_1");
    expect(block).not.toBeNull();
    expect(block?.kind).toBe("notes");
    expect(block?.text).toContain("Quantum Field Theory");
    expect(block?.text).toContain("#fizik");
    expect(block?.text).toContain("framework combining classical fields");
    // The leading "# Quantum Field Theory" heading is not echoed in the body.
    expect(block?.text).not.toContain("# Quantum Field Theory");
  });

  it("token-budgets so a huge note set stays bounded", async () => {
    const big = Array.from({ length: 50 }, (_, i) =>
      note({
        id: `note_${i}`,
        title: `Note ${i}`,
        content: "lorem ipsum dolor sit amet ".repeat(200),
      }),
    );
    listNotesByWorkspace.mockResolvedValue(big);
    const block = await buildNotesContext("ws_1");
    expect(block).not.toBeNull();
    // Approx 1500 tokens → ~6000 chars; allow the ellipsis + small overshoot.
    expect((block?.text.length ?? 0)).toBeLessThanOrEqual(6100);
  });
});
