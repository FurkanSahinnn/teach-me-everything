/**
 * Phase 6.3 — Heading scale + marker hide.
 *
 * For every ATX heading inside the visible viewport we:
 *   1. Apply a line decoration (`cm-tme-h{1..6}`) so the entire line picks
 *      up the heading font-size from the live-preview theme. The class is
 *      added unconditionally — heading size shouldn't shrink just because
 *      the cursor lands on it.
 *   2. If the line is inactive, hide the `# ` prefix (and its trailing
 *      space) via `Decoration.replace({})`. On the active line the prefix
 *      stays visible so the writer can edit it.
 *
 * Setext headings (`====` / `----` underlines) are NOT styled — they are
 * rarely written by hand in TME's audience and the underline syntax pulls
 * the rendering across two lines which collides badly with the cursor-aware
 * "show raw on active line" rule.
 */

import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import { Decoration } from "@codemirror/view";
import type { DecoSpec } from "./types";

const HEADING_NODE_RE = /^ATXHeading([1-6])$/;
const HIDE_MARK = Decoration.replace({});

const LINE_DECOS: Record<number, ReturnType<typeof Decoration.line>> = {
  1: Decoration.line({ attributes: { class: "cm-tme-h1" } }),
  2: Decoration.line({ attributes: { class: "cm-tme-h2" } }),
  3: Decoration.line({ attributes: { class: "cm-tme-h3" } }),
  4: Decoration.line({ attributes: { class: "cm-tme-h4" } }),
  5: Decoration.line({ attributes: { class: "cm-tme-h5" } }),
  6: Decoration.line({ attributes: { class: "cm-tme-h6" } }),
};

export function buildHeadingDecorations(
  state: EditorState,
  activeLines: Set<number>,
  from: number,
  to: number,
  out: DecoSpec[],
): void {
  syntaxTree(state).iterate({
    from,
    to,
    enter(node) {
      const match = HEADING_NODE_RE.exec(node.name);
      if (!match) return;
      const level = Number.parseInt(match[1]!, 10);
      const line = state.doc.lineAt(node.from);

      // Always: line class for font scale.
      out.push({ from: line.from, to: line.from, deco: LINE_DECOS[level]! });

      // Inactive: collapse the `# ` prefix so the heading reads as prose.
      if (!activeLines.has(line.number)) {
        const headerMark = node.node.getChild("HeaderMark");
        if (headerMark) {
          // HeaderMark covers `#` chars only — extend by 1 to swallow the
          // space that follows (clamped to line end to stay safe on a bare
          // `#` with no content).
          const hideTo = Math.min(headerMark.to + 1, line.to);
          out.push({ from: headerMark.from, to: hideTo, deco: HIDE_MARK });
        }
      }
    },
  });
}
