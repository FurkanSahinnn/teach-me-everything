import { describe, expect, it } from "vitest";
import { DEFAULT_NOTE_EDITOR_PREFS, type NoteEditorPrefs } from "@/lib/notes/editor-prefs";
import { migratePrefs } from "./prefs";

type MigratedShape = {
  noteEditor: NoteEditorPrefs;
  agentCli: unknown;
  modelBindings?: unknown;
};

describe("prefs v26 migration — noteEditor", () => {
  it("seeds default noteEditor prefs for a v25 user", () => {
    const next = migratePrefs({ theme: "github", agentCli: {} }, 25) as unknown as MigratedShape;
    expect(next.noteEditor).toEqual(DEFAULT_NOTE_EDITOR_PREFS);
  });

  it("leaves unrelated v25 fields untouched", () => {
    const bindings = { chat: "anthropic::x" };
    const next = migratePrefs(
      { theme: "github", agentCli: { path: "/bin/claude" }, modelBindings: bindings },
      25,
    ) as unknown as MigratedShape;
    expect(next.agentCli).toEqual({ path: "/bin/claude" });
  });

  it("repairs a partially written noteEditor payload instead of resetting it", () => {
    const next = migratePrefs(
      { theme: "github", agentCli: {}, noteEditor: { editorWidth: 900, toolbarMode: "bogus" } },
      25,
    ) as unknown as MigratedShape;
    expect(next.noteEditor.editorWidth).toBe(900);
    expect(next.noteEditor.toolbarMode).toBe("top");
  });
});
