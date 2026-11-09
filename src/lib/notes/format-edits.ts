/**
 * Pure (CodeMirror-free) inline-format transforms for colour, background,
 * underline / super / subscript, highlight, clear-formatting and alignment.
 * Same contract as `markdown-edits.ts`: take (text, from, to) and return the
 * new text plus the selection that should follow the edit.
 *
 * Syntax matches the Obsidian "Colored Text" and "Editing Toolbar" plugins so
 * vaults stay compatible: `<span style="color:#hex">`, `<mark style="background:#hex">`,
 * `<u>`, `<sup>`, `<sub>`, `==highlight==`, `<p align="…">`.
 */

import {
  type Align,
  type HtmlKind,
  type Wrapper,
  findWrappers,
  isSafeCssColor,
  normalizeCssColor,
  parseAlignWrapper,
} from "./inline-html-tags";
import {
  type HeadingLevel,
  type InlineWrapResult,
  blockPrefixLength,
  headingLevelOf,
  isWrappedOutside,
  lineSegments,
  mapSegments,
  toggleInlineWrap,
} from "./markdown-edits";

export { isSafeCssColor };
export type { Align };
export type EditResult = InlineWrapResult;

export type FormatState = {
  bold: boolean;
  italic: boolean;
  strike: boolean;
  code: boolean;
  highlight: boolean;
  underline: boolean;
  sup: boolean;
  sub: boolean;
  color: string | null;
  background: string | null;
  heading: HeadingLevel;
  list: "ul" | "ol" | "task" | null;
  quote: boolean;
};

const NL = "\n";

const colorOpen = (color: string): string => `<span style="color:${color}">`;
const bgOpen = (color: string): string => `<mark style="background:${color}">`;
const COLOR_CLOSE = "</span>";
const BG_CLOSE = "</mark>";

const unchanged = (text: string, from: number, to: number): EditResult => ({ text, from, to });

/** Innermost wrapper of `kinds` whose content holds the caret. */
function wrapperAtCaret(text: string, pos: number, kinds: HtmlKind[]): Wrapper | null {
  let best: Wrapper | null = null;
  for (const w of findWrappers(text)) {
    if (!kinds.includes(w.kind)) continue;
    if (w.open.to > pos || pos > w.close.from) continue;
    if (!best || w.open.from >= best.open.from) best = w;
  }
  return best;
}

/** Remove one wrapper's tags, shifting the selection accordingly. */
function unwrapWrapper(text: string, w: Wrapper, from: number, to: number): EditResult {
  const openLen = w.open.to - w.open.from;
  const closeLen = w.close.to - w.close.from;
  const shift = (p: number): number => {
    if (p >= w.close.to) return p - openLen - closeLen;
    if (p >= w.close.from) return w.close.from - openLen;
    if (p >= w.open.to) return p - openLen;
    return Math.min(p, w.open.from);
  };
  const out =
    text.slice(0, w.open.from) + text.slice(w.open.to, w.close.from) + text.slice(w.close.to);
  return { text: out, from: shift(from), to: shift(to) };
}

/**
 * Strip wrappers of `kinds` from [from, to). A wrapper that only partly
 * overlaps the selection is split so the selected part loses the formatting
 * while the rest keeps it.
 */
function stripKinds(text: string, from: number, to: number, kinds: HtmlKind[]): EditResult {
  let cur = { text, from, to };
  for (let guard = 0; guard < 200; guard += 1) {
    const { text: t, from: cf, to: ct } = cur;
    const w = findWrappers(t).find(
      (x) => kinds.includes(x.kind) && x.open.from < ct && x.close.to > cf,
    );
    if (!w) break;
    const openStr = t.slice(w.open.from, w.open.to);
    const closeStr = t.slice(w.close.from, w.close.to);
    const a = Math.min(Math.max(cf, w.open.to), w.close.from);
    const b = Math.min(Math.max(ct, w.open.to), w.close.from);
    const left = t.slice(w.open.to, a);
    const mid = t.slice(a, b);
    const right = t.slice(b, w.close.from);
    const leftStr = left ? openStr + left + closeStr : "";
    const rightStr = right ? openStr + right + closeStr : "";
    const replaced = leftStr + mid + rightStr;
    const delta = replaced.length - (w.close.to - w.open.from);
    const midStart = w.open.from + leftStr.length;
    cur = {
      text: t.slice(0, w.open.from) + replaced + t.slice(w.close.to),
      from: cf <= w.open.from ? cf : midStart,
      to: ct >= w.close.to ? ct + delta : midStart + mid.length,
    };
  }
  return cur;
}

