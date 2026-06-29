import type { SystemBlock } from "@/lib/ai/providers/types";
import type { AnalysisTargetLang } from "@/lib/article-analysis/types";
import type {
  CritiqueStageOutput,
  MapStageOutput,
  ReduceStageOutput,
  ReflectionStageOutput,
} from "@/lib/article-analysis/schema";

// System prompts for the Article Analysis pipeline. One `buildXSystem(...)`
// per stage. Every prompt follows the SAME block ordering (per the feature's
// caching contract): the STABLE article text sits in ONE block carrying the
// `cache_control: ephemeral` breakpoint FIRST, and the volatile, stage-specific
// instructions come AFTER it. Because the Reduce / Critique / Glossary /
// Reflection / Synthesize stages all pass the identical windowed article text,
// the cached prefix is reused across them — only the cheap instruction tail
// changes per call.
//
// Cross-cutting rules every stage enforces:
//   - strict JSON output matching the stage's Zod schema (no prose, no fences);
//   - non-glossary prose written in the target language;
//   - claims tagged with grounding "source" (carrying a verbatim quote) vs
//     "general" (model world-knowledge, flagged so the reader knows).

function langName(lang: AnalysisTargetLang): string {
  return lang === "tr" ? "Turkish" : "English";
}

// Appended to every stage so the model writes prose in the chosen language.
// The glossary stage overrides this with an explicit bilingual instruction.
function languageDirective(lang: AnalysisTargetLang): string {
  return `Write all prose (summaries, explanations, critique) in ${langName(lang)}, regardless of the paper's own language. Keep technical terms, proper nouns, symbols, and verbatim quotes in their ORIGINAL form.`;
}

// Shared grounding contract — the AnalysisClaim wire shape. Stages that emit
// `AnalysisClaim[]` reference this so the rules stay identical everywhere.
const CLAIM_GROUNDING_RULES = [
  "Grounding contract for every claim object:",
  '- A claim is `{ "text": string, "grounding": "source" | "general", "citations"?: [{ "quote": string, "page"?: number }] }`.',
  '- Use grounding "source" when the claim comes from the paper. It MUST carry at least one citation whose `quote` is a VERBATIM span copied from the article text (do not paraphrase the quote). Include `page` when the chunk marker shows one.',
  '- Use grounding "general" ONLY for your own world-knowledge (analogy, outside context, what-to-read-next). General claims carry NO citations.',
  "- Prefer source claims; never invent a quote that is not present verbatim in the article text.",
].join("\n");

// Each stage embeds a literal JSON schema. The field names double as a stable
// fingerprint of the stage (the runner and tests key off them) and tell the
// model the exact required shape.
function buildArticleBlock(articleText: string): SystemBlock {
  return {
    type: "text",
    text: `<article>\n${articleText}\n</article>`,
    cache_control: { type: "ephemeral" },
  };
}

function instructionBlock(text: string): SystemBlock {
  return { type: "text", text };
}

// ---------------------------------------------------------------------------
// Stage 1 — MAP (extractive-first section summary + verbatim quote pull)
// ---------------------------------------------------------------------------

export type MapSystemInput = {
  articleText: string;
  targetLang: AnalysisTargetLang;
  sectionTitle?: string | undefined;
};

export function buildMapSystem(input: MapSystemInput): SystemBlock[] {
  const instructions = [
    "Role: You are a meticulous research analyst extracting the substance of ONE section of an academic paper.",
    input.sectionTitle
      ? `This excerpt corresponds to the section: "${input.sectionTitle}".`
      : "This excerpt is one contiguous window of the paper.",
    "",
    "Task: Be EXTRACTIVE first. Summarize what this excerpt actually says, then pull the most load-bearing VERBATIM quotes (claims, definitions, results, equations-in-words). Copy quotes exactly as they appear; never paraphrase inside a quote.",
    "",
    "Output STRICT JSON only (no markdown fences, no commentary) matching:",
    "{",
    '  "sectionTitle": "string — a short title for this section",',
    '  "summary": "string — 2-5 sentences, extractive",',
    '  "keyQuotes": [ { "quote": "verbatim span from the excerpt", "page": 0 } ]',
    "}",
    'Include `page` on a quote only when the chunk marker shows one; otherwise omit it.',
    "",
    languageDirective(input.targetLang),
  ].join("\n");
  return [buildArticleBlock(input.articleText), instructionBlock(instructions)];
}

