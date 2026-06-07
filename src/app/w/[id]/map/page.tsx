"use client";

import { ChevronRight, Network, Sparkles } from "lucide-react";
import Link from "next/link";
import { notFound, useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { ConceptInspector } from "@/components/mindmap/ConceptInspector";
import { MindMapCanvas } from "@/components/mindmap/MindMapCanvas";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { useLocalePick } from "@/i18n/IntlProvider";
import {
  useConceptEdgesByWorkspace,
  useConceptsByWorkspace,
  useWorkspace,
} from "@/lib/db/hooks";
import { usePrefs } from "@/stores/prefs";
import { cn } from "@/lib/utils/cn";

export default function MindMapPage() {
  const params = useParams<{ id: string }>();
  const workspaceId = params.id;
  const ws = useWorkspace(workspaceId);
  const concepts = useConceptsByWorkspace(workspaceId) ?? [];
  const edges = useConceptEdgesByWorkspace(workspaceId) ?? [];
  const t = useTranslations("map");
  const pick = useLocalePick();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);

  // Local per-view language toggle, only meaningful when some concept carries
  // an English companion (langMode "both" extraction). base label/definition
  // hold Turkish; *En fields hold English. Defaults to the user's global locale
  // so the map opens in their preferred language; never mutates global state.
  const prefLocale = usePrefs((s) => s.locale);
  const [viewLocale, setViewLocale] = useState<"tr" | "en">(prefLocale);
  const hasBilingual = useMemo(
    () => concepts.some((c) => c.labelEn !== undefined),
    [concepts],
  );

  // Swap concept text to the chosen language only when a bilingual graph is
  // shown EN — otherwise pass concepts through untouched (same reference, so
  // the canvas doesn't re-run its force layout).
  const displayConcepts = useMemo(() => {
    if (!hasBilingual || viewLocale !== "en") return concepts;
    return concepts.map((c) => ({
      ...c,
      label: c.labelEn ?? c.label,
      ...(c.definitionEn !== undefined ? { definition: c.definitionEn } : {}),
    }));
  }, [concepts, hasBilingual, viewLocale]);

  const containerRef = useRef<HTMLDivElement>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 500 });

  // Track canvas container size so the layout adapts to window resize +
  // sidebar toggle without redoing layout on every interaction.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setCanvasSize({
        width: Math.max(320, Math.floor(width)),
        height: Math.max(320, Math.floor(height)),
      });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const selectedConcept = useMemo(
    () => displayConcepts.find((c) => c.id === selectedId) ?? null,
    [displayConcepts, selectedId],
  );

  if (ws === undefined) return null;
  if (ws === null) notFound();

  const breadcrumb = [
    t("dashboard"),
    pick(ws.name, ws.nameEn ?? ws.name),
    t("zihin_haritasi"),
  ];

  return (
    <AppShell workspaceId={workspaceId} breadcrumb={breadcrumb}>
      <div className="flex h-[calc(100vh-var(--topbar-h,56px))] flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-rule-soft px-6 py-3">
          <div className="min-w-0">
            <div className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-ink-3">
              {pick(ws.name, ws.nameEn ?? ws.name)}
            </div>
            <h1 className="mt-0.5 font-serif text-[20px] font-normal leading-tight tracking-[-0.005em]">
              {pick("Zihin haritası", "Mind map")}
            </h1>
          </div>
          <div className="flex items-center gap-2 text-[11.5px] font-mono text-ink-3">
            {hasBilingual ? (
              <div
                className="mr-1 flex items-center rounded-[8px] border border-rule-soft bg-paper-2 p-0.5 text-[11px] font-mono font-medium"
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
            <span>{concepts.length} {pick("konsept", "concepts")}</span>
            <span aria-hidden>·</span>
            <span>{edges.length} {pick("kenar", "edges")}</span>
            <Link href="/settings#concepts" className="ml-3">
              <Button size="sm">
                <Sparkles className="h-3.5 w-3.5" aria-hidden />
                {pick("Yeniden çıkar", "Re-extract")}
              </Button>
            </Link>
          </div>
        </header>

        {concepts.length === 0 ? (
          <div className="flex-1 grid place-items-center px-6">
            <EmptyState
              icon={<Network className="h-6 w-6" aria-hidden />}
              title={pick(
                "Bu workspace için henüz konsept yok.",
                "No concepts for this workspace yet.",
              )}
              description={pick(
                "Settings → Konseptler üzerinden modeli çalıştır; kaynak chunk'larından bir konsept grafiği üretir.",
                "Run extraction from Settings → Concepts; it builds a concept graph from your source chunks.",
              )}
              action={{
                label: pick("Konseptleri çıkar", "Extract concepts"),
                href: "/settings#concepts",
              }}
            />
          </div>
        ) : (
          <>
            {/* Desktop: 2-column canvas + inspector */}
            <div className="hidden flex-1 overflow-hidden md:flex">
              <div ref={containerRef} className="relative flex-1 bg-paper">
                <MindMapCanvas
                  concepts={displayConcepts}
                  edges={edges}
                  width={canvasSize.width}
                  height={canvasSize.height}
                  {...(selectedId !== null ? { selectedId } : {})}
                  onSelect={setSelectedId}
                />
              </div>
              <aside className="hidden w-[360px] shrink-0 border-l border-rule-soft bg-paper-2 md:block">
                <ConceptInspector
                  concept={selectedConcept}
                  concepts={displayConcepts}
                  edges={edges}
                  onSelect={setSelectedId}
                />
              </aside>
            </div>

            {/* Mobile: read-only concept list */}
            <div className="flex-1 overflow-y-auto md:hidden">
              <ConceptList
                concepts={displayConcepts}
                edges={edges}
                onTap={(id) => {
                  setSelectedId(id);
                  setMobileSheetOpen(true);
                }}
              />
            </div>
            {mobileSheetOpen && selectedConcept ? (
              <div className="fixed inset-0 z-40 flex flex-col bg-paper md:hidden">
                <ConceptInspector
                  concept={selectedConcept}
                  concepts={displayConcepts}
                  edges={edges}
                  onSelect={(id) => setSelectedId(id)}
                  onClose={() => setMobileSheetOpen(false)}
                />
              </div>
            ) : null}
          </>
        )}
      </div>
    </AppShell>
  );
}

function ConceptList({
  concepts,
  edges,
  onTap,
}: {
  concepts: NonNullable<ReturnType<typeof useConceptsByWorkspace>>;
  edges: NonNullable<ReturnType<typeof useConceptEdgesByWorkspace>>;
  onTap: (id: string) => void;
}) {
  const pick = useLocalePick();
  const edgeCountById = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of edges) {
      m.set(e.fromId, (m.get(e.fromId) ?? 0) + 1);
      m.set(e.toId, (m.get(e.toId) ?? 0) + 1);
    }
    return m;
  }, [edges]);
  return (
    <div className="divide-y divide-rule-soft">
      {concepts.map((c) => (
        <button
          key={c.id}
          onClick={() => onTap(c.id)}
          className={cn(
            "group flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-[background-color,border-color] duration-[180ms] ease-[cubic-bezier(0.2,0.6,0.2,1)] hover:bg-paper-2 active:bg-paper-3 focus:outline-none focus-visible:bg-paper-2 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent/50",
          )}
        >
          <div className="min-w-0">
            <div className="text-[14px] text-ink transition-colors group-hover:text-accent-ink">{c.label}</div>
            <div className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-3">
              {c.kind} · {edgeCountById.get(c.id) ?? 0}{" "}
              {pick("ilişki", "edges")}
            </div>
          </div>
          <ChevronRight
            className="h-4 w-4 shrink-0 text-ink-4 transition-[transform,color] duration-[180ms] group-hover:translate-x-0.5 group-hover:text-accent"
            aria-hidden
          />
        </button>
      ))}
    </div>
  );
}
