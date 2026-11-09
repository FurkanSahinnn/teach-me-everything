/**
 * GFM tables rendered as HTML while the cursor is outside them.
 *
 * Block replacement of a multi-line range must come from a StateField, so the
 * field walks the (already parsed) syntax tree for `Table` nodes on every doc
 * or selection change. Clicking a cell moves the cursor into that cell's
 * source, which flips the table back to raw markdown.
 */

import { syntaxTree } from "@codemirror/language";
import { type EditorState, type Extension, RangeSetBuilder, StateField } from "@codemirror/state";
import { isSourceModeActive, sourceModeField } from "./cursor-aware";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";

export type TableAlign = "left" | "center" | "right" | null;
export type TableCell = { text: string; /** offset of the cell text from table start */ offset: number };
export type ParsedTable = { header: TableCell[]; align: TableAlign[]; rows: TableCell[][] };

/** Split one table line into trimmed cells with source offsets. */
export function splitTableRow(line: string, base = 0): TableCell[] {
  const cells: TableCell[] = [];
  let start = 0;
  let inCode = false;
  const push = (end: number): void => {
    const raw = line.slice(start, end);
    const lead = raw.length - raw.trimStart().length;
    cells.push({ text: raw.trim(), offset: base + start + lead });
  };
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "\\") i++;
    else if (c === "`") inCode = !inCode;
    else if (c === "|" && !inCode) {
      if (cells.length > 0 || line.slice(0, i).trim().length > 0) push(i);
      start = i + 1;
    }
  }
  if (line.slice(start).trim().length > 0) push(line.length);
  return cells;
}

function parseAlign(cell: string): TableAlign {
  const l = cell.startsWith(":");
  const r = cell.endsWith(":");
  return l && r ? "center" : r ? "right" : l ? "left" : null;
}

/** Parse the source of a GFM table; null when the delimiter row is missing. */
export function parseTable(source: string): ParsedTable | null {
  const lines = source.split("\n");
  if (lines.length < 2) return null;
  let offset = 0;
  const parsed = lines.map((l) => {
    const cells = splitTableRow(l, offset);
    offset += l.length + 1;
    return cells;
  });
  const delim = parsed[1]!;
  if (delim.length === 0 || !delim.every((c) => /^:?-+:?$/.test(c.text))) return null;
  return {
    header: parsed[0]!,
    align: delim.map((c) => parseAlign(c.text)),
    rows: parsed.slice(2),
  };
}

export type InlineToken = { kind: "text" | "strong" | "em" | "code" | "del" | "link"; text: string; href?: string };

const INLINE_RE =
  /(`+)([^`]+?)\1|\*\*([^*]+?)\*\*|__([^_]+?)__|~~([^~]+?)~~|\*([^*\s][^*]*?)\*|(?<![\w])_([^_\s][^_]*?)_(?![\w])|\[([^\]]+)\]\(([^)\s]+)\)/g;

/** Minimal inline markdown tokenizer for cells; everything else stays text. */
export function tokenizeInline(src: string): InlineToken[] {
  const out: InlineToken[] = [];
  let last = 0;
  const text = src.replace(/\\\|/g, "|");
  INLINE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = INLINE_RE.exec(text)) !== null) {
    if (m.index > last) out.push({ kind: "text", text: text.slice(last, m.index) });
    if (m[2] !== undefined) out.push({ kind: "code", text: m[2] });
    else if (m[3] !== undefined || m[4] !== undefined) out.push({ kind: "strong", text: (m[3] ?? m[4])! });
    else if (m[5] !== undefined) out.push({ kind: "del", text: m[5] });
    else if (m[6] !== undefined || m[7] !== undefined) out.push({ kind: "em", text: (m[6] ?? m[7])! });
    else if (m[8] !== undefined) out.push({ kind: "link", text: m[8], href: m[9] ?? "" });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out;
}

const TAGS: Record<Exclude<InlineToken["kind"], "text" | "link">, string> = {
  strong: "strong",
  em: "em",
  code: "code",
  del: "s",
};

