// Claim reference table — the mechanism that makes a cross-paper contradiction
// auditable instead of asserted.
//
// The naive design asks the model to quote both sides of a disagreement. That
// fails the same way single-paper citations failed before citation-verify: a
// model will happily manufacture a plausible quote, and a fabricated
// contradiction renders identically to a real one.
//
// So the model never writes claim text at all. Every claim from every compared
// payload gets a short stable ref ("p0.kr2" = paper 0, keyResults[2]) which is
// rendered into the prompt; the model may only return PAIRS OF REFS plus its
// reasoning. Resolution happens here:
//
//   - a ref that doesn't resolve → the pair is dropped (the model invented it)
//   - a pair pointing at one paper → dropped (not a cross-paper finding)
//   - text + citation are copied from the ORIGINAL claim, never from the model
//   - `grounded` requires BOTH sides to carry a citation that already verified
//     (exact/fuzzy) against real chunk text when the source analysis ran
//
// Net effect: the worst a hallucinating model can do is propose a pairing of
// two real claims that don't actually conflict — a judgement error a reader can
// evaluate from the two verbatim quotes shown side by side. It cannot invent
// the quotes themselves.
//
// Pure + deterministic → unit-testable with no DB or network.

import type {
  AnalysisCitation,
  AnalysisClaim,
  ArticleAnalysisPayload,
} from "@/lib/article-analysis/types";
import type { Contradiction, ContradictionSide } from "./types";

// The claim arrays worth cross-comparing. Deliberately excludes
// `problemMotivation` and `priorWorkGap` — those describe the field's state
// rather than the paper's own position, so pairing them produces noise
// ("both papers say attention is important") rather than disagreement.
export const COMPARABLE_FIELDS = [
  "contributions",
  "keyResults",
  "assumptionsLimitations",
  "howItSolves",
] as const;

export type ComparableField = (typeof COMPARABLE_FIELDS)[number];

// Two-letter codes keep the rendered claim table compact — on four papers with
// ~30 claims each the ref column is pure prompt overhead, so it stays short.
const FIELD_CODE: Record<ComparableField, string> = {
  contributions: "co",
  keyResults: "kr",
  assumptionsLimitations: "al",
  howItSolves: "hs",
};

export type ClaimEntry = {
  ref: string;
  paperIndex: number;
  field: ComparableField;
  claim: AnalysisClaim;
};

export type ClaimTable = Map<string, ClaimEntry>;

export function formatRef(
  paperIndex: number,
  field: ComparableField,
  claimIndex: number,
): string {
  return `p${paperIndex}.${FIELD_CODE[field]}${claimIndex}`;
}

// Build the ref → claim index over every compared payload. Insertion order is
// paper-major then field-major so the rendered table reads as one paper at a
// time, which is how the model reasons about it.
export function buildClaimTable(
  payloads: ArticleAnalysisPayload[],
): ClaimTable {
  const table: ClaimTable = new Map();
  payloads.forEach((payload, paperIndex) => {
    for (const field of COMPARABLE_FIELDS) {
      const claims = payload[field] ?? [];
      claims.forEach((claim, claimIndex) => {
        const ref = formatRef(paperIndex, field, claimIndex);
        table.set(ref, { ref, paperIndex, field, claim });
      });
    }
  });
  return table;
}

// A citation counts as verified when the analysis run matched its quote to real
// chunk text. Legacy citations predate `verification` and are judged by their
// resolved chunkId instead — same fallback `scoreGrounding` uses, so old
// analyses don't read as uniformly ungrounded.
function isVerified(citation: AnalysisCitation): boolean {
  const verdict = citation.verification ?? (citation.chunkId ? "exact" : "unverified");
  return verdict !== "unverified";
}

// The strongest citation on a claim: an exact match beats a fuzzy one, and an
// unverified citation is never returned — a side with no verified citation is
// what makes a contradiction ungrounded.
export function bestVerifiedCitation(
  claim: AnalysisClaim,
): AnalysisCitation | undefined {
  let fallback: AnalysisCitation | undefined;
  for (const citation of claim.citations ?? []) {
    if (!isVerified(citation)) continue;
    if (citation.verification === "exact") return citation;
    fallback ??= citation;
  }
  return fallback;
}

