import { KEEP_EN_TERMS_RULE_TR } from "@/lib/ai/content-language";
import type { SystemBlock } from "@/lib/ai/providers/types";
import type { ChunkRecord, SourceRecord } from "@/lib/db/types";
import type { QuizItem, QuizMcqItem, QuizOpenItem } from "@/lib/quiz/types";

export type QuizMode = "mcq" | "open" | "mixed";

export type QuizGenInput = {
  source: Pick<SourceRecord, "title" | "titleEn" | "author" | "type">;
  chunks: Pick<
    ChunkRecord,
    "index" | "section" | "headings" | "text" | "page"
  >[];
  locale: "tr" | "en";
  count: number;
  // Default "mcq" — back-compat with 4.C callers. "mixed" produces a balanced
  // blend of MCQ and open items; "open" forces open-ended only.
  mode?: QuizMode;
  // When the content-language mode is "en_terms_tr", explanations stay Turkish
  // but technical terms are kept in their original English form. Only meaningful
  // with a Turkish locale (the extra rule is spliced into the TR rule list).
  keepEnglishTerms?: boolean | undefined;
};

export type QuizGenResult = {
  items: QuizItem[];
};

const MIN_COUNT = 1;
const MAX_COUNT = 20;
const REQUIRED_CHOICE_COUNT = 4;

export function clampQuizCount(n: number): number {
  if (!Number.isFinite(n)) return MIN_COUNT;
  if (n < MIN_COUNT) return MIN_COUNT;
  if (n > MAX_COUNT) return MAX_COUNT;
  return Math.round(n);
}

function modeTaskTr(count: number, mode: QuizMode): string {
  if (mode === "mcq") return `Görev: Tam olarak ${count} adet MCQ (multiple-choice question) üret.`;
  if (mode === "open") return `Görev: Tam olarak ${count} adet açık uçlu soru üret (her biri için rubric şart).`;
  return `Görev: Tam olarak ${count} adet quiz item'ı üret. Yaklaşık yarısı MCQ, yarısı açık uçlu (\`kind\` alanıyla ayır).`;
}

function modeTaskEn(count: number, mode: QuizMode): string {
  if (mode === "mcq") return `Task: Produce exactly ${count} MCQ (multiple-choice) items.`;
  if (mode === "open") return `Task: Produce exactly ${count} open-ended items (each with a rubric).`;
  return `Task: Produce exactly ${count} quiz items, roughly half MCQ and half open-ended (use the \`kind\` field).`;
}

const RULES_TR = (
  count: number,
  mode: QuizMode,
  keepEnglishTerms: boolean,
): string =>
  [
    "Rol: <source> kaynağındaki içerikten kullanıcıyı sınamak için quiz üreten bir öğretim asistanısın.",
    modeTaskTr(count, mode),
    "İlkeler:",
    "- Her soru tek bir atomik fikri test etsin; iki adımlık çıkarımları parçala.",
    ...(keepEnglishTerms ? [KEEP_EN_TERMS_RULE_TR] : []),
    ...(mode !== "open"
      ? [
          "- MCQ için tam olarak 4 şık; tek doğru şık. Yanlış şıklar inanılır olsun (ezbere atılmasın).",
          "- MCQ `correctIndex` sıfır-tabanlı; doğru şıkkın `choices` dizisindeki konumu (0..3).",
        ]
      : []),
    ...(mode !== "mcq"
      ? [
          "- Açık uçlu sorular için `rubric` zorunlu — kullanıcı cevabının doğru sayılması için içermesi gereken anahtar fikirleri 1-2 cümleyle yaz.",
          "- Açık uçlu sorular ezber değil, kavrama ölçsün (örnek isteme, karşılaştırma, kendi kelimeleriyle açıklama).",
        ]
      : []),
    "- Sorular yalnızca <source> içeriğine dayansın. Spekülasyon yok.",
    "- Aynı kavramı iki farklı soruyla tekrarlama; soru tipi çeşitliliği ekle.",
    ...(mode !== "open"
      ? [
          "- MCQ `explanation` opsiyonel ama önerilir — neden doğru olduğunu 1 cümleyle açıkla.",
        ]
      : []),
    "- `sourceSection` mümkünse chunk başlığıyla doldur; chunk numarası `sourceChunkId` (örn. '#3').",
    "",
    "Çıkış formatı: SADECE aşağıdaki şemada geçerli JSON döndür. Markdown kod fence'i kullanma, ek açıklama ekleme.",
  ].join("\n");