function wrapWithTag(
  text: string,
  from: number,
  to: number,
  kind: HtmlKind,
  open: string,
  close: string,
): EditResult {
  if (from < 0 || to > text.length || from > to) return unchanged(text, from, to);
  if (from === to) {
    const w = wrapperAtCaret(text, from, [kind]);
    if (w && (kind === "color" || kind === "bg")) {
      // Re-colouring under the caret replaces the colour instead of nesting.
      const out = text.slice(0, w.open.from) + open + text.slice(w.open.to);
      const pos = from + open.length - (w.open.to - w.open.from);
      return { text: out, from: pos, to: pos };
    }
    const out = text.slice(0, from) + open + close + text.slice(to);
    return { text: out, from: from + open.length, to: from + open.length };
  }
  // Strip first so re-colouring replaces the old colour rather than nesting.
  const stripped = stripKinds(text, from, to, [kind]);
  const segs = lineSegments(stripped.text, stripped.from, stripped.to);
  if (segs.length === 0) return unchanged(text, from, to);
  return mapSegments(stripped.text, segs, (seg) => ({
    out: open + seg + close,
    a: open.length,
    b: open.length + seg.length,
  }));
}

export function wrapWithColor(text: string, from: number, to: number, color: string): EditResult {
  const c = normalizeCssColor(color);
  if (c === null) return unchanged(text, from, to);
  return wrapWithTag(text, from, to, "color", colorOpen(c), COLOR_CLOSE);
}

export function wrapWithBackground(
  text: string,
  from: number,
  to: number,
  color: string,
): EditResult {
  const c = normalizeCssColor(color);
  if (c === null) return unchanged(text, from, to);
  return wrapWithTag(text, from, to, "bg", bgOpen(c), BG_CLOSE);
}

/**
 * Caret: unwrap the innermost colour / background wrapper under it.
 * Selection: remove colour and background from the selected text.
 */
export function removeColorAt(text: string, from: number, to: number): EditResult {
  if (from < 0 || to > text.length || from > to) return unchanged(text, from, to);
  if (from === to) {
    const w = wrapperAtCaret(text, from, ["color", "bg"]);
    return w ? unwrapWrapper(text, w, from, to) : unchanged(text, from, to);
  }
  return stripKinds(text, from, to, ["color", "bg"]);
}

export function toggleHtmlTag(
  text: string,
  from: number,
  to: number,
  tag: "u" | "sup" | "sub",
): EditResult {
  if (from < 0 || to > text.length || from > to) return unchanged(text, from, to);
  if (from === to) {
    const w = wrapperAtCaret(text, from, [tag]);
    if (w) return unwrapWrapper(text, w, from, to);
    return wrapWithTag(text, from, to, tag, `<${tag}>`, `</${tag}>`);
  }
  const active = findWrappers(text).some(
    (w) => w.kind === tag && w.open.from <= from && w.close.to >= to,
  );
  if (active) return stripKinds(text, from, to, [tag]);
  return wrapWithTag(text, from, to, tag, `<${tag}>`, `</${tag}>`);
}

export function toggleHighlightMarks(text: string, from: number, to: number): EditResult {
  return toggleInlineWrap(text, "==", from, to);
}

// ---------------------------------------------------------------- clearing