function renderInline(parent: HTMLElement, src: string): void {
  for (const t of tokenizeInline(src)) {
    if (t.kind === "text") parent.append(document.createTextNode(t.text));
    else {
      // Links are styled, not navigable: a click selects the cell for editing.
      const el = document.createElement(t.kind === "link" ? "span" : TAGS[t.kind]);
      if (t.kind === "link") el.className = "cm-tme-table__link";
      el.textContent = t.text;
      parent.append(el);
    }
  }
}

class TableWidget extends WidgetType {
  constructor(
    private readonly source: string,
    private readonly table: ParsedTable,
  ) {
    super();
  }

  override eq(other: WidgetType): boolean {
    return other instanceof TableWidget && other.source === this.source;
  }

  override toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "cm-tme-table-wrap";
    const table = document.createElement("table");
    table.className = "cm-tme-table";
    const build = (cells: TableCell[], tag: "th" | "td"): HTMLTableRowElement => {
      const tr = document.createElement("tr");
      this.table.align.forEach((align, i) => {
        const cell = cells[i];
        const el = document.createElement(tag);
        if (align) el.style.textAlign = align;
        if (cell) {
          renderInline(el, cell.text);
          el.dataset["offset"] = String(cell.offset);
        }
        tr.append(el);
      });
      return tr;
    };
    const thead = document.createElement("thead");
    thead.append(build(this.table.header, "th"));
    const tbody = document.createElement("tbody");
    for (const row of this.table.rows) tbody.append(build(row, "td"));
    table.append(thead, tbody);
    wrap.append(table);

    wrap.addEventListener("mousedown", (event) => {
      event.preventDefault();
      const cell = (event.target as HTMLElement).closest<HTMLElement>("th, td");
      const rel = Number(cell?.dataset["offset"] ?? 0);
      const base = view.posAtDOM(wrap);
      view.dispatch({ selection: { anchor: Math.min(base + rel, view.state.doc.length) }, scrollIntoView: true });
      view.focus();
    });
    return wrap;
  }

  override ignoreEvent(): boolean {
    return true;
  }
}

function touchesSelection(state: EditorState, from: number, to: number): boolean {
  return state.selection.ranges.some((r) => r.from <= to && r.to >= from);
}

function compute(state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name !== "Table") return;
      if (touchesSelection(state, node.from, node.to)) return false;
      const source = state.doc.sliceString(node.from, node.to);
      const table = parseTable(source);
      if (table) {
        builder.add(node.from, node.to, Decoration.replace({ block: true, widget: new TableWidget(source, table) }));
      }
      return false;
    },
  });
  return builder.finish();
}

export const tableField: Extension = [
  StateField.define<DecorationSet>({
    create: compute,
    update(value, tr) {
      if (tr.docChanged || tr.selection || syntaxTree(tr.startState) !== syntaxTree(tr.state)) {
        return compute(tr.state);
      }
      return value;
    },
    provide: (f) =>
      EditorView.decorations.compute([f, sourceModeField], (state) =>
        isSourceModeActive(state) ? Decoration.none : state.field(f),
      ),
  }),
  EditorView.theme({
    ".cm-tme-table-wrap": {
      overflowX: "auto",
      margin: "6px 0",
      cursor: "text",
    },
    ".cm-tme-table": {
      borderCollapse: "collapse",
      fontSize: "0.95em",
      minWidth: "40%",
    },
    ".cm-tme-table th, .cm-tme-table td": {
      border: "1px solid var(--color-rule)",
      padding: "3px 10px",
      textAlign: "left",
      verticalAlign: "top",
    },
    ".cm-tme-table th": {
      backgroundColor: "var(--color-paper-2)",
      fontWeight: "700",
      color: "var(--color-ink)",
    },
    ".cm-tme-table code": {
      fontFamily: "var(--font-mono, ui-monospace, monospace)",
      fontSize: "0.9em",
      backgroundColor: "var(--color-paper-3)",
      padding: "0 4px",
      borderRadius: "3px",
    },
    ".cm-tme-table__link": { color: "var(--color-accent)" },
  }),
];
