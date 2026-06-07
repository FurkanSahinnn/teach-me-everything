"use client";

// Phase 5.5.G — Settings → Models tab: ordered priority chain for the
// "Konu ara" modal's search backend.
//
// The user drags rows to reorder; toggle disables individual entries
// without removing them. The dispatcher walks this list top-down at search
// time (see `lib/research/search/dispatch.ts`).
//
// Native HTML5 drag-and-drop keeps the bundle slim — no react-dnd / dnd-kit
// dependency. Per-row hover-feedback is rendered via React state so the drop
// target is always obvious even without library affordances.

import {
  ChevronDown,
  Globe2,
  GripVertical,
  Plus,
  Search,
  Sparkles,
  X as XIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Switch } from "@/components/ui/Switch";
import { useLocalePick } from "@/i18n/IntlProvider";
import { hasApiKey } from "@/lib/db/api-keys-repo";
import { getSearchProvider } from "@/lib/research/search/registry";
import {
  ALL_SEARCH_PROVIDER_IDS,
  getKeyProvidersForSearch,
  type SearchProviderId,
} from "@/lib/research/search/types";
import { usePrefs } from "@/stores/prefs";

type ProviderMeta = {
  id: SearchProviderId;
  label: string;
  kind: "pure" | "chat";
  costPerCallUsd?: number | undefined;
  freeTierNote?: string | undefined;
};

/**
 * Curated OpenRouter model presets for the search `:online` plugin. Listed
 * in rough cost-asc / quality-asc order. The dropdown also offers a
 * "Custom..." escape hatch so users can paste any OpenRouter slug.
 */
const OPENROUTER_MODEL_PRESETS: ReadonlyArray<{ id: string; label: string }> = [
  { id: "z-ai/glm-5", label: "Z-AI GLM 5.0 — default" },
  { id: "z-ai/glm-4.6", label: "Z-AI GLM 4.6 — cheapest" },
  { id: "openai/gpt-4o-mini", label: "GPT-4o mini — balanced" },
  { id: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  { id: "perplexity/sonar", label: "Perplexity Sonar (native search)" },
  { id: "meta-llama/llama-3.3-70b-instruct", label: "Llama 3.3 70B" },
  { id: "mistralai/mistral-large", label: "Mistral Large" },
  { id: "anthropic/claude-sonnet-4.5", label: "Claude Sonnet 4.5 — premium" },
  { id: "anthropic/claude-opus-4.7", label: "Claude Opus 4.7 — premium" },
];
const OPENROUTER_DEFAULT_MODEL_ID = "z-ai/glm-5";

function buildMeta(id: SearchProviderId): ProviderMeta | null {
  const provider = getSearchProvider(id);
  if (!provider) return null;
  const meta: ProviderMeta = {
    id,
    label: provider.label,
    kind: provider.kind,
  };
  if (provider.costPerCallUsd !== undefined) {
    meta.costPerCallUsd = provider.costPerCallUsd;
  }
  if (provider.freeTierNote !== undefined) {
    meta.freeTierNote = provider.freeTierNote;
  }
  return meta;
}

const ALL_META: ProviderMeta[] = ALL_SEARCH_PROVIDER_IDS.map(buildMeta).filter(
  (m): m is ProviderMeta => m !== null,
);

const META_BY_ID = new Map<string, ProviderMeta>(
  ALL_META.map((m) => [m.id, m]),
);

// A provider counts as "has key" when ANY of its credential slots has a
// stored key. For Anthropic specifically that means EITHER the plain API key
// row OR the Claude Code OAuth row satisfies — both authenticate the same
// upstream API. Pure search providers (Brave/Exa/Tavily) have a single slot
// so the early-exit is equivalent to the legacy `hasApiKey` check.
async function probeAnyCredentialPresent(id: string): Promise<boolean> {
  const options = getKeyProvidersForSearch(id);
  for (const opt of options) {
    if (await hasApiKey(opt.keyProvider)) return true;
  }
  return false;
}

function useApiKeyPresence(): Map<string, boolean> {
  // One probe per provider id. We rerun on every render because adding a key
  // in the API Keys tab does not currently fire a Dexie subscription
  // detectable from here; the lightweight polling on focus keeps the UI
  // fresh without a global observer.
  const [presence, setPresence] = useState<Map<string, boolean>>(new Map());
  useEffect(() => {
    let cancelled = false;
    async function refresh(): Promise<void> {
      const next = new Map<string, boolean>();
      for (const id of ALL_SEARCH_PROVIDER_IDS) {
        const present = await probeAnyCredentialPresent(id);
        next.set(id, present);
      }
      if (!cancelled) setPresence(next);
    }
    void refresh();
    const handler = (): void => {
      void refresh();
    };
    window.addEventListener("focus", handler);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", handler);
    };
  }, []);
  return presence;
}

