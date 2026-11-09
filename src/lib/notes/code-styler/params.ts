/**
 * Parser for the Obsidian "Code Styler" fence info string, shared by the
 * live-preview editor and the reading view so both agree on what a fence means.
 *
 * Grammar (after the optional leading language, any order, `:` or `=`):
 *   title:name | title:"a b"      header title
 *   ln:true|false|27              line numbers on/off/start offset
 *   hl:1,3-5,word,/re/ | {1,3-4}  highlighted lines, ranges, words, regexes
 *   fold | fold:"Placeholder"     start collapsed
 *   wrap | unwrap                 per-block wrapping
 *   ignore                        render as a plain fence
 *
 * The parser never throws: malformed pieces are dropped.
 */

export type FenceHighlights = {
  lines: Set<number>;
  words: string[];
  regexes: RegExp[];
};

export type FenceParams = {
  language: string;
  title: string | null;
  lineNumbers: boolean;
  lineStart: number;
  highlights: FenceHighlights;
  fold: boolean;
  foldPlaceholder: string | null;
  /** `null` means "use the host's default". */
  wrap: boolean | null;
  ignore: boolean;
};

/** Guards against `hl:1-999999999` allocating a giant set. */
const MAX_RANGE_SPAN = 5000;
const SAFE_REGEX_FLAGS = /[imsu]/;
const WS = /\s/;

function readQuoted(src: string, start: number): { value: string; end: number } {
  const quote = src[start];
  let i = start + 1;
  let value = "";
  while (i < src.length && src[i] !== quote) {
    if (src[i] === "\\" && i + 1 < src.length) i++;
    value += src[i] ?? "";
    i++;
  }
  return { value, end: Math.min(i + 1, src.length) };
}

function readRegex(src: string, start: number): { value: RegExp | null; end: number } {
  let i = start + 1;
  let body = "";
  while (i < src.length && src[i] !== "/") {
    if (src[i] === "\\" && i + 1 < src.length) {
      body += src[i] ?? "";
      i++;
    }
    body += src[i] ?? "";
    i++;
  }
  if (i >= src.length) return { value: null, end: src.length };
  i++; // closing slash
  let flags = "";
  while (i < src.length && /[a-z]/i.test(src[i] ?? "")) {
    const f = src[i] ?? "";
    // g/y would make `.test` stateful across lines.
    if (SAFE_REGEX_FLAGS.test(f) && !flags.includes(f)) flags += f;
    i++;
  }
  try {
    return { value: body ? new RegExp(body, flags) : null, end: i };
  } catch {
    return { value: null, end: i };
  }
}

function addHighlightItem(h: FenceHighlights, raw: string): void {
  const range = /^(\d+)-(\d+)$/.exec(raw);
  if (range) {
    const a = Number(range[1]);
    const b = Number(range[2]);
    const [lo, hi] = a <= b ? [a, b] : [b, a];
    if (hi - lo > MAX_RANGE_SPAN) return;
    for (let n = lo; n <= hi; n++) h.lines.add(n);
    return;
  }
  if (/^\d+$/.test(raw)) {
    h.lines.add(Number(raw));
    return;
  }
  if (raw) h.words.push(raw);
}

/** Parses `1,3-5` style brace content into the highlight set. */
function addHighlightList(h: FenceHighlights, list: string): void {
  for (const part of list.split(",")) addHighlightItem(h, part.trim());
}

/** Reads a comma separated `hl:` value; items may be quoted or `/regex/`. */
function readHighlightValue(h: FenceHighlights, src: string, start: number): number {
  let i = start;
  for (;;) {
    const ch = src[i];
    if (ch === '"' || ch === "'") {
      const q = readQuoted(src, i);
      if (q.value) h.words.push(q.value);
      i = q.end;
    } else if (ch === "/") {
      const r = readRegex(src, i);
      if (r.value) h.regexes.push(r.value);
      i = r.end;
    } else {
      let j = i;
      while (j < src.length && src[j] !== "," && !WS.test(src[j] ?? "")) j++;
      addHighlightItem(h, src.slice(i, j));
      i = j;
    }
    if (src[i] === ",") {
      i++;
      continue;
    }
    return i;
  }
}

