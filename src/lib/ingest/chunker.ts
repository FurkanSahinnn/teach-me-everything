// Heading-aware semantic chunker. Pure — safe to import from main thread or Web Worker.
// Token approximation: chars/4. Real tiktoken integration is Phase 3.

const TARGET_TOKENS = 750;
const MAX_TOKENS = 1100;
const OVERLAP_TOKENS = 100;

export type ChunkerPage = {
  page: number;
  text: string;
  headings?: string[];
};

export type ChunkerInput = {
  pages: ChunkerPage[];
};

export type ChunkerOutput = Array<{
  index: number;
  text: string;
  tokenCount: number;
  page?: number | undefined;
  section?: string | undefined;
  headings?: string[] | undefined;
}>;

type Line = { text: string; page: number; isHeading: boolean };

export function chunkPages(input: ChunkerInput): ChunkerOutput {
  const lines: Line[] = [];
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
        lines.push({ text: trimmed, page: p.page, isHeading: false });
        continue;
      }
      // Inside a fence we MUST preserve leading whitespace (Python/YAML/etc
      // are indent-sensitive) and blank lines so the rendered code block
      // matches the source byte-for-byte.
      if (inCodeFence) {
        lines.push({ text: raw, page: p.page, isHeading: false });
        continue;
      }
      if (!trimmed) continue;
      const isHeading = headingSet.has(trimmed) || isHeadingByPattern(trimmed);
      lines.push({ text: trimmed, page: p.page, isHeading });
    }
  }

  const chunks: ChunkerOutput = [];
  let buf: Line[] = [];
  let bufTokens = 0;
  let bufFirstPage: number | undefined;
  let currentSection: string | undefined;
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
    chunks.push({
      index: chunks.length,
      text: body,
      tokenCount: bufTokens,
      page: bufFirstPage,
      section: currentSection,
      headings: bufHeadings.length > 0 ? [...bufHeadings] : undefined,
    });

    // Carry tail-overlap into next chunk so context isn't lost across boundaries.
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
    buf = tail;
    bufTokens = tailTokens;
    bufFirstPage = tail[0]?.page;
    bufHeadings = [];
  }

  for (const line of lines) {
    if (line.isHeading) {
      if (bufTokens >= TARGET_TOKENS) flush();
      currentSection = line.text;
      if (!bufHeadings.includes(line.text)) bufHeadings.push(line.text);
    }
    if (bufFirstPage === undefined) bufFirstPage = line.page;
    buf.push(line);
    bufTokens += approxTokens(line.text);
    if (bufTokens >= MAX_TOKENS) flush();
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
