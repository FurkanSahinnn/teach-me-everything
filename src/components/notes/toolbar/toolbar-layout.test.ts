import { describe, expect, it } from "vitest";
import { TOOLBAR_ITEM_IDS } from "@/lib/notes/editor-prefs";
import {
  BUTTON_WIDTH,
  DIVIDER_WIDTH,
  computeToolbarLayout,
  resolveToolbarItems,
  rowWidth,
  toolbarItemSpec,
} from "./toolbar-layout";

describe("rowWidth", () => {
  it("adds a divider between groups only", () => {
    const items = resolveToolbarItems(["undo", "redo", "bold"]);
    expect(rowWidth(items)).toBe(BUTTON_WIDTH * 3 + 2 * 2 + DIVIDER_WIDTH);
  });
});

describe("computeToolbarLayout", () => {
  const all = resolveToolbarItems(TOOLBAR_ITEM_IDS);

  it("keeps everything visible when the row fits", () => {
    const layout = computeToolbarLayout(all, 5_000);
    expect(layout.overflow).toEqual([]);
    expect(layout.visible).toHaveLength(all.length);
  });

  it("moves trailing commands into overflow in a narrow pane", () => {
    const layout = computeToolbarLayout(all, 420);
    expect(layout.visible.length).toBeGreaterThan(0);
    expect(layout.visible.length + layout.overflow.length).toBe(all.length);
    expect(rowWidth(layout.visible)).toBeLessThanOrEqual(420);
  });

  it("never splits a group between the row and the overflow menu", () => {
    for (let width = 120; width < 1100; width += 37) {
      const { visible, overflow } = computeToolbarLayout(all, width);
      const last = visible.at(-1);
      const first = overflow[0];
      if (last && first) expect(last.group).not.toBe(first.group);
    }
  });

  it("drops unknown ids from saved preferences", () => {
    expect(resolveToolbarItems(["bold", "rocket"]).map((i) => i.id)).toEqual(["bold"]);
  });

  it("marks dropdown commands as menus", () => {
    expect(toolbarItemSpec("heading").kind).toBe("menu");
    expect(toolbarItemSpec("bold").kind).toBe("button");
  });
});
