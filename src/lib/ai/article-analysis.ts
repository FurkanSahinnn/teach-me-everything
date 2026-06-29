import { resolveChatCredentialForPreset } from "@/lib/ai/anthropic-credential";
import { findChatOption } from "@/lib/ai/model-options";
import { computeCostUsd } from "@/lib/ai/pricing";
import {
  buildCritiqueSystem,
  buildGlossarySystem,
  buildMapSystem,
  buildReduceSystem,
  buildReflectionSystem,
  buildStageUserMessage,
  buildSynthesizeSystem,
} from "@/lib/ai/prompts/article-analysis";
import { getChatProvider } from "@/lib/ai/providers/registry";
import type {
  ChatRequest,
  ProviderId,
  SystemBlock,
  Usage,
} from "@/lib/ai/providers/types";
import {
  parseCritiqueStage,
  parseGlossaryStage,
  parseMapStage,
  parseReduceStage,
  parseReflectionStage,
  parseSynthesizeStage,
  type CritiqueStageOutput,
  type GlossaryStageOutput,
  type MapStageOutput,
  type ParseResult,
  type ReduceStageOutput,
  type ReflectionStageOutput,
  type SynthesizeStageOutput,
} from "@/lib/article-analysis/schema";
import {
  groupChunksIntoSections,
  groupToText,
} from "@/lib/article-analysis/token-budget";
import type {
  AnalysisCitation,
  AnalysisClaim,
  AnalysisTargetLang,
  AnalysisUsage,
  ArticleAnalysisPayload,
  AtAGlance,
  CritiqueBlock,
  FiveCs,
} from "@/lib/article-analysis/types";
import { listChunksBySource } from "@/lib/db/chunks";
import { getSource } from "@/lib/db/sources";
import type { ChunkRecord } from "@/lib/db/types";
import { clampToBudget } from "@/lib/ai/context/budget";

// Typed error for fatal pipeline failures. A SINGLE degraded stage never
// throws — it downgrades the result to status "draft" with a fallbackReason.
// Only the conditions below are unrecoverable.
export class ArticleAnalysisError extends Error {
  constructor(
    public readonly code:
      | "empty_source"
      | "no_credential"
      | "unknown_model"
      | "all_stages_failed"
      | "aborted",
    message: string,
  ) {
    super(message);
    this.name = "ArticleAnalysisError";
  }
}

// Internal marker for a stage whose stream/parse failed (non-fatal). Caught at
// the stage boundary and converted into a draft fallback. Never escapes.
class StageError extends Error {}

// Approx upper bound on the article text we window into each non-Map stage's
// cached block (~12k tokens). Long papers are clamped; the Map stage still
// covers the whole document group-by-group, so nothing is silently dropped
// from the understanding — Reduce / Critique / Glossary all lean on the section
// summaries for the tail they can't see verbatim.
const ARTICLE_WINDOW_TOKENS = 12_000;
// Default per-stage output cap. Lean stages (Map section summaries, Synthesize
// orientation, Reflection) fit comfortably here.
const STAGE_MAX_TOKENS = 4096;
// Larger cap for the JSON-heavy stages whose output realistically exceeds 4k
// tokens on a dense paper: Reduce (six claim arrays with verbatim citations),
// Critique (five prose axes + assumptions + reproducibility), and Glossary
// (20+ bilingual terms). A truncated buffer yields unbalanced braces → a draft
// with that whole section silently dropped, so these get the headroom.
const RICH_STAGE_MAX_TOKENS = 8192;

export type ArticleAnalysisStageEvent =
  | { stage: "map"; index: number; total: number }
  | { stage: "reduce" }
  | { stage: "specialists" }
  | { stage: "synthesize" }
  | { stage: "done" };

export type RunArticleAnalysisArgs = {
  workspaceId: string;
  sourceId: string;
  targetLang: AnalysisTargetLang;
  // Each value is a `provider::modelId` binding string (resolved via
  // findChatOption). extract → Map, synthesize → Reduce/Glossary/Reflection/
  // Synthesize, critique → the reviewer specialist.
  models: { extract: string; synthesize: string; critique: string };
  signal?: AbortSignal | undefined;
  onStage?: ((ev: ArticleAnalysisStageEvent) => void) | undefined;
};

