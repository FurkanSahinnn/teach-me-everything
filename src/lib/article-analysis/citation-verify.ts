// Article Analysis — citation verification.
//
// The pipeline asks each stage for VERBATIM quotes from the paper, but a model
// can silently paraphrase (or invent) one. Before this module the orchestrator
// only tried to resolve a quote to a chunk id and, on failure, dropped the id —
// so a fabricated quote rendered identically to a real one and the reader had
// no way to tell. Grounding you cannot audit is worse than no grounding claim
// at all, so every citation now carries an explicit verdict:
//
//   exact      → the quote appears verbatim in a chunk (modulo whitespace,
//                casing, and the punctuation PDF extraction mangles)
//   fuzzy      → a long contiguous run of the quote's words appears in a chunk;
//                the model lightly reflowed or elided it, but it is anchored
//   unverified → no chunk supports it; treat as model prose, not paper text
//
// Pure + deterministic → unit-testable with no DB or network.

import type { ChunkRecord } from "@/lib/db/types";

export type CitationVerification = "exact" | "fuzzy" | "unverified";

export type QuoteMatch = {
  verification: CitationVerification;
  chunkId?: string | undefined;
};

// Quotes shorter than this (in normalized chars) match almost any chunk by
// accident, so they can never earn a verdict better than "unverified" — a
// confident-looking chip on a 6-character "quote" is noise, not grounding.
const MIN_QUOTE_CHARS = 16;

// Fuzzy matching operates on word runs. A run this long is specific enough
// that hitting it by chance in an unrelated chunk is implausible, while still
// tolerating a model that dropped a clause or re-joined a hyphenated line.
const FUZZY_MIN_RUN_WORDS = 8;

// A quote must additionally have this fraction of its words covered by the
// matched run to count as fuzzy. Without it, one lucky 8-word overlap would
// "verify" a three-sentence fabrication.
const FUZZY_MIN_COVERAGE = 0.5;

// PDF text extraction produces typographic quotes, ligatures, soft hyphens and
// line-break hyphenation that never survive a round-trip through an LLM. We
// fold all of them away on BOTH sides so "verbatim" means "the same words",
// not "the same bytes".
const PUNCT_FOLD: ReadonlyArray<readonly [RegExp, string]> = [
  [/[‘’‚‛′]/g, "'"], // curly single quotes / prime
  [/[“”„‟″]/g, '"'], // curly double quotes
  [/[‐‑‒–—―−]/g, "-"], // dashes / minus
  [/[­​‌‍﻿]/g, ""], // soft hyphen + zero-width
  [/ /g, " "], // nbsp
  [/ﬁ/g, "fi"],
  [/ﬂ/g, "fl"],
  [/…/g, "..."], // ellipsis
];

// Collapse a string to its comparable form: folded punctuation, no
// line-break hyphenation, single-spaced, lowercase.
export function normalizeForMatch(text: string): string {
  let out = text;
  for (const [re, to] of PUNCT_FOLD) out = out.replace(re, to);
  // De-hyphenate words split across a line break ("attent-\nion" → "attention")
  // before whitespace collapsing erases the newline that identifies them.
  out = out.replace(/(\w)-\s*\n\s*(\w)/g, "$1$2");
  return out.replace(/\s+/g, " ").trim().toLowerCase();
}

// A chunk pre-normalized once. Building this up front turns verification from
// O(quotes × chunks × chunkLength) re-normalization into a single pass over the
// document — on a 60-chunk paper with 60 quotes that is the difference between
// ~3600 full-text normalizations and 60.
export type QuoteIndexEntry = {
  chunkId: string;
  normalized: string;
  words: string[];
};

export type QuoteIndex = QuoteIndexEntry[];

export function buildQuoteIndex(chunks: ChunkRecord[]): QuoteIndex {
  return chunks.map((c) => {
    const normalized = normalizeForMatch(c.text);
    return { chunkId: c.id, normalized, words: normalized.split(" ") };
  });
}

