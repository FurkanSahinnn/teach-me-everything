"use client";

import { FileText, Loader2, Sparkles, Upload } from "lucide-react";
import Link from "next/link";
import { type DragEvent, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { useLocalePick } from "@/i18n/IntlProvider";
import { findChatOption } from "@/lib/ai/model-options";
import { computeCostUsd } from "@/lib/ai/pricing";
import { useArticleAnalysisRunner } from "@/lib/ai/runners/article-analysis-runner";
import { listChunksBySource } from "@/lib/db/chunks";
import { useArticleAnalysis, useSources } from "@/lib/db/hooks";
import {
  ingestPdfForAnalysis,
  IngestPdfError,
  type IngestPdfHandle,
} from "@/lib/ingest/ingest-pdf-source";
import type { AnalysisTargetLang } from "@/lib/article-analysis/types";
import { ARTICLE_WINDOW_TOKENS } from "@/lib/article-analysis/token-budget";
import { usePrefs } from "@/stores/prefs";
import { cn } from "@/lib/utils/cn";

type Props = {
  workspaceId: string;
  // When given, the picker is preselected + locked to this source (the
  // "analyze this source" entry point). Omitted ⇒ free pick from the list.
  sourceId?: string | undefined;
  open: boolean;
  onClose: () => void;
  onGenerated?: ((analysisId: string) => void) | undefined;
};

// Rough pre-run estimate — a "~tahmini", never an invoice.
//
// Short papers use one writing call. Long papers add section extraction calls
// before the writer; the estimate remains a rough BYOK guide.

function bareModelId(binding: string): string {
  return findChatOption(binding)?.modelId ?? binding;
}

function estimateCostUsd(
  tokenSum: number,
  bindings: { extract: string; synthesize: string },
): number {
  if (tokenSum <= 0) return 0;
  const windowTokens = Math.min(tokenSum, ARTICLE_WINDOW_TOKENS);
  const long = tokenSum > ARTICLE_WINDOW_TOKENS;
  const groups = long ? Math.max(1, Math.ceil(tokenSum / 6000)) : 0;
  const extract = long ? computeCostUsd(bareModelId(bindings.extract), {
    input_tokens: tokenSum + groups * 300,
    output_tokens: groups * 650,
  }) : 0;
  const synthesize = computeCostUsd(bareModelId(bindings.synthesize), {
    input_tokens: windowTokens + groups * 700,
    output_tokens: 8000,
  });
  return extract + synthesize * 1.25;
}

// Pretty label for the adaptive brief progress events.
const STAGE_ORDER = ["prepare", "map", "synthesize", "expand"] as const;

export function AnalysisGenerateModal(props: Props) {
  return props.open ? <AnalysisGenerateSession key={`${props.workspaceId}:${props.sourceId ?? "upload"}`} {...props} /> : null;
}

function AnalysisGenerateSession({
  workspaceId,
  sourceId,
  open,
  onClose,
  onGenerated,
}: Props) {
  const pick = useLocalePick();
  const locale = usePrefs((s) => s.locale);
  const aiResponseLocale = usePrefs((s) => s.aiResponseLocale);
  const mb = usePrefs((s) => s.modelBindings);
  // Only the locked (regenerate / from-source) path needs the source title.
  const sources = useSources(workspaceId);

  const defaultLang: AnalysisTargetLang =
    aiResponseLocale === "en"
      ? "en"
      : aiResponseLocale === "tr"
        ? "tr"
        : locale === "en"
          ? "en"
          : "tr";

  const [selectedSourceId, setSelectedSourceId] = useState<string>(
    sourceId ?? "",
  );
  const [targetLang, setTargetLang] = useState<AnalysisTargetLang>(defaultLang);
  const [tokenSum, setTokenSum] = useState<number | null>(null);

  // Drag-and-drop PDF ingest state (the non-locked entry point). The dropped
  // PDF is parsed → chunked → persisted as a ready source, then analyzed —
  // so the user never picks from the mixed Sources list (where a non-article
  // could be selected by mistake).
  const [ingest, setIngest] = useState<{
    phase: "idle" | "ingesting" | "ready" | "error";
    pct: number;
    error?: string;
  }>({ phase: "idle", pct: 0 });
  const [ingestedTitle, setIngestedTitle] = useState<string>("");
  const ingestHandleRef = useRef<IngestPdfHandle | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { state, generate, cancel } = useArticleAnalysisRunner();
  const liveAnalysis = useArticleAnalysis(state.analysisId);
  const notifiedRef = useRef(false);

  // Closing unmounts this session, so a reopened form cannot receive an old
  // ingestion's completion or reuse a cancelled analysis runner.
  useEffect(() => () => {
    ingestHandleRef.current?.cancel();
    ingestHandleRef.current = null;
  }, []);

  const locked = Boolean(sourceId);
  const effectiveSourceId = locked ? (sourceId as string) : selectedSourceId;
  const [previousSource, setPreviousSource] = useState(effectiveSourceId);
  if (previousSource !== effectiveSourceId) {
    setPreviousSource(effectiveSourceId);
    setTokenSum(null);
  }

  // Pull the token sum for the chosen source to drive the cost estimate.
  useEffect(() => {
    if (!open || !effectiveSourceId) return;
    let cancelled = false;
    void listChunksBySource(effectiveSourceId).then((chunks) => {
      if (cancelled) return;
      setTokenSum(chunks.reduce((sum, c) => sum + (c.tokenCount ?? 0), 0));
    });
    return () => {
      cancelled = true;
    };
  }, [open, effectiveSourceId]);

  // Navigate / notify once the run finishes successfully.
  useEffect(() => {
    if (state.phase === "done" && state.analysisId && !notifiedRef.current) {
      notifiedRef.current = true;
      onGenerated?.(state.analysisId);
    }
  }, [state.phase, state.analysisId, onGenerated]);

  const estimate = useMemo(
    () =>
      estimateCostUsd(tokenSum ?? 0, {
        extract: mb.analysisExtract,
        synthesize: mb.analysisSynthesize,
      }),
    [tokenSum, mb.analysisExtract, mb.analysisSynthesize],
  );

  const running = state.phase === "running";

  function handleClose(): void {
    if (running) cancel();
    ingestHandleRef.current?.cancel();
    onClose();
  }

  function startIngest(file: File): void {
    const isPdf =
      file.type === "application/pdf" ||
      file.name.toLowerCase().endsWith(".pdf");
    if (!isPdf) {
      setIngest({
        phase: "error",
        pct: 0,
        error: pick(
          "Yalnız PDF dosyaları desteklenir.",
          "Only PDF files are supported.",
        ),
      });
      return;
    }
    ingestHandleRef.current?.cancel();
    setSelectedSourceId("");
    setIngestedTitle("");
    setIngest({ phase: "ingesting", pct: 0 });
    const handle = ingestPdfForAnalysis(file, workspaceId, (p) => {
      setIngest((cur) =>
        cur.phase === "ingesting" ? { ...cur, pct: p.pct } : cur,
      );
    });
    ingestHandleRef.current = handle;
    void handle.promise.then(
      (res) => {
        if (ingestHandleRef.current !== handle) return; // superseded / closed
        setSelectedSourceId(res.sourceId);
        setIngestedTitle(res.title);
        setIngest({ phase: "ready", pct: 100 });
      },
      (err) => {
        if (ingestHandleRef.current !== handle) return;
        const noText = err instanceof IngestPdfError && err.code === "no_text";
        setIngest({
          phase: "error",
          pct: 0,
          error: noText
            ? pick(
                "PDF'ten metin çıkarılamadı (taranmış görüntü olabilir).",
                "No text could be extracted (the PDF may be a scanned image).",
              )
            : pick(
                "PDF işlenemedi. Başka bir dosya dene.",
                "Could not process the PDF. Try another file.",
              ),
        });
      },
    );
  }

  function onDropPdf(e: DragEvent<HTMLDivElement>): void {
    e.preventDefault();
    // Stop the global SourceUploadProvider's window-level drop handler from
    // ALSO queueing this file into the normal source-upload flow.
    e.stopPropagation();
    if (ingest.phase === "ingesting") return;
    const f = e.dataTransfer.files?.[0];
    if (f) startIngest(f);
  }

  function onDragOverPdf(e: DragEvent<HTMLDivElement>): void {
    e.preventDefault();
    e.stopPropagation();
  }

  function handleGenerate(): void {
    if (running || !effectiveSourceId) return;
    let title: string;
    if (locked) {
      const src = (sources ?? []).find((s) => s.id === effectiveSourceId);
      title = src
        ? pick(src.title, src.titleEn ?? src.title)
        : pick("Kaynak", "Source");
    } else {
      title = ingestedTitle || pick("Makale", "Article");
    }
    void generate({
      workspaceId,
      sourceId: effectiveSourceId,
      title,
      targetLang,
    });
  }

  const modelRow = (label: string, binding: string) => {
    const opt = findChatOption(binding);
    return (
      <div className="flex items-center justify-between gap-3 text-[12px]">
        <span className="text-ink-4">{label}</span>
        <span className="truncate font-mono text-ink-2">
          {opt?.label ?? binding}
        </span>
      </div>
    );
  };

  const stageLabel = (
    stage: (typeof STAGE_ORDER)[number],
    index?: number | undefined,
    total?: number | undefined,
  ): string => {
    switch (stage) {
      case "prepare":
        return pick("Makale hazırlanıyor", "Preparing article");
      case "map":
        return total
          ? pick(
              `Bölüm özetleri ${(index ?? 0) + 1}/${total}`,
              `Section summaries ${(index ?? 0) + 1}/${total}`,
            )
          : pick("Bölüm özetleri", "Section summaries");
      case "synthesize":
        return pick("Okuma dosyası yazılıyor", "Writing reading brief");
      case "expand":
        return pick("Ayrıntılar derinleştiriliyor", "Expanding missing detail");
    }
  };

  const currentStageIndex =
    state.progress && state.progress.stage !== "done"
      ? STAGE_ORDER.indexOf(
          state.progress.stage as (typeof STAGE_ORDER)[number],
        )
      : -1;

  return (
    <Modal
      open={open}
      onClose={handleClose}
      size="lg"
      title={pick("Makale analizi", "Article analysis")}
      description={pick(
        "Makaleyi kaynaklarıyla birlikte anlaşılır bir okuma dosyasına dönüştür.",
        "Turn a paper into a clear, source-linked reading brief.",
      )}
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          <Button variant="ghost" size="sm" onClick={handleClose}>
            {running ? pick("İptal et", "Cancel") : pick("Kapat", "Close")}
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleGenerate}
            disabled={running || !effectiveSourceId}
          >
            {running ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                {pick("Analiz ediliyor…", "Analyzing…")}
              </>
            ) : (
              <>
                <Sparkles className="h-3.5 w-3.5" aria-hidden />
                {pick("Analiz et", "Analyze")}
              </>
            )}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {/* Article PDF — drag-and-drop upload (or locked to a preselected source) */}
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-ink">
            {pick("Makale (PDF)", "Article (PDF)")}
          </span>
          {locked ? (
            <div className="flex items-center gap-2 rounded-[10px] border border-rule-soft bg-paper-2 px-3 py-2 text-[13px] text-ink-2">
              <FileText className="h-3.5 w-3.5 shrink-0 text-ink-4" aria-hidden />
              <span className="truncate">
                {(() => {
                  const s = (sources ?? []).find((x) => x.id === sourceId);
                  return s
                    ? pick(s.title, s.titleEn ?? s.title)
                    : pick("Seçili kaynak", "Selected source");
                })()}
              </span>
            </div>
          ) : ingest.phase === "ready" ? (
            <div className="flex items-center justify-between gap-2 rounded-[10px] border border-ok/30 bg-ok/10 px-3 py-2 text-[13px] text-ink-2">
              <span className="flex min-w-0 items-center gap-2">
                <FileText className="h-3.5 w-3.5 shrink-0 text-ok" aria-hidden />
                <span className="truncate">{ingestedTitle}</span>
              </span>
              <button
                type="button"
                disabled={running}
                onClick={() => {
                  if (running) return;
                  setIngest({ phase: "idle", pct: 0 });
                  setSelectedSourceId("");
                  setIngestedTitle("");
                }}
                className={cn(
                  "shrink-0 text-[11.5px]",
                  running
                    ? "cursor-not-allowed text-ink-4"
                    : "text-accent hover:underline",
                )}
              >
                {pick("Değiştir", "Change")}
              </button>
            </div>
          ) : (
            <>
              <div
                role="button"
                tabIndex={ingest.phase === "ingesting" ? -1 : 0}
                aria-disabled={ingest.phase === "ingesting"}
                onClick={() => {
                  if (ingest.phase !== "ingesting") fileInputRef.current?.click();
                }}
                onKeyDown={(e) => {
                  if (
                    ingest.phase !== "ingesting" &&
                    (e.key === "Enter" || e.key === " ")
                  ) {
                    e.preventDefault();
                    fileInputRef.current?.click();
                  }
                }}
                onDrop={onDropPdf}
                onDragOver={onDragOverPdf}
                className={cn(
                  "flex flex-col items-center justify-center gap-2 rounded-[10px] border-2 border-dashed px-3 py-6 text-center outline-none transition-colors focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30",
                  ingest.phase === "ingesting"
                    ? "cursor-default border-accent-soft bg-accent-wash"
                    : "cursor-pointer border-rule-strong bg-paper hover:border-accent hover:bg-accent-wash/40",
                )}
              >
                {ingest.phase === "ingesting" ? (
                  <>
                    <Loader2
                      className="h-5 w-5 animate-spin text-accent"
                      aria-hidden
                    />
                    <span className="text-[12.5px] text-ink-2">
                      {pick("PDF işleniyor…", "Processing PDF…")} {ingest.pct}%
                    </span>
                    <div className="mt-1 h-1 w-full max-w-[220px] overflow-hidden rounded-full bg-paper-3">
                      <div
                        className="h-full rounded-full bg-accent transition-[width] duration-200"
                        style={{ width: `${ingest.pct}%` }}
                      />
                    </div>
                  </>
                ) : (
                  <>
                    <Upload className="h-5 w-5 text-ink-4" aria-hidden />
                    <span className="text-[13px] text-ink-2">
                      {pick(
                        "Bir PDF sürükle ya da seçmek için tıkla",
                        "Drop a PDF or click to choose",
                      )}
                    </span>
                    <span className="text-[11.5px] text-ink-4">
                      {pick(
                        "Yüklenen PDF analiz edilir ve kaynaklarına eklenir.",
                        "The uploaded PDF is analyzed and added to your sources.",
                      )}
                    </span>
                  </>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,application/pdf"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) startIngest(f);
                  e.target.value = "";
                }}
              />
              {ingest.phase === "error" && ingest.error ? (
                <span className="text-[12px] text-err">{ingest.error}</span>
              ) : null}
            </>
          )}
        </div>

        {/* Target language */}
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-ink">
            {pick("Çıktı dili", "Output language")}
          </span>
          <SegmentedControl<AnalysisTargetLang>
            value={targetLang}
            onChange={setTargetLang}
            size="md"
            disabled={running}
            options={[
              { value: "tr", label: pick("Türkçe", "Turkish") },
              { value: "en", label: pick("İngilizce", "English") },
            ]}
          />
          <span className="text-[11.5px] text-ink-4">
            {pick(
              "Sözlük her zaman çift dilli (TR/EN) üretilir.",
              "The glossary is always produced bilingually (TR/EN).",
            )}
          </span>
        </div>

        {/* Stage models (read-only) */}
        <div className="flex flex-col gap-2 rounded-[10px] border border-rule-soft bg-paper-2 px-3 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[12.5px] font-medium text-ink">
              {pick("Aşama modelleri", "Stage models")}
            </span>
            <Link
              href="/settings"
              className="text-[11.5px] text-accent hover:underline"
            >
              {pick("Settings'ten değiştir", "Change in Settings")}
            </Link>
          </div>
          {modelRow(pick("Çıkarım (Map)", "Extract (Map)"), mb.analysisExtract)}
          {modelRow(
            pick("Sentez", "Synthesize"),
            mb.analysisSynthesize,
          )}
        </div>

        {/* Cost estimate */}
        <div className="flex items-center justify-between gap-2 rounded-[10px] border border-rule-soft bg-paper-2 px-3 py-2.5 text-[12.5px]">
          <span className="text-ink-3">
            {pick("Tahmini maliyet", "Estimated cost")}
          </span>
          <span className="font-mono text-ink-2">
            {tokenSum === null
              ? "—"
              : estimate > 0
                ? `~$${estimate.toFixed(3)}`
                : pick("~ücretsiz", "~free")}
          </span>
        </div>

        {/* Live progress */}
        {running && state.progress ? (
          <div className="flex flex-col gap-2 rounded-[10px] border border-accent-soft bg-accent-wash px-3 py-2.5">
            <div className="flex items-center gap-2 text-[12.5px] text-accent-ink">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              <span className="font-medium">
                {state.progress.stage === "done"
                  ? pick("Tamamlanıyor…", "Finishing…")
                  : stageLabel(
                      state.progress.stage as (typeof STAGE_ORDER)[number],
                      state.progress.index,
                      state.progress.total,
                    )}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
              {STAGE_ORDER.map((stage, i) => (
                <span key={stage} className="flex items-center gap-1.5">
                  <span
                    className={cn(
                      "rounded-[6px] px-1.5 py-px font-mono uppercase tracking-[0.04em]",
                      i < currentStageIndex
                        ? "text-ok"
                        : i === currentStageIndex
                          ? "bg-accent text-paper"
                          : "text-ink-4",
                    )}
                  >
                    {stageLabel(stage)}
                  </span>
                  {i < STAGE_ORDER.length - 1 ? (
                    <span className="text-ink-4" aria-hidden>
                      →
                    </span>
                  ) : null}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        {running && (liveAnalysis?.brief || state.streamText) ? (
          <div aria-live="polite" className="max-h-[280px] space-y-4 overflow-y-auto rounded-[10px] border border-rule-soft bg-paper px-4 py-4">
            <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-accent-ink">{pick("Oluşan analiz", "Brief taking shape")}</p>
            {liveAnalysis?.brief ? <p className="font-serif text-[17px] leading-relaxed text-ink">{liveAnalysis.brief.thesis.text}</p> : null}
            {liveAnalysis?.brief?.sections.map((section) => <section key={section.id} className="article-brief-enter border-t border-rule-soft pt-3">
              <h3 className="font-serif text-[16px] text-ink">{section.title}</h3>
              {section.blocks.map((block) => <p key={block.id} className="mt-2 text-[12.5px] leading-relaxed text-ink-2">{block.text}</p>)}
            </section>)}
            {state.streamText ? <div className="border-t border-rule-soft pt-3 text-[12.5px] leading-relaxed text-ink-3">
              <p className="mb-1 text-[10px] uppercase tracking-wide text-ink-4">{pick("Geçici taslak · kaynak kontrolü sürüyor", "Live draft · checking sources")}</p>
              <p>{state.streamText}<span className="ml-0.5 inline-block h-3 w-0.5 animate-pulse bg-accent align-middle" aria-hidden /></p>
            </div> : null}
          </div>
        ) : null}

        {state.phase === "error" && state.error ? (
          <div className="rounded-[10px] border border-err/30 bg-err/10 px-3 py-2 text-[12.5px] text-err">
            {state.error}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