export type RunArticleAnalysisResult = {
  payload: ArticleAnalysisPayload;
  usage: AnalysisUsage;
  status: "ready" | "draft";
  fallbackReason?: string | undefined;
};

// A model binding resolved once up front: upstream model id + the credential
// for its preset. Credentials are cached by preset so models sharing a preset
// (the common case — all three on Anthropic) resolve the key only once.
type ResolvedModel = {
  presetId: ProviderId;
  modelId: string;
  apiKey: string;
  authKind?: "oauth" | "api-key" | undefined;
};

function mergeUsage(a: Usage, b: Usage): Usage {
  return {
    input_tokens: (a.input_tokens ?? 0) + (b.input_tokens ?? 0),
    output_tokens: (a.output_tokens ?? 0) + (b.output_tokens ?? 0),
    cache_read_input_tokens:
      (a.cache_read_input_tokens ?? 0) + (b.cache_read_input_tokens ?? 0),
    cache_creation_input_tokens:
      (a.cache_creation_input_tokens ?? 0) +
      (b.cache_creation_input_tokens ?? 0),
  };
}

// Shared stream consumer — mirrors roadmap-gen's drainStream. Abort surfaces
// as the fatal ArticleAnalysisError("aborted"); any other stream failure is a
// plain Error the stage wrapper converts into a StageError (non-fatal).
async function drainStream(
  handle: ReturnType<ReturnType<typeof getChatProvider>["streamChat"]>,
  fallbackModel: string,
): Promise<{
  buffer: string;
  model: string;
  usage: Usage;
  stopReason: string | null;
}> {
  let buffer = "";
  let model = fallbackModel;
  let usage: Usage = {};
  let stopReason: string | null = null;
  try {
    for await (const event of handle.events) {
      if (event.kind === "text") {
        buffer += event.delta;
      } else if (event.kind === "start") {
        model = event.model || model;
        usage = event.usage ?? usage;
      } else if (event.kind === "delta") {
        usage = { ...usage, ...event.usage };
        stopReason = event.stopReason ?? stopReason;
      } else if (event.kind === "error") {
        throw new Error(`Provider error ${event.status}: ${event.message}`);
      } else if (event.kind === "abort") {
        throw new ArticleAnalysisError("aborted", "Analysis aborted");
      }
    }
  } catch (err) {
    if (err instanceof ArticleAnalysisError) throw err;
    throw err instanceof Error ? err : new Error(String(err));
  }
  return { buffer, model, usage, stopReason };
}

// Re-throw only the fatal abort; everything else is a recoverable stage failure.
function rethrowIfFatal(err: unknown): void {
  if (err instanceof ArticleAnalysisError) throw err;
}

// A short, safe reason for a recoverable stage failure (StageError parse
// reason/detail, or a provider status). NOT user content — safe to surface in
// fallbackReason so a draft is diagnosable (schema-malformed vs rate-limit vs
// truncated) instead of leaving only the bare stage name.
function stageFailureDetail(err: unknown): string {
  const msg = err instanceof Error ? err.message.trim() : String(err).trim();
  return msg.length > 0 ? msg : "unknown error";
}

async function resolveModels(models: {
  extract: string;
  synthesize: string;
  critique: string;
}): Promise<{
  extract: ResolvedModel;
  synthesize: ResolvedModel;
  critique: ResolvedModel;
}> {
  const credCache = new Map<
    string,
    { apiKey: string; authKind?: "oauth" | "api-key" | undefined }
  >();
  const resolveOne = async (binding: string): Promise<ResolvedModel> => {
    const option = findChatOption(binding);
    if (!option) {
      throw new ArticleAnalysisError(
        "unknown_model",
        `Model not in registry: ${binding}`,
      );
    }
    let cred = credCache.get(option.presetId);
    if (!cred) {
      const resolved = await resolveChatCredentialForPreset(option.presetId);
      if (!resolved) {
        throw new ArticleAnalysisError(
          "no_credential",
          `No credential on file for provider: ${option.presetId}`,
        );
      }
      cred = resolved;
      credCache.set(option.presetId, cred);
    }
    return {
      presetId: option.presetId,
      modelId: option.modelId,
      apiKey: cred.apiKey,
      ...(cred.authKind ? { authKind: cred.authKind } : {}),
    };
  };
  const [extract, synthesize, critique] = await Promise.all([
    resolveOne(models.extract),
    resolveOne(models.synthesize),
    resolveOne(models.critique),
  ]);
  return { extract, synthesize, critique };
}