function toSide(entry: ClaimEntry): ContradictionSide {
  const citation = bestVerifiedCitation(entry.claim);
  return {
    paperIndex: entry.paperIndex,
    ref: entry.ref,
    text: entry.claim.text,
    ...(citation ? { citation } : {}),
  };
}

// The model's raw wire shape for one proposed contradiction.
export type RawContradiction = {
  aRef: string;
  bRef: string;
  kind: "direct" | "methodological" | "scope" | "terminological";
  explanation: string;
};

// Order-independent identity for a pair, so "p0.kr1 vs p1.kr2" and the reverse
// collapse to one finding. Models routinely emit both directions.
function pairKey(aRef: string, bRef: string): string {
  return aRef < bRef ? `${aRef}|${bRef}` : `${bRef}|${aRef}`;
}

// Resolve, validate and ground the model's proposed contradictions. Anything
// that fails resolution is dropped silently — a dropped pair is a model error,
// not a user-facing condition, and the count of survivors is what the UI shows.
export function groundContradictions(
  raw: RawContradiction[],
  table: ClaimTable,
): Contradiction[] {
  const seen = new Set<string>();
  const out: Contradiction[] = [];
  for (const item of raw) {
    const aEntry = table.get(item.aRef);
    const bEntry = table.get(item.bRef);
    // An unresolvable ref means the model invented a claim that was never in
    // its input. Drop rather than render an unanchored assertion.
    if (!aEntry || !bEntry) continue;
    // Same paper on both sides is not a cross-paper contradiction. (A paper
    // contradicting itself is interesting, but it belongs to the single-paper
    // critique stage, which already has the whole article text to judge it.)
    if (aEntry.paperIndex === bEntry.paperIndex) continue;
    const key = pairKey(aEntry.ref, bEntry.ref);
    if (seen.has(key)) continue;
    seen.add(key);

    const a = toSide(aEntry);
    const b = toSide(bEntry);
    out.push({
      a,
      b,
      kind: item.kind,
      explanation: item.explanation,
      grounded: a.citation !== undefined && b.citation !== undefined,
    });
  }
  // Grounded findings first — they are the ones a reader can actually check.
  // Stable within each group so the model's own ordering survives.
  return out
    .map((c, i) => ({ c, i }))
    .sort((x, y) => {
      if (x.c.grounded !== y.c.grounded) return x.c.grounded ? -1 : 1;
      return x.i - y.i;
    })
    .map(({ c }) => c);
}

// Render the claim table for the prompt. Only claims are listed — the model
// gets no article text here, because everything it may cite has already been
// distilled and verified upstream.
export function renderClaimTable(
  payloads: ArticleAnalysisPayload[],
  titles: string[],
): string {
  const lines: string[] = [];
  payloads.forEach((payload, paperIndex) => {
    lines.push(`### Paper p${paperIndex}: ${titles[paperIndex] ?? "(untitled)"}`);
    const glance = payload.ataGlance;
    if (glance) {
      const meta = [
        glance.paperType,
        glance.methodologyType,
        glance.dataSample,
        glance.venueYear,
      ]
        .filter((v) => v && v.trim().length > 0)
        .join(" · ");
      if (meta) lines.push(`(${meta})`);
    }
    for (const field of COMPARABLE_FIELDS) {
      const claims = payload[field] ?? [];
      if (claims.length === 0) continue;
      lines.push(`${field}:`);
      claims.forEach((claim, claimIndex) => {
        const ref = formatRef(paperIndex, field, claimIndex);
        // Mark which claims are checkable so the model prefers pairing those —
        // a contradiction between two verified claims is worth far more than
        // one resting on the model's own prose.
        const mark = bestVerifiedCitation(claim) ? "✓" : "·";
        lines.push(`  [${ref}] ${mark} ${claim.text}`);
      });
    }
    lines.push("");
  });
  return lines.join("\n").trim();
}
