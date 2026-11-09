/**
 * Lists and task checkboxes.
 *
 * Every list item's marker (plus its leading indent) on an inactive line is
 * replaced by one fixed-width widget: a bullet, an ordered number or a task
 * checkbox, preceded by faint guide cells for each outer nesting level. The
 * line gets `padding-left` / negative `text-indent` of the same width in `em`,
 * so wrapped lines hang under the text instead of under the marker. Using the
 * tree (ListMark nodes) rather than line regexes keeps list-like text inside
 * fenced code untouched.
 */

import { syntaxTree } from "@codemirror/language";
import type { EditorState, Extension } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import { quotePrefixLength } from "./callout";
import type { DecoSpec } from "./types";

export type ListMarkerKind = "bullet" | "ordered" | "task";

const INDENT_EM = 1.5;
const ORDERED_EM = 2;
const BULLETS = ["•", "◦", "▪"] as const;

const TASK_RE = /^[ \t]+\[([ xX])\](?=[ \t]|$)/;

/** Bullet glyph for a 1-based nesting depth (cycles through three shapes). */
export function bulletForDepth(depth: number): string {
  return BULLETS[(Math.max(depth, 1) - 1) % BULLETS.length] ?? "•";
}

/** Width in em of the marker widget (guides + marker cell). */
export function markerWidthEm(depth: number, kind: ListMarkerKind): number {
  return (depth - 1) * INDENT_EM + (kind === "ordered" ? ORDERED_EM : INDENT_EM);
}

/**
 * Read a task box right after a list marker. `after` is the text following
 * the marker; returns the box length (including the leading space) or null.
 */
export function matchTaskBox(after: string): { checked: boolean; length: number } | null {
  const m = TASK_RE.exec(after);
  if (!m) return null;
  return { checked: m[1] !== " ", length: m[0].length };
}

class ListMarkerWidget extends WidgetType {
  constructor(
    private readonly depth: number,
    private readonly kind: ListMarkerKind,
    private readonly text: string,
    private readonly checked: boolean,
  ) {
    super();
  }

  override eq(other: WidgetType): boolean {
    return (
      other instanceof ListMarkerWidget &&
      other.depth === this.depth &&
      other.kind === this.kind &&
      other.text === this.text &&
      other.checked === this.checked
    );
  }

  override toDOM(view: EditorView): HTMLElement {
    const root = document.createElement("span");
    root.className = "cm-tme-listmark";
    root.style.width = `${markerWidthEm(this.depth, this.kind)}em`;
    for (let i = 1; i < this.depth; i++) {
      const guide = document.createElement("span");
      guide.className = "cm-tme-listmark__guide";
      root.append(guide);
    }
    const cell = document.createElement("span");
    cell.className = `cm-tme-listmark__cell cm-tme-listmark__cell--${this.kind}`;
    if (this.kind === "task") cell.append(this.buildCheckbox(view, root));
    else cell.textContent = this.text;
    root.append(cell);
    return root;
  }

  private buildCheckbox(view: EditorView, root: HTMLElement): HTMLElement {
    const wrap = document.createElement("span");
    wrap.className = `cm-tme-task ${this.checked ? "cm-tme-task--checked" : "cm-tme-task--unchecked"}`;
    wrap.setAttribute("data-checked", this.checked ? "true" : "false");

    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = this.checked;
    box.className = "cm-tme-task__box";
    box.tabIndex = 0;
    box.setAttribute("aria-label", view.state.phrase("Task"));
    box.addEventListener("mousedown", (event) => event.preventDefault());
    box.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const pos = view.posAtDOM(root);
      if (pos < 0) return;
      const line = view.state.doc.lineAt(pos);
      // Search the line instead of trusting a captured offset: CM keeps the
      // widget alive across edits, so a stored offset could drift.
      const m = /\[([ xX])\]/.exec(line.text);
      if (!m) return;
      const from = line.from + m.index;
      view.dispatch({
        changes: { from, to: from + 3, insert: (m[1] ?? " ") === " " ? "[x]" : "[ ]" },
        userEvent: "input.markdown.task",
      });
      view.focus();
    });
    wrap.append(box);
    return wrap;
  }

  override ignoreEvent(): boolean {
    return false;
  }
}

const hangCache = new Map<string, Decoration>();
function hangLine(widthEm: number): Decoration {
  const key = String(widthEm);
  let d = hangCache.get(key);
  if (!d) {
    d = Decoration.line({
      attributes: {
        class: "cm-tme-listline",
        style: `padding-left: calc(${widthEm}em + 6px) !important; text-indent: -${widthEm}em;`,
      },
    });
    hangCache.set(key, d);
  }
  return d;
}

const DONE_TEXT = Decoration.mark({ class: "cm-tme-task-done" });

export function buildListDecorations(
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
      if (node.name !== "ListMark") return;
      let depth = 0;
      let ordered = false;
      for (let p = node.node.parent; p; p = p.parent) {
        if (p.name === "BulletList" || p.name === "OrderedList") {
          if (depth === 0) ordered = p.name === "OrderedList";
          depth++;
        }
      }
      if (depth === 0) return;

      const line = state.doc.lineAt(node.from);
      const afterMark = state.doc.sliceString(node.to, line.to);
      const task = ordered ? null : matchTaskBox(afterMark);
      const kind: ListMarkerKind = task ? "task" : ordered ? "ordered" : "bullet";

      let end = node.to;
      if (task) end = node.to + task.length;
      // Swallow the spaces after the marker/box so the widget owns the gap.
      const trailing = /^[ \t]+/.exec(state.doc.sliceString(end, line.to));
      if (trailing) end += trailing[0].length;
      if (task?.checked && end < line.to) {
        out.push({ from: end, to: line.to, deco: DONE_TEXT });
      }

      if (activeLines.has(line.number)) return;
      const start = line.from + quotePrefixLength(line.text);
      if (start > node.from) return;
      const text = state.doc.sliceString(node.from, node.to);
      const width = markerWidthEm(depth, kind);
      out.push({ from: line.from, to: line.from, deco: hangLine(width) });
      out.push({
        from: start,
        to: end,
        deco: Decoration.replace({
          widget: new ListMarkerWidget(
            depth,
            kind,
            kind === "bullet" ? bulletForDepth(depth) : text,
            task?.checked ?? false,
          ),
        }),
      });
    },
  });
}

export const listTheme: Extension = EditorView.theme({
  ".cm-tme-listmark": {
    display: "inline-flex",
    verticalAlign: "bottom",
    height: "1.7em",
    boxSizing: "border-box",
    textIndent: "0",
  },
  ".cm-tme-listmark__guide": {
    flex: "0 0 1.5em",
    background:
      "linear-gradient(var(--color-rule), var(--color-rule)) 0.75em 0 / 1px 100% no-repeat",
  },
  ".cm-tme-listmark__cell": {
    flex: "1 1 auto",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    color: "var(--color-ink-3)",
  },
  ".cm-tme-listmark__cell--ordered": {
    justifyContent: "flex-end",
    paddingRight: "0.45em",
    fontVariantNumeric: "tabular-nums",
  },
  ".cm-tme-task": {
    display: "inline-flex",
    alignItems: "center",
  },
  ".cm-tme-task__box": {
    cursor: "pointer",
    width: "15px",
    height: "15px",
    margin: "0",
    accentColor: "var(--color-accent)",
  },
  ".cm-tme-task-done": {
    color: "var(--color-ink-3)",
    textDecoration: "line-through",
  },
});
