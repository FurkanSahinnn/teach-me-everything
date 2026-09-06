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
// paragraph must still be chunkable.
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
  /** Section in force when this line was read (the heading itself included). */
  section: string | undefined;
};

const MARKDOWN_HEADING = /^ {0,3}#{1,6}\s/;

export function detectChunkerFormat(pages: ChunkerPage[]): ChunkerFormat {
  return pages.some((p) => /^ {0,3}#{1,6}\s/m.test(p.text)) ? "markdown" : "plain";
}

export function chunkPages(input: ChunkerInput): ChunkerOutput {
  const format = input.format ?? detectChunkerFormat(input.pages);
  const markdown = format === "markdown";

  const lines: Line[] = [];
  let currentSection: string | undefined;
  for (const p of input.pages) {
    const headingSet = new Set((p.headings ?? []).map((h) => h.trim()));
    const rawLines = p.text.split(/\r?\n/);
    let inCodeFence = false;
    for (const raw of rawLines) {
      const trimmed = raw.trim();
      // Fence markers (```lang or ```) toggle code mode. Stored trimmed —
      // markdown parser doesn't care about indent before the fence.
      if (trimmed.startsWith("```")) {
        inCodeFence = !inCodeFence;
        lines.push({
          text: trimmed,
          page: p.page,
          isHeading: false,
          isBlank: false,
          inFence: true,
          section: currentSection,
        });
        continue;
      }
      // Inside a fence we MUST preserve leading whitespace (Python/YAML/etc
      // are indent-sensitive) and blank lines so the rendered code block
      // matches the source byte-for-byte.
      if (inCodeFence) {
        lines.push({
          text: raw,
          page: p.page,
          isHeading: false,
          isBlank: false,
          inFence: true,
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
        section: currentSection,
      });
    }
  }

  const chunks: ChunkerOutput = [];
  let buf: Line[] = [];
  let bufTokens = 0;
  let bufFirstPage: number | undefined;
  let bufHeadings: string[] = [];

  function flush(): void {
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

    // Carry tail-overlap into next chunk so context isn't lost across
    // boundaries. The tail starts at a paragraph boundary and never inside a
    // fence: an overlap that opened with `---` or half a code block would
    // re-create the very rendering faults this chunker exists to avoid.
    const tail: Line[] = [];
    let tailTokens = 0;
    for (let i = buf.length - 1; i >= 0; i -= 1) {
      const line = buf[i];
      if (!line) continue;
      const t = approxTokens(line.text);
      if (tailTokens + t > OVERLAP_TOKENS) break;
      tail.unshift(line);
      tailTokens += t;
    }
    if (tail.some((l) => l.inFence)) {
      tail.length = 0;
    } else {
      const firstBlank = tail.findIndex((l) => l.isBlank);
      // No paragraph boundary inside the overlap window means mid-paragraph
      // context — exactly what the old chunker carried, so keep it as is.
      if (firstBlank !== -1) tail.splice(0, firstBlank + 1);
    }
    buf = tail;
    bufTokens = tail.reduce((n, l) => n + approxTokens(l.text), 0);
    bufFirstPage = tail[0]?.page;
    bufHeadings = [];
  }

  for (const line of lines) {
    if (line.isHeading) {
      if (bufTokens >= TARGET_TOKENS) flush();
      const label = line.text.trim();
      if (!bufHeadings.includes(label)) bufHeadings.push(label);
    }
    if (bufFirstPage === undefined) bufFirstPage = line.page;
    buf.push(line);
    bufTokens += approxTokens(line.text);
    if (line.inFence) continue;
    // Prefer splitting at a blank line (paragraph boundary); only a runaway
    // paragraph gets cut mid-flow.
    if ((bufTokens >= MAX_TOKENS && line.isBlank) || bufTokens >= HARD_MAX_TOKENS) {
      flush();
    }
  }
  flush();

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
