import type { SystemBlock } from "@/lib/ai/providers/types";
import type { ChunkRecord, SourceRecord, WorkspaceRecord } from "@/lib/db/types";
import type { StudySourceRef } from "@/lib/study/types";

export type LessonNotePromptInput = {
  workspace: Pick<WorkspaceRecord, "name" | "goal">;
  item: {
    title: string;
    objective: string;
    sourceRefs: StudySourceRef[];
  };
  sources: Array<
    Pick<SourceRecord, "id" | "title" | "titleEn" | "type" | "author"> & {
      chunks: Array<
        Pick<ChunkRecord, "id" | "index" | "section" | "headings" | "text" | "page">
      >;
    }
  >;
  locale: "tr" | "en";
};

export type ParsedLessonNote = {
  title: string;
  contentMarkdown: string;
  sourceRefs: StudySourceRef[];
};

const RULES_EN = [
  "Role: You are a study-note tutor that writes a grounded Markdown lesson note for one curriculum topic.",
  "Task: Write a concise Markdown lesson note for the selected topic and objective.",
  "Rules:",
  "- Ground the note in <lesson_sources>; no unsupported claims.",
  "- Use headings, short paragraphs, examples, and a final recap.",
  "- Include inline citations using chunk ids in the form [§ck_id] whenever a claim depends on a source passage.",
  "- If you add background explanation beyond the sources, label it as model context.",
  "- Return ONLY the JSON object below. No markdown fences, no commentary.",
].join("\n");

const RULES_TR = [
  "Rol: Tek bir müfredat konusu için kaynaklara dayalı Markdown çalışma notu yazan bir öğretmensin.",
  "Görev: Seçili konu ve hedef için kısa, okunabilir bir Markdown ders notu yaz.",
  "Kurallar:",
  "- Notu <lesson_sources> içeriğine dayandır; desteksiz iddia ekleme.",
  "- Başlıklar, kısa paragraflar, örnekler ve final özet kullan.",
  "- Kaynak pasajına dayanan iddialarda [§ck_id] biçiminde chunk id citation kullan.",
  "- Kaynak dışı arka plan açıklaması eklersen bunu model bağlamı olarak etiketle.",
  "- SADECE aşağıdaki JSON objesini döndür. Markdown fence veya açıklama ekleme.",
].join("\n");

const SCHEMA = [
  "{",
  '  "title": "string",',
  '  "contentMarkdown": "string",',
  '  "sourceRefs": [{ "sourceId": "src_id", "chunkIds": ["ck_id"], "section": "string", "quote": "string" }]',
  "}",
].join("\n");

export function buildLessonNoteSystem(input: LessonNotePromptInput): SystemBlock[] {
  const rules = input.locale === "tr" ? RULES_TR : RULES_EN;
  const goal = input.workspace.goal ? ` goal=${JSON.stringify(input.workspace.goal)}` : "";
  const refs = input.item.sourceRefs
    .map((ref) => {
      const chunks = ref.chunkIds?.length ? ` chunks=${JSON.stringify(ref.chunkIds)}` : "";
      return `<ref source=${JSON.stringify(ref.sourceId)}${chunks} />`;
    })
    .join("\n");
  const sourceBlocks = input.sources.map((source) => {
    const author = source.author ? ` author=${JSON.stringify(source.author)}` : "";
    const chunks = source.chunks.map((chunk) => {
      const bits = [`#${chunk.index}`, `id=${chunk.id}`];
      if (chunk.section) bits.push(`section: ${chunk.section}`);
      else if (chunk.headings?.[0]) bits.push(`section: ${chunk.headings[0]}`);
      if (typeof chunk.page === "number") bits.push(`page: ${chunk.page}`);
      return `---chunk ${bits.join(" · ")}---\n${chunk.text}`;
    });
    return [
      `<source id=${JSON.stringify(source.id)} title=${JSON.stringify(source.titleEn ?? source.title)} type=${JSON.stringify(source.type)}${author}>`,
      ...chunks,
      "</source>",
    ].join("\n\n");
  });
  const payload = [
    `<lesson workspace=${JSON.stringify(input.workspace.name)}${goal} topic=${JSON.stringify(input.item.title)} objective=${JSON.stringify(input.item.objective)}>`,
    refs,
    ...sourceBlocks,
    "</lesson>",
  ].join("\n\n");

  return [
    { type: "text", text: `${rules}\n\nSchema:\n${SCHEMA}` },
    {
      type: "text",
      text: `<lesson_sources>\n${payload}\n</lesson_sources>`,
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

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: string[] = [];
  for (const item of value) {
    const str = asString(item);
    if (str) out.push(str);
  }
  return out.length > 0 ? out : undefined;
}

function parseSourceRefs(value: unknown): StudySourceRef[] {
  if (!Array.isArray(value)) return [];
  const refs: StudySourceRef[] = [];
  for (const item of value) {
    if (!isPlainObject(item)) continue;
    const sourceId = asString(item.sourceId);
    if (!sourceId) continue;
    const ref: StudySourceRef = { sourceId };
    const chunkIds = asStringArray(item.chunkIds);
    if (chunkIds) ref.chunkIds = chunkIds;
    const section = asString(item.section);
    if (section) ref.section = section;
    const quote = asString(item.quote);
    if (quote) ref.quote = quote;
    refs.push(ref);
  }
  return refs;
}

export function parseLessonNoteOutput(raw: string): ParsedLessonNote {
  const cleaned = stripCodeFence(raw);
  const firstBrace = cleaned.indexOf("{");
  if (firstBrace === -1) {
    throw new Error("lesson-note: no JSON object found in response");
  }
  const jsonText = cleaned.slice(firstBrace);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    const lastBrace = jsonText.lastIndexOf("}");
    if (lastBrace === -1) {
      throw new Error("lesson-note: response is not valid JSON");
    }
    parsed = JSON.parse(jsonText.slice(0, lastBrace + 1));
  }
  if (!isPlainObject(parsed)) {
    throw new Error("lesson-note: response is not an object");
  }
  const title = asString(parsed.title) ?? "Lesson note";
  const contentMarkdown = asString(parsed.contentMarkdown);
  if (!contentMarkdown) {
    throw new Error("lesson-note: contentMarkdown is required");
  }
  const sourceRefs = parseSourceRefs(parsed.sourceRefs);
  if (sourceRefs.length === 0) {
    throw new Error("lesson-note: at least one valid sourceRefs item is required");
  }
  return { title, contentMarkdown, sourceRefs };
}
