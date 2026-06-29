"use client";

import { Loader2, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useRouteParams } from "@/lib/utils/route-params";
import { AppShell } from "@/components/shell/AppShell";
import { AnalysisCard } from "@/components/article-analysis/AnalysisCard";
import { AnalysisEmptyState } from "@/components/article-analysis/AnalysisEmptyState";
import { AnalysisGenerateModal } from "@/components/article-analysis/AnalysisGenerateModal";
import { Button } from "@/components/ui/Button";
import { useLocalePick } from "@/i18n/IntlProvider";
import {
  useArticleAnalysesByWorkspace,
  useWorkspace,
} from "@/lib/db/hooks";

export default function AnalysisListPage() {
  const params = useRouteParams();
  const router = useRouter();
  const pick = useLocalePick();
  // Static export hydrates `[id]` to the literal "_" so the route still emits;
  // guard with the same pattern the roadmap / notes / read pages use.
  const idParam = typeof params?.id === "string" ? params.id : "";
  const workspaceId = idParam === "_" ? undefined : idParam;
  const workspace = useWorkspace(workspaceId);
  const analyses = useArticleAnalysesByWorkspace(workspaceId);
  const [modalOpen, setModalOpen] = useState(false);

  // `analyses` is `undefined` only while the live query is still resolving
  // (the hook drops its default for exactly this reason); a settled query is a
  // concrete array. Distinguishing the two avoids flashing the empty state.
  const loading = workspaceId !== undefined && analyses === undefined;
  const items = analyses ?? [];

  return (
    <AppShell
      workspaceId={workspaceId}
      title={pick("Analiz", "Analysis")}
      breadcrumb={
        workspace
          ? [
              pick(workspace.name, workspace.nameEn ?? workspace.name),
              pick("Analiz", "Analysis"),
            ]
          : undefined
      }
      topbarActions={
        <Button
          variant="primary"
          size="sm"
          onClick={() => setModalOpen(true)}
          disabled={!workspaceId}
        >
          <Sparkles className="h-3.5 w-3.5" aria-hidden />
          {pick("Analiz et", "Analyze")}
        </Button>
      }
    >
      <div className="mx-auto flex w-full max-w-[920px] flex-col gap-4 px-4 py-6 sm:px-6">
        <header className="flex flex-col gap-1">
          <h1 className="font-serif text-[24px] font-medium text-ink">
            {pick("Makale analizi", "Article analysis")}
          </h1>
          <p className="text-[13px] text-ink-3">
            {pick(
              "Zorlu bir makaleyi hızlıca anla: ne diyor, sorunu nasıl çözüyor, kıdemli hakem eleştirisi ve çift dilli terim sözlüğü.",
              "Understand a hard paper fast: what it says, how it solves the problem, a senior-reviewer critique, and a bilingual glossary.",
            )}
          </p>
        </header>
        {loading ? (
          <div className="flex items-center gap-2 px-1 py-8 text-[13px] text-ink-4">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            {pick("Yükleniyor…", "Loading…")}
          </div>
        ) : items.length === 0 ? (
          <AnalysisEmptyState onCreate={() => setModalOpen(true)} />
        ) : (
          <div className="flex flex-col gap-3">
            {items.map((analysis) => (
              <AnalysisCard
                key={analysis.id}
                workspaceId={workspaceId ?? ""}
                analysis={analysis}
              />
            ))}
          </div>
        )}
      </div>
      {workspaceId ? (
        <AnalysisGenerateModal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          workspaceId={workspaceId}
          onGenerated={(analysisId) => {
            setModalOpen(false);
            router.push(`/w/${workspaceId}/analysis/${analysisId}`);
          }}
        />
      ) : null}
    </AppShell>
  );
}
