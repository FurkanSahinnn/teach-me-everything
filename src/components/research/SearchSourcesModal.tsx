"use client";

// SearchSourcesModal — "Konu ara → Kaynak ekle".
//
// Phase 5.5.E foundation, rewired in 5.5.G to drive the priority chain in
// `prefs.searchProviders` instead of the hardcoded Brave-only path.
//
// Two-stage flow: (1) the user enters a query → `searchWithFallback` walks
// the chain top-down (skipping disabled / no-key / unknown entries) → first
// successful backend's results render in the modal. (2) the user ticks the
// rows they want, hits "Seçilenleri kaynak yap", and each URL is fed
// through `ingestResearchUrl` using the research provider stored in
// `prefs.modelBindings.researchProvider`. Per-URL progress is tracked
// locally so a partial failure doesn't abort the rest.

import {
  CheckCircle2,
  ExternalLink,
  Globe,
  Loader2,
  Search,
  Square,
  SquareCheck,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { useLocalePick } from "@/i18n/IntlProvider";
import { hasApiKey } from "@/lib/db/api-keys-repo";
import { ingestResearchUrl } from "@/lib/research/ingest";
import {
  resolveResearchCredential,
} from "@/lib/research/credential";
import type { ResearchProviderId } from "@/lib/research/providers/types";
import {
  searchWithFallback,
  SearchDispatchError,
  type SearchAttempt,
} from "@/lib/research/search/dispatch";
import { getSearchProvider } from "@/lib/research/search/registry";
import {
  getKeyProvidersForSearch,
  type SearchResultItem,
} from "@/lib/research/search/types";
import { usePrefs } from "@/stores/prefs";
import { useVault } from "@/stores/vault";

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
type IngestStatus = { phase: IngestPhase; sourceId?: string; error?: string };

type Props = {
  open: boolean;
  onClose: () => void;
  workspaceId: string;
  onIngested?: (sourceIds: string[]) => void;
};

export function SearchSourcesModal({
  open,
  onClose,
  workspaceId,
  onIngested,
}: Props) {
  const pick = useLocalePick();
  const { toast } = useToast();
  const masterKey = useVault((s) => s.masterKey);
  const isVaultLocked = !masterKey;

  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  /**
   * Per-provider attempt trace from the last failed `searchWithFallback`
   * call. Rendered below the generic error so the user can see WHY each
   * provider in the chain didn't produce results (no key / HTTP 400 /
   * empty citations / etc.) instead of staring at a generic banner.
   */
  const [searchAttempts, setSearchAttempts] = useState<SearchAttempt[] | null>(
    null,
  );
  /**
   * Determinate progress signal driven by `searchWithFallback`'s `onAttempt`
   * hook. `attemptIndex` is 1-based, `total` is the modal's `liveChain`
   * length at search-start (captured into a ref). Used to render the
   * "Deneniyor: X (k/n)" bar while a search is in-flight.
   */
  const [searchProgress, setSearchProgress] = useState<{
    attemptIndex: number;
    total: number;
    providerLabel: string;
  } | null>(null);
  const [results, setResults] = useState<SearchResultItem[]>([]);
  /**
   * Substring filter applied to the result list AFTER a search lands —
   * lets the user narrow 10 hits down to "only wikipedia.org" or "only
   * `/learn/` paths" without re-running the search. Matched against the
   * lowercased URL string (host + path + query).
   */
  const [urlFilter, setUrlFilter] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [ingestProgress, setIngestProgress] = useState<Map<string, IngestStatus>>(
    new Map(),
  );
  const [ingesting, setIngesting] = useState(false);
  const [unlockOpen, setUnlockOpen] = useState(false);
  /**
   * Map of search-provider-id → "is a key stored for it?". Computed on
   * modal open via parallel `hasApiKey(...)` probes over every enabled
   * entry. Used to surface the "no provider has a key" warning early so
   * the user doesn't waste a click on the empty chain.
   */
  const [keyPresence, setKeyPresence] = useState<Map<string, boolean>>(new Map());
  /** Which provider in the chain actually produced the last result set. */
  const [activeProviderId, setActiveProviderId] = useState<string | null>(null);
  const cancelRef = useRef<AbortController | null>(null);

  const defaultProviderRaw = usePrefs(
    (s) => s.modelBindings.researchProvider,
  );
  const ingestProvider: ResearchProviderId = useMemo(() => {
    return KNOWN_RESEARCH_PROVIDERS.includes(
      defaultProviderRaw as ResearchProviderId,
    )
      ? (defaultProviderRaw as ResearchProviderId)
      : "readability";
  }, [defaultProviderRaw]);

  const searchProviders = usePrefs((s) => s.searchProviders);
  /**
   * The list of enabled, known, key-present entries — the actual "live"
   * chain at this moment. Drives the chain summary in the description and
   * the "no provider has a key" warning logic.
   */
  const liveChain = useMemo(
    () =>
      searchProviders.filter((entry) => {
        if (!entry.enabled) return false;
        if (!getSearchProvider(entry.id)) return false;
        return keyPresence.get(entry.id) === true;
      }),
    [searchProviders, keyPresence],
  );
  const noKeyForAnyProvider =
    keyPresence.size > 0 && liveChain.length === 0 && !isVaultLocked;
  /**
   * Snapshot of `liveChain.length` for the in-flight search's `onAttempt`
   * callback. Lives in a ref because the callback fires asynchronously and
   * we don't want stale-closure to pin `total` to whatever the chain was
   * when `handleSearch` was *declared* — only what it was when invoked.
   */
  const liveChainSizeRef = useRef(liveChain.length);
  useEffect(() => {
    liveChainSizeRef.current = liveChain.length;
  }, [liveChain.length]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setSearchError(null);
    setSearchAttempts(null);
    setSearchProgress(null);
    setResults([]);
    setUrlFilter("");
    setSelected(new Set());
    setIngestProgress(new Map());
    setIngesting(false);
    setActiveProviderId(null);
  }, [open]);

  const filteredResults = useMemo(() => {
    const needle = urlFilter.trim().toLowerCase();
    if (needle.length === 0) return results;
    return results.filter((r) => r.url.toLowerCase().includes(needle));
  }, [results, urlFilter]);

  // Probe key presence for every enabled entry whenever the modal opens or
  // the priority list changes. Disabled rows are skipped because they
  // can't contribute even if they have a key. "Present" means ANY of the
  // provider's credential slots has a key — important for Anthropic, where
  // either `anthropic` (plain API key) or `claude-code-oauth` qualifies.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      const next = new Map<string, boolean>();
      for (const entry of searchProviders) {
        if (!entry.enabled) continue;
        const options = getKeyProvidersForSearch(entry.id);
        if (options.length === 0) continue;
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
  }, [open, searchProviders]);

  const handleSearch = useCallback(async (): Promise<void> => {
    const trimmed = query.trim();
    if (!trimmed) return;
    if (!masterKey) {
      setSearchError(
        pick(
          "Vault kilitli. Önce master şifreni gir.",
          "Vault is locked. Enter your master password first.",
        ),
      );
      return;
    }
    setSearching(true);
    setSearchError(null);
    setSearchAttempts(null);
    setSearchProgress(null);
    setResults([]);
    setUrlFilter("");
    setSelected(new Set());
    const ctl = new AbortController();
    cancelRef.current = ctl;
    try {
      const out = await searchWithFallback({
        query: trimmed,
        count: 10,
        signal: ctl.signal,
        providers: searchProviders,
        onAttempt: (info) => {
          setSearchProgress({
            attemptIndex: info.attemptIndex,
            // Clamp total to >= attemptIndex so a chain that grew between
            // the snapshot and the actual attempt loop never renders a
            // "5/3" overflow. Better cosmetic floor than mid-search jitter.
            total: Math.max(liveChainSizeRef.current, info.attemptIndex),
            providerLabel: info.label,
          });
        },
      });
      setResults(out.results);
      setActiveProviderId(String(out.providerId));
    } catch (err) {
      if (err instanceof SearchDispatchError) {
        setSearchError(err.message);
        setSearchAttempts(err.attempted);
      } else {
        setSearchError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setSearching(false);
      setSearchProgress(null);
      cancelRef.current = null;
    }
  }, [query, masterKey, searchProviders, pick]);

  function toggleSelected(url: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  }

  function selectAll(): void {
    // Use the filtered slice — "Select all" should respect the active
    // URL filter so the user can do "wikipedia → select all → add" in
    // one motion without re-checking each row.
    setSelected(new Set(filteredResults.map((r) => r.url)));
  }

  function clearSelection(): void {
    setSelected(new Set());
  }

  const handleBulkIngest = useCallback(async (): Promise<void> => {
    if (selected.size === 0 || !masterKey || ingesting) return;
    setIngesting(true);
    const toRun = results.filter((r) => selected.has(r.url));
    const initial = new Map<string, IngestStatus>(
      toRun.map((r) => [r.url, { phase: "pending" }]),
    );
    setIngestProgress(initial);

    const apiKey = await resolveResearchCredential(ingestProvider);
    const successIds: string[] = [];
    for (const item of toRun) {
      setIngestProgress((prev) => {
        const next = new Map(prev);
        next.set(item.url, { phase: "running" });
        return next;
      });
      try {
        const out = await ingestResearchUrl({
          workspaceId,
          rawInput: item.url,
          webProvider: ingestProvider,
          ...(apiKey ? { apiKey } : {}),
        });
        successIds.push(out.source.id);
        setIngestProgress((prev) => {
          const next = new Map(prev);
          next.set(item.url, { phase: "done", sourceId: out.source.id });
          return next;
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setIngestProgress((prev) => {
          const next = new Map(prev);
          next.set(item.url, { phase: "error", error: message });
          return next;
        });
      }
    }
    setIngesting(false);
    // Clear selection so a second click on "Add as sources" doesn't
    // re-submit the same URLs. The repo-level `findSourceByUrl` dedupe
    // would catch it anyway, but resetting `selected` is the honest UI
    // signal that this batch is done.
    setSelected(new Set());
    const failCount = toRun.length - successIds.length;
    if (successIds.length > 0) {
      toast({
        variant: failCount === 0 ? "success" : "warn",
        title:
          failCount === 0
            ? pick(
                `${successIds.length} kaynak eklendi`,
                `${successIds.length} sources added`,
              )
            : pick(
                `${successIds.length} eklendi · ${failCount} başarısız`,
                `${successIds.length} added · ${failCount} failed`,
              ),
      });
      onIngested?.(successIds);
    } else {
      toast({
        variant: "error",
        title: pick("Kaynak eklenemedi", "Could not add sources"),
      });
    }
  }, [
    selected,
    results,
    ingesting,
    ingestProvider,
    workspaceId,
    onIngested,
    toast,
    pick,
  ]);

  function handleClose(): void {
    if (ingesting) return;
    cancelRef.current?.abort();
    onClose();
  }

  const canSearch = !searching && query.trim().length > 0 && !isVaultLocked;
  const canIngest =
    !ingesting && selected.size > 0 && !isVaultLocked && results.length > 0;

  return (
    <>
      <Modal
        open={open}
        onClose={handleClose}
        size="lg"
        title={
          <div className="flex items-center gap-2">
            <Search className="h-4 w-4 text-accent" aria-hidden />
            {pick("Konu ara → Kaynak ekle", "Search topic → Add as sources")}
          </div>
        }
        description={(() => {
          if (liveChain.length === 0) {
            return pick(
              "Sağlayıcı zinciri boş. Settings → Tercihler → Arama sağlayıcı zinciri üzerinden ekle.",
              "Provider chain empty. Add one via Settings → Preferences → Search provider chain.",
            );
          }
          const chainLabels = liveChain
            .slice(0, 4)
            .map((entry) => {
              const provider = getSearchProvider(entry.id);
              return provider?.label ?? String(entry.id);
            })
            .join(" → ");
          const suffix =
            liveChain.length > 4
              ? pick(` (+${liveChain.length - 4} daha)`, ` (+${liveChain.length - 4} more)`)
              : "";
          return pick(
            `Sırayla denenir: ${chainLabels}${suffix}. İlk başarılı sağlayıcı sonuçları döner.`,
            `Tried in order: ${chainLabels}${suffix}. First successful provider returns results.`,
          );
        })()}
        footer={
          <div className="flex items-center justify-between gap-3">
            <span
              className="font-mono text-[11px] text-ink-3"
              data-testid="search-active-provider"
            >
              {activeProviderId
                ? (() => {
                    const meta = getSearchProvider(activeProviderId);
                    const label = meta?.label ?? activeProviderId;
                    return pick(`Sağlandı: ${label}`, `Powered by: ${label}`);
                  })()
                : selected.size > 0
                  ? pick(
                      `${selected.size} seçildi`,
                      `${selected.size} selected`,
                    )
                  : results.length > 0
                    ? pick(
                        `${results.length} sonuç`,
                        `${results.length} results`,
                      )
                    : ""}
            </span>
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={handleClose} disabled={ingesting}>
                {pick("Kapat", "Close")}
              </Button>
              <Button
                size="sm"
                variant="accent"
                onClick={() => void handleBulkIngest()}
                disabled={!canIngest}
                data-testid="search-bulk-ingest"
              >
                {ingesting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <Globe className="h-3.5 w-3.5" aria-hidden />
                )}
                {pick(
                  `Seçilenleri kaynak yap (${selected.size})`,
                  `Add selected as sources (${selected.size})`,
                )}
              </Button>
            </div>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="flex flex-col gap-2">
            <label className="block space-y-2">
              <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-3">
                {pick("Aramak istediğin konu", "Topic you want to search")}
              </span>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && canSearch) {
                      e.preventDefault();
                      void handleSearch();
                    }
                  }}
                  placeholder={pick(
                    "ör. kuantum hesaplama temelleri",
                    "e.g. machine learning basics",
                  )}
                  autoFocus
                  className="flex-1 rounded-[8px] border border-rule bg-paper-2 px-3 py-2 text-[13px] outline-none focus:border-accent"
                  spellCheck={false}
                  data-testid="search-query-input"
                />
                <Button
                  size="sm"
                  variant="accent"
                  onClick={() => void handleSearch()}
                  disabled={!canSearch}
                  data-testid="search-submit"
                >
                  {searching ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  ) : (
                    <Search className="h-3.5 w-3.5" aria-hidden />
                  )}
                  {pick("Ara", "Search")}
                </Button>
              </div>
            </label>
            {isVaultLocked ? (
              <div className="flex items-center justify-between gap-2 rounded-md border border-rule bg-paper-2 px-3 py-2 text-[11.5px] text-warn">
                <span>
                  {pick(
                    "Vault kilitli. Sağlayıcı anahtarlarına erişmek için master şifreni gir.",
                    "Vault locked. Enter your master password to use the provider keys.",
                  )}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setUnlockOpen(true)}
                >
                  {pick("Vault'u aç", "Unlock vault")}
                </Button>
              </div>
            ) : noKeyForAnyProvider ? (
              <div className="rounded-md border border-rule bg-paper-2 px-3 py-2 text-[11.5px] text-warn">
                {pick(
                  "Zincirdeki hiçbir sağlayıcının anahtarı yok. Settings → Anahtarlar üzerinden ekle ya da Tercihler → Arama sağlayıcı zinciri üzerinden farklı bir sağlayıcı seç.",
                  "No provider in the chain has a key. Add one in Settings → Keys, or pick a different provider via Preferences → Search provider chain.",
                )}
              </div>
            ) : null}
          </div>

          {searching ? (
            <div
              className="flex flex-col gap-1"
              data-testid="search-progress"
              data-attempt-index={searchProgress?.attemptIndex ?? 0}
              data-total={searchProgress?.total ?? 0}
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={searchProgress?.total ?? 0}
              aria-valuenow={searchProgress?.attemptIndex ?? 0}
              aria-label={pick("Arama ilerlemesi", "Search progress")}
            >
              <div className="h-1 w-full overflow-hidden rounded-full border border-rule bg-paper-2">
                <div
                  className="h-full bg-accent transition-all duration-300 ease-out"
                  style={{
                    width:
                      searchProgress && searchProgress.total > 0
                        ? `${Math.min(
                            100,
                            (searchProgress.attemptIndex /
                              searchProgress.total) *
                              100,
                          )}%`
                        : "0%",
                  }}
                />
              </div>
              <div className="flex items-center justify-between font-mono text-[10.5px] text-ink-3">
                <span>
                  {searchProgress
                    ? pick(
                        `Deneniyor: ${searchProgress.providerLabel}`,
                        `Trying: ${searchProgress.providerLabel}`,
                      )
                    : pick("Hazırlanıyor…", "Preparing…")}
                </span>
                <span>
                  {searchProgress
                    ? `${searchProgress.attemptIndex}/${searchProgress.total}`
                    : ""}
                </span>
              </div>
            </div>
          ) : null}

          {searchError ? (
            <div role="alert" className="space-y-2">
              <div className="rounded-md border border-rule bg-paper-2 px-3 py-2 text-[12px] text-warn">
                {searchError}
              </div>
              {searchAttempts && searchAttempts.length > 0 ? (
                <ul
                  className="space-y-1 rounded-md border border-rule bg-paper-2 px-3 py-2 text-[11.5px]"
                  data-testid="search-attempt-list"
                >
                  {searchAttempts.map((attempt, idx) => {
                    const provider = getSearchProvider(attempt.id);
                    const label = provider?.label ?? attempt.id;
                    const desc = describeAttempt(attempt, pick);
                    return (
                      <li
                        key={`${attempt.id}-${idx}`}
                        className="flex items-start gap-2 font-mono"
                        data-testid="search-attempt"
                        data-status={attempt.status}
                      >
                        <span
                          aria-hidden
                          className={`mt-1.5 inline-flex h-1.5 w-1.5 shrink-0 rounded-full ${desc.tone}`}
                        />
                        <span className="flex-1 text-ink-2">
                          <span className="text-ink-1">{label}</span>
                          <span className="text-ink-3"> · {desc.text}</span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </div>
          ) : null}

          {results.length > 0 ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2 text-[11.5px]">
                <span className="text-ink-3">
                  {pick(
                    `Sağlayıcı: ${ingestProvider}`,
                    `Provider: ${ingestProvider}`,
                  )}
                </span>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="ghost" onClick={selectAll}>
                    {pick("Hepsini seç", "Select all")}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={clearSelection}>
                    {pick("Temizle", "Clear")}
                  </Button>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={urlFilter}
                  onChange={(e) => setUrlFilter(e.target.value)}
                  placeholder={pick(
                    "URL'e göre filtrele (ör. wikipedia.org)",
                    "Filter by URL (e.g. wikipedia.org)",
                  )}
                  spellCheck={false}
                  data-testid="search-url-filter"
                  className="flex-1 rounded-md border border-rule bg-paper-2 px-2 py-1.5 font-mono text-[11px] outline-none focus:border-accent"
                />
                <span className="shrink-0 font-mono text-[10.5px] text-ink-3">
                  {filteredResults.length}/{results.length}
                </span>
              </div>
            </div>
          ) : null}

          <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
            {filteredResults.map((r) => {
              const isSelected = selected.has(r.url);
              const progress = ingestProgress.get(r.url);
              const isIngested = progress?.phase === "done";
              // Wrapper is a `div role="button"` rather than `<button>` so
              // we can nest a real `<a target="_blank">` "Aç" link inside.
              // HTML5 forbids interactive descendants of <button>.
              const handleToggle = (): void => {
                if (ingesting) return;
                // Already-ingested rows are visually locked — preserve the
                // "Eklendi" badge instead of cycling through select state
                // that won't do anything (repo-level dedupe ignores it).
                if (isIngested) return;
                toggleSelected(r.url);
              };
              return (
                <div
                  key={r.url}
                  role="button"
                  tabIndex={ingesting ? -1 : 0}
                  aria-pressed={isSelected}
                  aria-disabled={ingesting ? "true" : undefined}
                  onClick={handleToggle}
                  onKeyDown={(e) => {
                    if (ingesting) return;
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      handleToggle();
                    }
                  }}
                  data-testid="search-result-row"
                  data-selected={isSelected ? "true" : "false"}
                  className={`flex w-full items-start gap-3 rounded-[10px] border px-3 py-2 text-left transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-accent ${
                    isSelected
                      ? "border-accent bg-accent/5"
                      : "border-rule bg-paper-2 hover:bg-paper-3"
                  } ${
                    ingesting || isIngested
                      ? "cursor-not-allowed"
                      : "cursor-pointer"
                  } ${ingesting && !isIngested ? "opacity-70" : ""} ${
                    isIngested ? "opacity-60" : ""
                  }`}
                >
                  <span aria-hidden className="mt-0.5">
                    {isSelected ? (
                      <SquareCheck className="h-4 w-4 text-accent" />
                    ) : (
                      <Square className="h-4 w-4 text-ink-3" />
                    )}
                  </span>
                  {r.faviconUrl ? (
                    <img
                      src={r.faviconUrl}
                      alt=""
                      width={16}
                      height={16}
                      className="mt-0.5 h-4 w-4 rounded-sm"
                      loading="lazy"
                    />
                  ) : (
                    <Globe className="mt-0.5 h-4 w-4 text-ink-3" aria-hidden />
                  )}
                  <span className="flex-1 space-y-0.5">
                    <span className="block text-[13px] font-medium text-ink-1">
                      {r.title}
                    </span>
                    <span className="block font-mono text-[10.5px] text-ink-3">
                      {hostnameOf(r.url)}
                      {r.age ? ` · ${r.age}` : ""}
                    </span>
                    {r.description ? (
                      <span className="block text-[12px] text-ink-2">
                        {r.description}
                      </span>
                    ) : null}
                  </span>
                  <a
                    href={r.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                    aria-label={pick(
                      `${r.title} adresini yeni sekmede aç`,
                      `Open ${r.title} in a new tab`,
                    )}
                    data-testid="search-result-open"
                    className="mt-0.5 inline-flex shrink-0 items-center gap-1 rounded border border-rule bg-paper-1 px-2 py-1 font-mono text-[10.5px] uppercase tracking-[0.06em] text-ink-2 transition-colors hover:border-accent hover:bg-paper-3 hover:text-ink-1 focus:outline-none focus-visible:border-accent"
                  >
                    <ExternalLink className="h-3 w-3" aria-hidden />
                    {pick("Aç", "Open")}
                  </a>
                  {progress ? (
                    <span
                      aria-hidden
                      className="mt-1 inline-flex shrink-0 items-center gap-1 font-mono text-[10px] uppercase tracking-[0.06em]"
                    >
                      {progress.phase === "running" ? (
                        <Loader2 className="h-4 w-4 animate-spin text-accent" />
                      ) : progress.phase === "done" ? (
                        <>
                          <CheckCircle2 className="h-4 w-4 text-ok" />
                          <span className="text-ok">
                            {pick("Eklendi", "Added")}
                          </span>
                        </>
                      ) : progress.phase === "error" ? (
                        <XCircle className="h-4 w-4 text-warn" />
                      ) : null}
                    </span>
                  ) : null}
                </div>
              );
            })}
            {results.length === 0 && !searching && !searchError ? (
              <div className="rounded-md border border-dashed border-rule bg-paper-2 px-3 py-6 text-center text-[12px] text-ink-3">
                {pick(
                  "Aramak için yukarıya konu yaz.",
                  "Type a topic above to search.",
                )}
              </div>
            ) : filteredResults.length === 0 && results.length > 0 ? (
              <div className="rounded-md border border-dashed border-rule bg-paper-2 px-3 py-6 text-center text-[12px] text-ink-3">
                {pick(
                  `Filtreyle eşleşen sonuç yok ("${urlFilter}").`,
                  `No results match the filter ("${urlFilter}").`,
                )}
              </div>
            ) : null}
          </div>
        </div>
      </Modal>
      
    </>
  );
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

type LocalePick = (tr: string, en: string) => string;

function describeAttempt(
  attempt: SearchAttempt,
  pick: LocalePick,
): { tone: string; text: string } {
  switch (attempt.status) {
    case "skipped-disabled":
      return { tone: "bg-ink-3", text: pick("devre dışı", "disabled") };
    case "skipped-unknown":
      return {
        tone: "bg-ink-3",
        text: pick("tanınmayan sağlayıcı", "unknown provider"),
      };
    case "skipped-no-key":
      return { tone: "bg-warn", text: pick("anahtar yok", "no API key") };
    case "skipped-empty":
      return {
        tone: "bg-warn",
        text: pick("sonuç dönmedi (boş)", "empty result"),
      };
    case "error":
      return {
        tone: "bg-warn",
        text: attempt.error ?? pick("hata", "error"),
      };
    case "ok":
      return { tone: "bg-ok", text: pick("başarılı", "ok") };
  }
}
