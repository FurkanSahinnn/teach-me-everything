"use client";

import { Plus } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { RoadmapCard } from "@/components/roadmap/RoadmapCard";
import { RoadmapEmptyState } from "@/components/roadmap/RoadmapEmptyState";
import { RoadmapWizardModal } from "@/components/roadmap/RoadmapWizardModal";
import { Button } from "@/components/ui/Button";
import { useLocalePick } from "@/i18n/IntlProvider";
import { useRoadmapsByWorkspace, useWorkspace } from "@/lib/db/hooks";

export default function RoadmapListPage() {
  const params = useParams();
  const router = useRouter();
  const pick = useLocalePick();
  // The static-export build hydrates `[id]` to the literal string "_" so the
  // route still emits — guard with the same pattern other dynamic routes
  // use (notes, sources, plan).
  const idParam = typeof params?.id === "string" ? params.id : "";
  const workspaceId = idParam === "_" ? undefined : idParam;
  const workspace = useWorkspace(workspaceId);
  const roadmaps = useRoadmapsByWorkspace(workspaceId);
  const [wizardOpen, setWizardOpen] = useState(false);

  const items = roadmaps ?? [];

  return (
    <AppShell
      workspaceId={workspaceId}
      title={pick("Roadmap", "Roadmap")}
      breadcrumb={
        workspace
          ? [
              pick(workspace.name, workspace.nameEn ?? workspace.name),
              pick("Roadmap", "Roadmap"),
            ]
          : undefined
      }
      topbarActions={
        <Button
          variant="primary"
          size="sm"
          onClick={() => setWizardOpen(true)}
          disabled={!workspaceId}
        >
          <Plus className="h-3.5 w-3.5" aria-hidden />
          {pick("Yeni roadmap", "New roadmap")}
        </Button>
      }
    >
      <div className="mx-auto flex w-full max-w-[920px] flex-col gap-4 px-4 py-6 sm:px-6">
        <header className="flex flex-col gap-1">
          <h1 className="font-serif text-[24px] font-medium text-ink">
            {pick("Roadmap", "Roadmap")}
          </h1>
          <p className="text-[13px] text-ink-3">
            {pick(
              "AI ile prerequisite (önkoşul) grafiği oluştur, çalış ve geri dön.",
              "Build AI-authored prerequisite graphs, study them, return whenever.",
            )}
          </p>
        </header>
        {items.length === 0 ? (
          <RoadmapEmptyState />
        ) : (
          <div className="flex flex-col gap-3">
            {items.map((rmp) => (
              <RoadmapCard
                key={rmp.id}
                workspaceId={workspaceId ?? ""}
                roadmap={rmp}
              />
            ))}
          </div>
        )}
      </div>
      {workspaceId ? (
        <RoadmapWizardModal
          open={wizardOpen}
          onClose={() => setWizardOpen(false)}
          workspaceId={workspaceId}
          onCreated={(id) => {
            setWizardOpen(false);
            router.push(`/w/${workspaceId}/roadmap/${id}`);
          }}
        />
      ) : null}
    </AppShell>
  );
}