// Longest run of consecutive quote-words that appears, in order and contiguous,
// anywhere in `haystack`. Anchors on each occurrence of the run's first word
// and extends greedily — linear in practice because content words repeat
// rarely, and bounded by the early exit once a run spans the whole quote.
function longestContiguousRun(
  quoteWords: string[],
  haystackWords: string[],
): number {
  if (quoteWords.length === 0 || haystackWords.length === 0) return 0;
  // Bucket haystack positions by word so we only probe plausible anchors.
  const positions = new Map<string, number[]>();
  for (let i = 0; i < haystackWords.length; i += 1) {
    const w = haystackWords[i] as string;
    const list = positions.get(w);
    if (list) list.push(i);
    else positions.set(w, [i]);
  }
  let best = 0;
  for (let qi = 0; qi < quoteWords.length; qi += 1) {
    // Can't beat the current best with the words that remain.
    if (quoteWords.length - qi <= best) break;
    const anchors = positions.get(quoteWords[qi] as string);
    if (!anchors) continue;
    for (const start of anchors) {
      let run = 0;
      while (
        qi + run < quoteWords.length &&
        start + run < haystackWords.length &&
        quoteWords[qi + run] === haystackWords[start + run]
      ) {
        run += 1;
      }
      if (run > best) best = run;
      if (best === quoteWords.length) return best;
    }
  }
  return best;
}

// Classify one quote against the pre-built index. Exact containment wins
// outright; otherwise the best fuzzy run across all chunks decides, and the
// chunk that produced it becomes the jump target.
export function verifyQuote(quote: string, index: QuoteIndex): QuoteMatch {
  const q = normalizeForMatch(quote);
  if (q.length < MIN_QUOTE_CHARS) return { verification: "unverified" };

  for (const entry of index) {
    if (entry.normalized.includes(q)) {
      return { verification: "exact", chunkId: entry.chunkId };
    }
  }

  const quoteWords = q.split(" ");
  // A short quote can't produce a long enough run to clear the bar, so skip
  // straight to unverified rather than pretending to measure.
  if (quoteWords.length < FUZZY_MIN_RUN_WORDS) {
    return { verification: "unverified" };
  }

  let bestRun = 0;
  let bestChunkId: string | undefined;
  for (const entry of index) {
    const run = longestContiguousRun(quoteWords, entry.words);
    if (run > bestRun) {
      bestRun = run;
      bestChunkId = entry.chunkId;
    }
  }

  const coverage = bestRun / quoteWords.length;
  if (bestRun >= FUZZY_MIN_RUN_WORDS && coverage >= FUZZY_MIN_COVERAGE) {
    return {
      verification: "fuzzy",
      ...(bestChunkId ? { chunkId: bestChunkId } : {}),
    };
  }
  return { verification: "unverified" };
}

// ---------------------------------------------------------------------------
// Payload-level grounding score
// ---------------------------------------------------------------------------

export type GroundingScore = {
  // Claims tagged grounding: "source" — the ones that promise paper backing.
  sourceClaims: number;
  // Source claims with at least one exact-or-fuzzy citation.
  verifiedClaims: number;
  totalCitations: number;
  exact: number;
  fuzzy: number;
  unverified: number;
};

type ScorableCitation = {
  verification?: CitationVerification | undefined;
  chunkId?: string | undefined;
};

type ScorableClaim = {
  grounding: "source" | "general";
  citations?: ScorableCitation[] | undefined;
};

// Roll a set of claim arrays into one score for the detail header. Citations
// written before this module existed carry no `verification`; they are counted
// against their resolved chunkId so legacy analyses still produce a sane
// number instead of reading as 100% unverified.
export function scoreGrounding(claimLists: ScorableClaim[][]): GroundingScore {
  const score: GroundingScore = {
    sourceClaims: 0,
    verifiedClaims: 0,
    totalCitations: 0,
    exact: 0,
    fuzzy: 0,
    unverified: 0,
  };
  for (const list of claimLists) {
    for (const claim of list) {
      if (claim.grounding !== "source") continue;
      score.sourceClaims += 1;
      let claimVerified = false;
      for (const citation of claim.citations ?? []) {
        score.totalCitations += 1;
        const verdict: CitationVerification =
          citation.verification ?? (citation.chunkId ? "exact" : "unverified");
        score[verdict] += 1;
        if (verdict !== "unverified") claimVerified = true;
      }
      if (claimVerified) score.verifiedClaims += 1;
    }
  }
  return score;
}
