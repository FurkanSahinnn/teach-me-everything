/**
 * Phase 6.3 — Inline mark decorations.
 *
 * Walks every inline syntax node inside the visible viewport and produces
 * two kinds of decorations:
 *
 *   • A `mark` decoration spanning the content (between the syntax markers)
 *     with a class that the live-preview theme styles — `cm-tme-strong`,
 *     `cm-tme-em`, `cm-tme-strike`, `cm-tme-code`, `cm-tme-link`. These are
 *     applied unconditionally so the prose stays styled even on the active
 *     line. Active-line markers fall through to default Markdown syntax
 *     highlighting from `@codemirror/lang-markdown`.
 *
 *   • A `replace` decoration that collapses each marker (`**`, `_`, `~~`,
 *     `` ` ``, `[`, `]`/`](url)`) — but ONLY on lines that do NOT contain
 *     the cursor. The hide is per-marker, not per-node: a bold span that
 *     opens on an active line but closes on an inactive one keeps the
 *     opener visible while collapsing the closer, which reads more naturally
 *     than an all-or-nothing rule.
 *
 * Nested marks (e.g. `**bold _italic_ bold**`) work because we recurse into
 * children via Lezer's normal iteration — the outer Emphasis fires first,
 * then the inner one, each contributing its own decorations.
 */

import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import { Decoration } from "@codemirror/view";
import type { SyntaxNodeRef } from "@lezer/common";
import type { DecoSpec } from "./types";

const HIDE = Decoration.replace({});

const STRONG_STYLE = Decoration.mark({ class: "cm-tme-strong" });
const EM_STYLE = Decoration.mark({ class: "cm-tme-em" });
const STRIKE_STYLE = Decoration.mark({ class: "cm-tme-strike" });
const CODE_STYLE = Decoration.mark({ class: "cm-tme-code" });
const LINK_STYLE = Decoration.mark({ class: "cm-tme-link" });

type ChildSummary = { name: string; from: number; to: number };

function readChildren(ref: SyntaxNodeRef): ChildSummary[] {
  const children: ChildSummary[] = [];
  let c = ref.node.firstChild;
  while (c) {
    children.push({ name: c.name, from: c.from, to: c.to });
    c = c.nextSibling;
  }
  return children;
}

function lineIsActive(state: EditorState, pos: number, active: Set<number>): boolean {
  return active.has(state.doc.lineAt(pos).number);
}

export function buildInlineMarkDecorations(
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
      switch (node.name) {
        case "StrongEmphasis":
          emitWrappedNode(state, node, activeLines, "EmphasisMark", STRONG_STYLE, out);
          return;
        case "Emphasis":
          emitWrappedNode(state, node, activeLines, "EmphasisMark", EM_STYLE, out);
          return;
        case "Strikethrough":
          emitWrappedNode(state, node, activeLines, "StrikethroughMark", STRIKE_STYLE, out);
          return;
        case "InlineCode":
          emitWrappedNode(state, node, activeLines, "CodeMark", CODE_STYLE, out);
          return;
        case "Link":
          emitLink(state, node, activeLines, out);
          return;
      }
    },
  });
}

/**
 * Emit a styled mark for the interior of a symmetric wrap node (Emphasis,
 * StrongEmphasis, Strikethrough, InlineCode). Collapse the leading and
 * trailing markers when their respective lines are inactive.
 */
function emitWrappedNode(
  state: EditorState,
  node: SyntaxNodeRef,
  activeLines: Set<number>,
  markerName: string,
  styleDeco: Decoration,
  out: DecoSpec[],
): void {
  const children = readChildren(node);
  const firstMark = children.find((c) => c.name === markerName);
  // Last marker (not first) so we don't pick the same child for both ends
  // when there's exactly one marker (malformed input — bail).
  let lastMark: ChildSummary | undefined;
  for (let i = children.length - 1; i >= 0; i--) {
    if (children[i]!.name === markerName) {
      lastMark = children[i];
      break;
    }
  }
  if (!firstMark || !lastMark || firstMark === lastMark) return;
  if (lastMark.from <= firstMark.to) return;

  out.push({ from: firstMark.to, to: lastMark.from, deco: styleDeco });

  if (!lineIsActive(state, firstMark.from, activeLines)) {
    out.push({ from: firstMark.from, to: firstMark.to, deco: HIDE });
  }
  if (!lineIsActive(state, lastMark.from, activeLines)) {
    out.push({ from: lastMark.from, to: lastMark.to, deco: HIDE });
  }
}

/**
 * `[label](url)` — render `label` as a link, collapse `[`, `]`, `(`, `url`
 * and `)` on inactive lines. Reference / shortcut / autolink forms are not
 * collapsed in Phase 6.3 (they look fine as raw text and the heuristics get
 * hairy fast — revisit if user feedback asks for it).
 */
function emitLink(
  state: EditorState,
  node: SyntaxNodeRef,
  activeLines: Set<number>,
  out: DecoSpec[],
): void {
  const children = readChildren(node);
  const hasUrl = children.some((c) => c.name === "URL");
  if (!hasUrl) return;

  const linkMarks = children.filter((c) => c.name === "LinkMark");
  if (linkMarks.length < 2) return;

  const openBracket = linkMarks[0]!;
  const closeBracket = linkMarks[1]!;
  if (closeBracket.from <= openBracket.to) return;

  // Style the label.
  out.push({ from: openBracket.to, to: closeBracket.from, deco: LINK_STYLE });

  if (!lineIsActive(state, openBracket.from, activeLines)) {
    out.push({ from: openBracket.from, to: openBracket.to, deco: HIDE });
    // Collapse everything from `]` through the end of the Link node — that
    // covers `](url)` and `](url "title")` in one shot.
    if (node.to > closeBracket.from) {
      out.push({ from: closeBracket.from, to: node.to, deco: HIDE });
    }
  }
}
