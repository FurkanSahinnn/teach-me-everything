"use client";

import { ChevronLeft, Network } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { NodeInspector } from "@/components/roadmap/NodeInspector";
import { RoadmapCanvas } from "@/components/roadmap/RoadmapCanvas";
import { Chip } from "@/components/ui/Chip";
import { useLocalePick } from "@/i18n/IntlProvider";
import { moveRoadmapNode, resetRoadmapLayout } from "@/lib/db/roadmaps";
import {
  useRoadmap,
  useRoadmapCompleteNodeIds,
  useRoadmapEdges,
  useRoadmapNodes,
  useRoadmapProgress,
  useWorkspace,
} from "@/lib/db/hooks";
import { usePrefs } from "@/stores/prefs";
import { cn } from "@/lib/utils/cn";

export default function RoadmapGraphPage() {
  const params = useParams();
  const pick = useLocalePick();
  const idParam = typeof params?.id === "string" ? params.id : "";
  const roadmapIdParam =
    typeof params?.roadmapId === "string" ? params.roadmapId : "";
  const workspaceId = idParam === "_" ? undefined : idParam;
  const roadmapId = roadmapIdParam === "_" ? undefined : roadmapIdParam;

  const workspace = useWorkspace(workspaceId);
  const roadmap = useRoadmap(roadmapId);
  const nodesRaw = useRoadmapNodes(roadmapId);
  // Stabilise the array identity so the canvas + downstream memos don't churn
  // on every render (the `?? []` fallback would otherwise be a fresh array).
  const nodes = useMemo(() => nodesRaw ?? [], [nodesRaw]);
  const edges = useRoadmapEdges(roadmapId) ?? [];
  const progress = useRoadmapProgress(roadmapId) ?? { total: 0, done: 0 };
  const completeNodeIdsRaw = useRoadmapCompleteNodeIds(roadmapId);
  const completeSet = useMemo(
    () => new Set(completeNodeIdsRaw ?? []),
    [completeNodeIdsRaw],
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Local per-view language toggle, only meaningful for langMode "both". The
  // base record fields hold Turkish; the *En fields hold English. Defaults to
  // the user's global locale so the graph opens in their preferred language.
  const prefLocale = usePrefs((s) => s.locale);
  const isBoth = roadmap?.langMode === "both";
  const [viewLocale, setViewLocale] = useState<"tr" | "en">(prefLocale);

  // Swap node text to the chosen language only when this roadmap actually
  // carries both languages and the toggle is on EN — otherwise pass the nodes
  // through untouched (same array reference, so the canvas doesn't re-fit).
  const displayNodes = useMemo(() => {
    if (!isBoth || viewLocale !== "en") return nodes;
    return nodes.map((n) => ({
      ...n,
      title: n.titleEn ?? n.title,
      description: n.descriptionEn ?? n.description,
    }));
  }, [nodes, isBoth, viewLocale]);

  const displayTitle =
    isBoth && viewLocale === "en"
      ? roadmap?.titleEn ?? roadmap?.title
      : roadmap?.title;

  const selectedNode = useMemo(
    () =>
      selectedId
        ? displayNodes.find((n) => n.id === selectedId) ?? null
        : null,
    [selectedId, displayNodes],
  );
  const selectedHasChildren = useMemo(() => {
    if (!selectedId) return false;
    return nodes.some((n) => n.parentId === selectedId);
  }, [selectedId, nodes]);

  const pct =
    progress.total === 0
      ? 0
      : Math.round((progress.done / progress.total) * 100);

  const handleMoveNode = useCallback(
    (id: string, x: number, y: number) => {
      void moveRoadmapNode(id, x, y);
    },
    [],
  );
  const handleResetLayout = useCallback(() => {
    if (roadmapId) void resetRoadmapLayout(roadmapId);
  }, [roadmapId]);

  return (
    <AppShell
      workspaceId={workspaceId}
      title={roadmap?.title ?? pick("Roadmap", "Roadmap")}
      breadcrumb={
        workspace && roadmap
          ? [
              pick(workspace.name, workspace.nameEn ?? workspace.name),
              pick("Roadmap", "Roadmap"),
              roadmap.title,
            ]
          : undefined
      }
    >
      <div className="flex h-full w-full flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-rule-soft bg-paper-2 px-5 py-3">
          <div className="flex items-center gap-3 min-w-0">
            {workspaceId ? (
              <Link
                href={`/w/${workspaceId}/roadmap`}
                className="grid h-8 w-8 place-items-center rounded-[8px] text-ink-3 hover:bg-paper-3 hover:text-ink"
                aria-label={pick("Roadmap listesi", "Roadmap list")}
              >
                <ChevronLeft className="h-4 w-4" aria-hidden />
              </Link>
            ) : null}
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-[0.06em] text-ink-4">
                <Network className="h-3 w-3" aria-hidden />
                {pick("Roadmap", "Roadmap")}
                {roadmap ? (
                  <>
                    <span>·</span>
                    <span>
                      {pick(
                        roadmap.timeframe === "daily"
                          ? "Günlük"
                          : roadmap.timeframe === "weekly"
                            ? "Haftalık"
                            : "Aylık",
                        roadmap.timeframe.charAt(0).toUpperCase() +
                          roadmap.timeframe.slice(1),
                      )}
                    </span>
                  </>
                ) : null}
              </div>
              <h1 className="truncate font-serif text-[17px] font-medium text-ink">
                {displayTitle ?? "…"}
              </h1>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {isBoth ? (
              <div
                className="flex items-center rounded-[8px] border border-rule-soft bg-paper-2 p-0.5 text-[11px] font-mono font-medium"
                role="group"
                aria-label={pick("Dil", "Language")}
              >
                {(["tr", "en"] as const).map((lc) => (
                  <button
                    key={lc}
                    type="button"
                    onClick={() => setViewLocale(lc)}
                    aria-pressed={viewLocale === lc}
                    className={cn(
                      "rounded-[6px] px-2 py-0.5 uppercase tracking-[0.04em] transition-colors",
                      viewLocale === lc
                        ? "bg-accent text-paper"
                        : "text-ink-3 hover:text-ink",
                    )}
                  >
                    {lc}
                  </button>
                ))}
              </div>
            ) : null}
            <div className="flex items-center gap-2 text-[12px] text-ink-3">
              <div className="w-28 h-1.5 rounded-full bg-paper-3 overflow-hidden">
                <div
                  className="h-full bg-accent"
                  style={{ width: `${pct}%` }}
                  aria-hidden
                />
              </div>
              <span className="font-mono tabular-nums">
                {progress.done} / {progress.total}
              </span>
            </div>
            <Chip variant="muted">{pct}%</Chip>
          </div>
        </header>
        <div className="relative flex-1 overflow-hidden bg-paper">
          {roadmap === null ? (
            <div className="absolute inset-0 grid place-items-center text-[13px] text-ink-3">
              {pick("Roadmap bulunamadı.", "Roadmap not found.")}
            </div>
          ) : (
            <RoadmapCanvas
              nodes={displayNodes}
              edges={edges}
              selectedId={selectedId}
              onSelectNode={setSelectedId}
              completeIds={completeSet}
              onMoveNode={handleMoveNode}
              onResetLayout={handleResetLayout}
            />
          )}
          {roadmap && selectedNode ? (
            <NodeInspector
              roadmap={roadmap}
              node={selectedNode}
              hasChildren={selectedHasChildren}
              onClose={() => setSelectedId(null)}
            />
          ) : null}
        </div>
      </div>
    </AppShell>
  );
}
