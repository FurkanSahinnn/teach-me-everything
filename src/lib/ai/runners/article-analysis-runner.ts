"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocalePick } from "@/i18n/IntlProvider";
import {
  runArticleAnalysis,
  ArticleAnalysisError,
  type ArticleAnalysisStageEvent,
} from "@/lib/ai/article-analysis";
import { createAnalysis, setAnalysisStatus } from "@/lib/db/article-analyses";
import type {
  AnalysisModelSnapshot,
  AnalysisTargetLang,
} from "@/lib/article-analysis/types";
import { usePrefs } from "@/stores/prefs";

// Run lifecycle surfaced to the modal / detail page. `progress` mirrors the
// orchestrator's onStage events so the UI can show live per-stage status.
export type AnalysisRunPhase = "idle" | "running" | "done" | "error";

export type AnalysisRunProgress = {
  stage: ArticleAnalysisStageEvent["stage"];
  index?: number | undefined;
  total?: number | undefined;
};

export type AnalysisRunnerState = {
  phase: AnalysisRunPhase;
  progress?: AnalysisRunProgress | undefined;
  // Available as soon as the row is minted (before the pipeline finishes) so
  // callers can deep-link to the detail page. NOTE: per-stage progress is held
  // in THIS hook's in-memory state only — the row's payload is persisted once
  // at the end of the run, so the detail page shows a neutral "in progress"
  // state until completion, not incremental sections.
  analysisId?: string | undefined;
  error?: string | undefined;
};

export type GenerateAnalysisInput = {
  workspaceId: string;
  sourceId: string;
  // Source-title snapshot persisted on the row (survives source rename/delete).
  title: string;
  targetLang: AnalysisTargetLang;
};

export type UseArticleAnalysisRunnerResult = {
  state: AnalysisRunnerState;
  generate: (input: GenerateAnalysisInput) => Promise<void>;
  cancel: () => void;
  reset: () => void;
};

// Map the orchestrator's typed error codes to friendly bilingual copy. The
// `aborted` code fires on user-cancel; everything else is a genuine failure.
function friendlyAnalysisError(
  code: ArticleAnalysisError["code"],
  fallback: string,
  pick: (tr: string, en: string) => string,
): string {
  switch (code) {
    case "empty_source":
      return pick(
        "Bu kaynakta analiz edilecek metin yok — önce işlenip parçalara ayrılması gerekiyor.",
        "This source has no text to analyze — it needs to be processed/chunked first.",
      );
    case "no_credential":
      return pick(
        "Seçili analiz modeli için API anahtarı yok. Ayarlar → API anahtarlarından ekle.",
        "No API key for the selected analysis model. Add one in Settings → API keys.",
      );
    case "unknown_model":
      return pick(
        "Seçili analiz modeli artık kayıtlı değil. Ayarlar → Varsayılan modeller'den güncelle.",
        "The selected analysis model is no longer registered. Update it in Settings → Default models.",
      );
    case "aborted":
      return pick("Analiz iptal edildi.", "Analysis cancelled.");
    case "all_stages_failed":
      return pick(
        "Tüm analiz aşamaları başarısız oldu. Tekrar dene ya da farklı bir model seç.",
        "Every analysis stage failed. Retry or pick a different model.",
      );
    default:
      return fallback;
  }
}

