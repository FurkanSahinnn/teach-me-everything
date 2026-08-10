// Article Analysis — token budgeting.
//
// Two independent concerns live here:
//   * `groupChunksIntoSections` — how the Map stage fans out over the paper;
//   * `buildArticleWindow` — the single shared article window every later
//     stage caches as its system prefix (see that function's note).
//
// The Map stage fans out one AI call per "section" of the paper. Left
// unbounded a 60-page paper would either blow each call's input window or
// explode the number of calls. This module groups an ordered `ChunkRecord[]`
// into bounded section groups:
//
//   1. consecutive chunks sharing a `section` (or first heading) stay together,
//      else they fall into fixed windows;
//   2. each group is capped to ~5-6 chunks AND ~4500 approx tokens so one call
//      stays cheap and well under the model's context window;
//   3. the TOTAL number of groups is capped (~16) by merging the tail groups,
//      so the per-paper call count can't run away.
//
// Pure + deterministic → unit-testable without any DB or network.

import type { ChunkRecord } from "@/lib/db/types";

// Shared 4-chars-per-token heuristic used across the repo for pre-flight
// budgeting (see lib/ai/context/budget.ts). Never sent to a model as a real
// count — only used to decide where to split.
const CHARS_PER_TOKEN = 4;

export const MAX_CHUNKS_PER_GROUP = 6;
export const MAX_TOKENS_PER_GROUP = 4500;
export const MAX_GROUPS = 16;

export type ChunkGroup = {
  // Best-effort human label for the group, surfaced as the Map prompt's
  // section title. Undefined when the chunks carry no section/heading.
  sectionTitle?: string | undefined;
  chunks: ChunkRecord[];
};

export type GroupChunksOptions = {
  maxChunksPerGroup?: number | undefined;
  maxTokensPerGroup?: number | undefined;
  maxGroups?: number | undefined;
};

function approxTokens(chunk: ChunkRecord): number {
  return chunk.tokenCount ?? Math.ceil(chunk.text.length / CHARS_PER_TOKEN);
}

function sectionLabel(chunk: ChunkRecord): string | undefined {
  const section = chunk.section?.trim();
  if (section) return section;
  const heading = chunk.headings?.[0]?.trim();
  return heading || undefined;
}

function makeGroup(chunks: ChunkRecord[]): ChunkGroup {
  const first = chunks[0];
  const title = first ? sectionLabel(first) : undefined;
  return { ...(title ? { sectionTitle: title } : {}), chunks };
}

// Merge everything past the (maxGroups - 1)th group into a single trailing
// group so a very long paper never exceeds `maxGroups` calls. We merge the
// TAIL (rather than the densest middle) because the back of a paper —
// appendices, extended results — tolerates coarser summarization best.
function capGroups(groups: ChunkGroup[], maxGroups: number): ChunkGroup[] {
  if (groups.length <= maxGroups) return groups;
  const head = groups.slice(0, maxGroups - 1);
  const tail = groups.slice(maxGroups - 1);
  const mergedChunks = tail.flatMap((g) => g.chunks);
  head.push(makeGroup(mergedChunks));
  return head;
}

export function groupChunksIntoSections(
  chunks: ChunkRecord[],
  options?: GroupChunksOptions,
): ChunkGroup[] {
  const maxChunks = options?.maxChunksPerGroup ?? MAX_CHUNKS_PER_GROUP;
  const maxTokens = options?.maxTokensPerGroup ?? MAX_TOKENS_PER_GROUP;
  const maxGroups = options?.maxGroups ?? MAX_GROUPS;
  if (chunks.length === 0) return [];

  const groups: ChunkGroup[] = [];
  let current: ChunkRecord[] = [];
  let currentTokens = 0;
  let currentSection: string | undefined;

  const flush = (): void => {
    if (current.length > 0) {
      groups.push(makeGroup(current));
      current = [];
      currentTokens = 0;
    }
  };

  for (const chunk of chunks) {
    const section = sectionLabel(chunk);
    const tokens = approxTokens(chunk);
    // Start a new group when the section label changes (so summaries stay
    // semantically coherent) OR when the current group would overflow either
    // cap. When chunks carry no section, the labels are all undefined, the
    // equality holds, and grouping degrades to pure fixed windows.
    const sectionChanged = current.length > 0 && section !== currentSection;
    const overflow =
      current.length >= maxChunks ||
      (current.length > 0 && currentTokens + tokens > maxTokens);
    if (sectionChanged || overflow) flush();
    if (current.length === 0) currentSection = section;
    current.push(chunk);
    currentTokens += tokens;
  }
  flush();

  return capGroups(groups, maxGroups);
}

