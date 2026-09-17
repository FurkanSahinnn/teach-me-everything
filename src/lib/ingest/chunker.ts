// Heading-aware semantic chunker. Pure — safe to import from main thread or Web Worker.
// Token approximation: chars/4. Real tiktoken integration is Phase 3.
//
// Structure is preserved, not "cleaned": blank lines and leading indentation
// are the grammar of Markdown. Dropping them (which this chunker did until
// 2026-09) turned `paragraph\n\n---` into a setext H2, glued consecutive
// paragraphs together, pulled the paragraph after a list into its last item,
// and flattened nested lists — every one of those showed up in the reader as
// "the markdown looks broken" even though the renderer was fine. The chunker
// only ever normalises for its own bookkeeping (token counts, heading
// detection) on a trimmed copy; the stored text is the author's.

const TARGET_TOKENS = 750;
const MAX_TOKENS = 1100;
// Past this we split even without a paragraph boundary — a single enormous
// paragraph must still be chunkable, and so must a single enormous code block:
// a fence is closed at the cut and re-opened in the next chunk rather than
// left to swallow the rest of the document, which is what an unbalanced ```
// in an LLM-written note would otherwise do (and an embedding model rejects a
// 20k-token input outright).
const HARD_MAX_TOKENS = 1650;
const OVERLAP_TOKENS = 100;

export type ChunkerPage = {
  page: number;
  text: string;
  headings?: string[];
};

/**
 * `markdown` keeps indentation and disables the PDF heading heuristics
 * (numbered / ALL-CAPS / keyword lines), which mistake ordered-list items and
 * numbered sentences for section titles. `plain` (PDF / DOCX extraction) trims
 * each line and keeps the heuristics, since that text has no `#` headings to
 * go on. Omitted → auto-detected from the presence of `#` headings.
 */
export type ChunkerFormat = "markdown" | "plain";

export type ChunkerInput = {
  pages: ChunkerPage[];
  format?: ChunkerFormat | undefined;
};

export type ChunkerOutput = Array<{
  index: number;
  text: string;
  tokenCount: number;
  page?: number | undefined;
  section?: string | undefined;
  headings?: string[] | undefined;
}>;

type Line = {
  text: string;
  page: number;
  isHeading: boolean;
  isBlank: boolean;
  inFence: boolean;
  /** The ``` marker lines themselves, as opposed to the code between them. */
  isFenceMarker: boolean;
  /** Section in force when this line was read (the heading itself included). */
  section: string | undefined;
};

const MARKDOWN_HEADING = /^ {0,3}#{1,6}\s/;

function splitLongLine(line: string): string[] {
  // Leave room for overlap and synthetic fence markers. A minified JSON line
  // or a paragraph without newlines must not bypass the hard token budget.
  const limit = (HARD_MAX_TOKENS - OVERLAP_TOKENS - 32) * 4;
  const parts: string[] = [];
  for (let start = 0; start < line.length;) {
    let end = Math.min(start + limit, line.length);
    if (end < line.length && /[\uD800-\uDBFF]/.test(line[end - 1]!)) end -= 1;
    parts.push(line.slice(start, end));
    start = end;
  }
  return parts.length ? parts : [""];
}

