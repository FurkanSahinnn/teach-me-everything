"use client";

// Research workspace page — full-page literature search + synthesis.
//
// Phase 6.A rewrite: replaces the 5.A fixture mockup with the real 5.5.G
// search dispatch + research ingest pipeline + Claude-driven comparison.
//
// Flow:
//  (1) `searchWithFallback` walks `prefs.searchProviders` for a user query.
//  (2) Hit list renders with per-row checkbox + ingest status. "Kaynak yap"
//      pipes each URL through `ingestResearchUrl` (DOI / arXiv / YouTube /
//      web) so the workspace's source list grows.
//  (3) "Karşılaştır" pushes ≥2 selected hits through `runSynthesis`, which
//      asks the configured chat model for a JSON matrix + insight paragraph.
//      No persistence — the comparison lives in component state.
//
// Honest scope: the matrix is generated from snippet titles + descriptions,
// not full article bodies. That's surfaced in the helper text below the
// synthesis card so users know to ingest first when they need depth.

import {
  AlertCircle,
  ArrowUpRight,
  CheckCircle2,
  Globe,
  Loader2,
  Lock,
  Search,
  Sparkles,
  Square,
  SquareCheck,
  Trash2,
  XCircle,
} from "lucide-react";
import { notFound, useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AppShell } from "@/components/shell/AppShell";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { useToast } from "@/components/ui/Toast";

import { useLocalePick } from "@/i18n/IntlProvider";
import { resolveChatCredentialForPreset } from "@/lib/ai/anthropic-credential";
import { findChatOption } from "@/lib/ai/model-options";
import { hasApiKey } from "@/lib/db/api-keys-repo";
import { useWorkspace } from "@/lib/db/hooks";

import { resolveResearchCredential } from "@/lib/research/credential";
import { ingestResearchUrl } from "@/lib/research/ingest";
import type { ResearchProviderId } from "@/lib/research/providers/types";
import {
  SearchDispatchError,
  searchWithFallback,
  type SearchAttempt,
} from "@/lib/research/search/dispatch";
import { getSearchProvider } from "@/lib/research/search/registry";
import {
  getKeyProvidersForSearch,
  type SearchResultItem,
} from "@/lib/research/search/types";
import {
  MAX_RESULTS as SYNTH_MAX,
  MIN_RESULTS as SYNTH_MIN,
  runSynthesis,
  SynthesisError,
  type SynthesisResult,
} from "@/lib/research/synthesis";

import { usePrefs } from "@/stores/prefs";
import { useVault } from "@/stores/vault";
import { cn } from "@/lib/utils/cn";

const KNOWN_RESEARCH_PROVIDERS: ResearchProviderId[] = [
  "readability",
  "firecrawl",
  "exa",
  "jina-reader",
  "tavily",
  "diffbot",
  "brightdata",
];

type IngestPhase = "pending" | "running" | "done" | "error";
type IngestStatusEntry = {
  phase: IngestPhase;
  sourceId?: string;
  error?: string;
};

type SynthesisState =
  | { kind: "idle" }
  | { kind: "loading"; count: number }
  | { kind: "ok"; result: SynthesisResult; count: number }
  | { kind: "error"; message: string };

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function faviconFor(url: string, fallback?: string): string {
  if (fallback) return fallback;
  try {
    const u = new URL(url);
    return `https://www.google.com/s2/favicons?sz=32&domain=${encodeURIComponent(u.host)}`;
  } catch {
    return "";
  }
}

