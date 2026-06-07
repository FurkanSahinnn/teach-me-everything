import type { SystemBlock } from "@/lib/ai/providers/types";
import {
  getNodeBudget,
  SUBTASK_NODE_BUDGET,
} from "@/lib/roadmap/token-budget";
import type {
  RoadmapLevel,
  RoadmapTimeframe,
} from "@/lib/roadmap/types";

// Locale switch is duplicated rather than templated to keep the rules
// readable — same convention as `flashcard-gen.ts` / `quiz-gen.ts`. The
// prompt language follows the UI locale; the model is free to write
// content in either language depending on the topic + sources.

export type RoadmapGenSystemInput = {
  topic: string;
  timeframe: RoadmapTimeframe;
  level: RoadmapLevel;
  goal?: string | undefined;
  // Free-form workspace context the caller chose to ground the roadmap in.
  // Typically a bulleted list of existing concept labels + short chunk
  // excerpts. Omitted when the user toggled "Use sources" off.
  sourceContext?: string | undefined;
  locale: "tr" | "en";
  // "en_terms_tr" mode: write explanations in `locale` (Turkish) but keep
  // technical terms in their original English form. Only meaningful with
  // locale === "tr".
  keepEnglishTerms?: boolean | undefined;
};

export type RoadmapSubtaskSystemInput = {
  parentTitle: string;
  parentDescription: string;
  roadmapTitle: string;
  roadmapTimeframe: RoadmapTimeframe;
  roadmapLevel: RoadmapLevel;
  locale: "tr" | "en";
  keepEnglishTerms?: boolean | undefined;
};

// One extra rule line appended when keepEnglishTerms is on. Kept here so both
// the roadmap + subtask prompts stay consistent.
const KEEP_EN_TERMS_RULE_TR =
  "- Teknik terimleri İngilizce orijinal haliyle bırak (örn. \"attention\", \"gradient descent\"); açıklamaları Türkçe yaz.";

const LEVEL_LABEL_TR: Record<RoadmapLevel, string> = {
  beginner: "başlangıç",
  intermediate: "orta",
  advanced: "ileri",
};

const LEVEL_LABEL_EN: Record<RoadmapLevel, string> = {
  beginner: "beginner",
  intermediate: "intermediate",
  advanced: "advanced",
};

const TIMEFRAME_LABEL_TR: Record<RoadmapTimeframe, string> = {
  daily: "günlük",
  weekly: "haftalık",
  monthly: "aylık",
};

const TIMEFRAME_LABEL_EN: Record<RoadmapTimeframe, string> = {
  daily: "daily",
  weekly: "weekly",
  monthly: "monthly",
};

// ---------------------------------------------------------------------------
// Schema block (shared TR/EN, since it's literal JSON)
// ---------------------------------------------------------------------------

const ROADMAP_SCHEMA_BLOCK = [
  "Schema:",
  "{",
  '  "title": "string",',
  '  "nodes": [',
  '    { "id": "n1", "title": "string", "description": "1-2 sentences" }',
  "  ],",
  '  "edges": [',
  '    { "from": "n1", "to": "n2" }',
  "  ]",
  "}",
].join("\n");

const SUBTASK_SCHEMA_BLOCK = [
  "Schema:",
  "{",
  '  "children": [',
  '    { "id": "c1", "title": "string", "description": "1-2 sentences" }',
  "  ],",
  '  "edges": [',
  '    { "from": "c1", "to": "c2" }',
  "  ]",
  "}",
].join("\n");

// ---------------------------------------------------------------------------
// Roadmap generation prompt
// ---------------------------------------------------------------------------