const RULES_EN = (count: number, mode: QuizMode): string =>
  [
    "Role: You are a tutoring assistant that produces quiz items to test the user on the <source> content.",
    modeTaskEn(count, mode),
    "Principles:",
    "- One atomic idea per question; split two-step inferences into separate items.",
    ...(mode !== "open"
      ? [
          "- For MCQ: exactly 4 choices, exactly one correct. Distractors should be plausible — not throwaways.",
          "- MCQ `correctIndex` is zero-based — the index in `choices` of the correct option (0..3).",
        ]
      : []),
    ...(mode !== "mcq"
      ? [
          "- For open-ended items, `rubric` is REQUIRED — write 1-2 sentences listing the key ideas the user's answer must contain to be marked correct.",
          "- Open-ended items should test understanding (give-an-example, contrast, paraphrase) rather than recall.",
        ]
      : []),
    "- Ground every question in the <source> content only. No speculation.",
    "- Don't ask the same concept twice; vary question types.",
    ...(mode !== "open"
      ? [
          "- MCQ `explanation` optional but recommended — one sentence on why the answer is correct.",
        ]
      : []),
    "- Fill `sourceSection` with the chunk heading when possible; you may add a chunk id like '#3' in `sourceChunkId`.",
    "",
    "Output format: Return ONLY valid JSON in the schema below. No markdown fences, no commentary.",
  ].join("\n");

function schemaBlock(locale: "tr" | "en", mode: QuizMode): string {
  const tr = locale === "tr";
  const header = tr ? "Şema:" : "Schema:";
  const opt = tr ? "opsiyonel" : "optional";
  const req = tr ? "zorunlu" : "required";
  const exact4 = tr ? "tam 4" : "exactly 4";
  const lines: string[] = [header, "{", '  "items": ['];
  if (mode !== "open") {
    lines.push(
      "    {",
      '      "kind": "mcq",',
      `      "q": "string (${req})",`,
      `      "choices": ["string", "string", "string", "string"],   // ${exact4}`,
      '      "correctIndex": 0,                                       // 0..3',
      `      "explanation": "string",                                  // ${opt}`,
      `      "sourceSection": "string",                                // ${opt}`,
      `      "sourceChunkId": "string"                                 // ${opt}`,
      mode === "mixed" ? "    }," : "    }",
    );
  }
  if (mode !== "mcq") {
    lines.push(
      "    {",
      '      "kind": "open",',
      `      "q": "string (${req})",`,
      `      "rubric": "string (${req})",`,
      `      "sourceSection": "string",                                // ${opt}`,
      `      "sourceChunkId": "string"                                 // ${opt}`,
      "    }",
    );
  }
  lines.push("  ]", "}");
  return lines.join("\n");
}

export function buildQuizGenSystem(input: QuizGenInput): SystemBlock[] {
  const count = clampQuizCount(input.count);
  const mode: QuizMode = input.mode ?? "mcq";
  const rules =
    input.locale === "tr"
      ? RULES_TR(count, mode, input.keepEnglishTerms ?? false)
      : RULES_EN(count, mode);
  const schema = schemaBlock(input.locale, mode);

  const title = input.source.titleEn ?? input.source.title;
  const authorAttr = input.source.author ? ` author=${JSON.stringify(input.source.author)}` : "";
  const typeAttr = ` type=${JSON.stringify(input.source.type)}`;
  const chunkBlocks = input.chunks.map((c) => {
    const headerBits: string[] = [`#${c.index}`];
    if (c.section) headerBits.push(`section: ${c.section}`);
    else if (c.headings?.[0]) headerBits.push(`section: ${c.headings[0]}`);
    if (typeof c.page === "number") headerBits.push(`page: ${c.page}`);
    return `---chunk ${headerBits.join(" · ")}---\n${c.text}`;
  });
  const sourcePayload = [
    `<source title=${JSON.stringify(title)}${authorAttr}${typeAttr}>`,
    ...chunkBlocks,
    "</source>",
  ].join("\n\n");

  return [
    { type: "text", text: `${rules}\n\n${schema}` },
    {
      type: "text",
      text: sourcePayload,
      // The chunk payload is reused across regenerate calls for the same
      // source — caching it cuts cost on the second+ run.
      cache_control: { type: "ephemeral" },
    },
  ];
}

