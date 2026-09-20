import type { ChunkRecord } from "@/lib/db/types";
import { balanceCodeFences } from "@/lib/markdown/balance-code-fences";
import { stripInlineMarkdown, stripMarkdownHeading } from "@/lib/reader/markdown";

export type ReaderOutlineEntry = {
  key: string;
  targetId: string;
  label: string;
  level: 1 | 2 | 3;
};

export type ReaderMarkdownSegment = {
  key: string;
  text: string;
  anchorId?: string;
};

type HeadingCandidate = {
  label: string;
  level: 1 | 2 | 3;
  lineIndex?: number;
};

export function buildReaderOutline(chunks: ChunkRecord[]): ReaderOutlineEntry[] {
  const entries: ReaderOutlineEntry[] = [];
  const seen = new Set<string>();

  chunks.forEach((chunk) => {
    const candidates = buildHeadingCandidates(chunk);

    candidates.forEach((candidate, index) => {
      const label = cleanOutlineLabel(candidate.label);
      if (!label) return;
      const dedupeKey = normalizeOutlineLabel(label);
      if (seen.has(dedupeKey)) return;
      seen.add(dedupeKey);

      entries.push({
        key: `${chunk.id}-${index}-${dedupeKey}`,
        targetId:
          candidate.lineIndex === undefined
            ? `chunk-${chunk.id}`
            : headingAnchorId(chunk.id, candidate.lineIndex),
        label,
        level: candidate.level,
      });
    });
  });

  return entries;
}

export function splitChunkIntoMarkdownSegments(chunk: ChunkRecord): ReaderMarkdownSegment[] {
  // Balance fences across the WHOLE chunk before detecting headings or
  // splitting. A chunk split mid-fence (chunker artifact) otherwise throws off
  // fence tracking, so headings are detected at the wrong lines and segments cut
  // real code blocks in half — yielding empty code boxes and unboxed code.
  const balanced = balanceCodeFences(chunk.text.replace(/\r\n/g, "\n"));
  const lines = balanced.split("\n");
  const headingLines = new Set(extractHeadingsFromText(balanced).map((h) => h.lineIndex));
  const segments: ReaderMarkdownSegment[] = [];
  let buffer: string[] = [];
  let activeAnchorId: string | undefined;
  let activeStart = 0;

  const flush = (): void => {
    const text = buffer.join("\n").trim();
    if (!text) {
      buffer = [];
      return;
    }
    segments.push({
      key: `${chunk.id}-${activeStart}`,
      text,
      ...(activeAnchorId ? { anchorId: activeAnchorId } : {}),
    });
    buffer = [];
  };

  lines.forEach((line, index) => {
    if (headingLines.has(index)) {
      flush();
      activeAnchorId = headingAnchorId(chunk.id, index);
      activeStart = index;
    } else if (buffer.length === 0) {
      activeStart = index;
    }
    buffer.push(line);
  });
  flush();

  return segments.length > 0
    ? segments
    : [{ key: `${chunk.id}-0`, text: balanced }];
}

function buildHeadingCandidates(chunk: ChunkRecord): HeadingCandidate[] {
  // Use the same balanced text as splitChunkIntoMarkdownSegments so heading
  // line indices (and thus anchor IDs) stay consistent between the two.
  const textCandidates = extractHeadingsFromText(
    balanceCodeFences(chunk.text.replace(/\r\n/g, "\n")),
  );
  const textLabels = new Set(
    textCandidates.map((candidate) => normalizeOutlineLabel(cleanOutlineLabel(candidate.label))),
  );
  const metadataCandidates = [
    ...(chunk.section ? [{ label: chunk.section, level: 1 as const }] : []),
    ...(chunk.headings ?? []).map((heading) => ({ label: heading, level: 2 as const })),
  ].filter((candidate) => {
    const key = normalizeOutlineLabel(cleanOutlineLabel(candidate.label));
    return key && !textLabels.has(key);
  });

  return [...textCandidates, ...metadataCandidates];
}

