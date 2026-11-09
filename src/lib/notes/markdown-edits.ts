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

/** Heading level of a line (0 when it is not an ATX heading). */
export function headingLevelOf(line: string): HeadingLevel {
  const m = HEADING_RE.exec(line);
  return (m ? (m[1] ?? "").length : 0) as HeadingLevel;
}

/** Like `setHeadingLevel`, but asking for the level the line already has clears it. */
export function toggleHeadingLevel(line: string, level: HeadingLevel): string {
  return setHeadingLevel(line, headingLevelOf(line) === level ? 0 : level);
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

export type Segment = { s: number; e: number };

const NL = "\n";

// Indentation, quote markers, list / task markers and ATX heading markers stay
// outside any inline wrapper so wrapping a list or quote never breaks it.
const BLOCK_PREFIX_RE =
  /^[ \t]*(?:>[ \t]*)*(?:(?:[-*+]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?|#{1,6}[ \t]+)?/;

/** Length of the block marker prefix of a single line. */
export function blockPrefixLength(line: string): number {
  return BLOCK_PREFIX_RE.exec(line)?.[0].length ?? 0;
}

/**
 * Split [from, to) into one segment per line, skipping block markers and
 * surrounding whitespace. Blank segments are dropped.
 */
export function lineSegments(text: string, from: number, to: number): Segment[] {
  const segs: Segment[] = [];
  let pos = from;
  for (;;) {
    const ls = pos === 0 ? 0 : text.lastIndexOf(NL, pos - 1) + 1;
    let le = text.indexOf(NL, pos);
    if (le === -1) le = text.length;
    let s = Math.max(from, ls);
    let e = Math.min(to, le);
    s = Math.max(s, ls + blockPrefixLength(text.slice(ls, le)));
    while (s < e && /\s/.test(text.charAt(s))) s += 1;
    while (e > s && /\s/.test(text.charAt(e - 1))) e -= 1;
    if (s < e) segs.push({ s, e });
    if (le >= to) break;
    pos = le + 1;
  }
  return segs;
}

/**
 * Rewrite each segment through `fn`; `a`/`b` are the inner selection offsets
 * inside the replacement. The result selects from the first segment's inner
 * start to the last segment's inner end.
 */
export function mapSegments(
  text: string,
  segs: Segment[],
  fn: (seg: string) => { out: string; a: number; b: number },
): InlineWrapResult {
  let out = "";
  let cursor = 0;
  let from = 0;
  let to = 0;
  segs.forEach((seg, i) => {
    out += text.slice(cursor, seg.s);
    const r = fn(text.slice(seg.s, seg.e));
    if (i === 0) from = out.length + r.a;
    to = out.length + r.b;
    out += r.out;
    cursor = seg.e;
  });
  out += text.slice(cursor);
  return { text: out, from, to };
}

// `*` and `_` can stack (`***x***` is bold+italic), so "is italic on" means an
// ODD run of the character on both sides, never a plain prefix match.
const isRunMarker = (marker: string): boolean => marker === "*" || marker === "_";

function runBefore(text: string, pos: number, ch: string): number {
  let n = 0;
  while (pos - n - 1 >= 0 && text.charAt(pos - n - 1) === ch) n += 1;
  return n;
}

function runAfter(text: string, pos: number, ch: string): number {
  let n = 0;
  while (pos + n < text.length && text.charAt(pos + n) === ch) n += 1;
  return n;
}

/** True when `marker` sits directly outside [from, to). */
export function isWrappedOutside(text: string, marker: string, from: number, to: number): boolean {
  if (isRunMarker(marker)) {
    return Math.min(runBefore(text, from, marker), runAfter(text, to, marker)) % 2 === 1;
  }
  return (
    from >= marker.length &&
    text.slice(from - marker.length, from) === marker &&
    text.slice(to, to + marker.length) === marker
  );
}

/** True when the selected text itself starts and ends with `marker`. */
export function isWrappedInside(text: string, marker: string, from: number, to: number): boolean {
  const sel = text.slice(from, to);
  if (isRunMarker(marker)) {
    const lead = runAfter(sel, 0, marker);
    const trail = runBefore(sel, sel.length, marker);
    return lead + trail < sel.length && Math.min(lead, trail) % 2 === 1;
  }
  return sel.length > 2 * marker.length && sel.startsWith(marker) && sel.endsWith(marker);
}

/**
 * Toggle a symmetric inline marker around [from, to).
 *
 * Unwraps when the marker is directly outside the range OR when the range
 * itself includes both markers (the user selected `**word**`); otherwise
 * wraps each line of the selection separately so list / quote markers stay
 * outside the wrapper. A caret inserts an empty pair and sits between them.
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
  const m = marker.length;

  if (from === to) {
    if (isWrappedOutside(text, marker, from, to)) {
      return {
        text: text.slice(0, from - m) + text.slice(to + m),
        from: from - m,
        to: to - m,
      };
    }
    return {
      text: text.slice(0, from) + marker + marker + text.slice(to),
      from: from + m,
      to: to + m,
    };
  }

  const segs = lineSegments(text, from, to);
  if (segs.length === 0) return { text, from, to };

  if (segs.length === 1) {
    const { s, e } = segs[0]!;
    if (isWrappedOutside(text, marker, s, e)) {
      return {
        text: text.slice(0, s - m) + text.slice(s, e) + text.slice(e + m),
        from: s - m,
        to: e - m,
      };
    }
  }

  const allInside = segs.every(({ s, e }) => isWrappedInside(text, marker, s, e));
  if (allInside) {
    return mapSegments(text, segs, (seg) => {
      const inner = seg.slice(m, seg.length - m);
      return { out: inner, a: 0, b: inner.length };
    });
  }
  // With several lines the selection keeps the markers inside it, so pressing
  // the same shortcut again takes the "selection includes the markers" path.
  const multi = segs.length > 1;
  return mapSegments(text, segs, (seg) => {
    if (isWrappedInside(seg, marker, 0, seg.length)) return { out: seg, a: 0, b: seg.length };
    const out = marker + seg + marker;
    return multi ? { out, a: 0, b: out.length } : { out, a: m, b: m + seg.length };
  });
}