function rulesTr(input: RoadmapGenSystemInput): string {
  const { min, max } = getNodeBudget(input.timeframe);
  return [
    "Rol: Müfredat mimari bir öğretim asistanısın. Bir konu için prerequisite (önkoşul) DAG'i oluşturursun.",
    `Görev: ${TIMEFRAME_LABEL_TR[input.timeframe]} bir öğrenme yol haritası inşa et (${min}-${max} arası node).`,
    `Seviye: ${LEVEL_LABEL_TR[input.level]}.`,
    "İlkeler:",
    "- Her node tek bir öğrenme konusunu temsil eder.",
    '- Edge yönlüdür: A → B "B\'ye başlamadan önce A öğrenilmeli" demektir.',
    "- Döngü yok. Her non-root node en az bir edge ile başka bir node'a bağlanmalı.",
    "- Description: konunun ne kazandırdığını anlatan 1-2 cümle.",
    "- Node ID'leri sıralı: n1, n2, ..., nN.",
    ...(input.keepEnglishTerms ? [KEEP_EN_TERMS_RULE_TR] : []),
    '- Çıkış SADECE JSON. Markdown fence yok, ek açıklama yok.',
  ].join("\n");
}

function rulesEn(input: RoadmapGenSystemInput): string {
  const { min, max } = getNodeBudget(input.timeframe);
  return [
    "Role: You are a curriculum architect. Build a prerequisite DAG learning roadmap.",
    `Task: Produce a ${TIMEFRAME_LABEL_EN[input.timeframe]} roadmap (${min}-${max} nodes).`,
    `Level: ${LEVEL_LABEL_EN[input.level]}.`,
    "Principles:",
    "- Each node is a single learning topic.",
    '- Edges are directional: A → B means "learn A before B".',
    "- No cycles. Every non-root node must be referenced by at least one edge.",
    "- Description: 1-2 sentences on what the learner gains.",
    "- Node IDs sequential: n1, n2, ..., nN.",
    "- Output ONLY JSON. No markdown fences, no commentary.",
  ].join("\n");
}

export function buildRoadmapGenSystem(
  input: RoadmapGenSystemInput,
): SystemBlock[] {
  const rules = input.locale === "tr" ? rulesTr(input) : rulesEn(input);
  const blocks: SystemBlock[] = [
    { type: "text", text: `${rules}\n\n${ROADMAP_SCHEMA_BLOCK}` },
  ];
  if (input.sourceContext && input.sourceContext.trim().length > 0) {
    blocks.push({
      type: "text",
      text:
        input.locale === "tr"
          ? `Çalışma alanı bağlamı (önceden işlenmiş kaynaklardan):\n${input.sourceContext}`
          : `Workspace context (from previously processed sources):\n${input.sourceContext}`,
      // Workspace context is the largest part of the prompt and identical
      // across the wizard call + immediate "Re-generate" retry — caching
      // saves the second-call input cost.
      cache_control: { type: "ephemeral" },
    });
  }
  return blocks;
}