export default function ResearchPage() {
  const params = useParams<{ id: string }>();
  const workspaceId = params.id;
  const ws = useWorkspace(workspaceId);

  const t = useTranslations("research");
  const tMobile = useTranslations("mobile");
  const pick = useLocalePick();
  const { toast } = useToast();

  const masterKey = useVault((s) => s.masterKey);
  const isVaultLocked = !masterKey;

  const searchProviders = usePrefs((s) => s.searchProviders);
  const chatModelId = usePrefs((s) => s.modelBindings.chat);
  const ingestProviderRaw = usePrefs((s) => s.modelBindings.researchProvider);
  const ingestProvider: ResearchProviderId = useMemo(() => {
    return (KNOWN_RESEARCH_PROVIDERS as readonly string[]).includes(
      ingestProviderRaw,
    )
      ? (ingestProviderRaw as ResearchProviderId)
      : "readability";
  }, [ingestProviderRaw]);

  // --- Local UI state ---
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchAttempts, setSearchAttempts] = useState<SearchAttempt[] | null>(
    null,
  );
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [activeProviderId, setActiveProviderId] = useState<string | null>(null);
  const [urlFilter, setUrlFilter] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [ingestProgress, setIngestProgress] = useState<
    Map<string, IngestStatusEntry>
  >(new Map());
  const [ingesting, setIngesting] = useState(false);
  const [unlockOpen, setUnlockOpen] = useState(false);
  const [keyPresence, setKeyPresence] = useState<Map<string, boolean>>(
    new Map(),
  );
  const [synthesis, setSynthesis] = useState<SynthesisState>({ kind: "idle" });

  const cancelRef = useRef<AbortController | null>(null);
  const synthCancelRef = useRef<AbortController | null>(null);

  // --- Key-presence probe whenever the chain changes ---
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const next = new Map<string, boolean>();
      for (const entry of searchProviders) {
        if (!entry.enabled) {
          next.set(entry.id, false);
          continue;
        }
        const options = getKeyProvidersForSearch(entry.id);
        let present = false;
        for (const opt of options) {
          if (await hasApiKey(opt.keyProvider)) {
            present = true;
            break;
          }
        }
        next.set(entry.id, present);
      }
      if (!cancelled) setKeyPresence(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [searchProviders]);

  // Synthesis call cancellation on unmount.
  useEffect(() => {
    return () => {
      cancelRef.current?.abort();
      synthCancelRef.current?.abort();
    };
  }, []);

  const noKeyAtAll = useMemo(() => {
    if (keyPresence.size === 0) return false;
    for (const [, v] of keyPresence) if (v) return false;
    return true;
  }, [keyPresence]);

  const filteredResults = useMemo(() => {
    const needle = urlFilter.trim().toLowerCase();
    if (needle.length === 0) return results;
    return results.filter((r) => r.url.toLowerCase().includes(needle));
  }, [results, urlFilter]);

  const activeProviderLabel = useMemo(() => {
    if (!activeProviderId) return null;
    return getSearchProvider(activeProviderId)?.label ?? activeProviderId;
  }, [activeProviderId]);

  const handleSearch = useCallback(async () => {
    const trimmed = query.trim();
    if (!trimmed) return;
    if (!masterKey) {
      setSearchError(t("vault_kilitli"));
      return;
    }
    cancelRef.current?.abort();
    const ctl = new AbortController();
    cancelRef.current = ctl;
    setSearching(true);
    setSearchError(null);
    setSearchAttempts(null);
    setResults([]);
    setActiveProviderId(null);
    setUrlFilter("");
    setSelected(new Set());
    setIngestProgress(new Map());
    setSynthesis({ kind: "idle" });
    try {
      const out = await searchWithFallback({
        query: trimmed,
        count: 10,
        signal: ctl.signal,
        providers: searchProviders,
      });
      setResults(out.results);
      setActiveProviderId(String(out.providerId));
    } catch (err) {
      if (err instanceof SearchDispatchError) {
        setSearchError(err.message);
        setSearchAttempts(err.attempted);
      } else if (err instanceof Error) {
        setSearchError(err.message);
      } else {
        setSearchError(String(err));
      }
    } finally {
      setSearching(false);
      cancelRef.current = null;
    }
  }, [query, masterKey, searchProviders, t]);

  const toggleSelected = useCallback((url: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelected(new Set(filteredResults.map((r) => r.url)));
  }, [filteredResults]);

  const clearSelected = useCallback(() => {
    setSelected(new Set());
  }, []);

  const handleIngestSelected = useCallback(async () => {
    if (selected.size === 0 || !masterKey || ingesting) return;
    setIngesting(true);
    let apiKey: string | undefined;
    try {
      const resolved = await resolveResearchCredential(ingestProvider);
      if (resolved) apiKey = resolved;
    } catch {
      apiKey = undefined;
    }

    const urls = Array.from(selected);
    const progress = new Map(ingestProgress);
    for (const u of urls) progress.set(u, { phase: "pending" });
    setIngestProgress(new Map(progress));

    const successIds: string[] = [];
    const errors: { url: string; msg: string }[] = [];

    for (const url of urls) {
      progress.set(url, { phase: "running" });
      setIngestProgress(new Map(progress));
      try {
        const input: Parameters<typeof ingestResearchUrl>[0] = {
          workspaceId,
          rawInput: url,
          webProvider: ingestProvider,
        };
        if (apiKey !== undefined) input.apiKey = apiKey;
        const out = await ingestResearchUrl(input);
        progress.set(url, { phase: "done", sourceId: out.source.id });
        successIds.push(out.source.id);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        progress.set(url, { phase: "error", error: msg });
        errors.push({ url, msg });
      }
      setIngestProgress(new Map(progress));
    }

    setIngesting(false);
    if (successIds.length > 0) {
      toast({
        variant: errors.length > 0 ? "warn" : "success",
        title: t("kaynak_eklendi_toast", { n: successIds.length }),
        ...(errors.length > 0
          ? { description: t("kaynak_hata_toast") }
          : {}),
      });
    } else if (errors.length > 0) {
      toast({
        variant: "error",
        title: t("kaynak_hata_toast"),
      });
    }
  }, [
    selected,
    ingesting,
    ingestProgress,
    ingestProvider,
    workspaceId,
    toast,
    t,
  ]);

  const handleSynthesize = useCallback(async () => {
    if (!masterKey) {
      setUnlockOpen(true);
      return;
    }
    const picked = filteredResults.filter((r) => selected.has(r.url));
    if (picked.length < SYNTH_MIN) {
      setSynthesis({
        kind: "error",
        message: t("karsilastirma_az_secim", { n: SYNTH_MIN }),
      });
      return;
    }
    if (picked.length > SYNTH_MAX) {
      setSynthesis({
        kind: "error",
        message: t("karsilastirma_cok_secim", { n: SYNTH_MAX }),
      });
      return;
    }
    const option = findChatOption(chatModelId);
    if (!option) {
      setSynthesis({
        kind: "error",
        message: t("karsilastirma_hatasi"),
      });
      return;
    }
    let cred: { apiKey: string; authKind?: "oauth" | "api-key" } | null = null;
    try {
      cred = await resolveChatCredentialForPreset(option.presetId);
    } catch (err) {
      setSynthesis({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    if (!cred) {
      setSynthesis({
        kind: "error",
        message: t("karsilastirma_hatasi"),
      });
      return;
    }
    synthCancelRef.current?.abort();
    const ctl = new AbortController();
    synthCancelRef.current = ctl;
    setSynthesis({ kind: "loading", count: picked.length });
    try {
      const synthArgs: Parameters<typeof runSynthesis>[0] = {
        results: picked,
        apiKey: cred.apiKey,
        modelId: chatModelId,
        signal: ctl.signal,
      };
      if (cred.authKind) synthArgs.authKind = cred.authKind;
      const result = await runSynthesis(synthArgs);
      setSynthesis({ kind: "ok", result, count: picked.length });
    } catch (err) {
      if (err instanceof SynthesisError) {
        setSynthesis({
          kind: "error",
          message: `${err.code}: ${err.message}`,
        });
      } else {
        setSynthesis({
          kind: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    } finally {
      synthCancelRef.current = null;
    }
  }, [filteredResults, selected, masterKey, chatModelId, t]);

  // Workspace gate. `useWorkspace` returns undefined while loading, null when
  // not found, and the record otherwise. Loading → render shell but no body
  // yet so the breadcrumb doesn't flash a stale state.
  if (ws === null) notFound();

  const selectedCount = selected.size;
  const synthesisEligible =
    selectedCount >= SYNTH_MIN && selectedCount <= SYNTH_MAX;

  return (
    <AppShell
      workspaceId={workspaceId}
      breadcrumb={
        ws
          ? [t("dashboard"), pick(ws.name, ws.nameEn ?? ws.name), t("arastirma")]
          : [t("dashboard"), t("arastirma")]
      }
      topbarActions={
        selectedCount > 0 ? (
          <Button
            size="sm"
            variant="primary"
            disabled={ingesting || !masterKey}
            onClick={handleIngestSelected}
          >
            {ingesting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
            )}
            {t("secilenleri_notebooka_aktar")} ({selectedCount})
          </Button>
        ) : null
      }
    >
      <div className="mx-auto max-w-[1240px] px-8 pb-24 pt-7">
        <header className="mb-6">
          <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-3">
            {ws ? pick(ws.name, ws.nameEn ?? ws.name) : "—"} ·{" "}
            {t("literatur_taramasi")}
          </div>
          <h1 className="mt-1.5 font-serif text-[32px] font-normal leading-tight tracking-[-0.015em]">
            {t("literatur_taramasi")}
          </h1>
        </header>

        <SearchBar
          query={query}
          onQueryChange={setQuery}
          onSubmit={handleSearch}
          searching={searching}
          urlFilter={urlFilter}
          onUrlFilterChange={setUrlFilter}
          hasResults={results.length > 0}
          activeProviderLabel={activeProviderLabel}
          totalResultCount={results.length}
          placeholder={t("search_placeholder")}
          searchLabel={t("ara")}
          searchingLabel={t("araniyor")}
          urlFilterLabel={t("url_filtrele")}
          providedByLabel={t("saglandi")}
          resultsLabel={t("sonuc")}
        />

        {isVaultLocked ? (
          <LockedCard
            title={t("vault_kilitli")}
            actionLabel={t("vault_ac")}
            onUnlock={() => setUnlockOpen(true)}
          />
        ) : noKeyAtAll ? (
          <NoKeyCard
            title={t("anahtar_yok_baslik")}
            description={t("anahtar_yok_aciklama")}
            actionLabel={t("tercihlere_git")}
          />
        ) : null}

        {searching ? (
          <ResultsSkeleton />
        ) : searchError ? (
          <ErrorCard
            title={t("arama_yapilamadi")}
            message={searchError}
            attempts={searchAttempts}
            retryLabel={t("yeniden_dene")}
            onRetry={() => void handleSearch()}
          />
        ) : results.length === 0 && !query ? (
          <EmptyAwait
            title={t("secim_yap_baslik")}
            description={t("secim_yap_aciklama")}
          />
        ) : results.length === 0 ? (
          <NoResults
            title={t("sonuc_yok_baslik")}
            description={t("sonuc_yok_aciklama")}
          />
        ) : (
          <>
            <ResultsToolbar
              selectedCount={selectedCount}
              totalCount={filteredResults.length}
              onSelectAll={selectAll}
              onClear={clearSelected}
              onSynthesize={handleSynthesize}
              synthesizable={synthesisEligible}
              synthesizing={synthesis.kind === "loading"}
              ingesting={ingesting}
              onIngestSelected={handleIngestSelected}
              labels={{
                selected:
                  selectedCount > 0
                    ? t("secilen_count", { n: selectedCount })
                    : "",
                selectAll: t("tumunu_sec"),
                clear: t("temizle"),
                compare: t("karsilastir"),
                comparing: t("karsilastiriliyor"),
                addSelected: t("secilenleri_notebooka_aktar"),
                adding: t("kaynak_olusturuluyor"),
              }}
            />

            <ResultList
              results={filteredResults}
              selected={selected}
              ingestProgress={ingestProgress}
              onToggle={toggleSelected}
              labels={{
                add: t("kaynak_yap"),
                added: t("kaynak_olusturuldu"),
                adding: t("kaynak_olusturuluyor"),
                source: t("kaynak_etiketi"),
              }}
            />
          </>
        )}

        <SynthesisCard
          state={synthesis}
          results={filteredResults}
          selected={selected}
          pick={pick}
          labels={{
            title: t("sentez_basligi", {
              model: findChatOption(chatModelId)?.label ?? chatModelId,
            }),
            description: t("sentez_aciklama"),
            comparing: t("karsilastiriliyor"),
            error: t("karsilastirma_hatasi"),
            retry: t("yeniden_dene"),
            metric: t("metrik"),
          }}
          onRetry={handleSynthesize}
        />

        <div className="md:hidden mt-3 font-mono text-[10.5px] uppercase tracking-[0.1em] text-ink-3">
          {tMobile("research_card_view_label")}
        </div>
      </div>

      
    </AppShell>
  );
}

// ---------- Sub-components ----------

type SearchBarProps = {
  query: string;
  onQueryChange: (v: string) => void;
  onSubmit: () => void;
  searching: boolean;
  urlFilter: string;
  onUrlFilterChange: (v: string) => void;
  hasResults: boolean;
  activeProviderLabel: string | null;
  totalResultCount: number;
  placeholder: string;
  searchLabel: string;
  searchingLabel: string;
  urlFilterLabel: string;
  providedByLabel: string;
  resultsLabel: string;
};

function SearchBar({
  query,
  onQueryChange,
  onSubmit,
  searching,
  urlFilter,
  onUrlFilterChange,
  hasResults,
  activeProviderLabel,
  totalResultCount,
  placeholder,
  searchLabel,
  searchingLabel,
  urlFilterLabel,
  providedByLabel,
  resultsLabel,
}: SearchBarProps) {
  return (
    <div className="mb-5 rounded-[12px] border border-rule bg-paper">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
        className="flex items-center gap-2 border-b border-rule-soft px-4 py-3"
      >
        <Search className="h-4 w-4 text-ink-3" aria-hidden />
        <input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder={placeholder}
          className="flex-1 bg-transparent text-[14px] outline-none placeholder:text-ink-4"
        />
        <Button
          type="submit"
          size="sm"
          variant="primary"
          disabled={searching || query.trim().length === 0}
        >
          {searching ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <Search className="h-3.5 w-3.5" aria-hidden />
          )}
          {searching ? searchingLabel : searchLabel}
        </Button>
      </form>
      {hasResults ? (
        <div className="flex flex-wrap items-center gap-2 px-4 py-2.5">
          <input
            type="text"
            value={urlFilter}
            onChange={(e) => onUrlFilterChange(e.target.value)}
            placeholder={urlFilterLabel}
            className="min-w-[180px] flex-1 rounded-md border border-rule bg-paper-2 px-3 py-1.5 text-[12.5px] outline-none placeholder:text-ink-4 focus:border-rule-strong"
          />
          {activeProviderLabel ? (
            <span
              className="inline-flex items-center gap-1 rounded-full border border-rule bg-paper-2 px-2.5 py-1 text-[11.5px] text-ink-3"
              data-testid="search-active-provider"
            >
              <Globe className="h-3 w-3" aria-hidden />
              {providedByLabel}: <b className="font-medium text-ink">{activeProviderLabel}</b>
            </span>
          ) : null}
          <span className="ml-auto font-mono text-[11px] text-ink-4">
            {totalResultCount} {resultsLabel}
          </span>
        </div>
      ) : null}
    </div>
  );
}

type ResultsToolbarProps = {
  selectedCount: number;
  totalCount: number;
  onSelectAll: () => void;
  onClear: () => void;
  onSynthesize: () => void;
  synthesizable: boolean;
  synthesizing: boolean;
  ingesting: boolean;
  onIngestSelected: () => void;
  labels: {
    selected: string;
    selectAll: string;
    clear: string;
    compare: string;
    comparing: string;
    addSelected: string;
    adding: string;
  };
};

function ResultsToolbar({
  selectedCount,
  totalCount,
  onSelectAll,
  onClear,
  onSynthesize,
  synthesizable,
  synthesizing,
  ingesting,
  onIngestSelected,
  labels,
}: ResultsToolbarProps) {
  const allSelected = selectedCount > 0 && selectedCount === totalCount;
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        variant="ghost"
        onClick={allSelected ? onClear : onSelectAll}
      >
        {allSelected ? (
          <SquareCheck className="h-3.5 w-3.5" aria-hidden />
        ) : (
          <Square className="h-3.5 w-3.5" aria-hidden />
        )}
        {labels.selectAll}
      </Button>
      {selectedCount > 0 ? (
        <span className="font-mono text-[11px] text-ink-3">
          {labels.selected}
        </span>
      ) : null}
      {selectedCount > 0 ? (
        <Button size="sm" variant="ghost" onClick={onClear}>
          <Trash2 className="h-3.5 w-3.5" aria-hidden />
          {labels.clear}
        </Button>
      ) : null}
      <div className="ml-auto flex gap-1.5">
        <Button
          size="sm"
          variant="primary"
          onClick={onSynthesize}
          disabled={!synthesizable || synthesizing}
        >
          {synthesizing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <Sparkles className="h-3.5 w-3.5" aria-hidden />
          )}
          {synthesizing ? labels.comparing : labels.compare}
        </Button>
        <Button
          size="sm"
          onClick={onIngestSelected}
          disabled={selectedCount === 0 || ingesting}
        >
          {ingesting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
          )}
          {ingesting ? labels.adding : labels.addSelected}
        </Button>
      </div>
    </div>
  );
}