function parseBool(value: string): boolean | null {
  const v = value.toLowerCase();
  if (v === "true") return true;
  if (v === "false") return false;
  return null;
}

function readValue(src: string, start: number): { value: string; end: number } {
  const ch = src[start];
  if (ch === '"' || ch === "'") return readQuoted(src, start);
  let j = start;
  while (j < src.length && !WS.test(src[j] ?? "")) j++;
  return { value: src.slice(start, j), end: j };
}

export function defaultFenceParams(): FenceParams {
  return {
    language: "",
    title: null,
    lineNumbers: true,
    lineStart: 1,
    highlights: { lines: new Set(), words: [], regexes: [] },
    fold: false,
    foldPlaceholder: null,
    wrap: null,
    ignore: false,
  };
}

function applyParam(p: FenceParams, key: string, value: string): void {
  switch (key) {
    case "title":
      if (value) p.title = value;
      break;
    case "ln": {
      const b = parseBool(value);
      if (b !== null) p.lineNumbers = b;
      else if (/^\d+$/.test(value)) {
        p.lineNumbers = true;
        p.lineStart = Number(value);
      }
      break;
    }
    case "fold": {
      const b = parseBool(value);
      if (b !== null) p.fold = b;
      else if (value) {
        p.fold = true;
        p.foldPlaceholder = value;
      }
      break;
    }
    case "wrap": {
      const b = parseBool(value);
      if (b !== null) p.wrap = b;
      break;
    }
    case "ignore": {
      const b = parseBool(value);
      if (b !== null) p.ignore = b;
      break;
    }
    default:
      break;
  }
}

/**
 * Parses the text after the opening backticks/tildes. The first token is the
 * language unless it looks like a parameter (`title:x`, `fold`, `{1,2}`).
 */
export function parseFenceInfo(info: string): FenceParams {
  const p = defaultFenceParams();
  const src = typeof info === "string" ? info : "";
  let i = 0;
  let first = true;

  while (i < src.length) {
    const ch = src[i] ?? "";
    if (WS.test(ch)) {
      i++;
      continue;
    }
    if (ch === "{") {
      const close = src.indexOf("}", i);
      const end = close === -1 ? src.length : close;
      addHighlightList(p.highlights, src.slice(i + 1, end));
      i = close === -1 ? src.length : close + 1;
      first = false;
      continue;
    }

    let j = i;
    while (j < src.length && !WS.test(src[j] ?? "") && !":={".includes(src[j] ?? "")) j++;
    const word = src.slice(i, j);
    const sep = src[j];

    if (sep === ":" || sep === "=") {
      const key = word.toLowerCase();
      first = false;
      if (key === "hl") {
        i = readHighlightValue(p.highlights, src, j + 1);
      } else {
        const { value, end } = readValue(src, j + 1);
        i = end;
        applyParam(p, key, value);
      }
      continue;
    }

    const lower = word.toLowerCase();
    if (lower === "fold") p.fold = true;
    else if (lower === "wrap") p.wrap = true;
    else if (lower === "unwrap") p.wrap = false;
    else if (lower === "ignore") p.ignore = true;
    else if (first && word) p.language = word;
    first = false;
    // `python{1,3}`: the brace group is handled on the next iteration.
    i = j > i ? j : i + 1;
  }
  return p;
}

/** `lineIndex` is 1-based within the block body (before the `ln:` offset). */
export function isLineHighlighted(
  params: FenceParams,
  lineIndex: number,
  lineText: string,
): boolean {
  const h = params.highlights;
  if (h.lines.has(lineIndex)) return true;
  if (h.words.some((w) => lineText.includes(w))) return true;
  return h.regexes.some((r) => r.test(lineText));
}
