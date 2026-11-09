/**
 * Lezer markdown extension for Obsidian's `==highlight==` syntax.
 *
 * `@lezer/markdown` ships GFM (strikethrough, tables, tasks) but not `==mark==`,
 * so without this the editor tree has no node for highlights and the live
 * preview can't style them. The delimiter rules mirror GFM strikethrough: a
 * run of exactly two `=` that is left- or right-flanking opens or closes.
 */

import type { MarkdownConfig } from "@lezer/markdown";
import { tags } from "@lezer/highlight";

const EQUALS = 61; // "="

// Same punctuation class @lezer/markdown uses for flanking checks.
const PUNCTUATION_RE = /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~\xA1‐-‧]/;

const HighlightDelim = { resolve: "Highlight", mark: "HighlightMark" };

export const HighlightSyntax: MarkdownConfig = {
  defineNodes: [
    { name: "Highlight", style: tags.special(tags.content) },
    { name: "HighlightMark", style: tags.processingInstruction },
  ],
  parseInline: [
    {
      name: "Highlight",
      parse(cx, next, pos) {
        if (next !== EQUALS || cx.char(pos + 1) !== EQUALS || cx.char(pos + 2) === EQUALS) {
          return -1;
        }
        if (pos > cx.offset && cx.char(pos - 1) === EQUALS) return -1;
        const before = cx.slice(pos - 1, pos);
        const after = cx.slice(pos + 2, pos + 3);
        const spaceBefore = /\s|^$/.test(before);
        const spaceAfter = /\s|^$/.test(after);
        const punctBefore = PUNCTUATION_RE.test(before);
        const punctAfter = PUNCTUATION_RE.test(after);
        return cx.addDelimiter(
          HighlightDelim,
          pos,
          pos + 2,
          !spaceAfter && (!punctAfter || spaceBefore || punctBefore),
          !spaceBefore && (!punctBefore || spaceAfter || punctAfter),
        );
      },
      after: "Emphasis",
    },
  ],
};