export function useArticleAnalysisRunner(): UseArticleAnalysisRunnerResult {
  const pick = useLocalePick();
  const [state, setState] = useState<AnalysisRunnerState>({ phase: "idle" });
  const abortRef = useRef<AbortController | null>(null);
  // Re-entry guard: keep at most one run in flight. A ref (not state) so the
  // check is synchronous and immune to React batching.
  const runningRef = useRef(false);
  const mountedRef = useRef(true);
  // Generation token: bumped on every reset() and at the start of every
  // generate(). A run captures its generation and only writes state while it
  // is still current — so a fast close (abort) + reopen (reset) can't be
  // poisoned by the aborted run's trailing safeSet. The abort →reject→awaited
  // DB write→finally chain is async, so the old runningRef guard on reset()
  // was racy; the generation token decouples reset from that timing.
  const generationRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, []);

  const safeSet = useCallback((next: AnalysisRunnerState, gen: number) => {
    if (mountedRef.current && generationRef.current === gen) setState(next);
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const reset = useCallback(() => {
    // Always reset, even mid-run: bumping the generation invalidates any
    // in-flight run's pending writes so the reopened modal starts clean.
    generationRef.current += 1;
    setState({ phase: "idle" });
  }, []);

  const generate = useCallback(
    async (input: GenerateAnalysisInput) => {
      if (runningRef.current) return;
      runningRef.current = true;
      // Claim a fresh generation; every safeSet below is scoped to it so a
      // later reset() (modal reopen) invalidates this run's trailing writes.
      const myGen = ++generationRef.current;

      // Resolve the three stage models from the user's Settings → Default
      // models bindings (provider::modelId strings). The orchestrator validates
      // / resolves credentials per binding; we only snapshot the choice here.
      const mb = usePrefs.getState().modelBindings;
      const modelSnapshot: AnalysisModelSnapshot = {
        extract: mb.analysisExtract,
        synthesize: mb.analysisSynthesize,
        critique: mb.analysisCritique,
      };

      const controller = new AbortController();
      abortRef.current = controller;
      safeSet({ phase: "running", progress: { stage: "map" } }, myGen);

      // Mint the row up-front (status "generating") so the list + detail page
      // can render it live while the pipeline runs.
      let analysisId: string;
      try {
        const row = await createAnalysis({
          workspaceId: input.workspaceId,
          sourceId: input.sourceId,
          title: input.title,
          targetLang: input.targetLang,
          modelSnapshot,
        });
        analysisId = row.id;
      } catch (err) {
        runningRef.current = false;
        abortRef.current = null;
        safeSet(
          {
            phase: "error",
            error:
              err instanceof Error
                ? err.message
                : pick("Analiz oluşturulamadı.", "Could not create analysis."),
          },
          myGen,
        );
        return;
      }

      safeSet(
        {
          phase: "running",
          progress: { stage: "map" },
          analysisId,
        },
        myGen,
      );

      try {
        const result = await runArticleAnalysis({
          workspaceId: input.workspaceId,
          sourceId: input.sourceId,
          targetLang: input.targetLang,
          models: modelSnapshot,
          signal: controller.signal,
          onStage: (ev) => {
            safeSet(
              {
                phase: "running",
                analysisId,
                progress:
                  ev.stage === "map"
                    ? { stage: "map", index: ev.index, total: ev.total }
                    : { stage: ev.stage },
              },
              myGen,
            );
          },
        });

        await setAnalysisStatus(analysisId, result.status, {
          payload: result.payload,
          usage: result.usage,
          fallbackReason: result.fallbackReason ?? null,
        });

        safeSet(
          {
            phase: "done",
            analysisId,
            progress: { stage: "done" },
          },
          myGen,
        );
      } catch (err) {
        const code =
          err instanceof ArticleAnalysisError ? err.code : undefined;
        const raw =
          err instanceof Error
            ? err.message
            : pick("Bilinmeyen hata.", "Unknown error.");
        const message = code
          ? friendlyAnalysisError(code, raw, pick)
          : raw;
        // Persist the failure onto the row so the list/detail reflect it.
        try {
          await setAnalysisStatus(analysisId, "error", {
            errorMessage: message,
          });
        } catch {
          // Best-effort: a DB write failure here must not mask the run error.
        }
        safeSet({ phase: "error", analysisId, error: message }, myGen);
      } finally {
        runningRef.current = false;
        abortRef.current = null;
      }
    },
    [pick, safeSet],
  );

  return { state, generate, cancel, reset };
}
