import { computeCostUsd } from "@/lib/ai/pricing";
import {
  buildContradictionSystem,
  buildCrossStageUserMessage,
  buildSynthesisSystem,
} from "@/lib/ai/prompts/cross-analysis";
import {
  callStage,
  mergeUsage,
  resolveModelBindings,
  stageFailureDetail,
  StageAbortError,
  StageBindingError,
  type ResolvedModel,
} from "@/lib/ai/stage-runner";
import type { Usage } from "@/lib/ai/providers/types";
import {
  buildClaimTable,
  groundContradictions,
  renderClaimTable,
} from "@/lib/cross-analysis/refs";
import { buildComparisonMatrix } from "@/lib/cross-analysis/matrix";
import {
  parseContradictionStage,
  parseSynthesisStage,
  type ContradictionStageOutput,
  type SynthesisStageOutput,
} from "@/lib/cross-analysis/schema";
import {
  MAX_COMPARE_PAPERS,
  MIN_COMPARE_PAPERS,
  type AnalysisTargetLang,
  type AnalysisUsage,
  type ComparedPaper,
  type Contradiction,
  type CrossAnalysisPayload,
  type ReadingStep,
} from "@/lib/cross-analysis/types";
import type { ArticleAnalysisPayload } from "@/lib/article-analysis/types";
import { getAnalysis } from "@/lib/db/article-analyses";

// Cross-Analysis orchestrator — compares N already-analyzed papers.
//
// Runs over persisted `ArticleAnalysisPayload` rows, never the PDFs. Two AI
// stages fan out in parallel over ONE shared, cached claim table; the matrix is
// built in code beforehand and needs neither.
//
// Degradation follows the Phase 4.5.H draft-first rule: a failed stage never
// throws. Because the matrix is free and always present, a run whose every AI
// stage fails still returns a usable comparison as `draft`.

export class CrossAnalysisError extends Error {
  constructor(
    public readonly code:
      | "too_few_papers"
      | "too_many_papers"
      | "missing_payload"
      | "no_credential"
      | "unknown_model"
      | "aborted",
    message: string,
  ) {
    super(message);
    this.name = "CrossAnalysisError";
  }
}

// Contradiction output is a compact ref list; synthesis is prose-heavy across
// up to four papers and needs the headroom (a truncated buffer becomes an
// unparseable draft).
const CONTRADICTION_MAX_TOKENS = 4096;
const SYNTHESIS_MAX_TOKENS = 8192;

export type CrossAnalysisStageEvent =
  | { stage: "matrix" }
  | { stage: "compare" }
  | { stage: "done" };

export type RunCrossAnalysisArgs = {
  workspaceId: string;
  // Order is authoritative — it defines paperIndex everywhere downstream.
  analysisIds: string[];
  targetLang: AnalysisTargetLang;
  // Reuses the existing analysis bindings; see CrossAnalysisModelSnapshot.
  models: { critique: string; synthesize: string };
  signal?: AbortSignal | undefined;
  onStage?: ((ev: CrossAnalysisStageEvent) => void) | undefined;
};

export type RunCrossAnalysisResult = {
  payload: CrossAnalysisPayload;
  papers: ComparedPaper[];
  usage: AnalysisUsage;
  status: "ready" | "draft";
  fallbackReason?: string | undefined;
};