export function detectChunkerFormat(pages: ChunkerPage[]): ChunkerFormat {
  return pages.some((p) => /^ {0,3}#{1,6}\s/m.test(p.text)) ? "markdown" : "plain";
}

export function chunkPages(input: ChunkerInput): ChunkerOutput {
  const format = input.format ?? detectChunkerFormat(input.pages);
  const markdown = format === "markdown";

  const lines: Line[] = [];
  let currentSection: string | undefined;
  let openFence: string | undefined;
  for (const p of input.pages) {
    const headingSet = new Set((p.headings ?? []).map((h) => h.trim()));
    const rawLines = p.text.split(/\r?\n/).flatMap(splitLongLine);
    for (const raw of rawLines) {
      const trimmed = raw.trim();
      const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(raw);
      const closesFence = marker && openFence && marker[1]![0] === openFence[0]
        && marker[1]!.length >= openFence.length && !marker[2]!.trim();
      if (marker && (!openFence || closesFence)) {
        openFence = openFence ? undefined : marker[1];
        lines.push({
          text: trimmed,
          page: p.page,
          isHeading: false,
          isBlank: false,
          inFence: true,
          isFenceMarker: true,
          section: currentSection,
        });
        continue;
      }
      // Inside a fence we MUST preserve leading whitespace (Python/YAML/etc
      // are indent-sensitive) and blank lines so the rendered code block
      // matches the source byte-for-byte.
      if (openFence) {
        lines.push({
          text: raw,
          page: p.page,
          isHeading: false,
          isBlank: false,
          inFence: true,
          isFenceMarker: false,
          section: currentSection,
        });
        continue;
      }
      if (!trimmed) {
        // One blank line carries all the structure Markdown needs; runs of
        // them are collapsed so token budgets and overlap stay predictable.
        const prev = lines[lines.length - 1];
        if (prev && !prev.isBlank) {
          lines.push({
            text: "",
            page: p.page,
            isHeading: false,
            isBlank: true,
            inFence: false,
            isFenceMarker: false,
            section: currentSection,
          });
        }
        continue;
      }
      const isHeading =
        headingSet.has(trimmed) ||
        (markdown ? MARKDOWN_HEADING.test(raw) : isHeadingByPattern(trimmed));
      if (isHeading) currentSection = trimmed;
      lines.push({
        // Markdown keeps the author's indentation (nested lists, continuation
        // lines) and trailing double-space hard breaks; extracted text is
        // trimmed because PDF/DOCX indentation is layout noise.
        text: markdown ? raw.replace(/\s+$/u, (m) => (m.startsWith("  ") ? "  " : "")) : trimmed,
        page: p.page,
        isHeading,
        isBlank: false,
        inFence: false,
        isFenceMarker: false,
        section: currentSection,
      });
    }
  }

  const chunks: ChunkerOutput = [];
  let buf: Line[] = [];
  let bufTokens = 0;
  let bufFirstPage: number | undefined;
  let bufHeadings: string[] = [];

  function push(line: Line): void {
    if (bufFirstPage === undefined) bufFirstPage = line.page;
    buf.push(line);
    bufTokens += approxTokens(line.text);
  }

  /**
   * Emit the buffer as a chunk. `atBoundary` says the cut landed on a
   * paragraph boundary, heading or fence edge; only a cut forced mid-paragraph
   * carries an overlap into the next chunk.
   */
  function flush(atBoundary: boolean): void {
    const body = buf
      .map((l) => l.text)
      .join("\n")
      .trim();
    if (!body) {
      buf = [];
      bufTokens = 0;
      bufHeadings = [];
      bufFirstPage = undefined;
      return;
    }
    // The section is the one in force at the chunk's first line, not the last
    // heading the chunker happened to pass — that mislabelled every chunk that
    // began before a heading with the title of what came after it.
    const firstContent = buf.find((l) => !l.isBlank);
    chunks.push({
      index: chunks.length,
      text: body,
      tokenCount: bufTokens,
      page: bufFirstPage,
      section: firstContent?.section,
      headings: bufHeadings.length > 0 ? [...bufHeadings] : undefined,
    });

    // Overlap exists to repair a paragraph that had to be cut mid-flow, so
    // the tail is the end of that paragraph and nothing before it — never a
    // blank line, never part of a fence. A chunk that ended cleanly carries
    // none: the reader shows chunks in sequence, so any overlap is text the
    // user reads twice, and an overlap that opened with `---` or half a code
    // block would re-create the very rendering faults this chunker exists to
    // avoid.
    const tail: Line[] = [];
    if (!atBoundary) {
      let tailTokens = 0;
      for (let i = buf.length - 1; i >= 0; i -= 1) {
        const line = buf[i];
        if (!line || line.isBlank || line.inFence) break;
        const t = approxTokens(line.text);
        if (tailTokens + t > OVERLAP_TOKENS) break;
        tail.unshift(line);
        tailTokens += t;
      }
    }
    buf = tail;
    bufTokens = tail.reduce((n, l) => n + approxTokens(l.text), 0);
    bufFirstPage = tail[0]?.page;
    bufHeadings = [];
  }

  // The marker that opened the fence the loop is currently inside, and how
  // many code lines of it the buffer already holds.
  let fenceOpener: Line | undefined;
  let fenceLinesInBuf = 0;

  for (const [lineIndex, line] of lines.entries()) {
    if (line.isHeading) {
      if (bufTokens >= TARGET_TOKENS) flush(true);
      const label = line.text.trim();
      if (!bufHeadings.includes(label)) bufHeadings.push(label);
    }

    if (line.inFence) {
      if (line.isFenceMarker) {
        const nextLineTokens = approxTokens(lines[lineIndex + 1]?.text ?? "");
        if (!fenceOpener && (bufTokens >= TARGET_TOKENS ||
          bufTokens + approxTokens(line.text) + nextLineTokens + 4 > HARD_MAX_TOKENS)) flush(true);
        fenceOpener = fenceOpener ? undefined : line;
        fenceLinesInBuf = 0;
        push(line);
        continue;
      }
      // A code block never splits raw: past the hard cap the fence is closed
      // here and re-opened in the next chunk, so both halves still render as
      // code. At least one code line stays with the opener, otherwise a single
      // oversized line would loop forever emitting empty blocks.
      if (
        fenceOpener &&
        fenceLinesInBuf > 0 &&
        bufTokens + approxTokens(line.text) > HARD_MAX_TOKENS
      ) {
        push({ ...fenceOpener, text: fenceOpener.text.match(/^(`+|~+)/)?.[0] ?? "```", isHeading: false });
        flush(true);
        push({ ...fenceOpener, page: line.page });
        fenceLinesInBuf = 0;
      }
      push(line);
      fenceLinesInBuf += 1;
      continue;
    }

    if (bufTokens > 0 && bufTokens + approxTokens(line.text) > HARD_MAX_TOKENS) {
      flush(line.isBlank || line.isHeading);
    }
    push(line);
    // Prefer splitting at a blank line (paragraph boundary); only a runaway
    // paragraph gets cut mid-flow. Extracted PDF/DOCX text has no blank lines
    // to offer, so in `plain` format the soft cap cuts wherever it is reached —
    // exactly as it did before structure preservation — instead of every
    // chunk silently growing to the hard cap.
    const softCutHere = line.isBlank || !markdown;
    if ((bufTokens >= MAX_TOKENS && softCutHere) || bufTokens >= HARD_MAX_TOKENS) {
      flush(line.isBlank);
    }
  }
  if (fenceOpener) {
    push({ ...fenceOpener, text: fenceOpener.text.match(/^(`+|~+)/)?.[0] ?? "```" });
  }
  flush(true);

  return chunks;
}

export function approxTokens(s: string): number {
  if (!s) return 0;
  return Math.max(1, Math.ceil(s.length / 4));
}

const NUMBERED_HEADING = /^\d+(\.\d+){0,4}\.?\s+\p{Lu}/u;
const ALL_CAPS_LINE = /^[A-ZÇĞİÖŞÜ0-9][A-ZÇĞİÖŞÜ0-9\s\-:.,]+$/;
const HEADING_KEYWORDS =
  /^(chapter|bölüm|section|kısım|introduction|giriş|conclusion|sonuç|abstract|özet|method|methods|yöntem|results|sonuçlar|bulgular|discussion|tartışma|references|kaynakça|kaynaklar|appendix|ek|preface|önsöz)\b/i;

export function isHeadingByPattern(line: string): boolean {
  if (line.length < 3 || line.length > 120) return false;
  if (NUMBERED_HEADING.test(line)) return true;
  if (line.length <= 80 && ALL_CAPS_LINE.test(line)) return true;
  if (HEADING_KEYWORDS.test(line)) return true;
  return false;
}