function extractHeadingsFromText(text: string): HeadingCandidate[] {
  const headings: HeadingCandidate[] = [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let inCodeFence = false;
  // A document that uses `#` headings has told us where its sections are; the
  // heuristics below exist for extracted PDF text and would otherwise split
  // an ordered list into one segment per item ("1. …", "2. …").
  const markdownDoc = /^ {0,3}#{1,6}\s/m.test(text);
  const trimmedLines = lines.map((l) => l.trim());
  const neighbourIsOrderedItem = (index: number): boolean => {
    const probe = (step: number): boolean => {
      for (let i = index + step; i >= 0 && i < trimmedLines.length; i += step) {
        const t = trimmedLines[i] ?? "";
        if (!t) return false;
        return /^\d+[.)]\s+/.test(t);
      }
      return false;
    };
    return probe(-1) || probe(1);
  };

  lines.forEach((rawLine, lineIndex) => {
    const trimmed = rawLine.trim();
    if (trimmed.startsWith("```")) {
      inCodeFence = !inCodeFence;
      return;
    }
    if (inCodeFence || !trimmed) return;

    const normalized = trimmed.replace(/^>\s?/, "").trim();
    if (/^[-*+]\s+/.test(normalized)) return;

    const markdownHeading = /^(#{1,6})\s+(.+?)\s*#*$/.exec(normalized);
    if (markdownHeading) {
      const level = Math.min(markdownHeading[1]!.length, 3) as 1 | 2 | 3;
      headings.push({ label: markdownHeading[2]!, level, lineIndex });
      return;
    }

    // A numbered line flanked by other numbered lines is a list, and one that
    // reads as a sentence is prose — neither is a section title. In a `#`
    // document numbered lines are never headings: the author had `#` and
    // chose not to use it. Bold / colon labels stay — LLM lessons lean on them.
    if (
      !markdownDoc &&
      isNumberedHeading(normalized) &&
      (/^\d+(?:\.\d+)*\s/.test(normalized) ||
        (!neighbourIsOrderedItem(lineIndex) &&
          !(/[.!?]$/.test(normalized) && normalized.split(/\s+/).length > 6)))
    ) {
      headings.push({
        label: normalized,
        level: numberedHeadingLevel(normalized),
        lineIndex,
      });
      return;
    }

    if (isStrongLabelHeading(normalized)) {
      headings.push({ label: normalized, level: 3, lineIndex });
      return;
    }

    if (isColonLabelHeading(normalized)) {
      headings.push({ label: normalized, level: 3, lineIndex });
    }
  });

  return headings;
}

function headingAnchorId(chunkId: string, lineIndex: number): string {
  return `reader-heading-${chunkId}-${lineIndex}`;
}

function cleanOutlineLabel(value: string): string {
  return stripInlineMarkdown(stripMarkdownHeading(value))
    .replace(/^>\s?/, "")
    .replace(/:$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeOutlineLabel(value: string): string {
  return value.toLocaleLowerCase("tr").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function isNumberedHeading(value: string): boolean {
  return /^\d+(?:\.\d+){0,5}\.?\s+\S.{1,100}$/.test(value);
}

function numberedHeadingLevel(value: string): 1 | 2 | 3 {
  const prefix = /^\d+(?:\.\d+)*/.exec(value)?.[0] ?? "";
  const depth = prefix.split(".").filter(Boolean).length;
  return Math.min(Math.max(depth, 1), 3) as 1 | 2 | 3;
}

function isStrongLabelHeading(value: string): boolean {
  return /^\*\*[^*\n]{3,90}:?\*\*$/.test(value);
}

function isColonLabelHeading(value: string): boolean {
  if (!/:$/.test(value)) return false;
  if (value.length < 4 || value.length > 90) return false;
  if (/[.!?]\s/.test(value)) return false;
  if (/^(https?:|doi:)/i.test(value)) return false;
  return true;
}