export function buildRoadmapGenUserMessage(input: RoadmapGenSystemInput): string {
  const goalLine = input.goal
    ? input.locale === "tr"
      ? `Hedef: ${input.goal}`
      : `Goal: ${input.goal}`
    : "";
  const lines =
    input.locale === "tr"
      ? [`Konu: ${input.topic}`, goalLine].filter(Boolean)
      : [`Topic: ${input.topic}`, goalLine].filter(Boolean);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Subtask expansion prompt
// ---------------------------------------------------------------------------

function subtaskRulesTr(input: RoadmapSubtaskSystemInput): string {
  return [
    "Rol: Bir öğrenme yol haritasında bir node'u alt konulara ayıran müfredat asistanısın.",
    `Görev: Verilen üst node'u ${SUBTASK_NODE_BUDGET.min}-${SUBTASK_NODE_BUDGET.max} adet alt-konuya böl.`,
    `Roadmap bağlamı: "${input.roadmapTitle}" — ${TIMEFRAME_LABEL_TR[input.roadmapTimeframe]} / ${LEVEL_LABEL_TR[input.roadmapLevel]}.`,
    "İlkeler:",
    "- Alt-konular birbiriyle ilişkili ve atomik olsun.",
    "- Aralarındaki edge'ler önkoşul yönlü (A → B = önce A).",
    "- Description: 1-2 cümle.",
    "- Child ID'ler: c1, c2, ..., cN.",
    ...(input.keepEnglishTerms ? [KEEP_EN_TERMS_RULE_TR] : []),
    "- Çıkış SADECE JSON. Markdown fence yok.",
  ].join("\n");
}

function subtaskRulesEn(input: RoadmapSubtaskSystemInput): string {
  return [
    "Role: You are a curriculum assistant that breaks a roadmap node into sub-topics.",
    `Task: Expand the given parent node into ${SUBTASK_NODE_BUDGET.min}-${SUBTASK_NODE_BUDGET.max} child topics.`,
    `Roadmap context: "${input.roadmapTitle}" — ${TIMEFRAME_LABEL_EN[input.roadmapTimeframe]} / ${LEVEL_LABEL_EN[input.roadmapLevel]}.`,
    "Principles:",
    "- Children are atomic and related.",
    "- Edges between them are prerequisite-directed (A → B = A first).",
    "- Description: 1-2 sentences.",
    "- Child IDs: c1, c2, ..., cN.",
    "- Output ONLY JSON. No markdown fences.",
  ].join("\n");
}

export function buildRoadmapSubtaskSystem(
  input: RoadmapSubtaskSystemInput,
): SystemBlock[] {
  const rules =
    input.locale === "tr" ? subtaskRulesTr(input) : subtaskRulesEn(input);
  return [{ type: "text", text: `${rules}\n\n${SUBTASK_SCHEMA_BLOCK}` }];
}

export function buildRoadmapSubtaskUserMessage(
  input: RoadmapSubtaskSystemInput,
): string {
  return input.locale === "tr"
    ? `Üst konu: ${input.parentTitle}\nAçıklama: ${input.parentDescription}`
    : `Parent topic: ${input.parentTitle}\nDescription: ${input.parentDescription}`;
}

// ---------------------------------------------------------------------------
// Translation pass (langMode "both")
// ---------------------------------------------------------------------------
// A single generation produces the canonical structure + text in one language;
// this pass translates the per-node title/description into the OTHER language
// while echoing each node id, so the structure (ids/edges) stays identical and
// the graph view can swap text without re-generating.

export type RoadmapTranslateItem = {
  id: string;
  title: string;
  description: string;
};

const TRANSLATE_SCHEMA_BLOCK = [
  "Schema:",
  "{",
  '  "items": [',
  '    { "id": "echo the input id", "title": "string", "description": "string" }',
  "  ]",
  "}",
].join("\n");

export function buildRoadmapTranslateSystem(
  target: "tr" | "en",
): SystemBlock[] {
  const rules =
    target === "en"
      ? [
          "Role: You translate learning-roadmap node titles and descriptions into English.",
          "Rules:",
          "- Translate every item; keep technical terms accurate and idiomatic.",
          "- Preserve each item's `id` EXACTLY as given — do not renumber.",
          "- Keep titles concise (close to the source length).",
          "- Output ONLY JSON. No markdown fences, no commentary.",
        ].join("\n")
      : [
          "Rol: Öğrenme yol haritası node başlıklarını ve açıklamalarını Türkçeye çevirirsin.",
          "Kurallar:",
          "- Her öğeyi çevir; teknik terimleri doğru ve akıcı kullan.",
          "- Her öğenin `id` değerini AYNEN koru — yeniden numaralandırma.",
          "- Başlıkları kısa tut (kaynak uzunluğuna yakın).",
          "- Çıkış SADECE JSON. Markdown fence yok, ek açıklama yok.",
        ].join("\n");
  return [{ type: "text", text: `${rules}\n\n${TRANSLATE_SCHEMA_BLOCK}` }];
}

export function buildRoadmapTranslateUserMessage(
  items: RoadmapTranslateItem[],
): string {
  return JSON.stringify({ items });
}
