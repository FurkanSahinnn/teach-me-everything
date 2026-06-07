import type { SystemBlock } from "@/lib/ai/providers/types";

export type StudyJournalPromptInput = {
  workspace: { name: string; goal?: string | undefined };
  source?:
    | {
        title?: string | undefined;
        titleEn?: string | undefined;
        author?: string | undefined;
      }
    | undefined;
  question: string;
  answerMarkdown: string;
  locale: "tr" | "en";
  /**
   * Sections or chunk titles already cited in the answer. Surfaced to the
   * model so tag suggestions can lean on real source structure rather than
   * inventing keywords. Optional — answer ungrounded → omit.
   */
  citedSections?: string[] | undefined;
};

export type ParsedStudyJournalMeta = {
  title: string;
  tags: string[];
  summaryMarkdown?: string | undefined;
};

const RULES_EN = [
  "Role: You are a study-journal librarian. Given one Q&A turn, you propose a short title, a small tag set, and an optional 1-2 sentence summary.",
  "Task: Read the question and answer. Return concise metadata that lets the learner re-find this entry later.",
  "Rules:",
  "- `title`: 4-9 words, captures the question's core intent, no trailing punctuation, no quotes.",
  "- `tags`: 2-5 lowercase keywords (alphanumeric + hyphens, no spaces). Thematic over surface-level. Skip generic words like 'study' or 'note'.",
  "- `summaryMarkdown` (optional): 1-2 sentences in plain Markdown describing what the answer establishes. Skip if the answer is shorter than 2 paragraphs.",
  "- Match the writing language to the question and answer language.",
  "- Return ONLY the JSON object below. No markdown fences, no commentary.",
].join("\n");

const RULES_TR = [
  "Rol: Çalışma günlüğü kütüphanecisisin. Tek bir Soru-Cevap turu için kısa başlık, küçük bir etiket seti ve opsiyonel 1-2 cümlelik özet üretirsin.",
  "Görev: Soruyu ve cevabı oku. Öğrencinin bu girdiyi sonra kolay bulmasını sağlayacak özlü bir meta üret.",
  "Kurallar:",
  "- `title`: 4-9 kelime, sorunun özünü yakalasın, sonunda noktalama ve tırnak olmasın.",
  "- `tags`: 2-5 küçük harf anahtar kelime (harf-rakam + tire, boşluk yok). Tematik olsun, yüzeysel değil. 'çalışma' ya da 'not' gibi genel kelimeleri atla.",
  "- `summaryMarkdown` (opsiyonel): Cevabın ne tespit ettiğini anlatan 1-2 cümlelik düz Markdown. Cevap 2 paragraftan kısa ise bu alanı atla.",
  "- Yazım dilini soru ve cevabın diliyle eşle.",
  "- SADECE aşağıdaki JSON objesini döndür. Markdown fence veya açıklama ekleme.",
].join("\n");

const SCHEMA = [
  "{",
  '  "title": "string",',
  '  "tags": ["string"],',
  '  "summaryMarkdown": "string"',
  "}",
].join("\n");

export function buildStudyJournalSystem(
  input: StudyJournalPromptInput,
): SystemBlock[] {
  const rules = input.locale === "tr" ? RULES_TR : RULES_EN;
  const goal = input.workspace.goal
    ? ` goal=${JSON.stringify(input.workspace.goal)}`
    : "";
  const sourceParts: string[] = [];
  if (input.source) {
    const title = input.source.titleEn ?? input.source.title;
    if (title) sourceParts.push(`title=${JSON.stringify(title)}`);
    if (input.source.author) {
      sourceParts.push(`author=${JSON.stringify(input.source.author)}`);
    }
  }
  const sourceLine = sourceParts.length
    ? `<source ${sourceParts.join(" ")} />`
    : "";
  const sectionsLine = input.citedSections?.length
    ? `<cited_sections>${JSON.stringify(input.citedSections)}</cited_sections>`
    : "";
  const payload = [
    `<journal_entry workspace=${JSON.stringify(input.workspace.name)}${goal}>`,
    sourceLine,
    sectionsLine,
    `<question>\n${input.question}\n</question>`,
    `<answer>\n${input.answerMarkdown}\n</answer>`,
    "</journal_entry>",
  ]
    .filter((line) => line.length > 0)
    .join("\n\n");

  return [
    { type: "text", text: `${rules}\n\nSchema:\n${SCHEMA}` },
    {
      type: "text",
      text: payload,
      cache_control: { type: "ephemeral" },
    },
  ];
}

function stripCodeFence(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  return trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeTag(value: unknown): string | undefined {
  const raw = asString(value);
  if (!raw) return undefined;
  const cleaned = raw
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9çğıöşü\-]/gi, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
  if (!cleaned) return undefined;
  if (cleaned.length > 40) return cleaned.slice(0, 40);
  return cleaned;
}

function parseTags(value: unknown, max = 5): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    const tag = normalizeTag(item);
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
    if (out.length >= max) break;
  }
  return out;
}

const TITLE_TRAILING_PUNCT = /[.!?。！？]+$/u;

function normalizeTitle(value: unknown): string | undefined {
  const raw = asString(value);
  if (!raw) return undefined;
  const stripped = raw
    .replace(/^["'“”‘’`]+/, "")
    .replace(/["'“”‘’`]+$/, "")
    .replace(TITLE_TRAILING_PUNCT, "")
    .trim();
  if (!stripped) return undefined;
  return stripped.length > 120 ? `${stripped.slice(0, 117)}…` : stripped;
}

export function parseStudyJournalOutput(raw: string): ParsedStudyJournalMeta {
  const cleaned = stripCodeFence(raw);
  const firstBrace = cleaned.indexOf("{");
  if (firstBrace === -1) {
    throw new Error("study-journal: no JSON object found in response");
  }
  const jsonText = cleaned.slice(firstBrace);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    const lastBrace = jsonText.lastIndexOf("}");
    if (lastBrace === -1) {
      throw new Error("study-journal: response is not valid JSON");
    }
    parsed = JSON.parse(jsonText.slice(0, lastBrace + 1));
  }
  if (!isPlainObject(parsed)) {
    throw new Error("study-journal: response is not an object");
  }
  const title = normalizeTitle(parsed.title);
  if (!title) {
    throw new Error("study-journal: title is required");
  }
  const tags = parseTags(parsed.tags);
  const summaryMarkdown = asString(parsed.summaryMarkdown);
  const result: ParsedStudyJournalMeta = { title, tags };
  if (summaryMarkdown) result.summaryMarkdown = summaryMarkdown;
  return result;
}