/**
 * Inline model picker for the OpenRouter `:online` search row. Renders a
 * preset `<select>` plus a "Custom..." escape hatch that swaps in a free-text
 * input. Persists the choice to `prefs.searchProviders[i].config.modelId`.
 */
function OpenRouterModelPicker({ currentId }: { currentId: string }) {
  const pick = useLocalePick();
  const setConfig = usePrefs((s) => s.setSearchProviderConfig);
  const effective = currentId.trim().length > 0 ? currentId : OPENROUTER_DEFAULT_MODEL_ID;
  const isPreset = OPENROUTER_MODEL_PRESETS.some((p) => p.id === effective);
  const [mode, setMode] = useState<"preset" | "custom">(
    isPreset ? "preset" : "custom",
  );
  const [draft, setDraft] = useState<string>(effective);

  // Keep local state in sync when the stored value changes from elsewhere
  // (e.g. switching to another row and back, or import/restore).
  useEffect(() => {
    setDraft(effective);
    setMode(
      OPENROUTER_MODEL_PRESETS.some((p) => p.id === effective)
        ? "preset"
        : "custom",
    );
  }, [effective]);

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 pl-10 text-[11.5px] text-ink-3">
      <span className="font-mono uppercase tracking-[0.06em] text-ink-4">
        {pick("model", "model")}
      </span>
      {mode === "preset" ? (
        <select
          value={effective}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "__custom__") {
              setMode("custom");
              return;
            }
            setConfig("openrouter-search", { modelId: v });
          }}
          aria-label={pick(
            "OpenRouter modeli",
            "OpenRouter model",
          )}
          className="min-w-[220px] rounded-[6px] border border-rule bg-paper px-2 py-1 font-mono text-[11.5px] text-ink outline-none transition-colors focus:border-accent"
        >
          {OPENROUTER_MODEL_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label} — {p.id}
            </option>
          ))}
          <option value="__custom__">
            {pick("Özel…", "Custom…")}
          </option>
        </select>
      ) : (
        <>
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              const trimmed = draft.trim();
              if (trimmed.length === 0) {
                setConfig("openrouter-search", { modelId: undefined });
                setDraft(OPENROUTER_DEFAULT_MODEL_ID);
                setMode("preset");
              } else {
                setConfig("openrouter-search", { modelId: trimmed });
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") {
                setDraft(effective);
                setMode(isPreset ? "preset" : "custom");
              }
            }}
            placeholder="author/model-slug"
            spellCheck={false}
            autoComplete="off"
            aria-label={pick(
              "Özel OpenRouter model slug'ı",
              "Custom OpenRouter model slug",
            )}
            className="min-w-[220px] rounded-[6px] border border-rule bg-paper px-2 py-1 font-mono text-[11.5px] text-ink outline-none transition-colors focus:border-accent"
          />
          <button
            type="button"
            onClick={() => {
              setMode("preset");
              setDraft(OPENROUTER_DEFAULT_MODEL_ID);
              setConfig("openrouter-search", {
                modelId: OPENROUTER_DEFAULT_MODEL_ID,
              });
            }}
            className="rounded-[6px] px-2 py-1 text-[11px] text-ink-3 transition-colors hover:bg-paper-3 hover:text-ink"
          >
            {pick("Hazır listeye dön", "Use preset list")}
          </button>
        </>
      )}
    </div>
  );
}

