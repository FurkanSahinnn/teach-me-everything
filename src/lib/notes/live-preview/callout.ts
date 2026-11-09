/**
 * Callouts (`> [!note] Title`) and plain blockquotes.
 *
 * Line-level styling and inline replacements (hidden `>` markers, title
 * widget) live in a ViewPlugin builder. Folding hides body lines with a block
 * replace, which CM6 only allows from a StateField, so `calloutField` owns
 * the block scan and the per-callout fold overrides.
 */

import {
  type EditorState,
  type Extension,
  RangeSetBuilder,
  StateEffect,
  StateField,
  type Text,
} from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import { isSourceModeActive, sourceModeField } from "./cursor-aware";
import type { DecoSpec } from "./types";

export type CalloutFamily = "accent" | "ok" | "warn" | "err" | "plum" | "slate";
export type CalloutFold = "+" | "-" | null;

export type CalloutHeader = {
  type: string;
  fold: CalloutFold;
  /** Text after `[!type]` and the optional fold sign, trimmed. */
  title: string;
  /** Offset of the title text inside the quote-stripped line. */
  titleOffset: number;
};

export type QuoteBlock = {
  fromLine: number;
  toLine: number;
  callout: CalloutHeader | null;
};

const FAMILIES: Record<string, CalloutFamily> = {
  note: "accent",
  info: "accent",
  todo: "accent",
  tip: "ok",
  hint: "ok",
  important: "ok",
  success: "ok",
  check: "ok",
  done: "ok",
  warning: "warn",
  caution: "warn",
  attention: "warn",
  question: "warn",
  help: "warn",
  faq: "warn",
  danger: "err",
  error: "err",
  bug: "err",
  failure: "err",
  fail: "err",
  missing: "err",
  quote: "plum",
  cite: "plum",
  example: "slate",
  abstract: "slate",
  summary: "slate",
  tldr: "slate",
};

export function calloutFamily(type: string): CalloutFamily {
  return FAMILIES[type.toLowerCase()] ?? "accent";
}

export function defaultCalloutTitle(type: string): string {
  const t = type.replace(/[-_]+/g, " ").trim();
  return t.length === 0 ? "Note" : t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
}

/** Length of the leading `>` markers (and one space after each), 0 if none. */
export function quotePrefixLength(text: string): number {
  const m = /^[ \t]*(?:>[ \t]?)+/.exec(text);
  return m ? m[0].length : 0;
}

const HEADER_RE = /^\[!([\w-]+)\]([+-])?(?:[ \t]+(.*))?$/;

/** Parse the quote-stripped text of a callout's first line. */
export function parseCalloutHeader(stripped: string): CalloutHeader | null {
  const text = stripped.trimEnd();
  const m = HEADER_RE.exec(text);
  if (!m || m[1] === undefined) return null;
  const title = (m[3] ?? "").trim();
  return {
    type: m[1].toLowerCase(),
    fold: (m[2] as CalloutFold | undefined) ?? null,
    title,
    titleOffset: title.length === 0 ? text.length : text.length - title.length,
  };
}

/**
 * Group consecutive `>` lines into blocks. Pure over an array of lines so it
 * can be tested without an editor. Lines inside fenced code are ignored.
 */
