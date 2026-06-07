import { KEEP_EN_TERMS_RULE_TR } from "@/lib/ai/content-language";
import type { SystemBlock } from "@/lib/ai/providers/types";
import type { ChunkRecord, SourceRecord } from "@/lib/db/types";

// Two flashcard-gen modes share the same JSON schema. Single = "Karta çevir"
// from a chat message (input is the recent assistant turn + chunk context).
// Batch = "Karttan üret" workspace-wide modal (input is N chunks selected
// by source, the model writes 5/10/20 cards from the union).
export type FlashcardGenMode = "single" | "batch";

export type FlashcardGenInput = {
  source: Pick<SourceRecord, "title" | "titleEn" | "author" | "type">;
  chunks: Pick<
    ChunkRecord,
    "index" | "section" | "headings" | "text" | "page"
  >[];
  /** UI locale — drives prompt language. The output language follows it
   *  unless `aiResponseLocale` overrides. */
  locale: "tr" | "en";
  /** Number of cards the model should produce (clamped to [1, 20] in the
   *  prompt; the parser clamps again as defence in depth). */
  count: number;
  mode: FlashcardGenMode;
  /** Optional context paragraph from the chat thread, used in `mode:
   *  "single"` so the model anchors cards to what was just discussed. */
  chatContext?: string;
  /** When true (only meaningful with a Turkish `locale`), keep technical terms
   *  in their original English form while explaining in Turkish — the
   *  `en_terms_tr` content-language mode. Splices the shared rule into the TR
   *  rule list. */
  keepEnglishTerms?: boolean;
};

export type FlashcardGenCard = {
  question: string;
  answer: string;
  /** English translation of `question`, attached by the modal after a "both"
   *  translation pass. The base `question`/`answer` always hold Turkish and
   *  the `*En` fields always hold English (the app's dual-field convention). */
  questionEn?: string;
  answerEn?: string;
  tags?: string[];
  /** Section heading the card cites — usually mirrors a chunk header. */
  sourceSection?: string;
  /** Optional `#index` chunk id from the source block. */
  sourceChunkId?: string;
};

export type FlashcardGenResult = {
  cards: FlashcardGenCard[];
};

const MIN_COUNT = 1;
const MAX_COUNT = 20;

export function clampCount(n: number): number {
  if (!Number.isFinite(n)) return MIN_COUNT;
  if (n < MIN_COUNT) return MIN_COUNT;
  if (n > MAX_COUNT) return MAX_COUNT;
  return Math.round(n);
}

const RULES_TR = (
  count: number,
  mode: FlashcardGenMode,
  keepEnglishTerms: boolean,
): string =>
  [
    "Rol: Aralıklı tekrar (SM-2) için yüksek kaliteli flashcard üreten bir öğretim asistanısın.",
    `Görev: <source> içindeki içerikten ${count} adet soru-cevap kartı üret.`,
    "İlkeler:",
    "- Her kart tek bir atomik fikri test etsin (büyük 'açıklayan' soru kartlar yasak).",
    "- Soru kısa ve nettir; cevap doğrudan, mümkünse tek-iki cümle.",
    "- Soru içinde cevabı sızdırma; 'açıkla', 'tartış' gibi açık uçlular yerine 'tanımla', 'hangi', 'ne zaman'.",
    "- Cevaplar yalnızca <source> içeriğine dayansın. Spekülasyon, harici bilgi yok.",
    "- Mümkünse `sourceSection` alanını chunk başlığıyla doldur; chunk numarasını `sourceChunkId` olarak yazabilirsin (örn. '#3').",
    "- Aynı kavramı iki ayrı şekilde sorma; varyasyon ekle (tanım / örnek / karşılaştırma).",
    "- Tag listesi opsiyonel; varsa kısa sözcükler (1-2 kelime, küçük harf).",
    ...(keepEnglishTerms ? [KEEP_EN_TERMS_RULE_TR] : []),
    mode === "single"
      ? "- 'Sohbet bağlamı' bloğu varsa, kartları o bağlamla hizala — kullanıcının az önce sorduğu konuya odaklan."
      : "- Tüm chunk yelpazesinden çeşitli kartlar topla — tek bir bölümden 3'ten fazla kart üretme.",
    "",
    "Çıkış formatı: SADECE aşağıdaki şemada geçerli JSON döndür. Markdown kod fence'i kullanma, ek açıklama ekleme.",
  ].join("\n");

const RULES_EN = (count: number, mode: FlashcardGenMode): string =>
  [
    "Role: You are a tutoring assistant that produces high-quality spaced-repetition (SM-2) flashcards.",
    `Task: Produce ${count} question/answer cards from the content inside <source>.`,
    "Principles:",
    "- One atomic idea per card (no broad 'explain X' prompts).",
    "- Question is short and unambiguous; answer is direct, ideally one or two sentences.",
    "- Don't leak the answer in the question; prefer 'define', 'which', 'when' over 'discuss'.",
    "- Ground every answer in the <source> content only — no outside knowledge or speculation.",
    "- Fill `sourceSection` with the chunk heading when possible; you may also include a chunk id like '#3' in `sourceChunkId`.",
    "- Don't ask the same concept twice; vary forms (definition / example / contrast).",
    "- Tag list is optional; if present, short lowercase words (1-2 each).",
    mode === "single"
      ? "- If a 'Chat context' block is present, anchor cards to that context — focus on what the user just asked."
      : "- Span the chunk range — never produce more than 3 cards from a single section.",
    "",
    "Output format: Return ONLY valid JSON in the schema below. No markdown fences, no commentary.",
  ].join("\n");

