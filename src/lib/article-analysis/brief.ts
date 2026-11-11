import { z } from "zod";
import { extractFirstJsonObject } from "@/lib/roadmap/schema";
import { verifyQuote, type QuoteIndex } from "./citation-verify";
import type {
  AnalysisCitation,
  AnalysisClaim,
  ArticleAnalysisPayload,
} from "./types";
import type { ParseResult } from "./schema";

const QuoteSchema = z.object({ quote: z.string().min(8) });
const BlockSchema = z.object({
  kind: z.enum(["prose", "step", "result", "caution", "external"]),
  text: z.string().min(1),
  grounding: z.enum(["source", "interpretation", "external"]),
  title: z.string().optional(),
  why: z.string().optional(),
  metric: z.string().optional(),
  comparison: z.string().optional(),
  context: z.string().optional(),
  citations: z.array(QuoteSchema).optional(),
});
const BriefWireSchema = z.object({
  paperType: z.string().min(1),
  field: z.string().optional(),
  methodologyType: z.string().optional(),
  dataSample: z.string().optional(),
  thesis: BlockSchema,
  sections: z.array(z.object({
    kind: z.enum(["context", "method", "findings", "critical", "external"]),
    title: z.string().min(1),
    blocks: z.array(BlockSchema).min(1),
  })).min(1).max(8),
});
const BriefProgressSchema = BriefWireSchema.extend({
  sections: z.array(BriefWireSchema.shape.sections.element).max(8),
});
const SectionRewriteSchema = z.object({
  title: z.string().min(1),
  blocks: z.array(BlockSchema).min(1).max(12),
});

export type BriefBlock = Omit<z.infer<typeof BlockSchema>, "citations"> & {
  id: string;
  citations?: AnalysisCitation[];
  externalSources?: { title: string; url: string }[];
};
export type BriefSection = Omit<z.infer<typeof BriefWireSchema>["sections"][number], "blocks"> & {
  id: string;
  blocks: BriefBlock[];
};
export type ArticleBrief = {
  version: 2;
  paperType: string;
  field?: string | undefined;
  methodologyType?: string | undefined;
  dataSample?: string | undefined;
  thesis: BriefBlock;
  sections: BriefSection[];
  coverage: { includedChunks: number; omittedChunks: number };
};
export type BriefWire = z.infer<typeof BriefWireSchema>;
export type SectionRewriteWire = z.infer<typeof SectionRewriteSchema>;

function parseWithSchema<T>(raw: string, schema: z.ZodType<T>): ParseResult<T> {
  const slice = extractFirstJsonObject(raw);
  if (!slice) return { ok: false, reason: "no_json" };
  try {
    const result = schema.safeParse(JSON.parse(slice));
    return result.success
      ? { ok: true, value: result.data }
      : { ok: false, reason: "schema_failed", detail: result.error.issues[0]?.message ?? "schema_failed" };
  } catch {
    return { ok: false, reason: "no_json" };
  }
}

export function parseBrief(raw: string): ParseResult<BriefWire> {
  return parseWithSchema(raw, BriefWireSchema);
}

// The model writes one JSON document. Close its still-open sections array
// temporarily so a completed thesis or section can be shown before the final
// token arrives. A partial section is never surfaced.
export function parseBriefProgress(raw: string): ParseResult<BriefWire> {
  const marker = /"sections"\s*:\s*\[/.exec(raw);
  const start = raw.indexOf("{");
  if (!marker || start < 0) return { ok: false, reason: "no_json" };
  const arrayStart = marker.index + marker[0].length - 1;
  const sections: string[] = [];
  let objectStart = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = arrayStart + 1; i < raw.length; i += 1) {
    const char = raw[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') { inString = true; continue; }
    if (char === "{") {
      if (depth === 0) objectStart = i;
      depth += 1;
    } else if (char === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && objectStart >= 0) {
        sections.push(raw.slice(objectStart, i + 1));
        objectStart = -1;
      }
    } else if (char === "]" && depth === 0) {
      break;
    }
  }
  return parseWithSchema(`${raw.slice(start, arrayStart + 1)}${sections.join(",")}]}`, BriefProgressSchema);
}

// A transient UI preview of the string currently being written. It is never
// persisted or treated as a verified claim until the containing section closes.
export function streamingBriefText(raw: string): string | undefined {
  const match = /"text"\s*:\s*"((?:\\.|[^"\\])*)$/.exec(raw);
  if (!match?.[1]) return undefined;
  const completeEscapes = match[1].replace(/\\(?:u[0-9a-fA-F]{0,3})?$/, "");
  try {
    return JSON.parse(`"${completeEscapes}"`) as string;
  } catch {
    return undefined;
  }
}

export function parseSectionRewrite(raw: string): ParseResult<SectionRewriteWire> {
  return parseWithSchema(raw, SectionRewriteSchema);
}

