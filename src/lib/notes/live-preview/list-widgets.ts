/**
 * Phase 6.3 — Blockquote + task-checkbox decorations.
 *
 * We iterate every line inside the viewport (cheaper than walking the Lezer
 * tree for line-anchored rules) and emit:
 *
 *   • Blockquote: a line class `cm-tme-blockquote` plus a `replace({})` over
 *     the leading `>` marker(s) on inactive lines so the prose reads
 *     indented. Nested `>>` collapses uniformly.
 *
 *   • Task checkbox: when a list item begins with `- [ ]`, `- [x]`, `* [ ]`,
 *     `+ [x]`, or any whitespace-prefixed variant, the entire `- [x] `
 *     prefix is replaced (on inactive lines) with a clickable checkbox
 *     widget. Click writes the toggled token back via a CM6 transaction so
 *     autosave + undo flow keep working.
 *
 * Plain bullet/numbered lists are intentionally left to the default Markdown
 * highlighting in `@codemirror/lang-markdown` for Phase 6.3 — they already
 * render fine and styling them requires per-list context (indent level) we
 * don't track here.
 */

import type { EditorState } from "@codemirror/state";
import { Decoration, type EditorView, WidgetType } from "@codemirror/view";
import type { DecoSpec } from "./types";

const HIDE = Decoration.replace({});

const BLOCKQUOTE_LINE = Decoration.line({
  attributes: { class: "cm-tme-blockquote" },
});

const BLOCKQUOTE_PREFIX_RE = /^(\s*)((?:>\s*)+)/;
const TASK_PREFIX_RE = /^(\s*)([-*+]\s+)(\[)([ xX])(\])(\s+)/;

class TaskCheckboxWidget extends WidgetType {
  constructor(private readonly checked: boolean) {
    super();
  }

  override eq(other: WidgetType): boolean {
    return other instanceof TaskCheckboxWidget && other.checked === this.checked;
  }

  override toDOM(view: EditorView): HTMLElement {
    const root = document.createElement("span");
    root.className = `cm-tme-task ${
      this.checked ? "cm-tme-task--checked" : "cm-tme-task--unchecked"
    }`;
    root.setAttribute("data-checked", this.checked ? "true" : "false");

    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = this.checked;
    box.className = "cm-tme-task__box";
    box.tabIndex = 0;
    box.setAttribute("aria-label", "Task");

    // Stop CM6 from moving the caret on widget mousedown.
    box.addEventListener("mousedown", (event) => {
      event.preventDefault();
    });

    box.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const pos = view.posAtDOM(root);
      if (pos < 0) return;
      const line = view.state.doc.lineAt(pos);
      // Find `[ ]` / `[x]` on the line — we search the line text rather
      // than relying on a captured offset because CM6 keeps the widget
      // alive across edits and a captured offset could drift.
      const taskMatch = /(\[)([ xX])(\])/.exec(line.text);
      if (!taskMatch) return;
      const tokenFrom = line.from + (taskMatch.index ?? 0);
      const tokenTo = tokenFrom + taskMatch[0].length;
      const currentlyChecked = (taskMatch[2] ?? " ").toLowerCase() === "x";
      view.dispatch({
        changes: {
          from: tokenFrom,
          to: tokenTo,
          insert: currentlyChecked ? "[ ]" : "[x]",
        },
        userEvent: "input.markdown.task",
      });
      view.focus();
    });

    root.append(box);
    return root;
  }

  override ignoreEvent(): boolean {
    return false;
  }
}

export function buildListDecorations(
  state: EditorState,
  activeLines: Set<number>,
  from: number,
  to: number,
  out: DecoSpec[],
): void {
  const firstLine = state.doc.lineAt(from).number;
  const lastLine = state.doc.lineAt(to).number;

  for (let n = firstLine; n <= lastLine; n++) {
    const line = state.doc.line(n);
    const active = activeLines.has(n);

    // ---- Task checkbox ----
    const taskMatch = TASK_PREFIX_RE.exec(line.text);
    if (taskMatch) {
      const leading = taskMatch[1] ?? "";
      const bullet = taskMatch[2] ?? "";
      const bracketChar = (taskMatch[4] ?? " ").toLowerCase();
      const trailing = taskMatch[6] ?? "";
      const checked = bracketChar === "x";
      const prefixStart = line.from + leading.length;
      const prefixEnd =
        prefixStart + bullet.length + 1 /* [ */ + 1 /* x/space */ + 1 /* ] */ + trailing.length;

      if (!active) {
        out.push({
          from: prefixStart,
          to: prefixEnd,
          deco: Decoration.replace({ widget: new TaskCheckboxWidget(checked) }),
        });
      }
      // Active task lines render raw — user can edit the bullet markup.
      // Skip the blockquote check on this line since `- [ ]` lines aren't
      // also blockquotes.
      continue;
    }

    // ---- Blockquote ----
    const quoteMatch = BLOCKQUOTE_PREFIX_RE.exec(line.text);
    if (quoteMatch) {
      out.push({ from: line.from, to: line.from, deco: BLOCKQUOTE_LINE });
      if (!active) {
        const leading = quoteMatch[1] ?? "";
        const marker = quoteMatch[2] ?? "";
        if (marker.length > 0) {
          out.push({
            from: line.from + leading.length,
            to: line.from + leading.length + marker.length,
            deco: HIDE,
          });
        }
      }
    }
  }
}
