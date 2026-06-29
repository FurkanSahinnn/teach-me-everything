"use client";

import {
  AlertTriangle,
  Calendar,
  FileText,
  Loader2,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { ConfirmDeleteModal } from "@/components/ui/ConfirmDeleteModal";
import { useToast } from "@/components/ui/Toast";
import { useLocalePick } from "@/i18n/IntlProvider";
import { deleteAnalysis } from "@/lib/db/article-analyses";
import { findChatOption } from "@/lib/ai/model-options";
import type {
  AnalysisStatus,
  ArticleAnalysisRecord,
} from "@/lib/article-analysis/types";
import { usePrefs } from "@/stores/prefs";
import { cn } from "@/lib/utils/cn";

type Props = {
  workspaceId: string;
  analysis: ArticleAnalysisRecord;
};

function formatRelative(timestamp: number, locale: "tr" | "en"): string {
  const diff = Date.now() - timestamp;
  const min = Math.floor(diff / 60000);
  const hour = Math.floor(min / 60);
  const day = Math.floor(hour / 24);
  if (locale === "tr") {
    if (min < 1) return "az önce";
    if (min < 60) return `${min} dakika önce`;
    if (hour < 24) return `${hour} saat önce`;
    if (day < 7) return `${day} gün önce`;
    return new Date(timestamp).toLocaleDateString("tr-TR");
  }
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  if (hour < 24) return `${hour} h ago`;
  if (day < 7) return `${day} d ago`;
  return new Date(timestamp).toLocaleDateString("en-US");
}

function StatusChip({ status }: { status: AnalysisStatus }) {
  const pick = useLocalePick();
  switch (status) {
    case "generating":
      return (
        <Chip variant="accent" className="gap-1.5">
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
          {pick("Üretiliyor", "Generating")}
        </Chip>
      );
    case "ready":
      return <Chip variant="ok">{pick("Hazır", "Ready")}</Chip>;
    case "draft":
      return <Chip variant="warn">{pick("Taslak", "Draft")}</Chip>;
    case "error":
      return (
        <Chip variant="err" className="gap-1.5">
          <AlertTriangle className="h-3 w-3" aria-hidden />
          {pick("Hata", "Error")}
        </Chip>
      );
  }
}

export function AnalysisCard({ workspaceId, analysis }: Props) {
  const pick = useLocalePick();
  const { toast } = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Use the app locale (single source of truth) — not `<html lang>`, which is
  // server-rendered and not kept in sync with prefs, and would hydrate wrong.
  const locale = usePrefs((s) => s.locale);
  const rel = formatRelative(analysis.createdAt, locale);

  const extractLabel =
    findChatOption(analysis.modelSnapshot.extract)?.modelId ??
    analysis.modelSnapshot.extract;
  const synthLabel =
    findChatOption(analysis.modelSnapshot.synthesize)?.modelId ??
    analysis.modelSnapshot.synthesize;

  const cost = analysis.usage.costUsd ?? 0;

  return (
    <Card variant="default" className="relative overflow-hidden">
      <div className="flex items-start gap-2">
        <Link
          href={`/w/${workspaceId}/analysis/${analysis.id}`}
          className="flex min-w-0 flex-1 flex-col gap-3 p-1 outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-[8px]"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 shrink-0 text-ink-3" aria-hidden />
                <h3 className="truncate font-serif text-[17px] font-medium text-ink">
                  {analysis.title}
                </h3>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <StatusChip status={analysis.status} />
                <Chip variant="muted" className="uppercase">
                  {analysis.targetLang}
                </Chip>
              </div>
              {analysis.status === "error" && analysis.errorMessage ? (
                <p className="mt-1.5 line-clamp-2 text-[11.5px] text-err">
                  {analysis.errorMessage}
                </p>
              ) : null}
            </div>
            <div className="flex flex-col items-end gap-1.5 text-[11px] text-ink-4">
              <div className="flex items-center gap-1">
                <Calendar className="h-3 w-3" aria-hidden />
                <span>{rel}</span>
              </div>
              {cost > 0 ? (
                <span className="font-mono tabular-nums text-ink-3">
                  ~${cost.toFixed(3)}
                </span>
              ) : null}
            </div>
          </div>
          <div
            className={cn(
              "flex flex-wrap items-center gap-x-2 gap-y-1",
              "font-mono text-[10.5px] text-ink-4",
            )}
          >
            <span className="truncate">
              {pick("Çıkarım", "Extract")}: {extractLabel}
            </span>
            <span aria-hidden>·</span>
            <span className="truncate">
              {pick("Sentez", "Synth")}: {synthLabel}
            </span>
          </div>
        </Link>
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setConfirmOpen(true);
          }}
          aria-label={pick("Analizi sil", "Delete analysis")}
          className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-[8px] text-ink-4 transition-colors hover:bg-paper-3 hover:text-err"
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
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
        }}
      />
    </Card>
  );
}