export function materializeBrief(
  wire: BriefWire,
  index: QuoteIndex,
  coverage: ArticleBrief["coverage"],
): ArticleBrief {
  const block = (input: z.infer<typeof BlockSchema>, id: string): BriefBlock => {
    const { citations, ...rest } = input;
    return {
      ...rest,
      id,
      ...(citations ? {
        citations: citations.map(({ quote }) => ({
          quote,
          ...verifyQuote(quote, index),
        })),
      } : {}),
    };
  };
  return {
    version: 2,
    paperType: wire.paperType,
    ...(wire.field ? { field: wire.field } : {}),
    ...(wire.methodologyType ? { methodologyType: wire.methodologyType } : {}),
    ...(wire.dataSample ? { dataSample: wire.dataSample } : {}),
    thesis: block(wire.thesis, "thesis"),
    sections: wire.sections.map((section, i) => ({
      id: `${section.kind}-${i}`,
      kind: section.kind,
      title: section.title,
      blocks: section.blocks.map((item, j) => block(item, `${section.kind}-${i}-${j}`)),
    })),
    coverage,
  };
}

export function materializeSectionRewrite(
  wire: SectionRewriteWire,
  previous: BriefSection,
  index: QuoteIndex,
): BriefSection {
  const materialized = materializeBrief({
    paperType: "section",
    thesis: { kind: "prose", text: wire.title, grounding: "interpretation" },
    sections: [{ kind: previous.kind, title: wire.title, blocks: wire.blocks }],
  }, index, { includedChunks: 0, omittedChunks: 0 }).sections[0];
  if (!materialized) throw new Error("Section rewrite produced no section");
  return {
    ...materialized,
    id: previous.id,
    blocks: materialized.blocks.map((block, i) => ({ ...block, id: `${previous.id}-${i}` })),
  };
}

export function countUnmatchedSourceBlocks(brief: ArticleBrief): number {
  const blocks = [brief.thesis, ...brief.sections.flatMap((section) => section.blocks)];
  return blocks.filter((block) =>
    block.grounding === "source" &&
    !(block.citations ?? []).some((citation) => citation.verification === "exact" || citation.verification === "fuzzy"),
  ).length;
}

export function countTextWords(text: string): number {
  return text.trim().match(/\S+/g)?.length ?? 0;
}

export function countBriefWords(brief: ArticleBrief): number {
  return [brief.thesis, ...brief.sections.flatMap((section) => section.blocks)]
    .reduce((total, block) => total + countTextWords([
      block.text, block.why, block.metric, block.comparison, block.context,
    ].filter(Boolean).join(" ")), 0);
}

// A substantive paper needs a substantial reading guide. Very short sources
// are exempt so the model is never pushed to invent detail to fill a quota.
export function minimumBriefWords(sourceWords: number): number {
  return sourceWords < 500 ? 0 : Math.min(3_000, Math.round(sourceWords * 0.38));
}

export function hasSufficientBriefDepth(brief: ArticleBrief, sourceWords: number): boolean {
  if (sourceWords < 500) return true;
  const minimumSections = sourceWords >= 5_000 ? 5 : sourceWords >= 1_500 ? 4 : 3;
  const minimumBlocks = sourceWords >= 5_000 ? 14 : sourceWords >= 1_500 ? 9 : 5;
  return countBriefWords(brief) >= minimumBriefWords(sourceWords)
    && brief.sections.length >= minimumSections
    && brief.sections.reduce((sum, section) => sum + section.blocks.length, 0) >= minimumBlocks;
}

// Existing comparisons and PDF export still consume the old payload. This
// projection is deliberately sparse: it never fabricates a second narrative.
export function projectBriefToLegacy(brief: ArticleBrief): ArticleAnalysisPayload {
  const forKind = (kind: BriefSection["kind"]): BriefBlock[] =>
    brief.sections.filter((s) => s.kind === kind).flatMap((s) => s.blocks);
  const claim = (block: BriefBlock): AnalysisClaim => ({
    text: block.text,
    grounding: block.grounding === "source" ? "source" : "general",
    ...(block.citations ? { citations: block.citations } : {}),
  });
  const context = forKind("context");
  const method = forKind("method");
  const findings = forKind("findings");
  const critical = forKind("critical");
  return {
    tldr: brief.thesis.text,
    ataGlance: {
      paperType: brief.paperType,
      field: brief.field ?? "",
      purpose: context[0]?.text ?? "",
      headlineFinding: findings[0]?.text ?? "",
      ...(brief.methodologyType ? { methodologyType: brief.methodologyType } : {}),
      ...(brief.dataSample ? { dataSample: brief.dataSample } : {}),
    },
    fiveCs: { category: brief.paperType, context: "", correctness: "", contributions: "", clarity: "" },
    problemMotivation: context.slice(0, 1).map(claim),
    priorWorkGap: context.slice(1, 2).map(claim),
    contributions: context.slice(2).map(claim),
    keyIdea: "",
    methodWalkthrough: method.filter((b) => b.kind === "step" && !!b.why).map((b) => ({ step: b.text, why: b.why ?? "" })),
    howItSolves: method.map(claim),
    keyResults: findings.map(claim),
    critique: { soundness: "", novelty: "", significance: "", clarity: "", weakestLink: critical[0]?.text ?? "" },
    assumptionsLimitations: critical.map(claim),
    reproducibility: "",
    questionsToAsk: [],
    soWhat: "",
    whatToReadNext: [],
    glossary: [],
  };
}