export function SearchProvidersSection() {
  const pick = useLocalePick();
  const tWebSearch = useTranslations("web_search");
  void tWebSearch;
  const providers = usePrefs((s) => s.searchProviders);
  const addSearchProvider = usePrefs((s) => s.addSearchProvider);
  const removeSearchProvider = usePrefs((s) => s.removeSearchProvider);
  const setSearchProviderEnabled = usePrefs((s) => s.setSearchProviderEnabled);
  const reorderSearchProvider = usePrefs((s) => s.reorderSearchProvider);
  const presence = useApiKeyPresence();

  const [addOpen, setAddOpen] = useState(false);
  /**
   * Ref points at the wrapper that contains BOTH the toggle button and the
   * floating panel — outside-click detection treats the whole composite as
   * "inside" so clicking a dropdown item doesn't close the panel before its
   * onClick handler runs.
   */
  const addWrapperRef = useRef<HTMLDivElement>(null);
  const [dragHoverIndex, setDragHoverIndex] = useState<number | null>(null);

  const inListIds = useMemo(
    () => new Set(providers.map((p) => p.id)),
    [providers],
  );
  const candidates = useMemo(
    () => ALL_META.filter((m) => !inListIds.has(m.id)),
    [inListIds],
  );

  // Close the "add" dropdown on outside click. Use `click` (not `mousedown`)
  // so the dropdown item's onClick has a chance to fire FIRST — mousedown on
  // document fires before React's synthetic click on the item, which would
  // tear the dropdown down before the selection is applied.
  useEffect(() => {
    if (!addOpen) return;
    function onDocClick(event: MouseEvent): void {
      if (!addWrapperRef.current?.contains(event.target as Node)) {
        setAddOpen(false);
      }
    }
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, [addOpen]);

  function onDragStart(e: React.DragEvent<HTMLDivElement>, index: number): void {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(index));
  }
  function onDragOver(
    e: React.DragEvent<HTMLDivElement>,
    overIndex: number,
  ): void {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragHoverIndex !== overIndex) setDragHoverIndex(overIndex);
  }
  function onDragLeave(): void {
    setDragHoverIndex(null);
  }
  function onDrop(
    e: React.DragEvent<HTMLDivElement>,
    dropIndex: number,
  ): void {
    e.preventDefault();
    setDragHoverIndex(null);
    const from = Number(e.dataTransfer.getData("text/plain"));
    if (!Number.isFinite(from) || from === dropIndex) return;
    const entry = providers[from];
    if (!entry) return;
    reorderSearchProvider(entry.id, dropIndex);
  }

  return (
    <Card className="p-5">
      <div className="mb-4 flex items-start gap-3">
        <Search className="mt-1 h-5 w-5 text-accent" aria-hidden />
        <div>
          <h3 className="font-serif text-[17px] font-medium leading-tight text-ink">
            {pick("Arama sağlayıcı zinciri", "Search provider chain")}
          </h3>
          <p className="mt-1 max-w-[62ch] text-[13px] leading-6 text-ink-3">
            {pick(
              `"Konu ara → Kaynak ekle" modalı bu sırayı tarayarak çalışır. İlk başarılı sağlayıcı sonuçları döner; diğerleri fallback olarak kalır. Bir LLM seçersen modal sohbet API'sinin web search özelliğini kullanır — Brave/Exa/Tavily gibi pure search'lerden genelde daha kapsamlı sonuçlar verir.`,
              `The "Search topic → Add as sources" modal walks this chain top-down. The first successful provider returns results; the rest stay as fallbacks. Picking an LLM lets the modal use the chat API's native web search — usually more comprehensive than pure search engines like Brave/Exa/Tavily.`,
            )}
          </p>
          <p className="mt-1 font-mono text-[11px] text-ink-4">
            {pick(
              "Değişiklikler otomatik kaydedilir.",
              "Changes are saved automatically.",
            )}
          </p>
        </div>
      </div>

      <div className="space-y-2">
        {providers.length === 0 ? (
          <div className="rounded-[10px] border border-dashed border-rule bg-paper-2 px-4 py-6 text-center text-[12.5px] text-ink-3">
            {pick(
              "Henüz sağlayıcı yok. Aşağıdan ekle.",
              "No providers configured. Add one below.",
            )}
          </div>
        ) : (
          providers.map((entry, index) => {
            const meta = META_BY_ID.get(entry.id);
            const hasKey = presence.get(entry.id) ?? null;
            const isHover = dragHoverIndex === index;
            return (
              <div
                key={entry.id}
                draggable
                onDragStart={(e) => onDragStart(e, index)}
                onDragOver={(e) => onDragOver(e, index)}
                onDragLeave={onDragLeave}
                onDrop={(e) => onDrop(e, index)}
                data-testid="search-provider-row"
                data-provider-id={entry.id}
                className={`flex flex-col rounded-[10px] border bg-paper-2 px-3 py-2.5 transition-colors ${
                  isHover ? "border-accent" : "border-rule"
                }`}
              >
                <div className="flex items-center gap-3">
                <GripVertical
                  className="h-4 w-4 shrink-0 cursor-grab text-ink-3"
                  aria-hidden
                />
                <span
                  aria-hidden
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-rule-soft bg-paper text-accent"
                  title={
                    meta?.kind === "chat"
                      ? pick("LLM sohbeti", "Chat LLM")
                      : pick("Doğrudan arama", "Direct search")
                  }
                >
                  {meta?.kind === "chat" ? (
                    <Sparkles className="h-3.5 w-3.5" />
                  ) : (
                    <Globe2 className="h-3.5 w-3.5" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium text-ink">
                      {meta?.label ?? entry.id}
                    </span>
                    <span className="rounded-[4px] border border-rule-soft px-1 py-px font-mono text-[10px] uppercase tracking-[0.06em] text-ink-3">
                      #{index + 1}
                    </span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px] text-ink-3">
                    {meta?.costPerCallUsd !== undefined ? (
                      <span className="font-mono">
                        ~${meta.costPerCallUsd.toFixed(3)}/q
                      </span>
                    ) : null}
                    {meta?.freeTierNote ? <span>{meta.freeTierNote}</span> : null}
                    {hasKey === false ? (
                      <span className="rounded-[4px] bg-warn/10 px-1 py-px text-warn">
                        {pick("anahtar yok", "no key")}
                      </span>
                    ) : null}
                  </div>
                </div>
                <Switch
                  // Key-less providers (`hasKey === false`) would fail at
                  // dispatch time. We freeze the switch in OFF + disabled so
                  // the user can't promote a broken entry to active. The
                  // stored `entry.enabled` is preserved — once a key is added
                  // the switch comes alive at its real value automatically.
                  checked={entry.enabled && hasKey !== false}
                  disabled={hasKey === false}
                  onCheckedChange={(next) =>
                    setSearchProviderEnabled(entry.id, next)
                  }
                  ariaLabel={
                    hasKey === false
                      ? pick(
                          "Anahtar yok — bu sağlayıcı kullanılamaz",
                          "No key — this provider can't be used",
                        )
                      : pick("Aktif", "Enabled")
                  }
                />
                <button
                  type="button"
                  onClick={() => removeSearchProvider(entry.id)}
                  aria-label={pick("Sil", "Remove")}
                  className="grid h-7 w-7 place-items-center rounded-[6px] text-ink-3 transition-colors hover:bg-paper-3 hover:text-ink"
                >
                  <XIcon className="h-4 w-4" aria-hidden />
                </button>
                </div>
                {entry.id === "openrouter-search" ? (
                  <OpenRouterModelPicker
                    currentId={entry.config?.modelId ?? ""}
                  />
                ) : null}
              </div>
            );
          })
        )}
      </div>

      {candidates.length > 0 ? (
        <div ref={addWrapperRef} className="relative mt-3 inline-block">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setAddOpen((v) => !v)}
            data-testid="search-providers-add"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            {pick("Sağlayıcı ekle", "Add provider")}
            <ChevronDown className="h-3 w-3" aria-hidden />
          </Button>
          {addOpen ? (
            // Bumped above the page's sticky save bar (`z-10`) — transient
            // popovers always win over page-level chrome.
            <div className="absolute left-0 top-full z-30 mt-1 w-[300px] overflow-hidden rounded-[8px] border border-rule bg-paper shadow-[var(--shadow-deep)]">
              <ul className="max-h-[320px] overflow-y-auto py-1">
                {candidates.map((m) => {
                  const hasKey = presence.get(m.id) ?? null;
                  return (
                    <li key={m.id}>
                      <button
                        type="button"
                        onClick={() => {
                          addSearchProvider(m.id);
                          setAddOpen(false);
                        }}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-ink transition-colors hover:bg-paper-2"
                      >
                        {m.kind === "chat" ? (
                          <Sparkles className="h-3.5 w-3.5 text-accent" aria-hidden />
                        ) : (
                          <Globe2 className="h-3.5 w-3.5 text-accent" aria-hidden />
                        )}
                        <span className="flex-1 truncate">{m.label}</span>
                        {hasKey === false ? (
                          <span className="rounded-[4px] bg-warn/10 px-1 py-px text-[10px] text-warn">
                            {pick("anahtar yok", "no key")}
                          </span>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="mt-3 text-[11.5px] text-ink-3">
          {pick(
            "Tüm bilinen sağlayıcılar zincirde.",
            "All known providers are in the chain.",
          )}
        </p>
      )}
    </Card>
  );
}