const LINK_RE = /(?<!!)\[([^\]\n]*)\]\([^)\n]*\)/g;
const WIKILINK_RE = /(?<!!)\[\[([^\]|#\n]+)(?:#[^\]|\n]*)?(?:\|([^\]\n]+))?\]\]/g;

function stripMarkersInText(s: string): string {
  let t = s;
  t = t.replace(WIKILINK_RE, (_m, target: string, alias?: string) => (alias ?? target).trim());
  t = t.replace(LINK_RE, (_m, label: string) => label);
  t = t.replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, "$2");
  t = t.replace(/~~(?=\S)([\s\S]*?\S)~~/g, "$1");
  t = t.replace(/==(?=\S)([\s\S]*?\S)==/g, "$1");
  t = t.replace(/(?<![\w*])\*(?=[^\s*])([^*\n]+?)\*(?!\*)/g, "$1");
  t = t.replace(/(?<![\w_])_(?=[^\s_])([^_\n]+?)_(?![\w_])/g, "$1");
  t = t.replace(/(`+)([^`\n]+?)\1/g, "$2");
  return t;
}

const CLEAR_MARKERS = ["**", "~~", "==", "*", "`"] as const;

/**
 * Remove inline markdown / HTML formatting from the selection (or from the
 * whole current line when there is no selection). Formatting that wraps the
 * selection from outside (`**|word|**`) is removed too.
 */
export function clearFormatting(text: string, from: number, to: number): EditResult {
  if (from < 0 || to > text.length || from > to) return unchanged(text, from, to);
  let a = from;
  let b = to;
  if (from === to) {
    const ls = from === 0 ? 0 : text.lastIndexOf(NL, from - 1) + 1;
    let le = text.indexOf(NL, from);
    if (le === -1) le = text.length;
    a = ls + blockPrefixLength(text.slice(ls, le));
    b = le;
    if (a >= b) return unchanged(text, from, to);
  }
  const stripped = stripKinds(text, a, b, ["color", "bg", "u", "sup", "sub"]);
  const cleaned = stripMarkersInText(stripped.text.slice(stripped.from, stripped.to));
  let cur: EditResult = {
    text: stripped.text.slice(0, stripped.from) + cleaned + stripped.text.slice(stripped.to),
    from: stripped.from,
    to: stripped.from + cleaned.length,
  };
  for (const marker of CLEAR_MARKERS) {
    const m = marker.length;
    if (cur.from >= cur.to || !isWrappedOutside(cur.text, marker, cur.from, cur.to)) continue;
    cur = {
      text:
        cur.text.slice(0, cur.from - m) +
        cur.text.slice(cur.from, cur.to) +
        cur.text.slice(cur.to + m),
      from: cur.from - m,
      to: cur.to - m,
    };
  }
  if (from === to) {
    const pos = Math.min(Math.max(from, cur.from), cur.to);
    return { text: cur.text, from: pos, to: pos };
  }
  return cur;
}

// --------------------------------------------------------------- alignment

/** Wrap (or unwrap) a single line with `<p align>`; `null` removes alignment. */
export function setAlignment(lineText: string, align: Align | null): string {
  const prefixLen = blockPrefixLength(lineText);
  // A bare indent is not a block marker; only list / quote / heading prefixes are.
  const prefix = /\S/.test(lineText.slice(0, prefixLen)) ? lineText.slice(0, prefixLen) : "";
  const body = lineText.slice(prefix.length);
  const existing = parseAlignWrapper(body);
  const inner = existing ? existing.inner : body;
  if (align === null) return prefix + inner;
  if (inner.trim().length === 0) return lineText;
  return `${prefix}<p align="${align}">${inner}</p>`;
}

// --------------------------------------------------------------- detection

const BOLD_RE = /(\*\*|__)(?=\S)(.+?)(?<=\S)\1/g;
const ITALIC_STAR_RE = /(?<![*\w])\*(?![*\s])(.+?)(?<![*\s])\*(?!\*)/g;
const ITALIC_UNDER_RE = /(?<![_\w])_(?![_\s])(.+?)(?<![_\s])_(?!_)/g;
const BOLD_ITALIC_RE = /(?<!\*)\*\*\*(?!\s)(.+?)(?<!\s)\*\*\*(?!\*)/g;
const STRIKE_RE = /~~(?=\S)(.+?)(?<=\S)~~/g;
const HIGHLIGHT_RE = /==(?=\S)(.+?)(?<=\S)==/g;
const CODE_RE = /(`+)(.+?)\1/g;

function lineCovers(line: string, res: RegExp[], from: number, to: number): boolean {
  return res.some((re) =>
    Array.from(line.matchAll(re)).some((m) => {
      const s = m.index ?? 0;
      return s <= from && to <= s + m[0].length;
    }),
  );
}

function innermostValue(
  wrappers: Wrapper[],
  kind: HtmlKind,
  from: number,
  to: number,
): string | null {
  let best: Wrapper | null = null;
  for (const w of wrappers) {
    if (w.kind !== kind) continue;
    const covers =
      from === to
        ? w.open.to <= from && from <= w.close.from
        : w.open.from <= from && to <= w.close.to;
    if (covers && (!best || w.open.from >= best.open.from)) best = w;
  }
  return best ? (best.value ?? "") : null;
}

export function detectFormats(text: string, from: number, to: number): FormatState {
  const lineStart = (p: number): number => (p === 0 ? 0 : text.lastIndexOf(NL, p - 1) + 1);
  const lineEnd = (p: number): number => {
    const i = text.indexOf(NL, p);
    return i === -1 ? text.length : i;
  };
  const firstLine = text.slice(lineStart(from), lineEnd(from));

  // Inline markers are checked per line; a multi-line selection counts as
  // active only when every non-blank line is.
  const segs = from === to ? [{ s: from, e: from }] : lineSegments(text, from, to);
  const inlineActive = (res: RegExp[]): boolean =>
    segs.length > 0 &&
    segs.every(({ s, e }) => {
      const ls = lineStart(s);
      return lineCovers(text.slice(ls, lineEnd(s)), res, s - ls, e - ls);
    });

  const wrappers = findWrappers(text);
  const listMatch = /^\s*(?:([-*+])\s+(\[[ xX]\]\s)?|(\d+[.)])\s)/.exec(firstLine);
  let list: FormatState["list"] = null;
  if (listMatch) list = listMatch[3] ? "ol" : listMatch[2] ? "task" : "ul";

  return {
    bold: inlineActive([BOLD_RE, BOLD_ITALIC_RE]),
    italic: inlineActive([ITALIC_STAR_RE, ITALIC_UNDER_RE, BOLD_ITALIC_RE]),
    strike: inlineActive([STRIKE_RE]),
    code: inlineActive([CODE_RE]),
    highlight: inlineActive([HIGHLIGHT_RE]),
    underline: innermostValue(wrappers, "u", from, to) !== null,
    sup: innermostValue(wrappers, "sup", from, to) !== null,
    sub: innermostValue(wrappers, "sub", from, to) !== null,
    color: innermostValue(wrappers, "color", from, to),
    background: innermostValue(wrappers, "bg", from, to),
    heading: headingLevelOf(firstLine),
    list,
    quote: /^\s*>/.test(firstLine),
  };
}
