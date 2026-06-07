/**
 * Pure markdown line- and inline-level transforms used by the editor toolbar.
 *
 * Kept independent of CodeMirror so toolbar behavior can be unit-tested in
 * a plain Node environment. The CM6 view layer (`toolbar-commands.ts`) wraps
 * these into `ChangeSpec`s.
 */

const HEADING_RE = /^(#{1,6})\s+/;
const ULIST_RE = /^[-*+]\s+/;
const OLIST_RE = /^\d+\.\s+/;
const CHECKBOX_RE = /^([-*+])\s+\[([ xX])\]\s+/;
const BLOCKQUOTE_RE = /^>\s+/;

export type HeadingLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/**
 * Apply or clear an ATX heading marker on a single line.
 * `level === 0` strips any existing 1-6 heading marker.
 * Existing headings of any level are replaced with the requested level.
 */
export function setHeadingLevel(line: string, level: HeadingLevel): string {
  const stripped = line.replace(HEADING_RE, "");
  if (level === 0) return stripped;
  return "#".repeat(level) + " " + stripped;
}

/**
 * Toggle a line between an unordered list item and a plain paragraph.
 * Ordered/checkbox items are converted to plain bullets first.
 */
export function toggleUnorderedListLine(line: string): string {
  if (CHECKBOX_RE.test(line)) {
    return line.replace(CHECKBOX_RE, "");
  }
  if (ULIST_RE.test(line)) {
    return line.replace(ULIST_RE, "");
  }
  if (OLIST_RE.test(line)) {
    return line.replace(OLIST_RE, "- ");
  }
  return "- " + line;
}

/**
 * Toggle a line between an ordered list item and a plain paragraph.
 * `indexForFresh` is the number used when promoting a plain line to ordered.
 */
export function toggleOrderedListLine(line: string, indexForFresh: number): string {
  if (OLIST_RE.test(line)) {
    return line.replace(OLIST_RE, "");
  }
  if (CHECKBOX_RE.test(line)) {
    return line.replace(CHECKBOX_RE, `${indexForFresh}. `);
  }
  if (ULIST_RE.test(line)) {
    return line.replace(ULIST_RE, `${indexForFresh}. `);
  }
  return `${indexForFresh}. ` + line;
}

/**
 * Toggle a line through three states: plain → checkbox-unchecked → checkbox-checked → plain.
 * Bullet/ordered items are converted to checkboxes on first toggle.
 */
export function toggleCheckboxLine(line: string): string {
  const match = CHECKBOX_RE.exec(line);
  if (match) {
    const marker = match[1] ?? "-";
    const checked = match[2] === "x" || match[2] === "X";
    if (checked) {
      // Remove the checkbox entirely on the third toggle.
      return line.replace(CHECKBOX_RE, "");
    }
    return line.replace(CHECKBOX_RE, `${marker} [x] `);
  }
  if (ULIST_RE.test(line)) {
    return line.replace(ULIST_RE, "- [ ] ");
  }
  if (OLIST_RE.test(line)) {
    return line.replace(OLIST_RE, "- [ ] ");
  }
  return "- [ ] " + line;
}

/**
 * Toggle a single-level blockquote marker on a line.
 * Nested blockquotes are not handled — adding `>` to an already-`>` line is a no-op strip.
 */
export function toggleBlockquoteLine(line: string): string {
  if (BLOCKQUOTE_RE.test(line)) {
    return line.replace(BLOCKQUOTE_RE, "");
  }
  return "> " + line;
}

export type InlineWrapResult = {
  text: string;
  from: number;
  to: number;
};

/**
 * Wrap (or unwrap) a substring of `text` with a symmetric inline marker.
 *
 * If the marker is already present directly outside the [from, to) range, it is
 * stripped. Otherwise the marker is inserted on both sides. Returns the new
 * text and the new caret/anchor positions for the same logical selection.
 */
export function toggleInlineWrap(
  text: string,
  marker: string,
  from: number,
  to: number,
): InlineWrapResult {
  if (from < 0 || to > text.length || from > to) {
    return { text, from, to };
  }
  const before = text.slice(Math.max(0, from - marker.length), from);
  const after = text.slice(to, Math.min(text.length, to + marker.length));
  const sel = text.slice(from, to);

  if (before === marker && after === marker) {
    const newText =
      text.slice(0, from - marker.length) + sel + text.slice(to + marker.length);
    return {
      text: newText,
      from: from - marker.length,
      to: to - marker.length,
    };
  }

  const newText = text.slice(0, from) + marker + sel + marker + text.slice(to);
  return {
    text: newText,
    from: from + marker.length,
    to: to + marker.length,
  };
}
