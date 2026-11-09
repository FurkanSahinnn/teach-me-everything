/**
 * Block-level "insert" commands behind the editing toolbar: tables, callouts,
 * fenced code, rules, images, math and footnotes.
 *
 * Pure builders (exported for tests) produce the markdown; the `insert*`
 * wrappers place it as its own block, never glued onto the middle of a
 * paragraph, and park the caret where the user types next.
 */

import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

export const CALLOUT_TYPES = [
  "note",
  "abstract",
  "info",
  "todo",
  "tip",
  "success",
  "question",
  "warning",
  "failure",
  "danger",
  "bug",
  "example",
  "quote",
] as const;
export type CalloutType = (typeof CALLOUT_TYPES)[number];

export function buildTableMarkdown(
  rows: number,
  cols: number,
  headerLabel: (index: number) => string,
): string {
  const safeRows = Math.max(1, Math.min(20, Math.floor(rows)));
  const safeCols = Math.max(1, Math.min(12, Math.floor(cols)));
  const header = Array.from({ length: safeCols }, (_, i) => headerLabel(i + 1));
  const lines = [
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
  ];
  for (let r = 0; r < safeRows; r += 1) {
    lines.push(`| ${header.map(() => " ").join(" | ")} |`);
  }
  return lines.join("\n");
}

/** Smallest positive integer not yet used as a `[^n]` footnote label. */
export function nextFootnoteId(doc: string): number {
  const used = new Set<number>();
  for (const m of doc.matchAll(/\[\^(\d+)\]/g)) used.add(Number.parseInt(m[1] ?? "0", 10));
  let n = 1;
  while (used.has(n)) n += 1;
  return n;
}

export function wrapInCallout(text: string, type: CalloutType, title: string): string {
  const head = `> [!${type}]${title ? ` ${title}` : ""}`;
  if (text.length === 0) return `${head}\n> `;
  const body = text
    .split("\n")
    .map((line) => (line.length > 0 ? `> ${line}` : ">"))
    .join("\n");
  return `${head}\n${body}`;
}

export function wrapInFence(text: string, language: string): string {
  return `\`\`\`${language}\n${text}\n\`\`\``;
}

type BlockInsert = {
  text: string;
  /** Caret (or selection start) offset inside `text`. */
  cursor: number;
  /** Optional selection end offset inside `text`. */
  selectTo?: number;
};

/**
 * Replace the selected lines (or insert at the caret's line) with a block,
 * separated from surrounding text by blank lines.
 */
function dispatchBlock(view: EditorView, build: (selected: string) => BlockInsert): void {
  const { state } = view;
  const range = state.selection.main;
  const fromLine = state.doc.lineAt(range.from);
  const toLine = state.doc.lineAt(range.to);
  const hasSelection = !range.empty;
  const selected = hasSelection ? state.sliceDoc(fromLine.from, toLine.to) : "";
  const block = build(selected);

  let from: number;
  let to: number;
  let prefix = "";
  let suffix = "";
  if (hasSelection || fromLine.text.trim().length === 0) {
    from = fromLine.from;
    to = hasSelection ? toLine.to : fromLine.to;
  } else {
    // Caret inside a non-empty paragraph: put the block after that line.
    from = fromLine.to;
    to = fromLine.to;
    prefix = "\n\n";
  }
  // Blocks need a blank line on both sides: a table or callout glued to a
  // paragraph is parsed as part of it.
  if (!prefix && from > 0) {
    const prevLine = state.doc.lineAt(from - 1);
    if (prevLine.text.trim().length > 0) prefix = from === prevLine.to + 1 ? "\n" : "\n\n";
  }
  // `to` is always a line end, so the newline already there closes the block;
  // only add the blank line when real text follows.
  if (to < state.doc.length) {
    const nextLine = state.doc.lineAt(to + 1);
    suffix = nextLine.text.trim().length > 0 ? "\n" : "";
  } else {
    suffix = "\n";
  }

  const insert = `${prefix}${block.text}${suffix}`;
  const base = from + prefix.length;
  view.dispatch({
    changes: { from, to, insert },
    selection: EditorSelection.single(base + block.cursor, base + (block.selectTo ?? block.cursor)),
    userEvent: "input.insert.block",
    scrollIntoView: true,
  });
  view.focus();
}

export function insertTable(
  view: EditorView,
  rows: number,
  cols: number,
  headerLabel: (index: number) => string,
): void {
  dispatchBlock(view, () => {
    const text = buildTableMarkdown(rows, cols, headerLabel);
    const firstCell = 2;
    return { text, cursor: firstCell, selectTo: firstCell + headerLabel(1).length };
  });
}

export function insertCallout(view: EditorView, type: CalloutType, title = ""): void {
  dispatchBlock(view, (selected) => {
    const text = wrapInCallout(selected, type, title);
    const headEnd = text.indexOf("\n");
    // Empty callout: caret on the body line; wrapped text: caret after the title.
    return { text, cursor: selected.length === 0 ? text.length : headEnd };
  });
}

export function insertCodeBlock(view: EditorView, language = ""): void {
  dispatchBlock(view, (selected) => {
    const text = wrapInFence(selected, language);
    // Caret (or the wrapped selection) inside the body: code typed straight
    // after inserting must not land on the fence line as the language.
    const bodyStart = 4 + language.length;
    return { text, cursor: bodyStart, selectTo: bodyStart + selected.length };
  });
}

export function insertHorizontalRule(view: EditorView): void {
  dispatchBlock(view, () => ({ text: "---\n", cursor: 4 }));
}

export function insertMathBlock(view: EditorView): void {
  dispatchBlock(view, (selected) => {
    const text = `$$\n${selected}\n$$`;
    return { text, cursor: 3, selectTo: 3 + selected.length };
  });
}

export function insertInlineMath(view: EditorView): void {
  const range = view.state.selection.main;
  const selected = view.state.sliceDoc(range.from, range.to);
  view.dispatch({
    changes: { from: range.from, to: range.to, insert: `$${selected}$` },
    selection: EditorSelection.single(range.from + 1, range.from + 1 + selected.length),
    userEvent: "input.insert.math",
  });
  view.focus();
}

export function insertImage(view: EditorView, placeholderUrl: string): void {
  const range = view.state.selection.main;
  const alt = view.state.sliceDoc(range.from, range.to);
  const text = `![${alt}](${placeholderUrl})`;
  const urlStart = range.from + alt.length + 4;
  view.dispatch({
    changes: { from: range.from, to: range.to, insert: text },
    selection: EditorSelection.single(urlStart, urlStart + placeholderUrl.length),
    userEvent: "input.insert.image",
  });
  view.focus();
}

/** Insert `[^n]` at the caret and a matching definition at the end of the note. */
export function insertFootnote(view: EditorView): void {
  const { state } = view;
  const id = nextFootnoteId(state.doc.toString());
  const caret = state.selection.main.to;
  const ref = `[^${id}]`;
  const docEnd = state.doc.length;
  const tail = state.doc.toString().endsWith("\n") ? "\n" : "\n\n";
  const def = `${tail}[^${id}]: `;
  view.dispatch({
    changes: [
      { from: caret, insert: ref },
      { from: docEnd, insert: def },
    ],
    selection: EditorSelection.cursor(docEnd + ref.length + def.length),
    userEvent: "input.insert.footnote",
    scrollIntoView: true,
  });
  view.focus();
}