// ---------------------------------------------------------------------------
// Stage 2 — REDUCE (Understanding layer)
// ---------------------------------------------------------------------------

export type ReduceSystemInput = {
  articleText: string;
  targetLang: AnalysisTargetLang;
  sectionSummaries: MapStageOutput[];
};

function renderSectionSummaries(summaries: MapStageOutput[]): string {
  if (summaries.length === 0) {
    return "(No section summaries were produced — work directly from the article text above.)";
  }
  return summaries
    .map((s, i) => {
      const quotes = s.keyQuotes
        .map((q) => `    • "${q.quote}"${q.page !== undefined ? ` (p.${q.page})` : ""}`)
        .join("\n");
      return [
        `Section ${i + 1}: ${s.sectionTitle}`,
        `  Summary: ${s.summary}`,
        quotes ? `  Key quotes:\n${quotes}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
}

export function buildReduceSystem(input: ReduceSystemInput): SystemBlock[] {
  const instructions = [
    "Role: You are a senior researcher distilling a paper into its UNDERSTANDING layer for a non-native reader.",
    "",
    "Using the section summaries below (and the full article text above for verbatim quotes), produce a structured understanding of the paper.",
    "",
    CLAIM_GROUNDING_RULES,
    "",
    "Output STRICT JSON only (no fences, no commentary) matching:",
    "{",
    '  "problemMotivation": [claim],   // what problem and why it matters',
    '  "priorWorkGap": [claim],        // what prior work missed',
    '  "contributions": [claim],       // the paper\'s stated contributions',
    '  "methodWalkthrough": [ { "step": "string", "why": "string — why this design choice answers the question" } ],',
    '  "howItSolves": [claim],         // how the method resolves the problem',
    '  "keyResults": [claim]           // the headline empirical/theoretical results',
    "}",
    "",
    "SECTION SUMMARIES:",
    renderSectionSummaries(input.sectionSummaries),
    "",
    languageDirective(input.targetLang),
  ].join("\n");
  return [buildArticleBlock(input.articleText), instructionBlock(instructions)];
}

// ---------------------------------------------------------------------------
// Stage 3a — CRITIQUE specialist (senior NeurIPS reviewer)
// ---------------------------------------------------------------------------

export type CritiqueSystemInput = {
  articleText: string;
  targetLang: AnalysisTargetLang;
  // Whole-document section summaries (from Map). The article text above is
  // windowed to the head of long papers, so these let the reviewer see
  // limitations / detail stated in later sections it can't read verbatim.
  sectionSummaries?: MapStageOutput[] | undefined;
};

export function buildCritiqueSystem(
  input: CritiqueSystemInput,
): SystemBlock[] {
  const instructions = [
    "Role: You are a SENIOR area chair writing a rigorous NeurIPS-grade review of the paper above. Be specific, fair, and skeptical — reward genuine novelty, flag overclaiming.",
    "",
    "Evaluate along the standard axes and name the single weakest link. Then enumerate the paper's assumptions, limitations, and threats to validity, plus a reproducibility assessment.",
    "",
    CLAIM_GROUNDING_RULES,
    "",
    "Output STRICT JSON only (no fences, no commentary) matching:",
    "{",
    '  "critique": {',
    '    "soundness": "string — methodological / theoretical soundness",',
    '    "novelty": "string — what is genuinely new vs prior work",',
    '    "significance": "string — impact / who should care",',
    '    "clarity": "string — how clearly it is written/argued",',
    '    "weakestLink": "string — the single biggest weakness"',
    "  },",
    '  "assumptionsLimitations": [claim],   // assumptions + limitations + threats-to-validity',
    '  "reproducibility": "string — can a competent reader reproduce it? code/data/hyperparams?"',
    "}",
    "",
    "WHOLE-DOCUMENT SECTION SUMMARIES (the article text above may be windowed to the head of a long paper; use these so limitations, threats, and detail stated in LATER sections are not missed):",
    renderSectionSummaries(input.sectionSummaries ?? []),
    "",
    languageDirective(input.targetLang),
  ].join("\n");
  return [buildArticleBlock(input.articleText), instructionBlock(instructions)];
}

// ---------------------------------------------------------------------------
// Stage 3b — GLOSSARY specialist (ALWAYS bilingual TR/EN)
// ---------------------------------------------------------------------------

export type GlossarySystemInput = {
  articleText: string;
  // targetLang is accepted for signature symmetry but deliberately ignored:
  // the glossary is ALWAYS bilingual regardless of the analysis target lang.
  targetLang: AnalysisTargetLang;
  // Whole-document section summaries (from Map). The article text above is
  // windowed to the head of long papers; these surface late-introduced jargon
  // from sections the glossary stage can't read verbatim.
  sectionSummaries?: MapStageOutput[] | undefined;
};

export function buildGlossarySystem(
  input: GlossarySystemInput,
): SystemBlock[] {
  const instructions = [
    "Role: You build a BILINGUAL jargon glossary — the single highest-leverage aid for a non-native reader of this paper.",
    "",
    "Extract the domain terms, acronyms, and symbols a reader must know to follow the paper. For EACH term give a plain-language definition in BOTH Turkish AND English. This is mandatory and independent of any target language — always populate both `tr` and `en`.",
    "",
    "Output STRICT JSON only (no fences, no commentary) matching:",
    "{",
    '  "glossary": [',
    '    { "term": "string", "symbol": "optional notation e.g. ∇θ", "tr": "Turkish definition", "en": "English definition" }',
    "  ]",
    "}",
    "Order terms by importance. Omit `symbol` when the term has no notation.",
    "",
    "WHOLE-DOCUMENT SECTION SUMMARIES (the article text above may be windowed to the head of a long paper; use these so jargon introduced in LATER sections is also covered):",
    renderSectionSummaries(input.sectionSummaries ?? []),
  ].join("\n");
  return [buildArticleBlock(input.articleText), instructionBlock(instructions)];
}

// ---------------------------------------------------------------------------
// Stage 3c — REFLECTION specialist (so-what / questions / read-next)
// ---------------------------------------------------------------------------

export type ReflectionSystemInput = {
  articleText: string;
  targetLang: AnalysisTargetLang;
  understanding?: ReduceStageOutput | undefined;
};

function renderUnderstandingBrief(
  understanding: ReduceStageOutput | undefined,
): string {
  if (!understanding) return "(Understanding layer unavailable.)";
  const contributions = understanding.contributions
    .map((c) => `  • ${c.text}`)
    .join("\n");
  const results = understanding.keyResults
    .map((c) => `  • ${c.text}`)
    .join("\n");
  return [
    contributions ? `Contributions:\n${contributions}` : "",
    results ? `Key results:\n${results}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildReflectionSystem(
  input: ReflectionSystemInput,
): SystemBlock[] {
  const instructions = [
    "Role: You are a reading mentor helping a learner think CRITICALLY about the paper above and place it in context.",
    "",
    "Produce: (1) sharp questions a careful reader should ask of this paper, (2) the 'so what' — why this matters beyond the paper, (3) what to read next (prerequisites or follow-ups). Items (2) and (3) are general knowledge — phrase them as guidance, not paper quotes.",
    "",
    "Output STRICT JSON only (no fences, no commentary) matching:",
    "{",
    '  "questionsToAsk": ["string"],',
    '  "soWhat": "string — the broader significance",',
    '  "whatToReadNext": [ { "title": "string", "why": "string" } ]',
    "}",
    "",
    "UNDERSTANDING SO FAR:",
    renderUnderstandingBrief(input.understanding),
    "",
    languageDirective(input.targetLang),
  ].join("\n");
  return [buildArticleBlock(input.articleText), instructionBlock(instructions)];
}

// ---------------------------------------------------------------------------
// Stage 4 — SYNTHESIZE (Orientation layer, reconciling prior stages)
// ---------------------------------------------------------------------------

export type SynthesizeSystemInput = {
  articleText: string;
  targetLang: AnalysisTargetLang;
  understanding?: ReduceStageOutput | undefined;
  critique?: CritiqueStageOutput | undefined;
  reflection?: ReflectionStageOutput | undefined;
};

function renderPriorStages(input: SynthesizeSystemInput): string {
  const parts: string[] = [];
  if (input.understanding) {
    const contributions = input.understanding.contributions
      .map((c) => `  • ${c.text}`)
      .join("\n");
    const results = input.understanding.keyResults
      .map((c) => `  • ${c.text}`)
      .join("\n");
    parts.push(
      `Understanding:\n${[contributions && `Contributions:\n${contributions}`, results && `Key results:\n${results}`].filter(Boolean).join("\n")}`,
    );
  }
  if (input.critique) {
    parts.push(
      `Critique — weakest link: ${input.critique.critique.weakestLink}\n  Soundness: ${input.critique.critique.soundness}\n  Novelty: ${input.critique.critique.novelty}`,
    );
  }
  if (input.reflection) {
    parts.push(`So what: ${input.reflection.soWhat}`);
  }
  return parts.length > 0
    ? parts.join("\n\n")
    : "(No prior-stage outputs — synthesize from the article text above.)";
}

export function buildSynthesizeSystem(
  input: SynthesizeSystemInput,
): SystemBlock[] {
  const instructions = [
    "Role: You write the ORIENTATION layer — the first thing the reader sees. Reconcile the prior-stage outputs (understanding, critique, reflection) below with the article text into a crisp, honest orientation.",
    "",
    "Output STRICT JSON only (no fences, no commentary) matching:",
    "{",
    '  "tldr": "string — 2-3 sentence plain-language summary",',
    '  "ataGlance": {',
    '    "paperType": "string", "field": "string", "subfield": "optional",',
    '    "authors": "optional", "venueYear": "optional",',
    '    "purpose": "string", "methodologyType": "optional", "dataSample": "optional",',
    '    "headlineFinding": "string", "maturity": "optional"',
    "  },",
    '  "fiveCs": {',
    '    "category": "string — what kind of paper",',
    '    "context": "string — where it sits in the literature",',
    '    "correctness": "string — your assessment of validity",',
    '    "contributions": "string — its contributions",',
    '    "clarity": "string — your assessment of clarity"',
    "  },",
    '  "keyIdea": "string — the single central idea in one sentence"',
    "}",
    "Omit optional fields when unknown rather than inventing them.",
    "",
    "PRIOR-STAGE OUTPUTS:",
    renderPriorStages(input),
    "",
    languageDirective(input.targetLang),
  ].join("\n");
  return [buildArticleBlock(input.articleText), instructionBlock(instructions)];
}

// ---------------------------------------------------------------------------
// User messages — short triggers. The substance lives in the system blocks so
// the article text can carry the cache breakpoint; the user turn just kicks
// the model into producing the JSON.
// ---------------------------------------------------------------------------

export function buildStageUserMessage(targetLang: AnalysisTargetLang): string {
  return targetLang === "tr"
    ? "Yukarıdaki talimatlara göre yalnızca geçerli JSON üret."
    : "Produce only the valid JSON described above.";
}
