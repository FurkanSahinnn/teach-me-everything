// Concept extraction for the Mind Map view (4.E). Walks the source's chunks
// and asks the model to surface the concepts + relations a learner would
// want to navigate. The prompt is deliberately schema-only (no tool calls)
// so the proxy + caching paths reuse the chat infrastructure.

import { KEEP_EN_TERMS_RULE_TR } from "@/lib/ai/content-language";
import type { SystemBlock } from "@/lib/ai/providers/types";
import type { ChunkRecord, SourceRecord } from "@/lib/db/types";
import type {
  ConceptEdgeKind,
  ConceptKind,
} from "@/lib/concepts/types";

export type ConceptExtractInput = {
  source: Pick<SourceRecord, "title" | "titleEn" | "author" | "type">;
  chunks: Pick<
    ChunkRecord,
    "id" | "index" | "section" | "headings" | "text" | "page"
  >[];
  locale: "tr" | "en";
  // Soft cap on concept output. Larger sources naturally produce more
  // concepts but the inspector becomes unusable past ~80; the prompt asks
  // the model to prioritise breadth + importance over completeness.
  maxConcepts?: number;
  // "en_terms_tr" mode: keep technical terms in their original English while
  // writing labels/definitions in Turkish. Only meaningful with a TR locale.
  keepEnglishTerms?: boolean;
};

export type RawConcept = {
  label: string;
  kind: ConceptKind;
  definition?: string;
  // Free-form chunk references the model emitted (e.g. "#3" or actual chunk
  // id). The runner resolves these against the chunk allowlist before
  // persisting; the parser does not validate.
  chunkRefs: string[];
};

export type RawEdge = {
  // `from`/`to` are the model's labels (NOT ids — those are minted after
  // dedupe). The runner maps them through the deduped concept map.
  from: string;
  to: string;
  kind: ConceptEdgeKind;
  evidence?: string[];
};

export type ConceptExtractResult = {
  concepts: RawConcept[];
  edges: RawEdge[];
};

const VALID_CONCEPT_KINDS: ReadonlySet<ConceptKind> = new Set([
  "concept",
  "term",
  "person",
  "place",
  "method",
  "event",
  "work",
]);

const VALID_EDGE_KINDS: ReadonlySet<ConceptEdgeKind> = new Set([
  "is-a",
  "part-of",
  "related",
  "depends-on",
]);

const DEFAULT_MAX_CONCEPTS = 40;

/**
 * Normalize a concept label for dedupe. Lowercase, strip punctuation, collapse
 * whitespace, NFKC-normalize so accented forms collide with their bare forms.
 * Pure + Unicode-aware so the test suite can pin behaviour without spinning
 * up the runner.
 */
