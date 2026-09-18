import type { ChunkRecord } from "@/lib/db/types";

function terms(text: string): Set<string> {
  return new Set(text.normalize("NFKC").toLocaleLowerCase("tr").match(/[\p{L}\p{N}]{3,}/gu) ?? []);
}

/** Local relevance fallback when no query embedding can be obtained. */
export function selectFallbackChunks<T extends Pick<ChunkRecord, "text" | "section" | "headings">>(
  chunks: readonly T[], query: string, limit: number,
): T[] {
  if (limit <= 0) return [];
  const queryTerms = terms(query);
  const rows = chunks.map((chunk, index) => ({
    chunk, index, words: terms(`${chunk.section ?? ""} ${(chunk.headings ?? []).join(" ")} ${chunk.text}`),
  }));
  const counts = new Map<string, number>();
  for (const row of rows) for (const word of queryTerms) {
    if (row.words.has(word)) counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return rows.map((row) => {
    let score = 0;
    for (const word of queryTerms) if (row.words.has(word)) {
      score += Math.log(1 + chunks.length / (counts.get(word) ?? 1));
    }
    return { ...row, score: score / Math.sqrt(Math.max(1, row.words.size)) };
  }).sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit).map((row) => row.chunk);
}
