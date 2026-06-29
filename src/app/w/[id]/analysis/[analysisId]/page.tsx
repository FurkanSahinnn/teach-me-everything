"use client";

import {
  ChevronLeft,
  FileDown,
  Loader2,
  RefreshCw,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useRouteParams } from "@/lib/utils/route-params";
import { AppShell } from "@/components/shell/AppShell";
import { AnalysisDetailView } from "@/components/article-analysis/AnalysisDetailView";
import { AnalysisGenerateModal } from "@/components/article-analysis/AnalysisGenerateModal";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { ConfirmDeleteModal } from "@/components/ui/ConfirmDeleteModal";
import { useToast } from "@/components/ui/Toast";
import { useLocalePick } from "@/i18n/IntlProvider";
import { deleteAnalysis } from "@/lib/db/article-analyses";
import {
  useArticleAnalysis,
  useWorkspace,
} from "@/lib/db/hooks";
import { exportAnalysisAsPdf } from "@/lib/article-analysis/pdf-export";

export default function AnalysisDetailPage() {
  const params = useRouteParams();
  const router = useRouter();
  const pick = useLocalePick();
  const { toast } = useToast();

  const idParam = typeof params?.id === "string" ? params.id : "";
  const analysisIdParam =
    typeof params?.analysisId === "string" ? params.analysisId : "";
  const workspaceId = idParam === "_" ? undefined : idParam;
  const analysisId = analysisIdParam === "_" ? undefined : analysisIdParam;

  const workspace = useWorkspace(workspaceId);
  const analysis = useArticleAnalysis(analysisId);

  const [regenOpen, setRegenOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  async function handleExportPdf(): Promise<void> {
    if (!analysis?.payload || exporting) return;
    setExporting(true);
    try {
      // Always export with the light/print palette (dark text on white) — the
      // dark UI theme's cream text is unreadable once the print background is
      // stripped to white.
      await exportAnalysisAsPdf(analysis, { exportedAt: Date.now() });
    } catch (err) {
      console.error("[article-analysis] PDF export failed", err);
      toast({
        variant: "warn",
        title: pick("PDF oluşturulamadı", "Could not create PDF"),
        ...(err instanceof Error && err.message
          ? { description: err.message }
          : {}),
      });
    } finally {
      setExporting(false);
    }
  }

  const listHref = workspaceId ? `/w/${workspaceId}/analysis` : "/";

  return (
    <AppShell
      workspaceId={workspaceId}
      title={analysis?.title ?? pick("Analiz", "Analysis")}
      breadcrumb={
        workspace && analysis
          ? [
              pick(workspace.name, workspace.nameEn ?? workspace.name),
              pick("Analiz", "Analysis"),
              analysis.title,
            ]
          : undefined
      }
    >
      <div className="mx-auto flex w-full max-w-[920px] flex-col gap-5 px-4 py-6 sm:px-6">
        <header className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2 min-w-0">
            <Link
              href={listHref}
              className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-[8px] text-ink-3 hover:bg-paper-3 hover:text-ink"
              aria-label={pick("Analiz listesi", "Analysis list")}
            >
              <ChevronLeft className="h-4 w-4" aria-hidden />
            </Link>
            <div className="min-w-0">
              <h1 className="truncate font-serif text-[22px] font-medium text-ink">
                {analysis?.title ?? "…"}
              </h1>
              {analysis ? (
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-4">
                  <Chip variant="muted" className="uppercase">
                    {analysis.targetLang}
                  </Chip>
                  {analysis.usage.costUsd && analysis.usage.costUsd > 0 ? (
                    <span className="font-mono tabular-nums">
                      ~${analysis.usage.costUsd.toFixed(3)}
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
          {analysis ? (
            <div className="flex shrink-0 items-center gap-2">
              {analysis.payload ? (
                <Button
                  variant="default"
                  size="sm"
                  onClick={handleExportPdf}
                  disabled={exporting}
                >
                  {exporting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  ) : (
                    <FileDown className="h-3.5 w-3.5" aria-hidden />
                  )}
                  {pick("PDF", "PDF")}
                </Button>
              ) : null}
              <Button
                variant="default"
                size="sm"
                onClick={() => setRegenOpen(true)}
                disabled={analysis.status === "generating"}
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                {pick("Yeniden üret", "Regenerate")}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setConfirmOpen(true)}
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
                {pick("Sil", "Delete")}
              </Button>
            </div>
          ) : null}
        </header>

        {analysis === null ? (
          <p className="text-[13px] text-ink-3">
            {pick("Analiz bulunamadı.", "Analysis not found.")}
          </p>
        ) : analysis === undefined ? (
          <p className="text-[13px] text-ink-4">{pick("Yükleniyor…", "Loading…")}</p>
        ) : analysis.status === "generating" ? (
          <div className="flex items-center gap-2.5 rounded-[10px] border border-accent-soft bg-accent-wash px-4 py-3 text-[13px] text-accent-ink">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            {pick(
              "Analiz üretiliyor — birkaç dakika sürebilir.",
              "Analysis in progress — this can take a few minutes.",
            )}
          </div>
        ) : analysis.status === "error" ? (
          <div className="rounded-[10px] border border-err/30 bg-err/10 px-4 py-3 text-[13px] text-err">
            <div className="font-medium">
              {pick("Analiz başarısız oldu", "Analysis failed")}
            </div>
            {analysis.errorMessage ? (
              <p className="mt-0.5 text-ink-2">{analysis.errorMessage}</p>
            ) : null}
            <Button
              variant="default"
              size="sm"
              className="mt-3"
              onClick={() => setRegenOpen(true)}
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden />
              {pick("Yeniden dene", "Try again")}
            </Button>
          </div>
        ) : (
          <AnalysisDetailView analysis={analysis} />
        )}
      </div>

      {workspaceId && analysis ? (
        <AnalysisGenerateModal
          open={regenOpen}
          onClose={() => setRegenOpen(false)}
          workspaceId={workspaceId}
          sourceId={analysis.sourceId}
          onGenerated={(newId) => {
            setRegenOpen(false);
            router.push(`/w/${workspaceId}/analysis/${newId}`);
          }}
        />
      ) : null}

      {analysis ? (
        <ConfirmDeleteModal
          open={confirmOpen}
          onClose={() => setConfirmOpen(false)}
          title={pick("Analizi sil", "Delete analysis")}
          description={pick(
            `"${analysis.title}" analizi kalıcı olarak silinecek. Bu işlem geri alınamaz.`,
            `The analysis of "${analysis.title}" will be permanently removed. This cannot be undone.`,
          )}
          confirmText={analysis.title}
          confirmInputLabel={
            <>
              {pick(
                "Onaylamak için kaynak adını yaz: ",
                "To confirm, type the source name: ",
              )}
              <code className="font-mono text-[12.5px] text-err">
                {analysis.title}
              </code>
            </>
          }
          confirmButtonLabel={pick("Kalıcı olarak sil", "Delete permanently")}
          cancelButtonLabel={pick("İptal", "Cancel")}
          onConfirm={async () => {
            await deleteAnalysis(analysis.id);
            toast({
              variant: "info",
              title: pick("Analiz silindi", "Analysis deleted"),
            });
            setConfirmOpen(false);
            router.push(listHref);
          }}
        />
      ) : null}
    </AppShell>
  );
}