function toAnalysisUsage(usage: Usage, costUsd: number): AnalysisUsage {
  return {
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
}

// Map the model's positional readingOrder onto real analysis ids. An index that
// doesn't address a compared paper is dropped, and any paper the model omitted
// is appended — so the list always covers the set exactly once regardless of
// what came back.
function resolveReadingOrder(
  raw: SynthesisStageOutput["readingOrder"],
  papers: ComparedPaper[],
): ReadingStep[] {
  const seen = new Set<number>();
  const steps: ReadingStep[] = [];
  for (const entry of raw) {
    const paper = papers[entry.paperIndex];
    if (!paper || seen.has(entry.paperIndex)) continue;
    seen.add(entry.paperIndex);
    steps.push({ analysisId: paper.analysisId, why: entry.why });
  }
  papers.forEach((paper, i) => {
    if (seen.has(i)) return;
    steps.push({ analysisId: paper.analysisId, why: "" });
  });
  return steps;
}

export async function runCrossAnalysis(
  args: RunCrossAnalysisArgs,
): Promise<RunCrossAnalysisResult> {
  const { analysisIds, targetLang, signal, onStage } = args;
  if (signal?.aborted) {
    throw new CrossAnalysisError("aborted", "Comparison aborted before start");
  }
  if (analysisIds.length < MIN_COMPARE_PAPERS) {
    throw new CrossAnalysisError(
      "too_few_papers",
      `Need at least ${MIN_COMPARE_PAPERS} analyses to compare`,
    );
  }
  if (analysisIds.length > MAX_COMPARE_PAPERS) {
    throw new CrossAnalysisError(
      "too_many_papers",
      `Cannot compare more than ${MAX_COMPARE_PAPERS} analyses`,
    );
  }

  // ---- Stage 0 — load ------------------------------------------------------
  const records = await Promise.all(analysisIds.map((id) => getAnalysis(id)));
  const papers: ComparedPaper[] = [];
  const payloads: ArticleAnalysisPayload[] = [];
  records.forEach((record, i) => {
    // A generating/error analysis has no payload and nothing to compare. Fail
    // loudly rather than silently comparing three papers the user picked four of.
    if (!record?.payload) {
      throw new CrossAnalysisError(
        "missing_payload",
        `Analysis has no payload to compare: ${analysisIds[i] ?? "(unknown)"}`,
      );
    }
    papers.push({
      analysisId: record.id,
      sourceId: record.sourceId,
      title: record.title,
    });
    payloads.push(record.payload);
  });

  let models: Record<"critique" | "synthesize", ResolvedModel>;
  try {
    models = await resolveModelBindings({
      critique: args.models.critique,
      synthesize: args.models.synthesize,
    });
  } catch (err) {
    if (err instanceof StageBindingError) {
      throw new CrossAnalysisError(err.code, err.message);
    }
    throw err;
  }

  // ---- Stage 1 — MATRIX (pure code, no model, cannot fail) -----------------
  onStage?.({ stage: "matrix" });
  const matrix = buildComparisonMatrix(papers, payloads);

  // Shared, cached prefix for both AI stages.
  const claimTable = renderClaimTable(
    payloads,
    papers.map((p) => p.title),
  );
  const table = buildClaimTable(payloads);
  const userText = buildCrossStageUserMessage(targetLang);

  let usage: Usage = {};
  let costUsd = 0;
  const failedStages: string[] = [];
  const accrue = (out: { usage: Usage; model: string }): void => {
    usage = mergeUsage(usage, out.usage);
    costUsd += computeCostUsd(out.model, out.usage);
  };

  // ---- Stage 2 — contradictions + synthesis (parallel) ---------------------
  onStage?.({ stage: "compare" });
  const [contradictionSettled, synthesisSettled] = await Promise.allSettled([
    callStage<ContradictionStageOutput>(
      models.critique,
      buildContradictionSystem({ claimTable, targetLang }),
      userText,
      parseContradictionStage,
      signal,
      CONTRADICTION_MAX_TOKENS,
    ),
    callStage<SynthesisStageOutput>(
      models.synthesize,
      buildSynthesisSystem({
        claimTable,
        targetLang,
        titles: papers.map((p) => p.title),
      }),
      userText,
      parseSynthesisStage,
      signal,
      SYNTHESIS_MAX_TOKENS,
    ),
  ]);

  const rethrowIfFatal = (err: unknown): void => {
    if (err instanceof StageAbortError) {
      throw new CrossAnalysisError("aborted", "Comparison aborted");
    }
    if (err instanceof CrossAnalysisError) throw err;
  };

  let contradictions: Contradiction[] = [];
  if (contradictionSettled.status === "fulfilled") {
    accrue(contradictionSettled.value);
    // The gate: model refs → real claims, with citations that already verified
    // against chunk text. Anything unresolvable is dropped here, not rendered.
    contradictions = groundContradictions(
      contradictionSettled.value.value.contradictions,
      table,
    );
  } else {
    rethrowIfFatal(contradictionSettled.reason);
    failedStages.push(
      `contradictions (${stageFailureDetail(contradictionSettled.reason)})`,
    );
  }

  let consensus: string[] = [];
  let divergences: string[] = [];
  let readingOrder: ReadingStep[] = resolveReadingOrder([], papers);
  let synthesis = "";
  if (synthesisSettled.status === "fulfilled") {
    accrue(synthesisSettled.value);
    const value = synthesisSettled.value.value;
    consensus = value.consensus;
    divergences = value.divergences;
    readingOrder = resolveReadingOrder(value.readingOrder, papers);
    synthesis = value.synthesis;
  } else {
    rethrowIfFatal(synthesisSettled.reason);
    failedStages.push(
      `synthesis (${stageFailureDetail(synthesisSettled.reason)})`,
    );
  }

  onStage?.({ stage: "done" });

  const payload: CrossAnalysisPayload = {
    matrix,
    contradictions,
    consensus,
    divergences,
    readingOrder,
    synthesis,
  };

  return {
    payload,
    papers,
    usage: toAnalysisUsage(usage, costUsd),
    // Never "error": the code-built matrix is always a usable result, so a
    // total AI failure is a draft, not a dead row.
    status: failedStages.length > 0 ? "draft" : "ready",
    ...(failedStages.length > 0
      ? { fallbackReason: failedStages.join("; ") }
      : {}),
  };
}
