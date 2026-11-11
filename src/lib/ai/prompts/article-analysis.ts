import type { SystemBlock } from "@/lib/ai/providers/types";
import type { BriefWire } from "@/lib/article-analysis/brief";
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
    "Task: Be EXTRACTIVE first. Capture the excerpt's concrete details so a later writer can explain the paper without seeing this excerpt. Include the question, definitions, assumptions, procedure, formulas in words, experimental setup, datasets, baselines, metrics, numerical results, ablations, limitations, and author caveats when present. Preserve exact numbers and conditions; omit categories absent from this excerpt. Then pull load-bearing VERBATIM quotes. Copy quotes exactly as they appear; never paraphrase inside a quote.",
    "",
    "Output STRICT JSON only (no markdown fences, no commentary) matching:",
    "{",
    '  "sectionTitle": "string — a short title for this section",',
    '  "summary": "string — detailed extractive notes, typically 8-15 sentences for a substantial section",',
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
  // Whole-document section summaries (from Map). A very long paper's window
  // elides the middle of the document, so these let the reviewer see anything
  // stated in an elided section it can't read verbatim.
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
    "WHOLE-DOCUMENT SECTION SUMMARIES (on a very long paper the article text above keeps the front and the back and elides the middle; use these so anything stated in an elided section is not missed):",
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
  // Whole-document section summaries (from Map). A very long paper's window
  // elides the middle of the document; these surface jargon introduced in a
  // section the glossary stage can't read verbatim.
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
    "WHOLE-DOCUMENT SECTION SUMMARIES (on a very long paper the article text above elides the middle; use these so jargon introduced in an elided section is also covered):",
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

// The new reading brief has one writer for the entire visible narrative. Long
// papers supply section extraction notes; short papers need only this call.
export function buildBriefSystem(input: {
  articleText: string;
  targetLang: AnalysisTargetLang;
  sectionSummaries: MapStageOutput[];
  minimumWords?: number;
  previousBrief?: BriefWire;
}): SystemBlock[] {
  const example: BriefWire = {
    paperType: "empirical / theoretical / review / other",
    field: "research field if stated",
    methodologyType: "method if stated",
    dataSample: "sample or data scale if stated",
    thesis: { kind: "prose", text: "Central claim and why it matters", grounding: "source", citations: [{ quote: "verbatim source phrase" }] },
    sections: [
      { kind: "context", title: "Question and prior gap", blocks: [
        { kind: "prose", text: "Research question and why it matters, explained in depth", grounding: "source", citations: [{ quote: "verbatim source phrase" }] },
        { kind: "prose", text: "Prior approaches, their precise gap, and this paper's contribution", grounding: "source", citations: [{ quote: "verbatim source phrase" }] },
      ] },
      { kind: "method", title: "Method and mechanism", blocks: [
        { kind: "step", title: "First step", text: "Inputs, operation, and a concrete explanation", why: "Reason for this design", grounding: "source", citations: [{ quote: "verbatim source phrase" }] },
        { kind: "step", title: "Next step", text: "Transformation, output, assumptions, and important formula", grounding: "source", citations: [{ quote: "verbatim source phrase" }] },
      ] },
      { kind: "findings", title: "Evaluation design", blocks: [
        { kind: "prose", text: "Dataset or sample, splits, baselines, metrics, and test conditions", grounding: "source", citations: [{ quote: "verbatim source phrase" }] },
        { kind: "prose", text: "What each comparison can establish and what it cannot", grounding: "interpretation" },
      ] },
      { kind: "findings", title: "Results and interpretation", blocks: [
        { kind: "result", text: "Main observed result and its meaning", metric: "outcome and value if reported", comparison: "baseline if reported", context: "dataset/sample/conditions if reported", grounding: "source", citations: [{ quote: "verbatim source phrase" }] },
        { kind: "prose", text: "Other results, ablations, uncertainty, or failures when reported", grounding: "source", citations: [{ quote: "verbatim source phrase" }] },
      ] },
      { kind: "critical", title: "Limits and open questions", blocks: [
        { kind: "caution", text: "Authors' stated limitations and unresolved questions", grounding: "source", citations: [{ quote: "verbatim source phrase" }] },
        { kind: "caution", text: "Carefully marked inference about generalization or reproducibility", grounding: "interpretation" },
      ] },
    ],
  };
  const summaries = input.sectionSummaries.length > 0
    ? JSON.stringify(input.sectionSummaries)
    : "None; the complete paper is in the article window.";
  return [
    { type: "text", text: input.articleText, cache_control: { type: "ephemeral" } },
    { type: "text", text: [
      "Write a thorough, source-grounded reading guide for ONE paper. A reader should understand the research question, prior gap, contribution, mechanism, evaluation, findings, and limits without first reading the entire paper. Output valid JSON only.",
      languageDirective(input.targetLang),
      "Use the paper as the only source. Section summaries may cover text omitted from the article window.",
      "Each idea appears once. The thesis orients; context covers the problem, prior approaches, and precise gap; method walks through inputs, transformations, outputs, design reasons, and important formulas; findings explain evaluation design before results; critical separates authors' limitations from your careful inferences. Avoid repeating a conclusion across sections.",
      "Coverage checklist, only where supported by the paper: research question and contribution; definitions and assumptions; full method sequence and important equations; data/sample and preprocessing; experimental protocol and baselines; each important metric with value, unit, and conditions; uncertainty, ablations, failure cases; author-stated limitations and reproducibility details. Explain the meaning of each item, not just its name. Explicitly distinguish a missing paper detail from a detail omitted by this brief.",
      "For a full research paper, usually write 5-8 substantive sections with 2-4 distinct blocks each, often 12-24 blocks overall. Each block should explain one specific idea in readable paragraphs. Explain the method step by step with a concrete example when the paper supports one. Report datasets or sample, baselines, metrics, values, uncertainty, and ablations when present; say plainly when a crucial detail is not reported. Review and theory papers need an adapted structure, not fictitious experiments.",
      input.minimumWords && input.minimumWords > 0
        ? `Depth target: at least about ${input.minimumWords} words across thesis and body, often ${Math.round(input.minimumWords * 1.25)} or more when the paper warrants it. A one-paragraph-per-section summary is insufficient. Use source-supported explanation, not filler, repeated claims, or invented detail.`
        : "For a short source, use only the detail actually supported by the text; do not pad it.",
      "For every source-grounded block, include a short VERBATIM quote from the raw article text or a section summary's keyQuotes. Do not quote a paraphrased summary sentence. Never declare a quote verified; the application checks it. Interpretations must be labeled interpretation and should be modest.",
      "For result blocks, metric, comparison, and context are optional and must be populated only when explicitly reported. Explain what a number measures and against which baseline. Do not convert percentages into relative improvements without a valid calculation.",
      "Do not use external sources or cite your own knowledge. Use readable paragraphs with concrete explanations, headings, and no generic praise.",
      input.previousBrief ? `PREVIOUS BRIEF WAS TOO SHALLOW. Rewrite it as a substantially more complete reading guide while keeping correct claims and citations. Fill omitted mechanism, experiment setup, results, and limitations from the source; do not merely lengthen existing sentences. PREVIOUS BRIEF: ${JSON.stringify(input.previousBrief)}` : "",
      `JSON shape example (replace all text and omit unsupported optional fields): ${JSON.stringify(example)}`,
      `SECTION EXTRACTION NOTES: ${summaries}`,
    ].filter(Boolean).join("\n\n") },
  ];
}