type ResultListProps = {
  results: SearchResultItem[];
  selected: Set<string>;
  ingestProgress: Map<string, IngestStatusEntry>;
  onToggle: (url: string) => void;
  labels: {
    add: string;
    added: string;
    adding: string;
    source: string;
  };
};

function ResultList({
  results,
  selected,
  ingestProgress,
  onToggle,
  labels,
}: ResultListProps) {
  return (
    <div className="space-y-2.5">
      {results.map((r) => {
        const isSelected = selected.has(r.url);
        const status = ingestProgress.get(r.url);
        return (
          <Card
            key={r.url}
            padding="md"
            className={cn(
              "transition-colors",
              isSelected ? "bg-paper-2/60" : "hover:bg-paper-2/30",
            )}
          >
            <div className="flex items-start gap-3">
              <button
                type="button"
                onClick={() => onToggle(r.url)}
                className="mt-0.5 shrink-0 text-ink-2"
                aria-label={r.title}
              >
                {isSelected ? (
                  <SquareCheck className="h-4 w-4" aria-hidden />
                ) : (
                  <Square className="h-4 w-4" aria-hidden />
                )}
              </button>
              {r.faviconUrl || r.url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={faviconFor(r.url, r.faviconUrl)}
                  alt=""
                  aria-hidden
                  className="mt-0.5 h-4 w-4 shrink-0 rounded-sm"
                  loading="lazy"
                />
              ) : null}
              <div className="min-w-0 flex-1">
                <a
                  href={r.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block truncate font-serif text-[16px] font-medium leading-tight hover:underline"
                >
                  {r.title || r.url}
                </a>
                <div className="mt-0.5 truncate font-mono text-[11px] text-ink-4">
                  {hostOf(r.url)}
                </div>
                {r.description ? (
                  <p className="mt-2 line-clamp-3 text-[13.5px] leading-[1.55] text-ink-2">
                    {r.description}
                  </p>
                ) : null}
              </div>
              <div className="ml-2 flex shrink-0 flex-col items-end gap-1.5">
                <a
                  href={r.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-md border border-rule px-2 py-1 font-mono text-[10.5px] text-ink-3 hover:bg-paper-2"
                >
                  <ArrowUpRight className="h-3 w-3" aria-hidden />
                </a>
                <IngestStatusChip
                  status={status}
                  labels={{
                    add: labels.add,
                    added: labels.added,
                    adding: labels.adding,
                  }}
                />
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

function IngestStatusChip({
  status,
  labels,
}: {
  status: IngestStatusEntry | undefined;
  labels: { add: string; added: string; adding: string };
}) {
  if (!status) {
    return (
      <span className="font-mono text-[10.5px] text-ink-4">{labels.add}</span>
    );
  }
  if (status.phase === "done") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 font-mono text-[10.5px] text-accent-ink">
        <CheckCircle2 className="h-3 w-3" aria-hidden />
        {labels.added}
      </span>
    );
  }
  if (status.phase === "error") {
    return (
      <span
        title={status.error}
        className="inline-flex items-center gap-1 rounded-full border border-danger/30 bg-danger/10 px-2 py-0.5 font-mono text-[10.5px] text-danger-ink"
      >
        <XCircle className="h-3 w-3" aria-hidden />
        {status.error?.slice(0, 28) ?? "error"}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-rule bg-paper-2 px-2 py-0.5 font-mono text-[10.5px] text-ink-3">
      <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
      {labels.adding}
    </span>
  );
}

type SynthesisCardProps = {
  state: SynthesisState;
  results: SearchResultItem[];
  selected: Set<string>;
  pick: (tr: string, en: string) => string;
  labels: {
    title: string;
    description: string;
    comparing: string;
    error: string;
    retry: string;
    metric: string;
  };
  onRetry: () => void;
};

function SynthesisCard({
  state,
  results,
  selected,
  pick,
  labels,
  onRetry,
}: SynthesisCardProps) {
  if (state.kind === "idle") return null;

  if (state.kind === "loading") {
    return (
      <Card padding="md" className="mt-5 border-l-[3px] border-l-accent">
        <div className="flex items-center gap-2 text-[13px] text-ink-3">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          {labels.comparing} · {state.count} {labels.metric.toLowerCase()}
        </div>
      </Card>
    );
  }

  if (state.kind === "error") {
    return (
      <Card padding="md" className="mt-5 border-l-[3px] border-l-danger">
        <div className="flex items-start gap-2">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger-ink" aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-danger-ink">
              {labels.error}
            </div>
            <p className="mt-1 break-words text-[13px] text-ink-2">
              {state.message}
            </p>
          </div>
          <Button size="sm" variant="ghost" onClick={onRetry}>
            {labels.retry}
          </Button>
        </div>
      </Card>
    );
  }

  // OK
  const picked = results.filter((r) => selected.has(r.url));
  const sources = picked.length > 0 ? picked : results.slice(0, state.count);
  const cols = sources.length;
  return (
    <Card padding="none" className="mt-5 overflow-hidden border-l-[3px] border-l-accent">
      <div className="border-b border-rule-soft p-4">
        <div className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-accent-ink">
          {labels.title}
        </div>
        <p className="mt-1 text-[12.5px] text-ink-3">{labels.description}</p>
      </div>

      <div className="overflow-x-auto">
        <div
          className="grid min-w-[640px] gap-px bg-rule-soft"
          style={{
            gridTemplateColumns: `180px repeat(${cols}, minmax(180px, 1fr))`,
          }}
        >
          <div className="bg-paper-2 p-3 font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-3">
            {labels.metric}
          </div>
          {sources.map((s, i) => (
            <div key={`hdr-${i}`} className="bg-paper p-3">
              <a
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block truncate font-serif text-[13px] font-medium leading-tight hover:underline"
                title={s.title}
              >
                {s.title || hostOf(s.url)}
              </a>
              <div className="mt-1 truncate font-mono text-[10.5px] text-ink-4">
                {hostOf(s.url)}
              </div>
            </div>
          ))}
          {state.result.rows.map((row) => (
            <RowBand
              key={row.metric}
              label={pick(row.metric, row.metricEn)}
              values={row.values}
            />
          ))}
        </div>
      </div>

      <div className="border-t border-rule-soft p-4">
        <p className="max-w-[78ch] font-serif text-[15px] leading-[1.65] text-ink-2">
          {pick(state.result.insight, state.result.insightEn)}
        </p>
      </div>
    </Card>
  );
}

function RowBand({ label, values }: { label: string; values: string[] }) {
  return (
    <>
      <div className="bg-paper-2 p-3 font-mono text-[11.5px] text-ink-3">
        {label}
      </div>
      {values.map((v, i) => (
        <div key={i} className="bg-paper p-3 text-[13.5px] text-ink-2">
          {v}
        </div>
      ))}
    </>
  );
}

function LockedCard({
  title,
  actionLabel,
  onUnlock,
}: {
  title: string;
  actionLabel: string;
  onUnlock: () => void;
}) {
  return (
    <Card padding="md" className="mb-5 border-l-[3px] border-l-rule-strong">
      <div className="flex items-center gap-3">
        <Lock className="h-4 w-4 text-ink-3" aria-hidden />
        <div className="text-[13.5px] text-ink-2">{title}</div>
        <Button size="sm" className="ml-auto" onClick={onUnlock}>
          {actionLabel}
        </Button>
      </div>
    </Card>
  );
}

function NoKeyCard({
  title,
  description,
  actionLabel,
}: {
  title: string;
  description: string;
  actionLabel: string;
}) {
  return (
    <Card padding="md" className="mb-5 border-l-[3px] border-l-warn">
      <div className="flex items-start gap-3">
        <AlertCircle className="mt-0.5 h-4 w-4 text-warn-ink" aria-hidden />
        <div className="flex-1">
          <div className="font-medium text-[13.5px] text-ink">{title}</div>
          <p className="mt-1 text-[12.5px] text-ink-3">{description}</p>
        </div>
        <a
          href="/settings#preferences"
          className="inline-flex h-7 items-center gap-1 rounded-md border border-rule bg-paper px-2.5 py-1 text-[12.5px] font-medium text-ink hover:bg-paper-2"
        >
          {actionLabel}
        </a>
      </div>
    </Card>
  );
}

function ResultsSkeleton() {
  return (
    <div className="space-y-2.5">
      {[0, 1, 2].map((i) => (
        <Card key={i} padding="md" className="animate-pulse">
          <div className="flex items-start gap-3">
            <div className="h-4 w-4 rounded bg-rule-soft" />
            <div className="h-4 w-4 rounded bg-rule-soft" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-2/3 rounded bg-rule-soft" />
              <div className="h-3 w-1/3 rounded bg-rule-soft" />
              <div className="h-3 w-full rounded bg-rule-soft" />
              <div className="h-3 w-5/6 rounded bg-rule-soft" />
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}

function ErrorCard({
  title,
  message,
  attempts,
  retryLabel,
  onRetry,
}: {
  title: string;
  message: string;
  attempts: SearchAttempt[] | null;
  retryLabel: string;
  onRetry: () => void;
}) {
  return (
    <Card padding="md" className="border-l-[3px] border-l-danger">
      <div className="flex items-start gap-3">
        <AlertCircle className="mt-0.5 h-4 w-4 text-danger-ink" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="font-medium text-[13.5px] text-ink">{title}</div>
          <p className="mt-1 break-words text-[12.5px] text-ink-3">{message}</p>
          {attempts && attempts.length > 0 ? (
            <ul className="mt-2 space-y-0.5 font-mono text-[11px] text-ink-4">
              {attempts.map((a, i) => (
                <li key={i}>
                  <b className="text-ink-3">{a.id}</b>: {a.status}
                  {a.error ? ` · ${a.error}` : ""}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <Button size="sm" variant="ghost" onClick={onRetry}>
          {retryLabel}
        </Button>
      </div>
    </Card>
  );
}

function EmptyAwait({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <Card variant="sunken" className="min-h-[220px]">
      <EmptyState icon={<Search />} title={title} description={description} />
    </Card>
  );
}

function NoResults({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <Card variant="sunken" className="min-h-[220px]">
      <EmptyState icon={<Search />} title={title} description={description} />
    </Card>
  );
}
