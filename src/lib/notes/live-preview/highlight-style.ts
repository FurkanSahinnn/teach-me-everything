/**
 * Token colours for the notes editor, driven by the design tokens.
 *
 * Replaces CodeMirror's `defaultHighlightStyle`, which hard-codes light-theme
 * colours (navy `#219` on a dark canvas is unreadable) and underlines every
 * heading. Markdown structure uses the ink scale; code inside fences uses the
 * same `--md-code-*` palette as the reading view so a block looks identical
 * in both modes.
 */

import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { tags as t } from "@lezer/highlight";

const notesHighlightStyle = HighlightStyle.define([
  // ---- markdown structure
  { tag: t.heading, fontWeight: "600", color: "var(--color-ink)" },
  { tag: t.strong, fontWeight: "700" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: [t.link, t.url], color: "var(--color-accent)" },
  { tag: t.quote, color: "var(--color-ink-2)" },
  { tag: t.monospace, fontFamily: "var(--font-mono)", fontSize: "0.92em" },
  { tag: [t.processingInstruction, t.contentSeparator], color: "var(--color-ink-4)" },
  { tag: t.special(t.content), backgroundColor: "var(--tme-highlight-bg)" },
  { tag: t.list, color: "var(--color-ink)" },

  // ---- code inside fences (lazy-loaded grammars)
  { tag: [t.keyword, t.modifier, t.operatorKeyword, t.controlKeyword], color: "var(--md-code-keyword)" },
  { tag: [t.string, t.special(t.string), t.regexp, t.character], color: "var(--md-code-string)" },
  { tag: [t.number, t.bool, t.null, t.atom, t.unit], color: "var(--md-code-number)" },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: "var(--md-code-comment)", fontStyle: "italic" },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.definition(t.function(t.variableName))], color: "var(--md-code-title)" },
  { tag: [t.typeName, t.className, t.namespace, t.tagName, t.standard(t.variableName)], color: "var(--md-code-built-in)" },
  { tag: [t.propertyName, t.attributeName, t.meta, t.annotation, t.labelName], color: "var(--md-code-attr)" },
  { tag: [t.self, t.special(t.variableName), t.macroName], color: "var(--md-code-number)" },
  { tag: [t.operator, t.punctuation, t.bracket, t.angleBracket, t.separator], color: "var(--md-code-muted)" },
  { tag: t.invalid, color: "var(--color-err)" },
]);

export function notesSyntaxHighlighting(): Extension {
  return syntaxHighlighting(notesHighlightStyle);
}
