/**
 * Math: inline `$…$` (ViewPlugin replace widgets on inactive lines) and block
 * `$$ … $$` (StateField block widget, raw while the cursor is inside).
 * KaTeX output is trusted markup for the given source, hence `innerHTML`.
 */

import { type EditorState, type Extension, RangeSetBuilder, StateField, type Text } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import katex from "katex";
import { isSourceModeActive, sourceModeField } from "./cursor-aware";
import type { DecoSpec } from "./types";

export type InlineMath = { from: number; to: number; src: string };
export type MathBlock = { fromLine: number; toLine: number; src: string };

/** Find `$…$` spans in one line. Currency like `$5 and $10` is not math. */
export function scanInlineMath(text: string): InlineMath[] {
  const out: InlineMath[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === "$" && text[i + 1] === "$") {
      // Skip the whole `$$` run so its second `$` is not read as an opener.
      i += 2;
      continue;
    }
    if (c !== "$" || text[i + 1] === undefined || /\s/.test(text[i + 1]!)) {
      i++;
      continue;
    }
    let j = i + 1;
    let end = -1;
    while (j < text.length) {
      if (text[j] === "\\") {
        j += 2;
        continue;
      }
      if (text[j] === "$") {
        if (!/\s/.test(text[j - 1] ?? " ") && !/\d/.test(text[j + 1] ?? "")) end = j;
        break;
      }
      j++;
    }
    if (end < 0) {
      i++;
      continue;
    }
    out.push({ from: i, to: end + 1, src: text.slice(i + 1, end) });
    i = end + 1;
  }
  return out;
}

/** Find `$$` blocks (single- or multi-line) in an array of lines, skipping fenced code. */
export function findMathBlocks(lines: readonly string[]): MathBlock[] {
  const blocks: MathBlock[] = [];
  let fence: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i]!;
    const fm = /^[ \t]*(`{3,}|~{3,})/.exec(text);
    if (fm) {
      const marker = fm[1]!.charAt(0);
      if (fence === null) fence = marker;
      else if (fence === marker) fence = null;
      continue;
    }
    if (fence !== null) continue;
    const t = text.trim();
    if (!t.startsWith("$$")) continue;
    if (t.length > 3 && t.endsWith("$$")) {
      blocks.push({ fromLine: i + 1, toLine: i + 1, src: t.slice(2, -2).trim() });
      continue;
    }
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j]!.includes("$$")) {
        const body = [t.slice(2), ...lines.slice(i + 1, j), lines[j]!.slice(0, lines[j]!.indexOf("$$"))];
        blocks.push({ fromLine: i + 1, toLine: j + 1, src: body.join("\n").trim() });
        i = j;
        break;
      }
    }
  }
  return blocks;
}

function docLines(doc: Text): string[] {
  const out: string[] = [];
  for (let n = 1; n <= doc.lines; n++) out.push(doc.line(n).text);
  return out;
}

function renderKatex(src: string, displayMode: boolean): string {
  try {
    return katex.renderToString(src, { throwOnError: false, displayMode });
  } catch {
    // throwOnError:false covers parse errors; this guards unexpected internals.
    return "";
  }
}

class MathWidget extends WidgetType {
  constructor(
    private readonly src: string,
    private readonly display: boolean,
  ) {
    super();
  }

  override eq(other: WidgetType): boolean {
    return other instanceof MathWidget && other.src === this.src && other.display === this.display;
  }

  override toDOM(view: EditorView): HTMLElement {
    const el = document.createElement(this.display ? "div" : "span");
    el.className = this.display ? "cm-tme-math cm-tme-math--block" : "cm-tme-math";
    el.innerHTML = renderKatex(this.src, this.display);
    if (this.display) {
      el.addEventListener("mousedown", (event) => {
        event.preventDefault();
        view.dispatch({ selection: { anchor: view.posAtDOM(el) }, scrollIntoView: true });
        view.focus();
      });
    }
    return el;
  }

  override ignoreEvent(): boolean {
    return this.display;
  }
}

type MathState = { blocks: MathBlock[]; decos: DecorationSet };

function computeDecos(state: EditorState, blocks: MathBlock[]): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const b of blocks) {
    const from = state.doc.line(b.fromLine).from;
    const to = state.doc.line(b.toLine).to;
    if (state.selection.ranges.some((r) => r.from <= to && r.to >= from)) continue;
    builder.add(from, to, Decoration.replace({ block: true, widget: new MathWidget(b.src, true) }));
  }
  return builder.finish();
}

const mathBlockField = StateField.define<MathState>({
  create(state) {
    const blocks = findMathBlocks(docLines(state.doc));
    return { blocks, decos: computeDecos(state, blocks) };
  },
  update(value, tr) {
    if (!tr.docChanged && !tr.selection) return value;
    const blocks = tr.docChanged ? findMathBlocks(docLines(tr.newDoc)) : value.blocks;
    return { blocks, decos: computeDecos(tr.state, blocks) };
  },
  provide: (f) =>
    EditorView.decorations.compute([f, sourceModeField], (state) =>
      isSourceModeActive(state) ? Decoration.none : state.field(f).decos,
    ),
});

export function buildInlineMathDecorations(
  state: EditorState,
  activeLines: Set<number>,
  from: number,
  to: number,
  out: DecoSpec[],
  codeRanges: ReadonlyArray<readonly [number, number]>,
): void {
  const blocks = state.field(mathBlockField, false)?.blocks ?? [];
  const first = state.doc.lineAt(from).number;
  const last = state.doc.lineAt(to).number;
  for (let n = first; n <= last; n++) {
    if (activeLines.has(n)) continue;
    if (blocks.some((b) => n >= b.fromLine && n <= b.toLine)) continue;
    const line = state.doc.line(n);
    if (!line.text.includes("$")) continue;
    for (const m of scanInlineMath(line.text)) {
      const absFrom = line.from + m.from;
      if (codeRanges.some(([f, t]) => absFrom >= f && absFrom < t)) continue;
      out.push({
        from: absFrom,
        to: line.from + m.to,
        deco: Decoration.replace({ widget: new MathWidget(m.src, false) }),
      });
    }
  }
}

export const mathExtension: Extension = [
  mathBlockField,
  EditorView.theme({
    ".cm-tme-math--block": {
      textAlign: "center",
      padding: "6px 0",
      overflowX: "auto",
      cursor: "text",
    },
    ".cm-tme-math .katex-display": { margin: "0" },
  }),
];