// One stage call: build request, drain, parse. Throws StageError on parse
// failure and the fatal ArticleAnalysisError on abort. Returns the parsed
// value plus the usage/model so the caller can accrue cost.
async function callStage<T>(
  model: ResolvedModel,
  system: SystemBlock[],
  userText: string,
  parse: (raw: string) => ParseResult<T>,
  signal: AbortSignal | undefined,
  maxTokens: number = STAGE_MAX_TOKENS,
): Promise<{ value: T; usage: Usage; model: string }> {
  const provider = getChatProvider(model.presetId, {
    ...(model.authKind ? { authKind: model.authKind } : {}),
  });
  const request: ChatRequest = {
    apiKey: model.apiKey,
    ...(model.authKind ? { authKind: model.authKind } : {}),
    model: model.modelId,
    system,
    messages: [{ role: "user", content: userText }],
    maxTokens,
    ...(signal ? { signal } : {}),
  };
  const drained = await drainStream(provider.streamChat(request), model.modelId);
  const parsed = parse(drained.buffer);
  if (!parsed.ok) {
    // A buffer cut off at the output cap yields unbalanced braces → "no_json".
    // Surface that as a distinct, diagnosable reason instead of looking like
    // malformed model output, so the draft cause is clear in fallbackReason.
    const truncated = drained.stopReason === "max_tokens";
    throw new StageError(
      truncated
        ? "output truncated (max_tokens)"
        : `${parsed.reason}${parsed.detail ? `: ${parsed.detail}` : ""}`,
    );
  }
  return { value: parsed.value, usage: drained.usage, model: drained.model };
}

// ---- citation resolution ---------------------------------------------------

