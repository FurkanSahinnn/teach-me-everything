import type { SystemBlock } from "@/lib/ai/providers/types";
import type { ChunkRecord, SourceRecord, WorkspaceRecord } from "@/lib/db/types";
import type { CurriculumItemRecord, StudySourceRef } from "@/lib/study/types";

export type CurriculumPromptInput = {
  workspace: Pick<WorkspaceRecord, "name" | "goal">;
  sources: Array<
    Pick<SourceRecord, "id" | "title" | "titleEn" | "type" | "author"> & {
      chunks: Array<
        Pick<ChunkRecord, "id" | "index" | "section" | "headings" | "text" | "page">
      >;
    }
  >;
  locale: "tr" | "en";
  level?: string | undefined;
  maxItems?: number | undefined;
  sourceTextBudgetChars?: number | undefined;
  maxChunkTextChars?: number | undefined;
  draftItems?: ParsedCurriculumItem[] | undefined;
};

export type ParsedCurriculumItem = Pick<
  CurriculumItemRecord,
  | "order"
  | "title"
  | "objective"
  | "sourceRefs"
  | "prerequisites"
  | "status"
  | "estimatedMinutes"
> & {
  parentTitle?: string | undefined;
};

export type ParsedCurriculum = {
  title: string;
  goal?: string | undefined;
  level?: string | undefined;
  items: ParsedCurriculumItem[];
};

const DEFAULT_MAX_ITEMS = 10;
const DEFAULT_ESTIMATED_MINUTES = 45;
const SOURCE_TEXT_BUDGET_CHARS = 120_000;
const MAX_CHUNK_TEXT_CHARS = 4_000;
const TRUNCATION_MARKER = "\n[chunk text truncated for prompt budget]";

const RULES_EN = (maxItems: number): string =>
  [
    "Role: You are a study-planning tutor that turns a workspace source inventory into a grounded curriculum.",
    `Task: Refine the supplied draft into up to ${maxItems} ordered study topics that answer what the learner should study next.`,
    "Rules:",
    "- Use only the supplied <workspace_sources>; do not invent topics that are unsupported.",
    "- Prefer a practical sequence: foundations first, then dependent or applied topics.",
    "- Keep the draft grounded: rename, reorder, clarify objectives, prerequisites, and minutes; do not invent unsupported topics.",
    "- Each item must include `title`, `objective`, `sourceRefs`, and `estimatedMinutes`.",
    "- `sourceRefs` must reference the provided source ids. The app will preserve the original draft chunk ids.",
    "- `prerequisites` should list earlier topic titles, not vague concepts.",
    "- Output ONLY the JSON object below. No markdown fences, no commentary.",
  ].join("\n");

const RULES_TR = (maxItems: number): string =>
  [
    "Rol: Workspace kaynak envanterinden kaynaklara dayalı müfredat çıkaran bir çalışma planı öğretmenisin.",
    `Görev: Verilen taslağı, öğrencinin sırada ne çalışacağını gösterecek en fazla ${maxItems} sıralı konuya iyileştir.`,
    "Kurallar:",
    "- Yalnızca <workspace_sources> içeriğini kullan; kaynakta dayanağı olmayan konu uydurma.",
    "- Pratik bir sıra kur: önce temeller, sonra bağımlı/uygulamalı konular.",
    "- Taslağı kaynaklara bağlı tut: yeniden adlandır, sırala, objective/prerequisite/dakika alanlarını netleştir; desteksiz konu uydurma.",
    "- Her item `title`, `objective`, `sourceRefs` ve `estimatedMinutes` içermeli.",
    "- `sourceRefs` verilen source id'lerine referans vermeli. Uygulama orijinal taslak chunk id'lerini koruyacak.",
    "- `prerequisites` önceki konu başlıklarını listelemeli, belirsiz kavramları değil.",
    "- SADECE aşağıdaki JSON objesini üret. Markdown fence veya açıklama ekleme.",
  ].join("\n");

const SCHEMA = [
  "{",
  '  "title": "string",',
  '  "goal": "string",',
  '  "level": "beginner | intermediate | advanced | string",',
  '  "items": [',
  "    {",
  '      "title": "string",',
  '      "objective": "string",',
  '      "parentTitle": "string",',
  '      "sourceRefs": [{ "sourceId": "src_id", "chunkIds": ["ck_id"], "section": "string", "quote": "string" }],',
  '      "prerequisites": ["Earlier topic title"],',
  '      "estimatedMinutes": 45',
  "    }",
  "  ]",
  "}",
].join("\n");

function truncateChunkText(text: string, maxChars: number): string {
  if (maxChars <= 0) return "";
  if (text.length <= maxChars) return text;
  const hardLimit = Math.max(0, maxChars - TRUNCATION_MARKER.length);
  if (hardLimit === 0) return text.slice(0, maxChars);
  const slice = text.slice(0, hardLimit);
  const lastWhitespace = slice.search(/\s+\S*$/u);
  const cutAt = lastWhitespace > hardLimit * 0.75 ? lastWhitespace : hardLimit;
  return `${slice.slice(0, cutAt).trimEnd()}${TRUNCATION_MARKER}`;
}

