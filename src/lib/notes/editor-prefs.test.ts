import { describe, expect, it } from "vitest";
import {
  DEFAULT_NOTE_EDITOR_PREFS,
  EDITOR_WIDTH_MAX,
  EDITOR_WIDTH_MIN,
  TOOLBAR_ITEM_IDS,
  percentFromWidth,
  pushRecentColor,
  readFrontmatterEditorWidth,
  sanitizeNoteEditorPrefs,
  widthFromPercent,
} from "./editor-prefs";

describe("sanitizeNoteEditorPrefs", () => {
  it("returns defaults for a missing payload", () => {
    expect(sanitizeNoteEditorPrefs(undefined)).toEqual(DEFAULT_NOTE_EDITOR_PREFS);
  });

  it("keeps valid fields and repairs invalid ones", () => {
    const next = sanitizeNoteEditorPrefs({
      editorWidth: 9999,
      fontSize: "big",
      toolbarMode: "floating",
      toolbarItems: ["bold", "nope", "bold", "italic"],
      textColors: ["#FF0000", "red;background:url(x)", "#00ff00"],
      spellcheck: true,
    });
    expect(next.editorWidth).toBe(EDITOR_WIDTH_MAX);
    expect(next.fontSize).toBe(DEFAULT_NOTE_EDITOR_PREFS.fontSize);
    expect(next.toolbarMode).toBe("floating");
    expect(next.toolbarItems).toEqual(["bold", "italic"]);
    expect(next.textColors).toEqual(["#ff0000", "#00ff00"]);
    expect(next.spellcheck).toBe(true);
  });

  it("falls back to the full toolbar when items are not an array", () => {
    expect(sanitizeNoteEditorPrefs({ toolbarItems: "bold" }).toolbarItems).toEqual([
      ...TOOLBAR_ITEM_IDS,
    ]);
  });

  it("falls back to the default palette when every colour is invalid", () => {
    expect(sanitizeNoteEditorPrefs({ backgroundColors: ["expression(x)"] }).backgroundColors).toEqual(
      DEFAULT_NOTE_EDITOR_PREFS.backgroundColors,
    );
  });
});

describe("pushRecentColor", () => {
  it("moves an existing colour to the front without duplicating it", () => {
    expect(pushRecentColor(["#111111", "#222222"], "#222222")).toEqual(["#222222", "#111111"]);
  });

  it("ignores values that are not hex colours", () => {
    expect(pushRecentColor(["#111111"], "url(x)")).toEqual(["#111111"]);
  });

  it("caps the list at eight colours", () => {
    const many = Array.from({ length: 8 }, (_, i) => `#00000${i}`);
    expect(pushRecentColor(many, "#ffffff")).toHaveLength(8);
  });
});

describe("readFrontmatterEditorWidth", () => {
  it("maps editor-width 0..100 onto the pixel range", () => {
    expect(readFrontmatterEditorWidth("---\neditor-width: 0\n---\n# T")).toBe(EDITOR_WIDTH_MIN);
    expect(readFrontmatterEditorWidth("---\neditor-width: 100\n---\n")).toBe(EDITOR_WIDTH_MAX);
  });

  it("returns null without frontmatter or with an out-of-range value", () => {
    expect(readFrontmatterEditorWidth("# Title\neditor-width: 50")).toBeNull();
    expect(readFrontmatterEditorWidth("---\neditor-width: 140\n---\n")).toBeNull();
  });

  it("round-trips through the percent helpers", () => {
    expect(percentFromWidth(widthFromPercent(40))).toBe(40);
  });
});
