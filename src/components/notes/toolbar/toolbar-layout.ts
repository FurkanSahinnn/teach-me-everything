/**
 * Toolbar geometry: which commands fit on one row and which move into the
 * overflow ("»") menu.
 *
 * The old toolbar wrapped onto a second row in a narrow pane, pushing the
 * note down and splitting groups mid-way. Widths are fixed per control kind,
 * so the split is computed arithmetically from the container width, with no
 * DOM measuring loop.
 */

import { TOOLBAR_ITEM_IDS, type ToolbarItemId } from "@/lib/notes/editor-prefs";

export type ToolbarControlKind = "button" | "menu";

export type ToolbarItemSpec = {
  id: ToolbarItemId;
  group: string;
  kind: ToolbarControlKind;
};

export const BUTTON_WIDTH = 30;
export const MENU_WIDTH = 42;
export const DIVIDER_WIDTH = 11;
export const OVERFLOW_TRIGGER_WIDTH = 34;
const GAP = 2;

const GROUP_OF: Record<ToolbarItemId, string> = {
  undo: "history",
  redo: "history",
  formatPainter: "tools",
  clearFormatting: "tools",
  heading: "heading",
  bold: "inline",
  italic: "inline",
  underline: "inline",
  strike: "inline",
  highlight: "color",
  textColor: "color",
  superscript: "script",
  subscript: "script",
  inlineCode: "script",
  bulletList: "lists",
  orderedList: "lists",
  taskList: "lists",
  outdent: "indent",
  indent: "indent",
  align: "indent",
  blockquote: "blocks",
  callout: "blocks",
  codeBlock: "blocks",
  table: "blocks",
  horizontalRule: "blocks",
  link: "insert",
  wikilink: "insert",
  image: "insert",
  math: "insert",
  footnote: "insert",
};

const MENU_ITEMS = new Set<ToolbarItemId>([
  "heading",
  "highlight",
  "textColor",
  "align",
  "callout",
  "table",
  "math",
]);

export function toolbarItemSpec(id: ToolbarItemId): ToolbarItemSpec {
  return { id, group: GROUP_OF[id], kind: MENU_ITEMS.has(id) ? "menu" : "button" };
}

export function widthOf(kind: ToolbarControlKind): number {
  return kind === "menu" ? MENU_WIDTH : BUTTON_WIDTH;
}

/** Keep the user's chosen order but only ids the toolbar knows. */
export function resolveToolbarItems(ids: readonly string[]): ToolbarItemSpec[] {
  const known = new Set<string>(TOOLBAR_ITEM_IDS);
  return ids.filter((id): id is ToolbarItemId => known.has(id)).map(toolbarItemSpec);
}

export type ToolbarLayout = {
  visible: ToolbarItemSpec[];
  overflow: ToolbarItemSpec[];
};

/** Row width of `items`, including a divider wherever the group changes. */
export function rowWidth(items: readonly ToolbarItemSpec[]): number {
  let total = 0;
  items.forEach((item, i) => {
    const prev = items[i - 1];
    if (prev && prev.group !== item.group) total += DIVIDER_WIDTH;
    total += widthOf(item.kind) + (i > 0 ? GAP : 0);
  });
  return total;
}

export function computeToolbarLayout(
  items: readonly ToolbarItemSpec[],
  available: number,
): ToolbarLayout {
  if (rowWidth(items) <= available) return { visible: [...items], overflow: [] };
  const budget = available - OVERFLOW_TRIGGER_WIDTH - GAP;
  let count = 0;
  while (count < items.length && rowWidth(items.slice(0, count + 1)) <= budget) count += 1;
  // Don't strand a lone control from a group at the row's end: if the cut
  // falls inside a group, move the whole group into the overflow menu.
  const cut = items[count];
  if (cut && count > 0 && items[count - 1]?.group === cut.group) {
    let start = count;
    while (start > 0 && items[start - 1]?.group === cut.group) start -= 1;
    if (start > 0) count = start;
  }
  return { visible: items.slice(0, count), overflow: items.slice(count) };
}