function compactSourcesForPrompt(
  sources: CurriculumPromptInput["sources"],
  opts: {
    sourceTextBudgetChars: number;
    maxChunkTextChars: number;
  },
): CurriculumPromptInput["sources"] {
  if (sources.length === 0) return sources;

  let remainingBudget = opts.sourceTextBudgetChars;
  return sources.map((source, sourceIndex) => {
    const remainingSources = sources.length - sourceIndex;
    const sourceBudget = Math.floor(remainingBudget / remainingSources);
    let sourceRemaining = sourceBudget;
    const chunks = [];

    for (const chunk of source.chunks) {
      if (sourceRemaining <= 0) break;
      const textBudget = Math.min(sourceRemaining, opts.maxChunkTextChars);
      const text = truncateChunkText(chunk.text, textBudget);
      sourceRemaining -= text.length;
      chunks.push({ ...chunk, text });
    }

    remainingBudget -= sourceBudget - sourceRemaining;
    return { ...source, chunks };
  });
}

export function buildCurriculumSystem(input: CurriculumPromptInput): SystemBlock[] {
  const maxItems = input.maxItems ?? DEFAULT_MAX_ITEMS;
  const rules = input.locale === "tr" ? RULES_TR(maxItems) : RULES_EN(maxItems);
  const level = input.level ? ` level=${JSON.stringify(input.level)}` : "";
  const goal = input.workspace.goal ? ` goal=${JSON.stringify(input.workspace.goal)}` : "";
  const sourceBlocks = compactSourcesForPrompt(input.sources, {
    sourceTextBudgetChars:
      input.sourceTextBudgetChars ?? SOURCE_TEXT_BUDGET_CHARS,
    maxChunkTextChars: input.maxChunkTextChars ?? MAX_CHUNK_TEXT_CHARS,
  }).map((source) => {
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
    `<workspace_sources workspace=${JSON.stringify(input.workspace.name)}${goal}${level}>`,
    ...sourceBlocks,
    "</workspace_sources>",
  ].join("\n\n");
  const draftPayload =
    input.draftItems && input.draftItems.length > 0
      ? [
          "<draft_curriculum>",
          JSON.stringify(
            {
              items: input.draftItems.map((item, index) => ({
                draftIndex: index,
                title: item.title,
                objective: item.objective,
                sourceRefs: item.sourceRefs,
                prerequisites: item.prerequisites,
                estimatedMinutes: item.estimatedMinutes,
              })),
            },
            null,
            2,
          ),
          "</draft_curriculum>",
        ].join("\n")
      : undefined;

  return [
    { type: "text", text: `${rules}\n\nSchema:\n${SCHEMA}` },
    {
      type: "text",
      text: draftPayload ? `${payload}\n\n${draftPayload}` : payload,
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

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const str = asString(item);
    if (str) out.push(str);
  }
  return out;
}

function asPositiveMinutes(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_ESTIMATED_MINUTES;
  }
  return Math.max(5, Math.round(value));
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
    if (chunkIds.length > 0) ref.chunkIds = chunkIds;
    const section = asString(item.section);
    if (section) ref.section = section;
    const quote = asString(item.quote);
    if (quote) ref.quote = quote;
    refs.push(ref);
  }
  return refs;
}

export function parseCurriculumOutput(raw: string): ParsedCurriculum {
  const cleaned = stripCodeFence(raw);
  const firstBrace = cleaned.indexOf("{");
  if (firstBrace === -1) {
    throw new Error("curriculum: no JSON object found in response");
  }
  const jsonText = cleaned.slice(firstBrace);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    const lastBrace = jsonText.lastIndexOf("}");
    if (lastBrace === -1) {
      throw new Error("curriculum: response is not valid JSON");
    }
    parsed = JSON.parse(jsonText.slice(0, lastBrace + 1));
  }
  if (!isPlainObject(parsed)) {
    throw new Error("curriculum: response is not an object");
  }

  const title = asString(parsed.title) ?? "Study curriculum";
  const goal = asString(parsed.goal);
  const level = asString(parsed.level);
  const rawItems = Array.isArray(parsed.items) ? parsed.items : [];
  const items: ParsedCurriculumItem[] = [];
  for (const rawItem of rawItems) {
    if (!isPlainObject(rawItem)) continue;
    const itemTitle = asString(rawItem.title);
    const objective = asString(rawItem.objective);
    const sourceRefs = parseSourceRefs(rawItem.sourceRefs);
    if (!itemTitle || !objective || sourceRefs.length === 0) continue;
    const item: ParsedCurriculumItem = {
      order: items.length,
      title: itemTitle,
      objective,
      sourceRefs,
      prerequisites: asStringArray(rawItem.prerequisites),
      status: "not_started",
      estimatedMinutes: asPositiveMinutes(rawItem.estimatedMinutes),
    };
    const parentTitle = asString(rawItem.parentTitle);
    if (parentTitle) item.parentTitle = parentTitle;
    items.push(item);
  }

  if (items.length === 0) {
    throw new Error("curriculum: no valid curriculum items in response");
  }
  return { title, goal, level, items };
}
