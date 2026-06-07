// Open-ended quiz evaluator. Takes a single question + rubric + the user's
// free-text answer, asks the model to judge it against the rubric, and parses
// a small JSON envelope back. Kept separate from quiz-gen so the runtime can
// route eval calls to a cheaper "summary" model (prefs.modelBindings.summary)
// while generation still uses the bigger chat model.

import type { SystemBlock } from "@/lib/ai/providers/types";

export type QuizEvalInput = {
  question: string;
  rubric: string;
  userAnswer: string;
  locale: "tr" | "en";
};

export type QuizEvalResult = {
  // True only when the rubric is materially satisfied. `partial` (0..1) is a
  // soft score the UI may surface; absence means the model didn't provide one.
  correct: boolean;
  partial?: number;
  feedback: string;
};

const RULES_TR = [
  "Rol: Açık uçlu bir quiz cevabını rubric'e göre değerlendiren bir öğretmensin.",
  "Görev: Rubric'teki anahtar fikirlerin kullanıcı cevabında yer alıp almadığını tara, kararını ver, kısa geri bildirim yaz.",
  "İlkeler:",
  "- `correct` ancak rubric'in özü karşılandıysa true olur. Yarım/yüzeysel cevaplar false.",
  "- `partial` 0 ile 1 arası kısmi puan (opsiyonel). Tam doğru → 1.0, tam yanlış → 0.0; ara değerler kısmi.",
  "- `feedback` 1-3 cümle: önce neyin doğru olduğunu, sonra eksik/yanlış olanı söyle. Türkçe yaz, kullanıcıya 'sen' diye hitap et.",
  "- Kullanıcı cevabını yargılama; sadece içeriği rubric'e göre tart.",
  "",
  "Çıkış formatı: SADECE aşağıdaki JSON. Markdown fence'i kullanma, ek açıklama ekleme.",
].join("\n");

const RULES_EN = [
  "Role: You are a teacher grading an open-ended quiz answer against a rubric.",
  "Task: Check whether the user's answer covers the key ideas in the rubric, render a verdict, write short feedback.",
  "Principles:",
  "- `correct` is true only when the rubric's essence is met. Half-formed / surface answers → false.",
  "- `partial` is an optional 0–1 score. Fully correct → 1.0, fully wrong → 0.0; in-between is partial.",
  "- `feedback` is 1–3 sentences: name what's right first, then what's missing/wrong. English, second-person.",
  "- Don't judge the user; only weigh the content against the rubric.",
  "",
  "Output format: ONLY the JSON below. No markdown fences, no commentary.",
].join("\n");

const SCHEMA_BLOCK_TR = [
  "Şema:",
  "{",
  '  "correct": true,                  // boolean — zorunlu',
  '  "partial": 0.7,                   // 0..1, opsiyonel',
  '  "feedback": "string"              // 1-3 cümle, zorunlu',
  "}",
].join("\n");

const SCHEMA_BLOCK_EN = [
  "Schema:",
  "{",
  '  "correct": true,                  // boolean, required',
  '  "partial": 0.7,                   // 0..1, optional',
  '  "feedback": "string"              // 1-3 sentences, required',
  "}",
].join("\n");

export function buildQuizEvalSystem(input: QuizEvalInput): SystemBlock[] {
  const rules = input.locale === "tr" ? RULES_TR : RULES_EN;
  const schema = input.locale === "tr" ? SCHEMA_BLOCK_TR : SCHEMA_BLOCK_EN;
  const payload = [
    `<question>`,
    input.question.trim(),
    `</question>`,
    "",
    `<rubric>`,
    input.rubric.trim(),
    `</rubric>`,
    "",
    `<user-answer>`,
    input.userAnswer.trim(),
    `</user-answer>`,
  ].join("\n");
  return [
    { type: "text", text: `${rules}\n\n${schema}` },
    { type: "text", text: payload },
  ];
}

function stripCodeFence(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  const withoutOpen = trimmed.replace(/^```(?:json)?\s*/i, "");
  const withoutClose = withoutOpen.replace(/```\s*$/i, "");
  return withoutClose.trim();
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Parse the eval model's JSON envelope. Tolerates the same garbage as the
 * quiz-gen parser (markdown fences, leading prose, trailing chatter). Throws
 * when no JSON object can be located or required fields are missing.
 */
export function parseQuizEvalOutput(raw: string): QuizEvalResult {
  const cleaned = stripCodeFence(raw);
  const firstBrace = cleaned.indexOf("{");
  if (firstBrace === -1) {
    throw new Error("quiz-eval: no JSON object found in response");
  }
  const jsonText = cleaned.slice(firstBrace);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    const lastClose = jsonText.lastIndexOf("}");
    if (lastClose === -1) {
      throw new Error("quiz-eval: response is not valid JSON");
    }
    parsed = JSON.parse(jsonText.slice(0, lastClose + 1));
  }
  if (!isPlainObject(parsed)) {
    throw new Error("quiz-eval: response is not an object");
  }
  const correctRaw = parsed.correct;
  if (typeof correctRaw !== "boolean") {
    throw new Error("quiz-eval: missing boolean `correct` field");
  }
  const feedbackRaw = parsed.feedback;
  const feedback =
    typeof feedbackRaw === "string" && feedbackRaw.trim().length > 0
      ? feedbackRaw.trim()
      : "";
  if (!feedback) {
    throw new Error("quiz-eval: missing `feedback` field");
  }
  const result: QuizEvalResult = { correct: correctRaw, feedback };
  if (
    typeof parsed.partial === "number" &&
    Number.isFinite(parsed.partial) &&
    parsed.partial >= 0 &&
    parsed.partial <= 1
  ) {
    result.partial = parsed.partial;
  }
  return result;
}