function normalizeText(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

// Best-effort: find the chunk whose text verbatim-contains the quote. Uses a
// leading probe (quotes can be lightly reflowed) and skips very short quotes
// that would match almost anything. Returns undefined when unmatched — the
// citation still renders, just without a jump target.
function findChunkIdForQuote(
  quote: string,
  chunks: ChunkRecord[],
): string | undefined {
  const q = normalizeText(quote);
  if (q.length < 12) return undefined;
  const probe = q.slice(0, Math.min(q.length, 60));
  for (const chunk of chunks) {
    if (normalizeText(chunk.text).includes(probe)) return chunk.id;
  }
  return undefined;
}

function resolveCitations(
  citations: { quote: string; page?: number | undefined }[] | undefined,
  chunks: ChunkRecord[],
): AnalysisCitation[] | undefined {
  if (!citations || citations.length === 0) return undefined;
  return citations.map((c) => {
    const chunkId = findChunkIdForQuote(c.quote, chunks);
    return {
      quote: c.quote,
      ...(chunkId ? { chunkId } : {}),
      ...(c.page !== undefined ? { page: c.page } : {}),
    };
  });
}

function mapClaim(
  claim: {
    text: string;
    grounding: "source" | "general";
    citations?: { quote: string; page?: number | undefined }[] | undefined;
  },
  chunks: ChunkRecord[],
): AnalysisClaim {
  const citations = resolveCitations(claim.citations, chunks);
  return {
    text: claim.text,
    grounding: claim.grounding,
    ...(citations ? { citations } : {}),
  };
}

function mapClaims(
  claims: {
    text: string;
    grounding: "source" | "general";
    citations?: { quote: string; page?: number | undefined }[] | undefined;
  }[],
  chunks: ChunkRecord[],
): AnalysisClaim[] {
  return claims.map((c) => mapClaim(c, chunks));
}

// ---- empty defaults for degraded sections ----------------------------------

const EMPTY_AT_A_GLANCE: AtAGlance = {
  paperType: "",
  field: "",
  purpose: "",
  headlineFinding: "",
};

const EMPTY_FIVE_CS: FiveCs = {
  category: "",
  context: "",
  correctness: "",
  contributions: "",
  clarity: "",
};

const EMPTY_CRITIQUE: CritiqueBlock = {
  soundness: "",
  novelty: "",
  significance: "",
  clarity: "",
  weakestLink: "",
};

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export async function runArticleAnalysis(
  args: RunArticleAnalysisArgs,
): Promise<RunArticleAnalysisResult> {
  const { sourceId, targetLang, signal, onStage } = args;
  if (signal?.aborted) {
    throw new ArticleAnalysisError("aborted", "Analysis aborted before start");
  }

  // ---- Stage 0 — load + resolve ------------------------------------------
  const [source, chunks] = await Promise.all([
    getSource(sourceId),
    listChunksBySource(sourceId),
  ]);
  if (!source || chunks.length === 0) {
    throw new ArticleAnalysisError(
      "empty_source",
      "Source has no chunks to analyze",
    );
  }
  const models = await resolveModels(args.models);

  const fullArticleText = clampToBudget(
    chunks.map((c) => c.text).join("\n\n"),
    ARTICLE_WINDOW_TOKENS,
  );
  const userText = buildStageUserMessage(targetLang);

  let usage: Usage = {};
  let costUsd = 0;
  const failedStages: string[] = [];
  // Accrue usage + per-call cost (each stage may run a different model).
  const accrue = (out: { usage: Usage; model: string }): void => {
    usage = mergeUsage(usage, out.usage);
    costUsd += computeCostUsd(out.model, out.usage);
  };

  // ---- Stage 1 — MAP (parallel over section groups) ----------------------
  const groups = groupChunksIntoSections(chunks);
  const mapSettled = await Promise.allSettled(
    groups.map(async (group, index) => {
      const out = await callStage(
        models.extract,
        buildMapSystem({
          articleText: groupToText(group),
          targetLang,
          ...(group.sectionTitle ? { sectionTitle: group.sectionTitle } : {}),
        }),
        userText,
        parseMapStage,
        signal,
      );
      onStage?.({ stage: "map", index, total: groups.length });
      return out;
    }),
  );
  const sectionSummaries: MapStageOutput[] = [];
  let mapFailures = 0;
  for (const r of mapSettled) {
    if (r.status === "fulfilled") {
      sectionSummaries.push(r.value.value);
      accrue(r.value);
    } else {
      rethrowIfFatal(r.reason);
      mapFailures += 1;
    }
  }
  if (mapFailures > 0) {
    failedStages.push(`map (${mapFailures}/${groups.length} sections)`);
  }

  // ---- Stage 2 — REDUCE (sequential) -------------------------------------
  onStage?.({ stage: "reduce" });
  let understanding: ReduceStageOutput | undefined;
  try {
    const out = await callStage(
      models.synthesize,
      buildReduceSystem({ articleText: fullArticleText, targetLang, sectionSummaries }),
      userText,
      parseReduceStage,
      signal,
      RICH_STAGE_MAX_TOKENS,
    );
    understanding = out.value;
    accrue(out);
  } catch (err) {
    rethrowIfFatal(err);
    failedStages.push(`reduce (${stageFailureDetail(err)})`);
  }

  // ---- Stage 3 — specialists (parallel) ----------------------------------
  onStage?.({ stage: "specialists" });
  const [critiqueSettled, glossarySettled, reflectionSettled] =
    await Promise.allSettled([
      callStage<CritiqueStageOutput>(
        models.critique,
        buildCritiqueSystem({
          articleText: fullArticleText,
          targetLang,
          sectionSummaries,
        }),
        userText,
        parseCritiqueStage,
        signal,
        RICH_STAGE_MAX_TOKENS,
      ),
      callStage<GlossaryStageOutput>(
        models.synthesize,
        buildGlossarySystem({
          articleText: fullArticleText,
          targetLang,
          sectionSummaries,
        }),
        userText,
        parseGlossaryStage,
        signal,
        RICH_STAGE_MAX_TOKENS,
      ),
      callStage<ReflectionStageOutput>(
        models.synthesize,
        buildReflectionSystem({
          articleText: fullArticleText,
          targetLang,
          ...(understanding ? { understanding } : {}),
        }),
        userText,
        parseReflectionStage,
        signal,
      ),
    ]);

  let critique: CritiqueStageOutput | undefined;
  if (critiqueSettled.status === "fulfilled") {
    critique = critiqueSettled.value.value;
    accrue(critiqueSettled.value);
  } else {
    rethrowIfFatal(critiqueSettled.reason);
    failedStages.push(`critique (${stageFailureDetail(critiqueSettled.reason)})`);
  }

  let glossary: GlossaryStageOutput | undefined;
  if (glossarySettled.status === "fulfilled") {
    glossary = glossarySettled.value.value;
    accrue(glossarySettled.value);
  } else {
    rethrowIfFatal(glossarySettled.reason);
    failedStages.push(`glossary (${stageFailureDetail(glossarySettled.reason)})`);
  }

  let reflection: ReflectionStageOutput | undefined;
  if (reflectionSettled.status === "fulfilled") {
    reflection = reflectionSettled.value.value;
    accrue(reflectionSettled.value);
  } else {
    rethrowIfFatal(reflectionSettled.reason);
    failedStages.push(
      `reflection (${stageFailureDetail(reflectionSettled.reason)})`,
    );
  }

  // ---- Stage 4 — SYNTHESIZE orientation (sequential) ---------------------
  onStage?.({ stage: "synthesize" });
  let orientation: SynthesizeStageOutput | undefined;
  try {
    const out = await callStage(
      models.synthesize,
      buildSynthesizeSystem({
        articleText: fullArticleText,
        targetLang,
        ...(understanding ? { understanding } : {}),
        ...(critique ? { critique } : {}),
        ...(reflection ? { reflection } : {}),
      }),
      userText,
      parseSynthesizeStage,
      signal,
    );
    orientation = out.value;
    accrue(out);
  } catch (err) {
    rethrowIfFatal(err);
    failedStages.push(`synthesize (${stageFailureDetail(err)})`);
  }

  // Nothing usable reached the user-visible payload — fatal. Map output
  // (sectionSummaries) is intermediate prompt context only: it never feeds the
  // payload directly, so a run where every Map call succeeds but Reduce + all
  // specialists + Synthesize fail would otherwise become an empty 'draft'. Gate
  // strictly on the stages that DO populate the payload.
  const anySuccess =
    understanding !== undefined ||
    critique !== undefined ||
    glossary !== undefined ||
    reflection !== undefined ||
    orientation !== undefined;
  if (!anySuccess) {
    throw new ArticleAnalysisError(
      "all_stages_failed",
      "Every pipeline stage failed to produce a usable result",
    );
  }

  // ---- Assemble payload in code ------------------------------------------
  const payload: ArticleAnalysisPayload = {
    tldr: orientation?.tldr ?? "",
    ataGlance: orientation?.ataGlance ?? EMPTY_AT_A_GLANCE,
    fiveCs: orientation?.fiveCs ?? EMPTY_FIVE_CS,
    problemMotivation: understanding
      ? mapClaims(understanding.problemMotivation, chunks)
      : [],
    priorWorkGap: understanding
      ? mapClaims(understanding.priorWorkGap, chunks)
      : [],
    contributions: understanding
      ? mapClaims(understanding.contributions, chunks)
      : [],
    keyIdea: orientation?.keyIdea ?? "",
    methodWalkthrough: understanding?.methodWalkthrough ?? [],
    howItSolves: understanding
      ? mapClaims(understanding.howItSolves, chunks)
      : [],
    keyResults: understanding ? mapClaims(understanding.keyResults, chunks) : [],
    critique: critique?.critique ?? EMPTY_CRITIQUE,
    assumptionsLimitations: critique
      ? mapClaims(critique.assumptionsLimitations, chunks)
      : [],
    reproducibility: critique?.reproducibility ?? "",
    questionsToAsk: reflection?.questionsToAsk ?? [],
    soWhat: reflection?.soWhat ?? "",
    whatToReadNext: reflection?.whatToReadNext ?? [],
    glossary: glossary?.glossary ?? [],
  };

  onStage?.({ stage: "done" });

  const analysisUsage: AnalysisUsage = {
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    ...(usage.cache_read_input_tokens !== undefined
      ? { cacheReadTokens: usage.cache_read_input_tokens }
      : {}),
    ...(usage.cache_creation_input_tokens !== undefined
      ? { cacheCreationTokens: usage.cache_creation_input_tokens }
      : {}),
    costUsd,
  };

  const status: "ready" | "draft" =
    failedStages.length > 0 ? "draft" : "ready";
  return {
    payload,
    usage: analysisUsage,
    status,
    ...(failedStages.length > 0
      ? { fallbackReason: failedStages.join(", ") }
      : {}),
  };
}
