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
  isRetryableStreamError,
  mapWithConcurrency,
  ProviderStreamError,
  runWithRetry,
} from "@/lib/ai/stage-runner";
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
  buildArticleWindow,
  groupChunksIntoSections,
  groupToText,
} from "@/lib/article-analysis/token-budget";
import {
  buildQuoteIndex,
  verifyQuote,
  type QuoteIndex,
} from "@/lib/article-analysis/citation-verify";
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

// Default per-stage output cap. Lean stages (Map section summaries, Synthesize
// orientation, Reflection) fit comfortably here.
const STAGE_MAX_TOKENS = 4096;
// Larger cap for the JSON-heavy stages whose output realistically exceeds 4k
// tokens on a dense paper: Reduce (six claim arrays with verbatim citations),
// Critique (five prose axes + assumptions + reproducibility), and Glossary
// (20+ bilingual terms). A truncated buffer yields unbalanced braces → a draft
// with that whole section silently dropped, so these get the headroom.
const RICH_STAGE_MAX_TOKENS = 8192;

// The Map stage used to launch every section call at once. On a paper that
// groups into a dozen sections that burst is exactly what trips a provider's
// per-minute request/token limit, and a single shed call downgraded the whole
// run to "draft". Sections are independent and each is small, so capping the
// in-flight width spreads token consumption over time at the cost of a few
// extra seconds on a pipeline that already runs for minutes.
export const MAP_CONCURRENCY = 3;

// Several Map sections failing at once nearly always share ONE cause (the same
// shed burst, the same schema slip). Repeating it once per section would bury
// the signal in the fallbackReason, so distinct reasons are collapsed and the
// list is capped.
const MAX_REPORTED_MAP_REASONS = 2;

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
        throw new ProviderStreamError(event.status, event.message);
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

// Collapse the per-section reasons of a fan-out failure into one short clause.
function summarizeReasons(reasons: readonly string[]): string {
  const distinct = [...new Set(reasons)];
  const shown = distinct.slice(0, MAX_REPORTED_MAP_REASONS).join("; ");
  const rest = distinct.length - MAX_REPORTED_MAP_REASONS;
  return rest > 0 ? `${shown}; +${rest} more` : shown;
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

// Every citation is checked against the real chunk text and carries the verdict
// (exact / fuzzy / unverified) into the payload, so the UI can distinguish a
// quote the paper actually contains from one the model manufactured. The index
// is built once per run and threaded through — see `citation-verify`.
function resolveCitations(
  citations: { quote: string; page?: number | undefined }[] | undefined,
  index: QuoteIndex,
): AnalysisCitation[] | undefined {
  if (!citations || citations.length === 0) return undefined;
  return citations.map((c) => {
    const match = verifyQuote(c.quote, index);
    return {
      quote: c.quote,
      verification: match.verification,
      ...(match.chunkId ? { chunkId: match.chunkId } : {}),
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
  index: QuoteIndex,
): AnalysisClaim {
  const citations = resolveCitations(claim.citations, index);
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
  index: QuoteIndex,
): AnalysisClaim[] {
  return claims.map((c) => mapClaim(c, index));
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

  // Shared, cached article window for every non-Map stage. Chunk-aligned and
  // head+tail on overflow, so the paper's conclusions and limitations reach the
  // reviewer even on a long document (see buildArticleWindow).
  const articleWindow = buildArticleWindow(chunks);
  const fullArticleText = articleWindow.text;
  // Verification index over the WHOLE document, not just the window — a quote
  // pulled by the Map stage from an elided section is still a real quote and
  // must verify.
  const quoteIndex = buildQuoteIndex(chunks);
  const userText = buildStageUserMessage(targetLang);

  let usage: Usage = {};
  let costUsd = 0;
  const failedStages: string[] = [];
  // Accrue usage + per-call cost (each stage may run a different model).
  const accrue = (out: { usage: Usage; model: string }): void => {
    usage = mergeUsage(usage, out.usage);
    costUsd += computeCostUsd(out.model, out.usage);
  };

  // ---- Stage 1 — MAP (bounded-width fan-out over section groups) ---------
  const groups = groupChunksIntoSections(chunks);
  // Counts SETTLED sections, not the group index, so the progress the UI shows
  // advances monotonically instead of jumping around with completion order.
  let mapSettledCount = 0;
  const mapSettled = await mapWithConcurrency(
    groups,
    MAP_CONCURRENCY,
    async (group) => {
      // Queued sections must not start a call after the user cancelled. This
      // is also what makes `runWithRetry` abort-safe: it cuts its backoff short
      // and re-enters here, where the fatal error is thrown.
      if (signal?.aborted) {
        throw new ArticleAnalysisError("aborted", "Analysis aborted");
      }
      try {
        return await runWithRetry(
          () =>
            callStage(
              models.extract,
              buildMapSystem({
                articleText: groupToText(group),
                targetLang,
                ...(group.sectionTitle
                  ? { sectionTitle: group.sectionTitle }
                  : {}),
              }),
              userText,
              parseMapStage,
              signal,
            ),
          { isRetryable: isRetryableStreamError, ...(signal ? { signal } : {}) },
        );
      } finally {
        mapSettledCount += 1;
        onStage?.({
          stage: "map",
          index: mapSettledCount - 1,
          total: groups.length,
        });
      }
    },
  );
  const sectionSummaries: MapStageOutput[] = [];
  const mapFailureReasons: string[] = [];
  for (const r of mapSettled) {
    if (r.status === "fulfilled") {
      sectionSummaries.push(r.value.value);
      accrue(r.value);
    } else {
      rethrowIfFatal(r.reason);
      mapFailureReasons.push(stageFailureDetail(r.reason));
    }
  }
  if (mapFailureReasons.length > 0) {
    // Spelled out rather than "map (1/11 sections)", which read as "1 of 11
    // done" when it always meant "1 of 11 failed".
    failedStages.push(
      `map (${mapFailureReasons.length} of ${groups.length} sections failed: ${summarizeReasons(mapFailureReasons)})`,
    );
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
      ? mapClaims(understanding.problemMotivation, quoteIndex)
      : [],
    priorWorkGap: understanding
      ? mapClaims(understanding.priorWorkGap, quoteIndex)
      : [],
    contributions: understanding
      ? mapClaims(understanding.contributions, quoteIndex)
      : [],
    keyIdea: orientation?.keyIdea ?? "",
    methodWalkthrough: understanding?.methodWalkthrough ?? [],
    howItSolves: understanding
      ? mapClaims(understanding.howItSolves, quoteIndex)
      : [],
    keyResults: understanding ? mapClaims(understanding.keyResults, quoteIndex) : [],
    critique: critique?.critique ?? EMPTY_CRITIQUE,
    assumptionsLimitations: critique
      ? mapClaims(critique.assumptionsLimitations, quoteIndex)
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
