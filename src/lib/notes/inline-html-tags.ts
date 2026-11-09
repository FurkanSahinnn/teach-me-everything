/**
 * Strict recogniser for the inline HTML shapes the notes editor reads and
 * writes (Colored Text / Editing Toolbar compatible). Shared by the pure edit
 * transforms, the live-preview decorations and the reading-view markdown-it
 * rule so all three agree on what counts as formatting. Anything that does not
 * match a shape exactly (or carries an unvalidated colour) is NOT a tag and
 * stays raw text, which is what keeps `html: false` meaningful.
 */

export type HtmlKind = "color" | "bg" | "u" | "sup" | "sub";

export type OpenTag = {
  kind: HtmlKind;
  /** Validated, trimmed CSS colour for `color` / `bg`; null otherwise. */
  value: string | null;
  length: number;
  /** Lowercase element name that closes this tag (`span`, `font`, `mark`, …). */
  closeName: string;
};

export type Wrapper = {
  kind: HtmlKind;
  value: string | null;
  open: { from: number; to: number };
  close: { from: number; to: number };
};

const NAMED_COLORS = new Set([
  "black", "white", "gray", "grey", "silver", "red", "maroon", "orange", "yellow",
  "olive", "lime", "green", "aqua", "cyan", "teal", "blue", "navy", "fuchsia",
  "magenta", "purple", "pink", "brown", "gold", "coral", "salmon", "violet",
  "indigo", "crimson", "turquoise", "tomato", "orchid", "khaki", "tan", "beige",
  "lavender", "plum", "sienna", "chocolate", "skyblue", "steelblue", "slategray",
  "darkgreen", "darkblue", "darkred", "lightgreen", "lightblue", "lightgray",
  "lightyellow", "lightpink", "orangered", "hotpink", "limegreen", "royalblue",
]);

const HEX_RE = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const NUM = String.raw`\d{1,3}(?:\.\d{1,2})?%?`;
const ALPHA = String.raw`(?:0?\.\d{1,3}|[01]|\d{1,3}%)`;
const RGB_RE = new RegExp(
  String.raw`^rgba?\(\s*${NUM}\s*,\s*${NUM}\s*,\s*${NUM}\s*(?:,\s*${ALPHA}\s*)?\)$`,
  "i",
);

/** Trimmed colour when it passes the strict validator, else null. */
export function normalizeCssColor(value: string): string | null {
  const v = value.trim();
  if (v.length === 0 || v.length > 64) return null;
  if (HEX_RE.test(v) || RGB_RE.test(v) || NAMED_COLORS.has(v.toLowerCase())) return v;
  return null;
}

/** Only values that can never break out of a `style` attribute are accepted. */
export function isSafeCssColor(value: string): boolean {
  return normalizeCssColor(value) !== null;
}

const VALUE = String.raw`([^"';<>]{1,64}?)`;
const SPAN_RE = new RegExp(
  String.raw`<span\s+style\s*=\s*(["'])\s*color\s*:\s*${VALUE}\s*;?\s*\1\s*>`,
  "iy",
);
const FONT_RE = new RegExp(
  String.raw`<font\s+color\s*=\s*(["'])\s*${VALUE}\s*\1\s*>`,
  "iy",
);
const MARK_RE = new RegExp(
  String.raw`<mark\s+style\s*=\s*(["'])\s*background(?:-color)?\s*:\s*${VALUE}\s*;?\s*\1\s*>`,
  "iy",
);
const PLAIN_RE = /<(u|sup|sub)>/iy;
const CLOSE_RE = /<\/(span|font|mark|u|sup|sub)>/iy;

/** Match an opening tag exactly at `pos`; null when it is not a known shape. */
export function matchOpenTag(src: string, pos: number): OpenTag | null {
  if (src.charCodeAt(pos) !== 60 /* < */) return null;
  const colored: Array<[RegExp, HtmlKind, string]> = [
    [SPAN_RE, "color", "span"],
    [FONT_RE, "color", "font"],
    [MARK_RE, "bg", "mark"],
  ];
  for (const [re, kind, closeName] of colored) {
    re.lastIndex = pos;
    const m = re.exec(src);
    if (!m) continue;
    const value = normalizeCssColor(m[2] ?? "");
    if (value === null) return null;
    return { kind, value, length: m[0].length, closeName };
  }
  PLAIN_RE.lastIndex = pos;
  const p = PLAIN_RE.exec(src);
  if (p) {
    const name = (p[1] ?? "").toLowerCase();
    return { kind: name as HtmlKind, value: null, length: p[0].length, closeName: name };
  }
  return null;
}

/** Match a closing tag at `pos`; `name` is the lowercase element name. */
export function matchCloseTag(src: string, pos: number): { name: string; length: number } | null {
  if (src.charCodeAt(pos) !== 60 || src.charCodeAt(pos + 1) !== 47) return null;
  CLOSE_RE.lastIndex = pos;
  const m = CLOSE_RE.exec(src);
  if (!m) return null;
  return { name: (m[1] ?? "").toLowerCase(), length: m[0].length };
}

/**
 * Pair up recognised open/close tags. Unmatched tags are simply absent from
 * the result, so callers leave them as raw text. Backtick code spans are
 * skipped so tags quoted in code are never treated as formatting.
 */
export function findWrappers(text: string): Wrapper[] {
  const out: Wrapper[] = [];
  const stack: Array<{ tag: OpenTag; from: number }> = [];
  let i = 0;
  while (i < text.length) {
    const c = text.charCodeAt(i);
    if (c === 96 /* ` */) {
      let run = 1;
      while (text.charCodeAt(i + run) === 96) run += 1;
      const fence = "`".repeat(run);
      const end = text.indexOf(fence, i + run);
      i = end === -1 ? i + run : end + run;
      continue;
    }
    if (c === 60 /* < */) {
      const open = matchOpenTag(text, i);
      if (open) {
        stack.push({ tag: open, from: i });
        i += open.length;
        continue;
      }
      const close = matchCloseTag(text, i);
      if (close) {
        for (let s = stack.length - 1; s >= 0; s -= 1) {
          const entry = stack[s]!;
          if (entry.tag.closeName !== close.name) continue;
          out.push({
            kind: entry.tag.kind,
            value: entry.tag.value,
            open: { from: entry.from, to: entry.from + entry.tag.length },
            close: { from: i, to: i + close.length },
          });
          stack.length = s;
          break;
        }
        i += close.length;
        continue;
      }
    }
    i += 1;
  }
  return out.sort((a, b) => a.open.from - b.open.from || b.close.to - a.close.to);
}

export type Align = "left" | "center" | "right" | "justify";

const ALIGN_P_RE = /^<p\s+align\s*=\s*(["'])(left|center|right|justify)\1\s*>([\s\S]*)<\/p>$/i;
const ALIGN_CENTER_RE = /^<center>([\s\S]*)<\/center>$/i;

/** Parse a whole `<p align>…</p>` / `<center>…</center>` string. */
export function parseAlignWrapper(s: string): { align: Align; inner: string } | null {
  const t = s.trim();
  const p = ALIGN_P_RE.exec(t);
  if (p) return { align: (p[2] ?? "left").toLowerCase() as Align, inner: p[3] ?? "" };
  const c = ALIGN_CENTER_RE.exec(t);
  if (c) return { align: "center", inner: c[1] ?? "" };
  return null;
}
