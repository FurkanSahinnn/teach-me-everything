import type { SystemBlock } from "@/lib/ai/providers/types";
import type { AnalysisTargetLang } from "@/lib/article-analysis/types";

// System prompts for the Cross-Analysis pipeline (compare N analyzed papers).
//
// Same caching contract as article-analysis: the STABLE block — here the
// rendered claim table, not article text — carries the `cache_control:
// ephemeral` breakpoint FIRST, and the volatile per-stage instructions follow.
// Both stages pass the identical table, so the second call reuses the cached
// prefix and pays only for its instruction tail.
//
// The rule that shapes both prompts: the model may only REFERENCE claims it was
// given. It never writes claim text or quotes — see cross-analysis/refs.ts for
// why, and for the resolution that enforces it.

function langName(lang: AnalysisTargetLang): string {
  return lang === "tr" ? "Turkish" : "English";
}

function languageDirective(lang: AnalysisTargetLang): string {
  return `Write all prose (explanations, consensus, synthesis) in ${langName(lang)}. Keep technical terms, proper nouns, symbols, and paper titles in their ORIGINAL form.`;
}

function claimTableBlock(claimTable: string): SystemBlock {
  return {
    type: "text",
    text: `<claims>\n${claimTable}\n</claims>`,
    cache_control: { type: "ephemeral" },
  };
}

function instructionBlock(text: string): SystemBlock {
  return { type: "text", text };
}

// Shared framing so both stages read the table the same way.
const TABLE_CONTRACT = [
  "The <claims> block lists every comparable claim from each paper, one per line, in the form:",
  "  [ref] mark claim text",
  "where `ref` is a stable identifier like `p0.kr2` (paper 0, key result 2) and `mark` is:",
  "  ✓ — the claim is backed by a quote already verified against the paper's own text",
  "  · — the claim carries no verified quote",
  "You may ONLY refer to claims by their `ref`. Never invent a ref, never quote or restate claim text as if it were your own finding.",
].join("\n");

// ---------------------------------------------------------------------------
// Stage A — CONTRADICTIONS
// ---------------------------------------------------------------------------

export type ContradictionSystemInput = {
  claimTable: string;
  targetLang: AnalysisTargetLang;
};

export function buildContradictionSystem(
  input: ContradictionSystemInput,
): SystemBlock[] {
  const instructions = [
    "Role: You are a meticulous research referee looking for places where two papers genuinely disagree.",
    "",
    TABLE_CONTRACT,
    "",
    "Task: Find pairs of claims from DIFFERENT papers that are in tension. Classify each pair:",
    '  "direct"         — the claims cannot both be true (opposite result on the same question/metric)',
    '  "methodological" — they reach different answers because they measured differently',
    '  "scope"          — both may hold, but over different populations, regimes, or datasets',
    '  "terminological" — they appear to disagree only because they use a term differently',
    "",
    "Rules:",
    "- Both refs in a pair MUST come from different papers.",
    "- Strongly prefer pairs where BOTH claims are marked ✓; a disagreement the reader cannot check against the papers is close to worthless.",
    "- Do NOT manufacture tension. Papers in the same lineage frequently agree, and an empty list is a correct, expected answer. A forced contradiction is worse than none, because it teaches the reader to distrust the real ones.",
    "- Two papers studying unrelated questions are not in tension; they are simply unrelated.",
    "- Report each pair once. Do not also report its reverse.",
    "",
    "Output STRICT JSON only (no markdown fences, no commentary) matching:",
    "{",
    '  "contradictions": [',
    '    { "aRef": "p0.kr2", "bRef": "p1.kr0", "kind": "direct", "explanation": "string — what exactly is in tension, and under what condition each claim holds" }',
    "  ]",
    "}",
    'If there is no genuine disagreement, return {"contradictions": []}.',
    "",
    languageDirective(input.targetLang),
  ].join("\n");
  return [claimTableBlock(input.claimTable), instructionBlock(instructions)];
}

// ---------------------------------------------------------------------------
// Stage B — SYNTHESIS
// ---------------------------------------------------------------------------

export type SynthesisSystemInput = {
  claimTable: string;
  targetLang: AnalysisTargetLang;
  // Index-aligned titles so the model can reason about papers by name while
  // still returning positional indices.
  titles: string[];
};

export function buildSynthesisSystem(
  input: SynthesisSystemInput,
): SystemBlock[] {
  const roster = input.titles
    .map((t, i) => `  p${i} — ${t}`)
    .join("\n");
  const instructions = [
    "Role: You are a senior researcher writing the short synthesis that sits at the top of a literature comparison.",
    "",
    TABLE_CONTRACT,
    "",
    "Papers under comparison:",
    roster,
    "",
    "Task: Say what this SET of papers collectively establishes — the part no single paper's analysis can tell the reader.",
    "- `consensus`: points essentially all of these papers support. Omit anything only one paper claims.",
    "- `divergences`: real differences in framing, scope, or method where both positions can hold. These are NOT contradictions; another stage handles those.",
    "- `readingOrder`: the order to read them in for someone new to the topic, by paperIndex, each with a one-sentence reason. Include every paper exactly once.",
    "- `synthesis`: 3-6 sentences on what the set means together and what it leaves open.",
    "",
    "Ground every point in the claims above. If the papers have little in common, say so plainly in `synthesis` and keep `consensus` short or empty rather than padding it.",
    "",
    "Output STRICT JSON only (no fences, no commentary) matching:",
    "{",
    '  "consensus": ["string"],',
    '  "divergences": ["string"],',
    '  "readingOrder": [ { "paperIndex": 0, "why": "string" } ],',
    '  "synthesis": "string"',
    "}",
    "",
    languageDirective(input.targetLang),
  ].join("\n");
  return [claimTableBlock(input.claimTable), instructionBlock(instructions)];
}

export function buildCrossStageUserMessage(lang: AnalysisTargetLang): string {
  return lang === "tr"
    ? "Yukarıdaki talimatlara göre yalnızca geçerli JSON üret."
    : "Produce only the valid JSON described above.";
}
