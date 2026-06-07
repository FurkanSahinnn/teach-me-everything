/**
 * Phase 6.6 — Inline `#tag` chip widget.
 *
 * Matches the boundary rules of `extractTags` in `src/lib/notes/parser.ts`:
 *   • `#` must be preceded by start-of-string or a non-tag character,
 *   • body allows Unicode letters, digits, `_`, `-`, and `/` (for nested
 *     `#kimya/organik`),
 *   • must contain at least one letter (rejects `#123`, `#1.2`),
 *   • code-block content is skipped (FencedCode / InlineCode / CodeBlock).
 *
 * Active line → mark style so the user can edit. Inactive line → replace
 * with a chip widget that dispatches `tme-tag-click` so the surrounding
 * shell can drive a tag-panel filter or sidebar focus.
 */

import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import { Decoration, WidgetType } from "@codemirror/view";
import type { DecoSpec, TagClickDetail } from "./types";
import { TME_EVENT } from "./types";

export type TagMatch = {
  /** Byte offset of `#` relative to the scanned slice. */
  from: number;
  /** Byte offset just past the last tag char. */
  to: number;
  /** Raw text including the leading `#`. */
  raw: string;
  /** Lowercased tag value without `#`. */
  tag: string;
};

// Boundary group is captured separately so we can advance the regex
// cursor past it without consuming the next match's prefix.
const TAG_RE = /(^|[^\p{L}\p{N}_/#-])#([\p{L}\p{N}_/-]+)/gu;

/**
 * Scan `text` and return every inline-tag match with byte positions
 * relative to `text`. Boundary char (if any) is excluded from `from`.
 * Tags without at least one letter are skipped.
 */
export function scanTags(text: string): TagMatch[] {
  const out: TagMatch[] = [];
  TAG_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TAG_RE.exec(text)) !== null) {
    const boundary = match[1] ?? "";
    const body = match[2];
    if (body === undefined) continue;
    if (!/\p{L}/u.test(body)) continue;
    const hashIdx = match.index + boundary.length;
    out.push({
      from: hashIdx,
      to: hashIdx + 1 + body.length,
      raw: `#${body}`,
      tag: body.toLowerCase(),
    });
  }
  return out;
}

class TagWidget extends WidgetType {
  constructor(private readonly detail: TagClickDetail) {
    super();
  }

  override eq(other: WidgetType): boolean {
    if (!(other instanceof TagWidget)) return false;
    return other.detail.raw === this.detail.raw && other.detail.tag === this.detail.tag;
  }

  override toDOM(): HTMLElement {
    const root = document.createElement("span");
    root.className = "cm-tme-tag";
    root.setAttribute("role", "button");
    root.setAttribute("tabindex", "0");
    root.setAttribute("data-tag", this.detail.tag);
    root.setAttribute("data-raw", this.detail.raw);
    root.setAttribute("aria-label", `tag: ${this.detail.tag}`);
    root.textContent = this.detail.raw;

    root.addEventListener("mousedown", (event) => {
      event.preventDefault();
    });
    root.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      dispatchTagEvent(root, this.detail);
    });
    root.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        dispatchTagEvent(root, this.detail);
      }
    });
    return root;
  }

  override ignoreEvent(): boolean {
    return false;
  }
}

function dispatchTagEvent(target: HTMLElement, detail: TagClickDetail): void {
  target.dispatchEvent(
    new CustomEvent<TagClickDetail>(TME_EVENT.tagClick, {
      detail,
      bubbles: true,
      composed: true,
    }),
  );
}

const RAW_STYLE = Decoration.mark({ class: "cm-tme-tag-raw" });

export function buildTagDecorations(
  state: EditorState,
  activeLines: Set<number>,
  from: number,
  to: number,
  out: DecoSpec[],
): void {
  // Collect code-mask ranges intersecting the viewport so we skip tags
  // that sit inside fenced or inline code spans.
  const codeRanges: Array<[number, number]> = [];
  syntaxTree(state).iterate({
    from,
    to,
    enter(node) {
      if (
        node.name === "FencedCode" ||
        node.name === "InlineCode" ||
        node.name === "CodeBlock"
      ) {
        codeRanges.push([node.from, node.to]);
      }
    },
  });

  const viewportText = state.doc.sliceString(from, to);
  const matches = scanTags(viewportText);

  for (const m of matches) {
    const absFrom = from + m.from;
    const absTo = from + m.to;

    // Boundary re-check at viewport edge: scanTags' regex requires a
    // boundary char or start-of-string, but if the match is at position 0
    // of the slice we have to verify against the surrounding doc.
    if (m.from === 0 && absFrom > 0) {
      const prev = state.doc.sliceString(absFrom - 1, absFrom);
      if (/[\p{L}\p{N}_/#-]/u.test(prev)) continue;
    }

    // Skip matches that begin inside a code range.
    let insideCode = false;
    for (const [f, t] of codeRanges) {
      if (absFrom >= f && absFrom < t) {
        insideCode = true;
        break;
      }
    }
    if (insideCode) continue;

    const line = state.doc.lineAt(absFrom);
    if (activeLines.has(line.number)) {
      out.push({ from: absFrom, to: absTo, deco: RAW_STYLE });
    } else {
      const widget = new TagWidget({ raw: m.raw, tag: m.tag });
      out.push({ from: absFrom, to: absTo, deco: Decoration.replace({ widget }) });
    }
  }
}