function stripCodeFence(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  const withoutOpen = trimmed.replace(/^```(?:json)?\s*/i, "");
  const withoutClose = withoutOpen.replace(/```\s*$/i, "");
  return withoutClose.trim();
}

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const t = value.trim();
  return t.length === 0 ? undefined : t;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: string[] = [];
  for (const v of value) {
    const s = asString(v);
    if (s !== undefined) out.push(s);
  }
  return out;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asInteger(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.trunc(value);
}

/**
 * Parse a model response into normalized quiz items. Tolerant of:
 *  - markdown ```json fences
 *  - leading prose ("Sure! Here is the JSON:")
 *  - bare `[...]` arrays without an `items` wrapper
 *  - truncated streams
 *
 * Items that fail invariants (MCQ: 4 choices, correctIndex in [0,3], non-empty
 * question; OPEN: non-empty q + rubric) are silently dropped — better to lose
 * a bad item than to render a broken question. Throws when there's no JSON,
 * no items array, or zero valid items. The `mode` arg gates which kinds are
 * accepted; default "mcq" preserves 4.C back-compat (open items dropped).
 */
export function parseQuizGenOutput(raw: string, mode: QuizMode = "mcq"): QuizGenResult {
  const cleaned = stripCodeFence(raw);
  const firstBrace = cleaned.indexOf("{");
  const firstBracket = cleaned.indexOf("[");
  let firstToken: number;
  let isArray: boolean;
  if (firstBrace === -1 && firstBracket === -1) {
    throw new Error("quiz-gen: no JSON object found in response");
  } else if (firstBrace === -1) {
    firstToken = firstBracket;
    isArray = true;
  } else if (firstBracket === -1) {
    firstToken = firstBrace;
    isArray = false;
  } else {
    isArray = firstBracket < firstBrace;
    firstToken = isArray ? firstBracket : firstBrace;
  }
  const jsonText = cleaned.slice(firstToken);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    const closeChar = isArray ? "]" : "}";
    const lastClose = jsonText.lastIndexOf(closeChar);
    if (lastClose === -1) {
      throw new Error("quiz-gen: response is not valid JSON");
    }
    parsed = JSON.parse(jsonText.slice(0, lastClose + 1));
  }

  let itemsRaw: unknown;
  if (Array.isArray(parsed)) {
    itemsRaw = parsed;
  } else if (isPlainObject(parsed) && Array.isArray(parsed.items)) {
    itemsRaw = parsed.items;
  } else {
    throw new Error("quiz-gen: response missing `items` array");
  }

  const acceptMcq = mode !== "open";
  const acceptOpen = mode !== "mcq";
  const items: QuizItem[] = [];
  for (const raw of itemsRaw as unknown[]) {
    if (!isPlainObject(raw)) continue;
    const kind = asString(raw.kind);
    if (kind === "mcq" && acceptMcq) {
      const q = asString(raw.q);
      const choices = asStringArray(raw.choices);
      const correctIndex = asInteger(raw.correctIndex);
      if (!q || !choices) continue;
      if (choices.length !== REQUIRED_CHOICE_COUNT) continue;
      if (
        correctIndex === undefined ||
        correctIndex < 0 ||
        correctIndex >= REQUIRED_CHOICE_COUNT
      ) {
        continue;
      }
      const item: QuizMcqItem = { kind: "mcq", q, choices, correctIndex };
      const explanation = asString(raw.explanation);
      if (explanation) item.explanation = explanation;
      const section = asString(raw.sourceSection);
      if (section) item.sourceSection = section;
      const chunkId = asString(raw.sourceChunkId);
      if (chunkId) item.sourceChunkId = chunkId;
      items.push(item);
    } else if (kind === "open" && acceptOpen) {
      const q = asString(raw.q);
      const rubric = asString(raw.rubric);
      if (!q || !rubric) continue;
      const item: QuizOpenItem = { kind: "open", q, rubric };
      const section = asString(raw.sourceSection);
      if (section) item.sourceSection = section;
      const chunkId = asString(raw.sourceChunkId);
      if (chunkId) item.sourceChunkId = chunkId;
      items.push(item);
    }
  }

  if (items.length === 0) {
    throw new Error("quiz-gen: no valid items in response");
  }
  return { items };
}