const SCHEMA_BLOCK_TR = [
  "Şema:",
  "{",
  '  "cards": [',
  "    {",
  '      "question": "string (zorunlu)",',
  '      "answer": "string (zorunlu)",',
  '      "tags": ["string", "..."],          // opsiyonel',
  '      "sourceSection": "string",            // opsiyonel',
  '      "sourceChunkId": "string"             // opsiyonel, örn. \'#3\'',
  "    }",
  "  ]",
  "}",
].join("\n");

const SCHEMA_BLOCK_EN = [
  "Schema:",
  "{",
  '  "cards": [',
  "    {",
  '      "question": "string (required)",',
  '      "answer": "string (required)",',
  '      "tags": ["string", "..."],          // optional',
  '      "sourceSection": "string",            // optional',
  '      "sourceChunkId": "string"             // optional, e.g. \'#3\'',
  "    }",
  "  ]",
  "}",
].join("\n");

export function buildFlashcardGenSystem(
  input: FlashcardGenInput,
): SystemBlock[] {
  const count = clampCount(input.count);
  const rules =
    input.locale === "tr"
      ? RULES_TR(count, input.mode, input.keepEnglishTerms ?? false)
      : RULES_EN(count, input.mode);
  const schema = input.locale === "tr" ? SCHEMA_BLOCK_TR : SCHEMA_BLOCK_EN;

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

  const blocks: SystemBlock[] = [
    { type: "text", text: `${rules}\n\n${schema}` },
    {
      type: "text",
      text: sourcePayload,
      // The chunk payload is large and reused across batch generation calls
      // for the same source — caching it cuts cost on the second+ call.
      cache_control: { type: "ephemeral" },
    },
  ];

  if (input.mode === "single" && input.chatContext) {
    blocks.push({
      type: "text",
      text:
        input.locale === "tr"
          ? `Sohbet bağlamı (kartlar bu konuya odaklansın):\n${input.chatContext}`
          : `Chat context (focus the cards on this topic):\n${input.chatContext}`,
    });
  }

  return blocks;
}

// Strip ```json fences if the model ignored the prompt instruction. Some
// non-Anthropic providers (gemini-1.5, smaller open-weights) wrap JSON in a
// markdown block even when explicitly asked not to; rather than fight the
// model we tolerate it at parse time.
function stripCodeFence(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  // Drop the opening fence ("```json" or "```") and trailing fence.
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
  return out.length === 0 ? undefined : out;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Parse a model response into a normalized result. Tolerant of:
 *  - markdown ```json fences
 *  - extra text after the closing brace (truncated streams)
 *  - missing optional fields
 *  - cards array nested at the root or under `cards`
 *
 * Throws when the input cannot be parsed as JSON at all, or when there is
 * no `cards` array with at least one valid `{question, answer}` pair.
 */
export function parseFlashcardGenOutput(raw: string): FlashcardGenResult {
  const cleaned = stripCodeFence(raw);
  // Locate the first JSON entry token, accepting either `{` (object form)
  // or `[` (bare array form). Whichever appears first wins so a leading
  // prose preamble ("Here is the JSON:") is still forgiven.
  const firstBrace = cleaned.indexOf("{");
  const firstBracket = cleaned.indexOf("[");
  let firstToken: number;
  let isArray: boolean;
  if (firstBrace === -1 && firstBracket === -1) {
    throw new Error("flashcard-gen: no JSON object found in response");
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
    // Recover from trailing prose / truncated stream by scanning for the
    // matching closing token of the same kind we opened with.
    const closeChar = isArray ? "]" : "}";
    const lastClose = jsonText.lastIndexOf(closeChar);
    if (lastClose === -1) {
      throw new Error("flashcard-gen: response is not valid JSON");
    }
    parsed = JSON.parse(jsonText.slice(0, lastClose + 1));
  }

  // Accept both `{ cards: [...] }` and a bare `[...]` array (some models
  // strip the wrapper when there's only one key).
  let cardsRaw: unknown;
  if (Array.isArray(parsed)) {
    cardsRaw = parsed;
  } else if (isPlainObject(parsed) && Array.isArray(parsed.cards)) {
    cardsRaw = parsed.cards;
  } else {
    throw new Error("flashcard-gen: response missing `cards` array");
  }

  const cards: FlashcardGenCard[] = [];
  for (const raw of cardsRaw as unknown[]) {
    if (!isPlainObject(raw)) continue;
    const question = asString(raw.question);
    const answer = asString(raw.answer);
    if (!question || !answer) continue;
    const card: FlashcardGenCard = { question, answer };
    const tags = asStringArray(raw.tags);
    if (tags) card.tags = tags;
    const section = asString(raw.sourceSection);
    if (section) card.sourceSection = section;
    const chunkId = asString(raw.sourceChunkId);
    if (chunkId) card.sourceChunkId = chunkId;
    cards.push(card);
  }

  if (cards.length === 0) {
    throw new Error("flashcard-gen: no valid cards in response");
  }
  return { cards };
}

/**
 * Drop near-duplicate cards within a freshly generated batch. Two cards are
 * considered duplicates when their normalized questions match — strip
 * punctuation, lowercase, collapse whitespace. Stable: keeps the first
 * occurrence so callers can rely on order.
 */
export function dedupeFlashcardCards(
  cards: FlashcardGenCard[],
): FlashcardGenCard[] {
  const seen = new Set<string>();
  const out: FlashcardGenCard[] = [];
  for (const card of cards) {
    const key = card.question
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, "")
      .replace(/\s+/g, " ")
      .trim();
    if (key.length === 0) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(card);
  }
  return out;
}
