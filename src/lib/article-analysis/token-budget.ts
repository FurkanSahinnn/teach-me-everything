// Article Analysis — Map-stage sectioning.
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
  return group.chunks
    .map((c) => {
      const bits: string[] = [`#${c.index}`];
      if (typeof c.page === "number") bits.push(`page: ${c.page}`);
      return `---chunk ${bits.join(" · ")}---\n${c.text}`;
    })
    .join("\n\n");
}
