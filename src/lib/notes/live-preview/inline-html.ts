/**
 * Live-preview rendering for the inline HTML the formatting toolbar writes
 * (Obsidian "Colored Text" / "Editing Toolbar" syntax) plus the `==highlight==`
 * theme.
 *
 *   <span style="color:#hex">…</span>   text colour (also `<font color>`)
 *   <mark style="background:#hex">…</mark>   background colour
 *   <u> <sup> <sub>                     underline / super / subscript
 *   <p align="center">…</p>, <center>…</center>   line-level alignment
 *
 * On inactive lines the tags collapse and only the styled text shows; on the
 * active line the tags stay visible but dimmed while the inner text is still
 * styled, so the user sees the result as they edit. Colours reach a `style`
 * attribute only after `isSafeCssColor` passes (the tag matcher validates
 * them as well); unmatched or invalid tags are never decorated and stay raw.
 */

import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { blockPrefixLength } from "@/lib/notes/markdown-edits";
import { findWrappers, isSafeCssColor, type Wrapper } from "@/lib/notes/inline-html-tags";
import type { DecoSpec } from "./types";

const HIDE = Decoration.replace({});
const TAG_DIM = Decoration.mark({ class: "cm-tme-html-tag" });
const U_STYLE = Decoration.mark({ class: "cm-tme-u" });
const SUP_STYLE = Decoration.mark({ class: "cm-tme-sup" });
const SUB_STYLE = Decoration.mark({ class: "cm-tme-sub" });

const CODE_NODES = new Set(["FencedCode", "CodeBlock", "InlineCode", "CodeText", "CommentBlock"]);

const ALIGN_LINE_RE =
  /^(<p\s+align\s*=\s*(["'])(left|center|right|justify)\2\s*>|<center>)(.*?)(<\/p>|<\/center>)\s*$/i;

function isInCode(state: EditorState, pos: number): boolean {
  let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 1);
  while (node) {
    if (CODE_NODES.has(node.name)) return true;
    node = node.parent;
  }
  return false;
}

function contentDeco(w: Wrapper): Decoration | null {
  switch (w.kind) {
    case "color":
      if (w.value === null || !isSafeCssColor(w.value)) return null;
      return Decoration.mark({
        class: "cm-tme-color",
        attributes: { style: `color:${w.value}` },
      });
    case "bg":
      if (w.value === null || !isSafeCssColor(w.value)) return null;
      return Decoration.mark({
        class: "cm-tme-bg",
        attributes: { style: `background:${w.value}` },
      });
    case "u":
      return U_STYLE;
    case "sup":
      return SUP_STYLE;
    case "sub":
      return SUB_STYLE;
  }
}

function emitTag(from: number, to: number, active: boolean, out: DecoSpec[]): void {
  if (to <= from) return;
  out.push({ from, to, deco: active ? TAG_DIM : HIDE });
}

function emitAlignment(
  lineFrom: number,
  text: string,
  active: boolean,
  out: DecoSpec[],
): void {
  const prefix = blockPrefixLength(text);
  const m = ALIGN_LINE_RE.exec(text.slice(prefix));
  if (!m) return;
  const openIsP = (m[1] ?? "").toLowerCase().startsWith("<p");
  const closeIsP = (m[5] ?? "").toLowerCase() === "</p>";
  if (openIsP !== closeIsP) return;
  const align = openIsP ? (m[3] ?? "left").toLowerCase() : "center";
  out.push({
    from: lineFrom,
    to: lineFrom,
    deco: Decoration.line({ class: `cm-tme-align cm-tme-align-${align}` }),
  });
  const openStart = lineFrom + prefix;
  const openEnd = openStart + (m[1] ?? "").length;
  const closeStart = openEnd + (m[4] ?? "").length;
  emitTag(openStart, openEnd, active, out);
  emitTag(closeStart, closeStart + (m[5] ?? "").length, active, out);
}

export function buildInlineHtmlDecorations(
  state: EditorState,
  activeLines: Set<number>,
  from: number,
  to: number,
  out: DecoSpec[],
): void {
  const doc = state.doc;
  let pos = from;
  while (pos <= to) {
    const line = doc.lineAt(pos);
    pos = line.to + 1;
    if (!line.text.includes("<")) continue;
    if (isInCode(state, line.from)) continue;
    const active = activeLines.has(line.number);
    emitAlignment(line.from, line.text, active, out);
    // Wrappers are paired per line: the toolbar writes one wrapper per line,
    // and it keeps a stray `<u>` from styling the rest of the document.
    for (const w of findWrappers(line.text)) {
      const base = line.from;
      if (isInCode(state, base + w.open.from)) continue;
      const deco = contentDeco(w);
      if (!deco) continue;
      if (w.close.from > w.open.to) {
        out.push({ from: base + w.open.to, to: base + w.close.from, deco });
      }
      emitTag(base + w.open.from, base + w.open.to, active, out);
      emitTag(base + w.close.from, base + w.close.to, active, out);
    }
  }
}

export const inlineHtmlTheme = EditorView.theme({
  ".cm-tme-highlight": {
    backgroundColor: "var(--tme-highlight-bg)",
    borderRadius: "3px",
    padding: "0 0.1em",
  },
  ".cm-tme-bg": {
    borderRadius: "3px",
    padding: "0 0.1em",
  },
  ".cm-tme-u": {
    textDecoration: "underline",
    textUnderlineOffset: "3px",
  },
  ".cm-tme-sup": {
    verticalAlign: "super",
    fontSize: "0.75em",
  },
  ".cm-tme-sub": {
    verticalAlign: "sub",
    fontSize: "0.75em",
  },
  ".cm-tme-html-tag": {
    color: "var(--color-ink-4)",
    fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)",
    fontSize: "0.85em",
  },
  ".cm-tme-align-center": { textAlign: "center" },
  ".cm-tme-align-right": { textAlign: "right" },
  ".cm-tme-align-justify": { textAlign: "justify" },
  ".cm-tme-align-left": { textAlign: "left" },
});