export function findQuoteBlocks(lines: readonly string[]): QuoteBlock[] {
  const blocks: QuoteBlock[] = [];
  let fence: string | null = null;
  let current: QuoteBlock | null = null;
  lines.forEach((text, i) => {
    const n = i + 1;
    const fm = /^[ \t]*(`{3,}|~{3,})/.exec(text);
    if (fm) {
      const marker = fm[1]!.charAt(0);
      if (fence === null) fence = marker;
      else if (fence === marker) fence = null;
    }
    const prefix = fence === null && !fm ? quotePrefixLength(text) : 0;
    if (prefix > 0) {
      if (current === null) {
        const header = parseCalloutHeader(text.slice(prefix));
        current = { fromLine: n, toLine: n, callout: header };
        blocks.push(current);
      } else {
        current.toLine = n;
      }
    } else {
      current = null;
    }
  });
  return blocks;
}

function docLines(doc: Text): string[] {
  const out: string[] = [];
  for (let n = 1; n <= doc.lines; n++) out.push(doc.line(n).text);
  return out;
}

/* ------------------------------- state ------------------------------- */

/** Toggle the fold of the callout whose header line starts at `pos`. */
export const toggleCalloutFold = StateEffect.define<number>();

type CalloutState = {
  blocks: QuoteBlock[];
  /** Header line start -> collapsed, only for callouts the user toggled. */
  overrides: Map<number, boolean>;
  decos: DecorationSet;
};

function isCollapsed(state: EditorState, overrides: Map<number, boolean>, b: QuoteBlock): boolean {
  if (!b.callout || b.callout.fold === null || b.toLine === b.fromLine) return false;
  const headerFrom = state.doc.line(b.fromLine).from;
  const collapsed = overrides.get(headerFrom) ?? b.callout.fold === "-";
  if (!collapsed) return false;
  // Never hide a body that holds the cursor.
  const to = state.doc.line(b.toLine).to;
  return !state.selection.ranges.some((r) => r.from <= to && r.to >= headerFrom);
}

function compute(state: EditorState, blocks: QuoteBlock[], overrides: Map<number, boolean>): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const b of blocks) {
    if (!isCollapsed(state, overrides, b)) continue;
    const header = state.doc.line(b.fromLine);
    const last = state.doc.line(b.toLine);
    if (last.to >= state.doc.length) {
      builder.add(header.to, last.to, Decoration.replace({ block: true }));
    } else {
      builder.add(state.doc.line(b.fromLine + 1).from, last.to + 1, Decoration.replace({ block: true }));
    }
  }
  return builder.finish();
}

export const calloutField = StateField.define<CalloutState>({
  create(state) {
    const blocks = findQuoteBlocks(docLines(state.doc));
    const overrides = new Map<number, boolean>();
    return { blocks, overrides, decos: compute(state, blocks, overrides) };
  },
  update(value, tr) {
    let { blocks, overrides } = value;
    const toggles = tr.effects.filter((e) => e.is(toggleCalloutFold));
    if (!tr.docChanged && !tr.selection && toggles.length === 0) return value;
    if (tr.docChanged) {
      blocks = findQuoteBlocks(docLines(tr.newDoc));
      const mapped = new Map<number, boolean>();
      for (const [pos, v] of overrides) mapped.set(tr.changes.mapPos(pos, 1), v);
      overrides = mapped;
    }
    if (toggles.length > 0) {
      overrides = new Map(overrides);
      for (const e of toggles) {
        const pos = e.value as number;
        const b = blocks.find((x) => tr.state.doc.line(x.fromLine).from === pos);
        if (!b?.callout) continue;
        const current = overrides.get(pos) ?? b.callout.fold === "-";
        overrides.set(pos, !current);
      }
    }
    return { blocks, overrides, decos: compute(tr.state, blocks, overrides) };
  },
  provide: (f) =>
    EditorView.decorations.compute([f, sourceModeField], (state) =>
      isSourceModeActive(state) ? Decoration.none : state.field(f).decos,
    ),
});

export function calloutChanged(a: EditorState, b: EditorState): boolean {
  return a.field(calloutField, false) !== b.field(calloutField, false);
}

/* ------------------------------ widgets ------------------------------ */

const SVG_NS = "http://www.w3.org/2000/svg";
// Static, author-controlled path data (lucide-style); never built from user text.
const ICONS: Record<CalloutFamily, string> = {
  accent: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  ok: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  warn: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4M12 17h.01"/>',
  err: '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6M9 9l6 6"/>',
  plum: '<path d="M3 21c3 0 7-1 7-8V5c0-1.25-.76-2-2-2H4c-1.25 0-2 .75-2 2v6c0 1.25.75 2 2 2h4M15 21c3 0 7-1 7-8V5c0-1.25-.76-2-2-2h-4c-1.25 0-2 .75-2 2v6c0 1.25.75 2 2 2h4"/>',
  slate: '<path d="M4 6h16M4 12h16M4 18h10"/>',
};

class CalloutTitleWidget extends WidgetType {
  constructor(
    private readonly type: string,
    private readonly foldable: boolean,
    private readonly collapsed: boolean,
    /** Shown after the icon when the author gave no title. */
    private readonly fallbackTitle: string | null,
  ) {
    super();
  }

  override eq(other: WidgetType): boolean {
    return (
      other instanceof CalloutTitleWidget &&
      other.type === this.type &&
      other.foldable === this.foldable &&
      other.collapsed === this.collapsed &&
      other.fallbackTitle === this.fallbackTitle
    );
  }

  override toDOM(view: EditorView): HTMLElement {
    const root = document.createElement("span");
    root.className = "cm-tme-callout__head";
    if (this.foldable) {
      const chev = document.createElement("span");
      chev.className = `cm-tme-callout__chev${this.collapsed ? " is-collapsed" : ""}`;
      chev.setAttribute("role", "button");
      chev.setAttribute("aria-label", view.state.phrase(this.collapsed ? "Expand callout" : "Collapse callout"));
      chev.textContent = "▾";
      chev.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const pos = view.posAtDOM(root);
        view.dispatch({ effects: toggleCalloutFold.of(view.state.doc.lineAt(pos).from) });
      });
      root.append(chev);
    }
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("class", "cm-tme-callout__icon");
    svg.setAttribute("aria-hidden", "true");
    svg.innerHTML = ICONS[calloutFamily(this.type)];
    root.append(svg);
    if (this.fallbackTitle !== null) {
      const t = document.createElement("span");
      t.className = "cm-tme-callout__title";
      t.textContent = view.state.phrase(this.fallbackTitle);
      root.append(t);
    }
    return root;
  }

  override ignoreEvent(): boolean {
    return false;
  }
}

/* ----------------------------- decorations ----------------------------- */

const HIDE = Decoration.replace({});
const QUOTE_LINE = Decoration.line({ attributes: { class: "cm-tme-blockquote" } });
const TITLE_TEXT = Decoration.mark({ class: "cm-tme-callout__title" });
const lineCache = new Map<string, Decoration>();

function calloutLine(family: CalloutFamily, pos: "first" | "mid" | "last" | "only"): Decoration {
  const key = `${family}:${pos}`;
  let d = lineCache.get(key);
  if (!d) {
    const posClass =
      pos === "only" ? "cm-tme-callout--first cm-tme-callout--last" : `cm-tme-callout--${pos}`;
    d = Decoration.line({ attributes: { class: `cm-tme-callout cm-tme-callout--${family} ${posClass}` } });
    lineCache.set(key, d);
  }
  return d;
}

export function buildCalloutDecorations(
  state: EditorState,
  activeLines: Set<number>,
  from: number,
  to: number,
  out: DecoSpec[],
): void {
  const cs = state.field(calloutField, false);
  if (!cs) return;
  const firstVisible = state.doc.lineAt(from).number;
  const lastVisible = state.doc.lineAt(to).number;

  for (const b of cs.blocks) {
    if (b.toLine < firstVisible || b.fromLine > lastVisible) continue;
    const collapsed = isCollapsed(state, cs.overrides, b);
    const lastLine = collapsed ? b.fromLine : b.toLine;
    const family = b.callout ? calloutFamily(b.callout.type) : null;

    for (let n = Math.max(b.fromLine, firstVisible); n <= Math.min(lastLine, lastVisible); n++) {
      const line = state.doc.line(n);
      if (family) {
        const pos =
          n === b.fromLine && n === lastLine ? "only" : n === b.fromLine ? "first" : n === lastLine ? "last" : "mid";
        out.push({ from: line.from, to: line.from, deco: calloutLine(family, pos) });
      } else {
        out.push({ from: line.from, to: line.from, deco: QUOTE_LINE });
      }
      if (activeLines.has(n)) continue;
      const prefix = quotePrefixLength(line.text);
      if (n === b.fromLine && b.callout) {
        const hdr = b.callout;
        const hasTitle = hdr.title.length > 0;
        // One replace covers `> [!type]- ` so the widget stands in for it.
        const end = hasTitle ? Math.min(line.from + prefix + hdr.titleOffset, line.to) : line.to;
        out.push({
          from: line.from,
          to: end,
          deco: Decoration.replace({
            widget: new CalloutTitleWidget(
              hdr.type,
              hdr.fold !== null && b.toLine > b.fromLine,
              collapsed,
              hasTitle ? null : defaultCalloutTitle(hdr.type),
            ),
          }),
        });
        if (hasTitle) out.push({ from: end, to: line.to, deco: TITLE_TEXT });
      } else if (prefix > 0) {
        out.push({ from: line.from, to: line.from + prefix, deco: HIDE });
      }
    }
  }
}

export const calloutTheme: Extension = EditorView.theme({
  ".cm-tme-blockquote": {
    borderLeft: "3px solid var(--color-rule-strong)",
    paddingLeft: "12px !important",
    color: "var(--color-ink-2)",
  },
  ".cm-tme-callout": {
    "--tme-callout-c": "var(--color-accent)",
    borderLeft: "3px solid var(--tme-callout-c)",
    backgroundColor: "color-mix(in srgb, var(--tme-callout-c) 8%, transparent)",
    paddingLeft: "12px !important",
    paddingRight: "12px !important",
  },
  ".cm-tme-callout--ok": { "--tme-callout-c": "var(--color-ok)" },
  ".cm-tme-callout--warn": { "--tme-callout-c": "var(--color-warn)" },
  ".cm-tme-callout--err": { "--tme-callout-c": "var(--color-err)" },
  ".cm-tme-callout--plum": { "--tme-callout-c": "var(--color-plum)" },
  ".cm-tme-callout--slate": { "--tme-callout-c": "var(--color-slate)" },
  ".cm-tme-callout--first": {
    borderTopRightRadius: "6px",
    paddingTop: "6px",
  },
  ".cm-tme-callout--last": {
    borderBottomRightRadius: "6px",
    paddingBottom: "6px",
  },
  ".cm-tme-callout__head": {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    color: "var(--tme-callout-c)",
    verticalAlign: "baseline",
    marginRight: "6px",
  },
  ".cm-tme-callout__icon": {
    width: "1.05em",
    height: "1.05em",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    flexShrink: "0",
  },
  ".cm-tme-callout__title": {
    fontWeight: "700",
    color: "var(--color-ink)",
  },
  ".cm-tme-callout__chev": {
    cursor: "pointer",
    color: "var(--color-ink-3)",
    transition: "transform 150ms ease",
    userSelect: "none",
  },
  ".cm-tme-callout__chev.is-collapsed": { transform: "rotate(-90deg)" },
});