export function normalizeConceptLabel(label: string): string {
  return label
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const RULES_TR = (max: number, keepEnglishTerms: boolean): string =>
  [
    "Rol: <source> kaynağındaki içerikten konsept grafiği üreten bir öğretim asistanısın.",
    `Görev: En önemli ${max} kavram ve aralarındaki ilişkileri çıkar.`,
    "İlkeler:",
    "- Önce kapsayıcı/genel kavramları, sonra önemli alt kavramları seç. Çok teknik ya da tekil terimleri atla.",
    "- `kind` alanı: 'concept' (soyut fikir), 'term' (resmi terim), 'person', 'place', 'method', 'event', 'work' (kitap/makale/eser).",
    "- `definition` opsiyonel ama önerilir — bir cümlede tanımla.",
    "- `chunkRefs` her zaman zorunlu: kavramın geçtiği chunk id'lerini (`#0`, `#3` gibi) listele. Boş liste verme.",
    "- Kenarlar (`edges`) yalnızca aynı listede yer alan kavramlar arasında olabilir.",
    "- Kenar `kind`: 'is-a' (taksonomi), 'part-of' (parça-bütün), 'related' (zayıf ilişki), 'depends-on' (önkoşul/nedensellik).",
    "- `evidence` opsiyonel; ilişkinin geçtiği chunk id'lerini ver.",
    "- Aynı kavramı tekrar etme; eş anlamlıları tek bir label altında topla.",
    "- Yalnızca <source> içeriğinden çıkar. Genel bilgiyle uydurma.",
    ...(keepEnglishTerms ? [KEEP_EN_TERMS_RULE_TR] : []),
    "",
    "Çıkış formatı: SADECE aşağıdaki JSON. Markdown kod fence'i kullanma, ek açıklama ekleme.",
  ].join("\n");

const RULES_EN = (max: number): string =>
  [
    "Role: You are a tutoring assistant that extracts a concept graph from <source>.",
    `Task: Surface the ${max} most important concepts and the relations between them.`,
    "Principles:",
    "- Pick umbrella/general concepts first, then key sub-concepts. Skip overly technical singletons.",
    "- `kind`: one of 'concept' (abstract idea), 'term' (formal vocabulary), 'person', 'place', 'method', 'event', 'work' (book/paper/artifact).",
    "- `definition` is optional but recommended — one sentence.",
    "- `chunkRefs` is REQUIRED — list the chunk ids (e.g. `#0`, `#3`) where the concept appears. Never empty.",
    "- Edges only between concepts present in the same list.",
    "- Edge `kind`: 'is-a' (taxonomy), 'part-of' (composition), 'related' (weak association), 'depends-on' (causal/prerequisite).",
    "- `evidence` optional — the chunk ids where the relation is supported.",
    "- Don't repeat concepts; merge synonyms under one label.",
    "- Ground every concept in <source>. No background-knowledge fabrication.",
    "",
    "Output format: ONLY the JSON below. No markdown fences, no commentary.",
  ].join("\n");

const SCHEMA_BLOCK_TR = [
  "Şema:",
  "{",
  '  "concepts": [',
  "    {",
  '      "label": "string (zorunlu)",',
  '      "kind": "concept | term | person | place | method | event | work",',
  '      "definition": "string",                  // opsiyonel',
  '      "chunkRefs": ["#0", "#3"]                // zorunlu, boş olmasın',
  "    }",
  "  ],",
  '  "edges": [',
  "    {",
  '      "from": "Kavram A",',
  '      "to": "Kavram B",',
  '      "kind": "is-a | part-of | related | depends-on",',
  '      "evidence": ["#3"]                       // opsiyonel',
  "    }",
  "  ]",
  "}",
].join("\n");

const SCHEMA_BLOCK_EN = [
  "Schema:",
  "{",
  '  "concepts": [',
  "    {",
  '      "label": "string (required)",',
  '      "kind": "concept | term | person | place | method | event | work",',
  '      "definition": "string",                  // optional',
  '      "chunkRefs": ["#0", "#3"]                // required, non-empty',
  "    }",
  "  ],",
  '  "edges": [',
  "    {",
  '      "from": "Concept A",',
  '      "to": "Concept B",',
  '      "kind": "is-a | part-of | related | depends-on",',
  '      "evidence": ["#3"]                       // optional',
  "    }",
  "  ]",
  "}",
].join("\n");

export function buildConceptExtractSystem(
  input: ConceptExtractInput,
): SystemBlock[] {
  const max = input.maxConcepts ?? DEFAULT_MAX_CONCEPTS;
  const rules =
    input.locale === "tr"
      ? RULES_TR(max, input.keepEnglishTerms ?? false)
      : RULES_EN(max);
  const schema = input.locale === "tr" ? SCHEMA_BLOCK_TR : SCHEMA_BLOCK_EN;
  const title = input.source.titleEn ?? input.source.title;
  const authorAttr = input.source.author
    ? ` author=${JSON.stringify(input.source.author)}`
    : "";
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
      // Same source payload across regenerate calls — caching saves cost on
      // re-runs.
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

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
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

function asConceptKind(value: unknown): ConceptKind {
  const s = asString(value);
  if (s && VALID_CONCEPT_KINDS.has(s as ConceptKind)) {
    return s as ConceptKind;
  }
  return "concept";
}

function asEdgeKind(value: unknown): ConceptEdgeKind | undefined {
  const s = asString(value);
  if (s && VALID_EDGE_KINDS.has(s as ConceptEdgeKind)) {
    return s as ConceptEdgeKind;
  }
  return undefined;
}

/**
 * Parse the model response into normalized concepts + edges. Tolerates the
 * same garbage shapes as quiz-gen (markdown fences, leading prose, trailing
 * chatter). Drops items that fail invariants — concept needs label + at
 * least one chunkRef; edge needs from/to/kind. Throws when no JSON object
 * found or both lists are empty.
 */
export function parseConceptExtractOutput(
  raw: string,
): ConceptExtractResult {
  const cleaned = stripCodeFence(raw);
  const firstBrace = cleaned.indexOf("{");
  if (firstBrace === -1) {
    throw new Error("concept-extract: no JSON object found in response");
  }
  const jsonText = cleaned.slice(firstBrace);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    const lastClose = jsonText.lastIndexOf("}");
    if (lastClose === -1) {
      throw new Error("concept-extract: response is not valid JSON");
    }
    parsed = JSON.parse(jsonText.slice(0, lastClose + 1));
  }
  if (!isPlainObject(parsed)) {
    throw new Error("concept-extract: response is not an object");
  }

  const conceptsRaw = Array.isArray(parsed.concepts) ? parsed.concepts : [];
  const edgesRaw = Array.isArray(parsed.edges) ? parsed.edges : [];

  const concepts: RawConcept[] = [];
  for (const item of conceptsRaw) {
    if (!isPlainObject(item)) continue;
    const label = asString(item.label);
    const chunkRefs = asStringArray(item.chunkRefs);
    if (!label || !chunkRefs || chunkRefs.length === 0) continue;
    const kind = asConceptKind(item.kind);
    const concept: RawConcept = { label, kind, chunkRefs };
    const definition = asString(item.definition);
    if (definition) concept.definition = definition;
    concepts.push(concept);
  }

  const edges: RawEdge[] = [];
  for (const item of edgesRaw) {
    if (!isPlainObject(item)) continue;
    const from = asString(item.from);
    const to = asString(item.to);
    const kind = asEdgeKind(item.kind);
    if (!from || !to || !kind) continue;
    if (normalizeConceptLabel(from) === normalizeConceptLabel(to)) continue;
    const edge: RawEdge = { from, to, kind };
    const evidence = asStringArray(item.evidence);
    if (evidence && evidence.length > 0) edge.evidence = evidence;
    edges.push(edge);
  }

  if (concepts.length === 0 && edges.length === 0) {
    throw new Error("concept-extract: no valid concepts or edges in response");
  }
  return { concepts, edges };
}