// Concatenate a group's chunks into a single prompt-ready text block with
// lightweight per-chunk provenance markers (mirrors the workspace-chat source
// wrapper) so the model can ground quotes against page numbers.
export function groupToText(group: ChunkGroup): string {
  return chunksToText(group.chunks);
}

function chunksToText(chunks: ChunkRecord[]): string {
  return chunks
    .map((c) => {
      const bits: string[] = [`#${c.index}`];
      if (typeof c.page === "number") bits.push(`page: ${c.page}`);
      return `---chunk ${bits.join(" · ")}---\n${c.text}`;
    })
    .join("\n\n");
}

// ---------------------------------------------------------------------------
// Whole-article window (Reduce / Critique / Glossary / Reflection / Synthesize)
// ---------------------------------------------------------------------------

// The non-Map stages all share ONE windowed copy of the article as their cached
// system prefix. This used to be `clampToBudget(joined, 12k)` — a HEAD
// truncation — which meant a long paper's Results, Discussion, and Limitations
// never reached the reviewer, the glossary, or the synthesizer verbatim. Worse,
// Reduce is asked for verbatim citations from text it could not see, which is
// exactly the condition that manufactures unverifiable quotes.
//
// Two changes fix it:
//   1. a far larger default budget, so the overwhelming majority of papers fit
//      whole and are never truncated at all;
//   2. when a document genuinely overflows, keep the HEAD *and* the TAIL and
//      elide the middle — papers state their contribution up front and their
//      limitations/conclusions at the back, so the middle (related work,
//      extended tables, appendices) is the right thing to lose. The Map stage
//      still covers every section, so the elided span survives as summaries.
export const ARTICLE_WINDOW_TOKENS = 32_000;

// Split of the budget between the front and back of an overflowing document.
// Head-weighted: the front carries the abstract, intro, contributions, and
// method, which more stages depend on than the tail.
const HEAD_SHARE = 0.6;

export type ArticleWindow = {
  text: string;
  // True when at least one chunk was elided — callers surface this so a
  // truncated analysis is never silently presented as whole-document.
  truncated: boolean;
  includedChunks: number;
  omittedChunks: number;
};

function elisionMarker(omitted: number): string {
  return `\n\n---[ ${omitted} chunk(s) from the middle of the document omitted for length — their content is covered by the section summaries ]---\n\n`;
}

// Build the shared article window. Selection is CHUNK-ALIGNED — a chunk is
// either wholly in or wholly out — so every quote a model lifts from the window
// is a complete, verifiable span rather than one severed mid-sentence by a
// character-level clamp.
export function buildArticleWindow(
  chunks: ChunkRecord[],
  maxTokens: number = ARTICLE_WINDOW_TOKENS,
): ArticleWindow {
  if (chunks.length === 0) {
    return { text: "", truncated: false, includedChunks: 0, omittedChunks: 0 };
  }

  const total = chunks.reduce((sum, c) => sum + approxTokens(c), 0);
  if (maxTokens <= 0) {
    return {
      text: "",
      truncated: true,
      includedChunks: 0,
      omittedChunks: chunks.length,
    };
  }
  if (total <= maxTokens) {
    return {
      text: chunksToText(chunks),
      truncated: false,
      includedChunks: chunks.length,
      omittedChunks: 0,
    };
  }

  const headBudget = Math.floor(maxTokens * HEAD_SHARE);
  const head: ChunkRecord[] = [];
  let headTokens = 0;
  let i = 0;
  for (; i < chunks.length; i += 1) {
    const c = chunks[i] as ChunkRecord;
    const t = approxTokens(c);
    // Always take the first chunk even if it alone exceeds the head budget,
    // so a document of one huge chunk still yields text rather than "".
    if (head.length > 0 && headTokens + t > headBudget) break;
    head.push(c);
    headTokens += t;
  }

  const tail: ChunkRecord[] = [];
  let tailTokens = 0;
  const tailBudget = maxTokens - headTokens;
  for (let j = chunks.length - 1; j >= i; j -= 1) {
    const c = chunks[j] as ChunkRecord;
    const t = approxTokens(c);
    if (tailTokens + t > tailBudget) break;
    tail.unshift(c);
    tailTokens += t;
  }

  const omitted = chunks.length - head.length - tail.length;
  const text =
    omitted > 0
      ? `${chunksToText(head)}${elisionMarker(omitted)}${chunksToText(tail)}`
      : chunksToText([...head, ...tail]);
  return {
    text,
    truncated: omitted > 0,
    includedChunks: head.length + tail.length,
    omittedChunks: omitted,
  };
}
