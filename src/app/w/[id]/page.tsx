"use client";

import {
  BookOpen,
  ChevronDown,
  FileText,
  Headphones,
  Highlighter,
  Layers,
  Map,
  NotebookPen,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Sparkles,
  SquareStack,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { EmptyState } from "@/components/ui/EmptyState";
import { ConfirmDeleteModal } from "@/components/ui/ConfirmDeleteModal";
import { Input } from "@/components/ui/Input";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { useRouteParams } from "@/lib/utils/route-params";
import { useTranslations } from "next-intl";
import { AppShell } from "@/components/shell/AppShell";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { Skeleton } from "@/components/ui/Skeleton";
import { AddUrlModal } from "@/components/sources/AddUrlModal";
import { GenerateScriptModal } from "@/components/podcast/GenerateScriptModal";
import { SearchSourcesModal } from "@/components/research/SearchSourcesModal";
import {
  SourceUploadProvider,
  useSourceUpload,
} from "@/components/sources/SourceUploader";
import { useLocalePick } from "@/i18n/IntlProvider";
import {
  useFlashcardCount,
  useHighlightCount,
  useSourceCount,
  useSources,
  useWorkspace,
} from "@/lib/db/hooks";
import type {
  EmbeddingStatus,
  IngestStatus,
  SourceRecord,
  SourceType,
} from "@/lib/db/types";
import { cn } from "@/lib/utils/cn";
import { formatRelativeDay } from "@/lib/utils/intl";
import { usePrefs } from "@/stores/prefs";
import { useVault } from "@/stores/vault";
import { useToast } from "@/components/ui/Toast";
import { getApiKey, hasApiKey } from "@/lib/db/api-keys-repo";
import { deleteSource } from "@/lib/db/sources";
import { runReembed, presetToProviderId } from "@/lib/ingest/reembed";
import { EMBED_PRESETS, type EmbedPresetId } from "@/lib/ai/providers/embed-presets";
import { isLocalUrl } from "@/lib/ai/providers/local-bypass";
import { buildSourceClickHref } from "@/lib/notes/source-routing";
import type { Provider } from "@/lib/db/schema";

type SortKey =
  | "updated_desc"
  | "updated_asc"
  | "created_desc"
  | "created_asc"
  | "title_asc"
  | "pages_desc"
  | "size_desc";

const SORT_LABEL: Record<SortKey, { tr: string; en: string }> = {
  updated_desc: { tr: "Güncellenme (yeni → eski)", en: "Updated (newest)" },
  updated_asc: { tr: "Güncellenme (eski → yeni)", en: "Updated (oldest)" },
  created_desc: { tr: "Eklenme (yeni → eski)", en: "Added (newest)" },
  created_asc: { tr: "Eklenme (eski → yeni)", en: "Added (oldest)" },
  title_asc: { tr: "İsim (A → Z)", en: "Title (A → Z)" },
  pages_desc: { tr: "Sayfa sayısı (çok → az)", en: "Page count (most)" },
  size_desc: { tr: "Boyut (büyük → küçük)", en: "Size (largest)" },
};

const SORT_ORDER: SortKey[] = [
  "updated_desc",
  "updated_asc",
  "created_desc",
  "created_asc",
  "title_asc",
  "pages_desc",
  "size_desc",
];

function compareSources(a: SourceRecord, b: SourceRecord, key: SortKey): number {
  switch (key) {
    case "updated_desc":
      return b.updatedAt - a.updatedAt;
    case "updated_asc":
      return a.updatedAt - b.updatedAt;
    case "created_desc":
      return b.createdAt - a.createdAt;
    case "created_asc":
      return a.createdAt - b.createdAt;
    case "title_asc":
      return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
    case "pages_desc":
      // Sources without page counts (txt/md/url etc.) sink to the bottom so
      // the user sees the meaningful entries first.
      return (b.pageCount ?? -1) - (a.pageCount ?? -1);
    case "size_desc":
      return (b.byteSize ?? -1) - (a.byteSize ?? -1);
  }
}

const TYPE_LABEL: Record<SourceType, { tr: string; en: string }> = {
  pdf: { tr: "PDF", en: "PDF" },
  docx: { tr: "Word", en: "Word" },
  epub: { tr: "EPUB", en: "EPUB" },
  md: { tr: "Markdown", en: "Markdown" },
  txt: { tr: "Metin", en: "Text" },
  rtf: { tr: "RTF", en: "RTF" },
  image: { tr: "Görsel", en: "Image" },
  youtube: { tr: "YouTube", en: "YouTube" },
  arxiv: { tr: "arXiv", en: "arXiv" },
  doi: { tr: "DOI", en: "DOI" },
  url: { tr: "URL", en: "URL" },
  // Phase 6.9 — Notes-as-Source. User-authored markdown notes (Phase 6
  // vault) embedded into the RAG layer; surfaced on the Sources list with
  // a "from note" label so users can spot them at a glance.
  note: { tr: "Not", en: "Note" },
};

const STATUS_LABEL: Record<IngestStatus, { tr: string; en: string }> = {
  pending: { tr: "Bekliyor", en: "Pending" },
  parsing: { tr: "Ayrıştırılıyor", en: "Parsing" },
  chunking: { tr: "Bölünüyor", en: "Chunking" },
  ready: { tr: "Hazır", en: "Ready" },
  error: { tr: "Hata", en: "Error" },
};

const EMBEDDING_STATUS_LABEL: Record<EmbeddingStatus, { tr: string; en: string }> = {
  missing: { tr: "Embedding yok", en: "No embedding" },
  queued: { tr: "Embedding bekliyor", en: "Embedding queued" },
  embedding: { tr: "Embedding üretiliyor", en: "Embedding" },
  ready: { tr: "AI arama hazır", en: "AI search ready" },
  skipped: { tr: "Embedding atlandı", en: "Embedding skipped" },
  error: { tr: "Embedding hatası", en: "Embedding error" },
};

// A source is embeddable from the bulk bar when its text is fully ingested
// (chunks exist) but its vectors are missing/stale. Kept in lockstep with
// countSourcesNeedingEmbedding's predicate so the bulk count, the per-row
// retry, and the DB-side helper all agree on what "needs embedding" means.
function sourceNeedsEmbedding(s: SourceRecord): boolean {
  if (s.ingestStatus !== "ready") return false;
  const es = s.embeddingStatus;
  return (
    es === undefined ||
    es === "missing" ||
    es === "skipped" ||
    es === "error"
  );
}

type EmbedAuthToast = { variant: "warn"; title: string; description: string };

// Shared embedding-credential resolution for both the per-row retry and the
// bulk "embed missing" action, so the two paths can never diverge on which
// preset/provider key they read or how they report a missing one. Returns the
// resolved key + preset id, or a ready-to-toast warning (no key / locked
// vault). Local presets resolve to an empty key (no credential needed).
async function resolveEmbedAuth(
  pick: (tr: string, en: string) => string,
): Promise<{ apiKey: string; presetId: EmbedPresetId } | { error: EmbedAuthToast }> {
  const { embedPresetId } = usePrefs.getState().modelBindings;
  const preset =
    EMBED_PRESETS[embedPresetId as EmbedPresetId] ??
    EMBED_PRESETS["openai-3-small"];
  const providerId = presetToProviderId(preset.id);
  const isLocal = preset.isLocal === true || isLocalUrl(preset.baseUrl);

  const { isUnlocked, masterKey } = useVault.getState();
  let apiKey: string | null = null;
  if (isLocal) {
    apiKey = "";
  } else if (isUnlocked && masterKey) {
    try {
      apiKey = await getApiKey(providerId as Provider);
    } catch {
      apiKey = null;
    }
  }

  if (apiKey == null) {
    const lockedButStored =
      !isLocal &&
      !isUnlocked &&
      (await hasApiKey(providerId as Provider).catch(() => false));
    return {
      error: {
        variant: "warn",
        title: lockedButStored
          ? pick("Vault kilitli", "Vault locked")
          : pick(
              `${preset.label} anahtarı yok`,
              `${preset.label} key missing`,
            ),
        description: lockedButStored
          ? pick(
              "Master parolayı girince yeniden dene.",
              "Unlock the vault and try again.",
            )
          : pick(
              "Ayarlardan ekleyince retrieval'a hazır.",
              "Add it in Settings to enable retrieval.",
            ),
      },
    };
  }
  return { apiKey, presetId: preset.id };
}

export default function WorkspacePage() {
  const params = useRouteParams<{ id: string }>();
  const id = params.id;

  return (
    <SourceUploadProvider workspaceId={id}>
      <WorkspaceView id={id} />
    </SourceUploadProvider>
  );
}

function WorkspaceView({ id }: { id: string }) {
  const t = useTranslations("workspace");
  const pick = useLocalePick();
  const ws = useWorkspace(id);
  const sources = useSources(id) ?? [];
  const sourceCount = useSourceCount(id) ?? 0;
  const highlightCount = useHighlightCount(id) ?? 0;
  const flashcardCount = useFlashcardCount(id) ?? 0;
  const { toast } = useToast();

  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | SourceType>("all");
  const [sort, setSort] = useState<SortKey>("updated_desc");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkEmbedding, setBulkEmbedding] = useState(false);
  const [embedProgress, setEmbedProgress] = useState({ done: 0, total: 0 });
  // Synchronous re-entrancy guard. The Button's `disabled` attribute reflects
  // `bulkEmbedding` state, which isn't guaranteed painted before a same-tick
  // second activation (double-click / Enter+click), and the closure's
  // `bulkEmbedding` is stale until re-render. A ref flips immediately.
  const bulkEmbedRunningRef = useRef(false);
  const [addUrlOpen, setAddUrlOpen] = useState(false);
  const [searchSourcesOpen, setSearchSourcesOpen] = useState(false);
  const [podcastOpen, setPodcastOpen] = useState(false);
  // Lifted out of SourceDeleteButton — the trigger button lives inside <Link>,
  // and React synthetic events bubble through the React tree even from
  // portal'd children, so a modal rendered inside SourceDeleteButton would
  // forward every click into the row's Link and navigate the user away.
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const deleteTarget =
    deleteTargetId !== null
      ? (sources.find((s) => s.id === deleteTargetId) ?? null)
      : null;

  // Surface only the source types actually present in this workspace so the
  // filter row stays compact instead of listing every supported format.
  const presentTypes = useMemo(() => {
    const seen = new Set<SourceType>();
    for (const s of sources) seen.add(s.type);
    const order: SourceType[] = [
      "pdf",
      "docx",
      "epub",
      "md",
      "txt",
      "rtf",
      "image",
      "youtube",
      "arxiv",
      "doi",
      "url",
    ];
    // Always-on chips: the four canonical source kinds users routinely
    // ingest. Even an empty workspace should hint at filterable types so
    // it's clear what can be added later. Less common formats (docx/epub/
    // txt/rtf/image) stay dynamic — they'd otherwise clutter the panel.
    const ALWAYS_SHOW: ReadonlySet<SourceType> = new Set([
      "pdf",
      "md",
      "url",
      "youtube",
    ]);
    return order.filter((type) => seen.has(type) || ALWAYS_SHOW.has(type));
  }, [sources]);

  const filteredSources = useMemo(() => {
    const q = query.trim().toLowerCase();
    const subset = sources.filter((s) => {
      if (typeFilter !== "all" && s.type !== typeFilter) return false;
      if (q) {
        const hay =
          `${s.title} ${s.titleEn ?? ""} ${s.author ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    return [...subset].sort((a, b) => compareSources(a, b, sort));
  }, [sources, query, typeFilter, sort]);

  // Drop selections that no longer point to existing sources (post-delete or
  // post-filter-change). Selection state outliving its rows is the most
  // common cause of "ghost" bulk actions.
  useEffect(() => {
    const ids = new Set(sources.map((s) => s.id));
    setSelected((prev) => {
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (ids.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [sources]);

  function toggleSelect(sourceId: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(sourceId)) next.delete(sourceId);
      else next.add(sourceId);
      return next;
    });
  }

  function toggleSelectAll(): void {
    setSelected((prev) => {
      const visibleIds = filteredSources.map((s) => s.id);
      const allSelected =
        visibleIds.length > 0 &&
        visibleIds.every((sid) => prev.has(sid));
      if (allSelected) {
        const next = new Set(prev);
        for (const sid of visibleIds) next.delete(sid);
        return next;
      }
      const next = new Set(prev);
      for (const sid of visibleIds) next.add(sid);
      return next;
    });
  }

  async function handleSingleDelete(): Promise<void> {
    const target = deleteTarget;
    if (!target) return;
    try {
      await deleteSource(target.id);
      setDeleteTargetId(null);
      toast({
        variant: "success",
        title: pick("Kaynak silindi", "Source deleted"),
        description: pick(target.title, target.titleEn ?? target.title),
      });
    } catch (err) {
      toast({
        variant: "error",
        title: pick("Silme başarısız", "Delete failed"),
        description: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function handleBulkDelete(): Promise<void> {
    if (selected.size === 0 || bulkDeleting) return;
    setBulkDeleting(true);
    const ids = Array.from(selected);
    let ok = 0;
    let failed = 0;
    try {
      for (const sid of ids) {
        try {
          await deleteSource(sid);
          ok += 1;
        } catch {
          failed += 1;
        }
      }
      setSelected(new Set());
      setBulkDeleteOpen(false);
      if (failed === 0) {
        toast({
          variant: "success",
          title: pick(
            `${ok} kaynak silindi`,
            `${ok} sources deleted`,
          ),
        });
      } else {
        toast({
          variant: "warn",
          title: pick(
            `${ok} silindi · ${failed} hatalı`,
            `${ok} deleted · ${failed} failed`,
          ),
        });
      }
    } finally {
      setBulkDeleting(false);
    }
  }

  // Selected sources whose chunks exist but vectors are missing/stale — the
  // targets of the bulk "embed missing" action. Already-embedded selections
  // are excluded so the button count is honest and ready rows are never
  // re-billed.
  const embeddableSelected = useMemo(
    () => sources.filter((s) => selected.has(s.id) && sourceNeedsEmbedding(s)),
    [sources, selected],
  );

  async function handleBulkEmbed(): Promise<void> {
    if (bulkEmbedRunningRef.current) return;
    const targets = embeddableSelected;
    if (targets.length === 0) return;
    bulkEmbedRunningRef.current = true;
    setBulkEmbedding(true);
    setEmbedProgress({ done: 0, total: targets.length });

    let embedded = 0; // sources that actually had vectors written
    let failed = 0;
    try {
      const auth = await resolveEmbedAuth(pick);
      if ("error" in auth) {
        toast(auth.error);
        return;
      }
      // Sequential: the embed worker is single-threaded, so parallel runReembed
      // calls would contend. Mirrors the bulk-delete loop above.
      for (const s of targets) {
        try {
          const handle = runReembed({
            scope: { kind: "source", sourceId: s.id },
            apiKey: auth.apiKey,
            presetId: auth.presetId,
          });
          const result = await handle.promise;
          // runReembed resolves {total:0} when a source's chunks already match
          // the target dim (or it has none) — nothing is written and the row's
          // status is left untouched. Counting that as "embedded" would falsely
          // claim success, so only count rows that actually got vectors.
          if (result.total > 0) embedded += 1;
        } catch {
          failed += 1;
        } finally {
          setEmbedProgress((p) => ({ ...p, done: p.done + 1 }));
        }
      }
      // Embedded rows flip to "ready" via useLiveQuery, so sourceNeedsEmbedding
      // drops them from embeddableSelected and the button count updates on its
      // own — no manual selection edit needed.
      if (failed > 0) {
        toast({
          variant: "warn",
          title: pick(
            `${embedded} gömüldü · ${failed} hatalı`,
            `${embedded} embedded · ${failed} failed`,
          ),
        });
      } else if (embedded === 0) {
        toast({
          variant: "info",
          title: pick("Gömülecek yeni chunk yok", "Nothing new to embed"),
        });
      } else {
        toast({
          variant: "success",
          title: pick(
            `${embedded} kaynak gömüldü`,
            `${embedded} sources embedded`,
          ),
          description: pick(
            "Retrieval artık çalışır.",
            "Retrieval is live now.",
          ),
        });
      }
    } finally {
      bulkEmbedRunningRef.current = false;
      setBulkEmbedding(false);
      setEmbedProgress({ done: 0, total: 0 });
    }
  }

  const visibleIds = filteredSources.map((s) => s.id);
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((sid) => selected.has(sid));
  const someVisibleSelected =
    visibleIds.some((sid) => selected.has(sid)) && !allVisibleSelected;

  if (ws === undefined) {
    return (
      <AppShell
        workspaceId={id}
        breadcrumb={[t("dashboard"), pick("Yükleniyor…", "Loading…")]}
      >
        <div className="page-container">
          <WorkspaceHeaderSkeleton />
          <SourcesGridSkeleton />
        </div>
      </AppShell>
    );
  }

  if (ws === null) notFound();

  const firstSource = sources[0];
  // Route the "resume reading" card through the same helper as row clicks so
  // a note-source at the top of the list opens in /notes, not /read.
  const firstSourceHref = firstSource
    ? buildSourceClickHref(firstSource, id)
    : `/w/${id}`;

  return (
    <AppShell
      workspaceId={id}
      breadcrumb={[t("dashboard"), pick(ws.name, ws.nameEn ?? ws.name)]}
      topbarActions={<HeaderUploadButton label={t("kaynak_ekle")} />}
    >
      <div className="page-container">
        <header className="mb-7 rounded-[var(--radius-lg)] border border-rule bg-paper-2 p-4 shadow-[var(--shadow-soft)] sm:p-5">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="flex min-w-0 items-start gap-4">
              <span
                className="grid h-12 w-12 shrink-0 place-items-center rounded-[12px] text-[18px] font-semibold text-white"
                style={{ backgroundColor: ws.color }}
                aria-hidden
              >
                {ws.initials}
              </span>
              <div className="min-w-0">
                <div className="eyebrow">{t("calisma_alani")}</div>
                <h1 className="mt-1 truncate text-[28px] font-semibold leading-tight tracking-[-0.025em] sm:text-[36px]">
                  {pick(ws.name, ws.nameEn ?? ws.name)}
                </h1>
                {ws.goal ? (
                  <p className="mt-2 max-w-[72ch] text-[14px] leading-6 text-ink-3">
                    {pick(ws.goal, ws.goalEn ?? ws.goal)}
                  </p>
                ) : null}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3 text-[12.5px] text-ink-3 sm:min-w-[360px]">
              <WorkspaceStat
                icon={FileText}
                value={sourceCount}
                label={t("kaynak")}
              />
              <WorkspaceStat
                icon={Highlighter}
                value={highlightCount}
                label={t("highlight")}
              />
              <WorkspaceStat
                icon={SquareStack}
                value={flashcardCount}
                label={t("kart")}
              />
            </div>
          </div>
        </header>

        <section className="mb-7 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <QuickAction
            href={firstSourceHref}
            icon={BookOpen}
            title={t("okumaya_basla")}
            subtitle={pick(
              "Son okuduğun yerden devam et",
              "Resume where you left off",
            )}
          />
          <QuickAction
            href={`/w/${id}/cards`}
            icon={Layers}
            title={t("kart_tekrari")}
            subtitle={t("7_kart_bugun")}
          />
          <QuickAction
            href={`/w/${id}/quiz`}
            icon={SquareStack}
            title={t("quiz_baslat")}
            subtitle={t("4_uzerine_8_soru")}
          />
          <QuickAction
            href={`/w/${id}/map`}
            icon={Map}
            title={t("zihin_haritasi")}
            subtitle={t("42_konsept_89_baglanti")}
          />
        </section>

        <section>
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-[20px] font-semibold tracking-[-0.01em]">
                {t("kaynaklar")}
              </h2>
              <p className="mt-1 max-w-[62ch] text-[13px] leading-6 text-ink-3">
                {pick(
                  "PDF, makale, kitap, not — her şey aynı çalışma alanında.",
                  "PDFs, papers, books, notes — all in one workspace.",
                )}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <SectionUploadButton label={t("yukle")} />
              <Button
                size="sm"
                variant="accent"
                onClick={() => setAddUrlOpen(true)}
              >
                <Plus className="h-3.5 w-3.5" aria-hidden />
                {t("url_doi_ekle")}
              </Button>
              <Button
                size="sm"
                variant="default"
                onClick={() => setSearchSourcesOpen(true)}
                data-testid="open-search-sources-modal"
              >
                <Search className="h-3.5 w-3.5" aria-hidden />
                {t("konu_ara")}
              </Button>
              <Button
                size="sm"
                variant="default"
                onClick={() => setPodcastOpen(true)}
              >
                <Headphones className="h-3.5 w-3.5" aria-hidden />
                {t("podcast_olustur")}
              </Button>
            </div>
          </div>

          {sources.length === 0 ? (
            <EmptySourcesState pageLabel={t("yukle")} />
          ) : (
            <>
              <SourcesToolbar
                query={query}
                onQueryChange={setQuery}
                typeFilter={typeFilter}
                onTypeFilterChange={setTypeFilter}
                sort={sort}
                onSortChange={setSort}
                presentTypes={presentTypes}
                selectedCount={selected.size}
                embeddableCount={embeddableSelected.length}
                bulkEmbedding={bulkEmbedding}
                embedProgress={embedProgress}
                onBulkEmbed={() => void handleBulkEmbed()}
                onClearSelection={() => setSelected(new Set())}
                onBulkDelete={() => setBulkDeleteOpen(true)}
                pick={pick}
              />

              {filteredSources.length === 0 ? (
                <Card variant="sunken" className="min-h-[200px]">
                  <EmptyState
                    icon={<Search />}
                    title={pick(
                      "Eşleşen kaynak yok",
                      "No matching sources",
                    )}
                    description={pick(
                      "Aramayı veya tür filtresini değiştirmeyi dene.",
                      "Try a different search or type filter.",
                    )}
                    {...(query ||
                    typeFilter !== "all" ||
                    sort !== "updated_desc"
                      ? {
                          action: {
                            label: pick("Filtreleri sıfırla", "Reset filters"),
                            onClick: () => {
                              setQuery("");
                              setTypeFilter("all");
                              setSort("updated_desc");
                            },
                          },
                        }
                      : {})}
                  />
                </Card>
              ) : (
                <>
                  <Card className="hidden overflow-hidden md:block">
                    <div className="grid grid-cols-[28px_1fr_110px_130px_150px_120px_36px] items-center gap-4 border-b border-rule-soft bg-paper-2 px-4 py-2.5 font-mono text-[10.5px] uppercase tracking-[0.04em] text-ink-3">
                      <SelectAllCheckbox
                        allSelected={allVisibleSelected}
                        someSelected={someVisibleSelected}
                        onToggle={toggleSelectAll}
                        pick={pick}
                      />
                      <span>{t("baslik")}</span>
                      <span>{t("tur")}</span>
                      <span>{pick("Durum", "Status")}</span>
                      <span>{pick("AI arama", "AI search")}</span>
                      <span className="text-right">{t("guncellenme")}</span>
                      <span aria-hidden />
                    </div>
                    {filteredSources.map((s, i) => (
                      <SourceRow
                        key={s.id}
                        source={s}
                        href={buildSourceClickHref(s, id)}
                        bordered={i < filteredSources.length - 1}
                        pick={pick}
                        pageLabel={t("sayfa")}
                        selected={selected.has(s.id)}
                        onToggleSelect={toggleSelect}
                        onRequestDelete={setDeleteTargetId}
                      />
                    ))}
                  </Card>

                  <div className="grid grid-cols-1 gap-3 md:hidden">
                    {filteredSources.map((s) => (
                      <SourceCard
                        key={s.id}
                        source={s}
                        href={buildSourceClickHref(s, id)}
                        pick={pick}
                        pageLabel={t("sayfa")}
                        selected={selected.has(s.id)}
                        onToggleSelect={toggleSelect}
                        onRequestDelete={setDeleteTargetId}
                      />
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </section>
      </div>

      <ConfirmDeleteModal
        open={bulkDeleteOpen}
        onClose={() => setBulkDeleteOpen(false)}
        onConfirm={handleBulkDelete}
        title={pick(
          `${selected.size} kaynağı sil?`,
          `Delete ${selected.size} sources?`,
        )}
        description={pick(
          "Seçili kaynaklara bağlı tüm chunk, highlight, sohbet, quiz ve konsept bağlantıları da silinir. Bu işlem geri alınamaz.",
          "All chunks, highlights, chats, quizzes, and concept links tied to the selected sources will also be removed. This cannot be undone.",
        )}
        confirmText="DELETE"
        confirmInputLabel={pick(
          'Onaylamak için "DELETE" yaz:',
          'Type "DELETE" to confirm:',
        )}
        confirmButtonLabel={pick(
          `${selected.size} kaynağı sil`,
          `Delete ${selected.size} sources`,
        )}
        cancelButtonLabel={pick("Vazgeç", "Cancel")}
      />

      <ConfirmDeleteModal
        open={deleteTarget !== null}
        onClose={() => setDeleteTargetId(null)}
        onConfirm={handleSingleDelete}
        title={pick("Kaynağı sil?", "Delete source?")}
        description={pick(
          "Bu kaynağa bağlı chunk, highlight, sohbet, quiz ve konsept bağlantıları da silinir. Bu işlem geri alınamaz.",
          "All chunks, highlights, chats, quizzes, and concept links tied to this source will also be removed. This cannot be undone.",
        )}
        confirmText={
          deleteTarget
            ? pick(deleteTarget.title, deleteTarget.titleEn ?? deleteTarget.title)
            : ""
        }
        confirmInputLabel={
          deleteTarget
            ? pick(
                `Onaylamak için kaynağın adını yaz: "${pick(deleteTarget.title, deleteTarget.titleEn ?? deleteTarget.title)}"`,
                `Type the source title to confirm: "${pick(deleteTarget.title, deleteTarget.titleEn ?? deleteTarget.title)}"`,
              )
            : ""
        }
        confirmButtonLabel={pick("Sil", "Delete")}
        cancelButtonLabel={pick("Vazgeç", "Cancel")}
      />
      <AddUrlModal
        open={addUrlOpen}
        onClose={() => setAddUrlOpen(false)}
        workspaceId={id}
      />
      <SearchSourcesModal
        open={searchSourcesOpen}
        onClose={() => setSearchSourcesOpen(false)}
        workspaceId={id}
      />
      <GenerateScriptModal
        open={podcastOpen}
        onClose={() => setPodcastOpen(false)}
        workspaceId={id}
        workspace={{
          name: ws.name,
          ...(ws.goal !== undefined ? { goal: ws.goal } : {}),
        }}
      />
    </AppShell>
  );
}

function SourcesToolbar({
  query,
  onQueryChange,
  typeFilter,
  onTypeFilterChange,
  sort,
  onSortChange,
  presentTypes,
  selectedCount,
  embeddableCount,
  bulkEmbedding,
  embedProgress,
  onBulkEmbed,
  onClearSelection,
  onBulkDelete,
  pick,
}: {
  query: string;
  onQueryChange: (q: string) => void;
  typeFilter: "all" | SourceType;
  onTypeFilterChange: (t: "all" | SourceType) => void;
  sort: SortKey;
  onSortChange: (key: SortKey) => void;
  presentTypes: SourceType[];
  selectedCount: number;
  embeddableCount: number;
  bulkEmbedding: boolean;
  embedProgress: { done: number; total: number };
  onBulkEmbed: () => void;
  onClearSelection: () => void;
  onBulkDelete: () => void;
  pick: (tr: string, en: string) => string;
}) {
  const filtersDirty = typeFilter !== "all" || sort !== "updated_desc";
  return (
    <div className="mb-3 flex flex-col gap-2.5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1 sm:max-w-[360px]">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-4"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder={pick(
              "Kaynak ara…",
              "Search sources…",
            )}
            className="pl-9 pr-9"
            aria-label={pick("Kaynak ara", "Search sources")}
          />
          {query ? (
            <button
              type="button"
              onClick={() => onQueryChange("")}
              aria-label={pick("Aramayı temizle", "Clear search")}
              className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-md text-ink-3 transition-colors hover:bg-paper-3 hover:text-ink"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          ) : null}
        </div>

        <FiltersMenu
          typeFilter={typeFilter}
          onTypeFilterChange={onTypeFilterChange}
          sort={sort}
          onSortChange={onSortChange}
          presentTypes={presentTypes}
          dirty={filtersDirty}
          pick={pick}
        />
      </div>

      {selectedCount > 0 ? (
        <div className="flex items-center justify-between gap-3 rounded-[10px] border border-accent-soft bg-accent-wash px-3 py-2 text-[13px] text-accent-ink">
          <span className="font-medium">
            {pick(
              `${selectedCount} seçildi`,
              `${selectedCount} selected`,
            )}
          </span>
          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              variant="ghost"
              onClick={onClearSelection}
              disabled={bulkEmbedding}
            >
              {pick("Seçimi temizle", "Clear")}
            </Button>
            {embeddableCount > 0 || bulkEmbedding ? (
              <Button
                size="sm"
                variant="default"
                onClick={onBulkEmbed}
                disabled={bulkEmbedding || embeddableCount === 0}
              >
                {bulkEmbedding ? (
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <Sparkles className="h-3.5 w-3.5" aria-hidden />
                )}
                {bulkEmbedding
                  ? pick(
                      `Gömülüyor… ${embedProgress.done}/${embedProgress.total}`,
                      `Embedding… ${embedProgress.done}/${embedProgress.total}`,
                    )
                  : pick(
                      `Eksikleri göm (${embeddableCount})`,
                      `Embed missing (${embeddableCount})`,
                    )}
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="danger"
              onClick={onBulkDelete}
              disabled={bulkEmbedding}
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
              {pick("Sil", "Delete")}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function FiltersMenu({
  typeFilter,
  onTypeFilterChange,
  sort,
  onSortChange,
  presentTypes,
  dirty,
  pick,
}: {
  typeFilter: "all" | SourceType;
  onTypeFilterChange: (t: "all" | SourceType) => void;
  sort: SortKey;
  onSortChange: (key: SortKey) => void;
  presentTypes: SourceType[];
  dirty: boolean;
  pick: (tr: string, en: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close on outside mousedown / Escape — same pattern as TweaksPanel.
  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent): void {
      if (!wrapRef.current) return;
      if (!(e.target instanceof Node)) return;
      if (!wrapRef.current.contains(e.target)) setOpen(false);
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function reset(): void {
    onTypeFilterChange("all");
    onSortChange("updated_desc");
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={cn(
          "inline-flex h-9 items-center gap-1.5 rounded-[10px] border px-3 text-[13px] font-medium transition-colors",
          dirty
            ? "border-accent bg-accent-wash text-accent-ink"
            : "border-rule bg-paper text-ink-2 hover:border-rule-strong hover:bg-paper-2",
        )}
      >
        <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden />
        {pick("Filtreler", "Filters")}
        {dirty ? (
          <span className="grid h-4 min-w-[16px] place-items-center rounded-full bg-accent px-1 font-mono text-[10px] font-semibold text-accent-fg">
            {(typeFilter !== "all" ? 1 : 0) + (sort !== "updated_desc" ? 1 : 0)}
          </span>
        ) : null}
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 transition-transform",
            open && "rotate-180",
          )}
          aria-hidden
        />
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label={pick("Filtreler", "Filters")}
          className="absolute right-0 z-30 mt-1.5 w-[300px] origin-top-right rounded-[12px] border border-rule bg-paper p-4 shadow-[var(--shadow-deep)]"
        >
          <section>
            <h3 className="mb-2 font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-3">
              {pick("Tür", "Type")}
            </h3>
            <div className="flex flex-wrap gap-1.5">
              <FilterChip
                active={typeFilter === "all"}
                onClick={() => onTypeFilterChange("all")}
              >
                {pick("Tümü", "All")}
              </FilterChip>
              {presentTypes.map((type) => (
                <FilterChip
                  key={type}
                  active={typeFilter === type}
                  onClick={() => onTypeFilterChange(type)}
                >
                  {pick(TYPE_LABEL[type].tr, TYPE_LABEL[type].en)}
                </FilterChip>
              ))}
            </div>
          </section>

          <section className="mt-4">
            <h3 className="mb-2 font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-3">
              {pick("Sıralama", "Sort by")}
            </h3>
            <div role="radiogroup" className="m-0 grid grid-cols-1 gap-0.5">
              {SORT_ORDER.map((key) => {
                const checked = sort === key;
                return (
                  <button
                    key={key}
                    type="button"
                    role="radio"
                    aria-checked={checked}
                    onClick={() => onSortChange(key)}
                    className={cn(
                      "flex items-center justify-between gap-2 rounded-[8px] px-2.5 py-1.5 text-left text-[13px] transition-colors",
                      checked
                        ? "bg-accent-wash text-accent-ink"
                        : "text-ink-2 hover:bg-paper-2",
                    )}
                  >
                    <span>{pick(SORT_LABEL[key].tr, SORT_LABEL[key].en)}</span>
                    {checked ? (
                      <span
                        className="h-1.5 w-1.5 rounded-full bg-accent"
                        aria-hidden
                      />
                    ) : null}
                  </button>
                );
              })}
            </div>
          </section>

          <footer className="mt-4 flex items-center justify-between border-t border-rule-soft pt-3">
            <button
              type="button"
              onClick={reset}
              disabled={!dirty}
              className="inline-flex items-center gap-1.5 text-[12.5px] text-ink-3 transition-colors hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
            >
              <RotateCcw className="h-3 w-3" aria-hidden />
              {pick("Sıfırla", "Reset")}
            </button>
            <Button size="sm" variant="default" onClick={() => setOpen(false)}>
              {pick("Kapat", "Close")}
            </Button>
          </footer>
        </div>
      ) : null}
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex h-7 items-center rounded-full border px-3 text-[12px] font-medium transition-colors",
        active
          ? "border-accent bg-accent text-accent-fg"
          : "border-rule bg-paper text-ink-2 hover:border-rule-strong hover:bg-paper-2",
      )}
    >
      {children}
    </button>
  );
}

function SelectAllCheckbox({
  allSelected,
  someSelected,
  onToggle,
  pick,
}: {
  allSelected: boolean;
  someSelected: boolean;
  onToggle: () => void;
  pick: (tr: string, en: string) => string;
}) {
  return (
    <input
      type="checkbox"
      checked={allSelected}
      ref={(el) => {
        if (el) el.indeterminate = someSelected;
      }}
      onChange={onToggle}
      aria-label={pick("Tümünü seç", "Select all")}
      className="h-3.5 w-3.5 cursor-pointer accent-accent"
    />
  );
}

function HeaderUploadButton({ label }: { label: string }) {
  const { openPicker } = useSourceUpload();
  return (
    <Button
      size="sm"
      variant="accent"
      className="ml-1 hidden sm:inline-flex"
      onClick={openPicker}
    >
      <Plus className="h-3.5 w-3.5" aria-hidden />
      {label}
    </Button>
  );
}

function SectionUploadButton({ label }: { label: string }) {
  const { openPicker } = useSourceUpload();
  return (
    <Button size="sm" onClick={openPicker}>
      <Upload className="h-3.5 w-3.5" aria-hidden />
      {label}
    </Button>
  );
}

function EmptySourcesState({ pageLabel: _pageLabel }: { pageLabel: string }) {
  const t = useTranslations("empty_state");
  const { openPicker } = useSourceUpload();
  return (
    <Card variant="sunken" className="min-h-[260px]">
      <EmptyState
        icon={<FileText />}
        title={t("workspace_no_sources_title")}
        description={t("workspace_no_sources_desc")}
        action={{
          label: t("workspace_no_sources_action"),
          onClick: openPicker,
        }}
      />
    </Card>
  );
}

function WorkspaceStat({
  icon: Icon,
  value,
  label,
}: {
  icon: LucideIcon;
  value: number;
  label: string;
}) {
  return (
    <div className="rounded-[12px] border border-rule bg-paper px-3 py-2">
      <Icon className="mb-2 h-3.5 w-3.5 text-accent" aria-hidden />
      <div className="font-mono text-[16px] font-semibold text-ink">{value}</div>
      <div className="mt-0.5 truncate text-[11.5px] text-ink-4">{label}</div>
    </div>
  );
}

function QuickAction({
  href,
  icon: Icon,
  title,
  subtitle,
}: {
  href: string;
  icon: LucideIcon;
  title: string;
  subtitle: string;
}) {
  return (
    <Link
      href={href}
      className="group rounded-[var(--radius-lg)] border border-rule bg-paper-2 p-4 shadow-[var(--shadow-soft)] transition-[background,border-color,transform] duration-[160ms] hover:-translate-y-[1px] hover:border-rule-strong hover:bg-paper-3"
    >
      <Icon className="h-4 w-4 text-accent" aria-hidden />
      <div className="mt-4 text-[14px] font-semibold text-ink">{title}</div>
      <div className="mt-1 text-[12.5px] leading-5 text-ink-3">{subtitle}</div>
    </Link>
  );
}

function SourceRow({
  source,
  href,
  bordered,
  pick,
  pageLabel,
  selected,
  onToggleSelect,
  onRequestDelete,
}: {
  source: SourceRecord;
  href: string;
  bordered: boolean;
  pick: (tr: string, en: string) => string;
  pageLabel: string;
  selected: boolean;
  onToggleSelect: (id: string) => void;
  onRequestDelete: (id: string) => void;
}) {
  const locale = usePrefs((s) => s.locale);
  return (
    <Link
      href={href}
      className={cn(
        "grid grid-cols-[28px_1fr_110px_130px_150px_120px_36px] items-center gap-4 px-4 py-3 transition-colors hover:bg-paper-2",
        bordered && "border-b border-rule-soft",
        selected && "bg-accent-wash hover:bg-accent-wash",
      )}
    >
      <RowSelectCheckbox
        checked={selected}
        onToggle={() => onToggleSelect(source.id)}
        pick={pick}
      />
      <SourceTitle source={source} pageLabel={pageLabel} pick={pick} />
      <Chip>{pick(TYPE_LABEL[source.type].tr, TYPE_LABEL[source.type].en)}</Chip>
      <StatusBadge status={source.ingestStatus} pick={pick} />
      <EmbeddingStatusBadge
        status={source.embeddingStatus ?? "missing"}
        pick={pick}
        sourceId={source.id}
      />
      <div className="text-right text-[12px] text-ink-3">
        {formatRelative(source.updatedAt, locale)}
      </div>
      <SourceDeleteButton
        sourceId={source.id}
        onRequest={onRequestDelete}
        pick={pick}
      />
    </Link>
  );
}

function SourceCard({
  source,
  href,
  pick,
  pageLabel,
  selected,
  onToggleSelect,
  onRequestDelete,
}: {
  source: SourceRecord;
  href: string;
  pick: (tr: string, en: string) => string;
  pageLabel: string;
  selected: boolean;
  onToggleSelect: (id: string) => void;
  onRequestDelete: (id: string) => void;
}) {
  const locale = usePrefs((s) => s.locale);
  return (
    <Link
      href={href}
      className={cn(
        "block rounded-[var(--radius-lg)] border bg-paper-2 p-4 shadow-[var(--shadow-soft)]",
        selected ? "border-accent bg-accent-wash" : "border-rule",
      )}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <RowSelectCheckbox
            checked={selected}
            onToggle={() => onToggleSelect(source.id)}
            pick={pick}
            className="mt-1"
          />
          <SourceTitle source={source} pageLabel={pageLabel} pick={pick} />
        </div>
        <div className="flex items-center gap-1.5">
          <Chip>
            {pick(TYPE_LABEL[source.type].tr, TYPE_LABEL[source.type].en)}
          </Chip>
          <SourceDeleteButton
            sourceId={source.id}
            onRequest={onRequestDelete}
            pick={pick}
          />
        </div>
      </div>
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          <StatusBadge status={source.ingestStatus} pick={pick} />
          <EmbeddingStatusBadge
            status={source.embeddingStatus ?? "missing"}
            pick={pick}
            sourceId={source.id}
          />
        </div>
        <div className="text-[12px] text-ink-4">
          {formatRelative(source.updatedAt, locale)}
        </div>
      </div>
    </Link>
  );
}

function RowSelectCheckbox({
  checked,
  onToggle,
  pick,
  className,
}: {
  checked: boolean;
  onToggle: () => void;
  pick: (tr: string, en: string) => string;
  className?: string;
}) {
  return (
    <input
      type="checkbox"
      checked={checked}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      aria-label={pick("Bu kaynağı seç", "Select this source")}
      className={cn(
        "h-3.5 w-3.5 cursor-pointer accent-accent",
        className,
      )}
    />
  );
}

function SourceDeleteButton({
  sourceId,
  onRequest,
  pick,
}: {
  sourceId: string;
  onRequest: (sourceId: string) => void;
  pick: (tr: string, en: string) => string;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onRequest(sourceId);
      }}
      aria-label={pick("Kaynağı sil", "Delete source")}
      title={pick("Kaynağı sil", "Delete source")}
      className="relative z-10 grid h-7 w-7 shrink-0 place-items-center rounded-md border border-transparent text-ink-3 transition-colors hover:border-err/40 hover:bg-err/10 hover:text-err focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-err/40"
    >
      <Trash2 className="h-3.5 w-3.5" aria-hidden />
    </button>
  );
}

function EmbeddingStatusBadge({
  status,
  pick,
  sourceId,
}: {
  status: EmbeddingStatus;
  pick: (tr: string, en: string) => string;
  sourceId: string;
}) {
  const label = pick(EMBEDDING_STATUS_LABEL[status].tr, EMBEDDING_STATUS_LABEL[status].en);
  const tone =
    status === "ready"
      ? "border-ok/40 bg-ok/10 text-ok"
      : status === "embedding" || status === "queued"
        ? "border-accent-soft bg-accent-wash text-accent-ink"
        : status === "error"
          ? "border-err/40 bg-err/10 text-err"
          : "border-rule bg-paper text-ink-3";
  // `missing` is the default state every freshly-ingested source starts
  // in — without it here, brand-new YouTube/URL/PDF rows would have no
  // way to trigger their first embedding from the source list. `skipped`
  // and `error` cover later retry scenarios (key missing at ingest time,
  // upstream failure).
  const canRetry =
    status === "missing" || status === "skipped" || status === "error";
  const [retrying, setRetrying] = useState(false);
  const { toast } = useToast();

  async function handleRetry(e: React.MouseEvent): Promise<void> {
    e.preventDefault();
    e.stopPropagation();
    if (retrying) return;
    setRetrying(true);
    try {
      const auth = await resolveEmbedAuth(pick);
      if ("error" in auth) {
        toast(auth.error);
        return;
      }

      const handle = runReembed({
        scope: { kind: "source", sourceId },
        apiKey: auth.apiKey,
        presetId: auth.presetId,
      });
      const result = await handle.promise;
      if (result.total === 0) {
        toast({
          variant: "info",
          title: pick("Embedding'lik chunk yok", "Nothing to embed"),
        });
      } else {
        toast({
          variant: "success",
          title: pick("Embedding hazır", "Embedding ready"),
          description: pick(
            "Retrieval şimdi çalışır.",
            "Retrieval is live now.",
          ),
        });
      }
    } catch (err) {
      toast({
        variant: "error",
        title: pick("Embedding başarısız", "Embedding failed"),
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setRetrying(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-[8px] border px-2 py-0.5 text-[11.5px] font-medium",
          tone,
        )}
      >
        {label}
      </span>
      {canRetry ? (
        <button
          type="button"
          onClick={handleRetry}
          disabled={retrying}
          aria-label={pick("Embedding'i yeniden dene", "Retry embedding")}
          title={pick("Yeniden dene", "Try again")}
          className="grid h-6 w-6 place-items-center rounded-md border border-rule text-ink-3 transition-colors hover:border-accent hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RefreshCw
            className={cn("h-3 w-3", retrying && "animate-spin")}
            aria-hidden
          />
        </button>
      ) : null}
    </span>
  );
}

function SourceTitle({
  source,
  pageLabel,
  pick,
}: {
  source: SourceRecord;
  pageLabel: string;
  pick: (tr: string, en: string) => string;
}) {
  const meta: string[] = [];
  if (source.author) meta.push(source.author);
  if (source.pageCount) meta.push(`${source.pageCount} ${pageLabel}`);
  if (source.byteSize) meta.push(formatBytes(source.byteSize, pick));
  // Phase 6.9.6 — note-sources get a NotebookPen icon prefix + "from note"
  // pill so they're spottable in a mixed-source list. The standard type
  // Chip ("Not"/"Note") still renders in its own column; the badge here is
  // the secondary in-title affordance that doubles as the "this row routes
  // to /notes instead of /read" signal.
  const isNote = source.type === "note";
  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-center gap-1.5">
        {isNote ? (
          <NotebookPen
            className="h-3.5 w-3.5 shrink-0 text-emerald-600"
            aria-hidden
          />
        ) : null}
        <span className="truncate text-[14px] font-semibold text-ink">
          {pick(source.title, source.titleEn ?? source.title)}
        </span>
        {isNote ? (
          <span
            data-testid="source-from-note-badge"
            className="shrink-0 rounded-[6px] border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10.5px] font-medium text-emerald-700"
          >
            {pick("nottan", "from note")}
          </span>
        ) : null}
      </div>
      {meta.length > 0 ? (
        <div className="mt-1 truncate text-[12px] text-ink-3">
          {meta.join(" · ")}
        </div>
      ) : null}
    </div>
  );
}

function StatusBadge({
  status,
  pick,
}: {
  status: IngestStatus;
  pick: (tr: string, en: string) => string;
}) {
  const label = pick(STATUS_LABEL[status].tr, STATUS_LABEL[status].en);
  const tone =
    status === "ready"
      ? "border-ok/40 bg-ok/10 text-ok"
      : status === "error"
        ? "border-err/40 bg-err/10 text-err"
        : "border-rule bg-paper-2 text-ink-3";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-[8px] border px-2 py-0.5 text-[11.5px] font-medium",
        tone,
      )}
    >
      {label}
    </span>
  );
}

function WorkspaceHeaderSkeleton() {
  return (
    <div className="mb-7 rounded-[var(--radius-lg)] border border-rule bg-paper-2 p-4 shadow-[var(--shadow-soft)] sm:p-5">
      <div className="flex items-start gap-4">
        <Skeleton variant="rect" width={48} height={48} className="shrink-0" />
        <div className="flex-1 space-y-2">
          <Skeleton variant="rect" width={120} height={10} />
          <Skeleton variant="rect" width="60%" height={28} />
          <Skeleton variant="text" lines={2} />
        </div>
      </div>
    </div>
  );
}

function SourcesGridSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {[0, 1, 2].map((i) => (
        <Card key={i} variant="sunken" padding="md">
          <Skeleton variant="rect" width="70%" height={16} />
          <div className="mt-2">
            <Skeleton variant="rect" width="40%" height={12} />
          </div>
          <div className="mt-4">
            <Skeleton variant="rect" height={6} />
          </div>
        </Card>
      ))}
    </div>
  );
}

function formatRelative(ts: number, locale: "tr" | "en"): string {
  return formatRelativeDay(ts, locale);
}

function formatBytes(
  bytes: number,
  pick: (tr: string, en: string) => string,
): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(mb < 10 ? 1 : 0)} ${pick("MB", "MB")}`;
}
