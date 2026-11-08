"use client";

import { Sparkles } from "@/components/icons";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useLocalePick } from "@/i18n/IntlProvider";
import {
  DynamicKeyField,
  PresetChooser,
} from "@/components/setup/PresetChooser";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";
import { SettingsRow } from "@/components/settings/layout/SettingsPrimitives";
import type { ApiKeyManager } from "@/components/settings/ApiKeyRow";
import {
  getQuickStartPreset,
  type QuickStartPresetId,
} from "@/lib/ai/quick-start-presets";
import { type Provider } from "@/lib/db/schema";
import { type ModelBindings, usePrefs } from "@/stores/prefs";
import {
  encodeChatModelBinding,
  findChatOption,
  findModelDescriptor,
  formatModelPriceLabel,
  getProviderChatModels,
  MODEL_TIER_LABEL,
  type CapabilityBadge,
  type ChatOption,
} from "@/lib/ai/model-options";
import type { ModelTier, ProviderId } from "@/lib/ai/providers/types";
import { getPreset } from "@/lib/ai/providers/presets";
import { useProviderChatModels } from "@/hooks/useProviderChatModels";
import { supportsModelFetch } from "@/lib/ai/providers/model-fetch/adapter";

export type ModelRowOption = {
  id: string;
  label: string;
  badges: CapabilityBadge[];
};

const TIER_CHIP_STYLES: Record<ModelTier, string> = {
  flagship: "border-accent/40 bg-accent/10 text-ink",
  balanced: "border-rule-soft bg-paper-2 text-ink-2",
  fast: "border-rule-soft bg-paper-2 text-ink-2",
  free: "border-ok/40 bg-ok/10 text-ok",
};

// Providers that have a dedicated Quick-start tile. Picking one of these and
// hitting the "no key" chip should scroll the user to the inline form rather
// than sending them to a different tab.
const QUICK_START_PROVIDERS = new Set<string>([
  "anthropic",
  "google-gemini",
  "groq",
  "openrouter",
  "ollama",
]);

export function ChatModelRow({
  label,
  value,
  onChange,
  options,
  keys,
  hint,
  note,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: ChatOption[];
  keys: ApiKeyManager;
  hint?: string;
  note?: string;
}) {
  const pick = useLocalePick();
  const router = useRouter();
  const resolved = findChatOption(value);
  const selectedProvider =
    options.find((o) => o.presetId === resolved?.presetId) ?? options[0];
  const modelValue = resolved?.modelId ?? value;
  // Phase 10.D — Dynamic catalog: hook returns either the cached `/models`
  // response (dynamic) or the static preset list (fallback). presetId is
  // never undefined in practice (options always non-empty); the fallback to
  // "anthropic" exists only to satisfy the hook signature on the first paint
  // before useLiveQuery resolves.
  const presetIdForCatalog: ProviderId =
    selectedProvider?.presetId ?? ("anthropic" as ProviderId);
  const {
    models: availableModels,
    source: modelsSource,
    isFetching: modelsFetching,
    error: modelsError,
    fetchedAt: modelsFetchedAt,
    refresh: refreshModels,
  } = useProviderChatModels(presetIdForCatalog);
  const selectedDescriptor = selectedProvider
    ? availableModels.find((m) => m.id === modelValue) ??
      findModelDescriptor(selectedProvider.presetId, modelValue)
    : undefined;
  // Local providers have no key requirement; "claude-code-oauth" uses a
  // separate sentinel that lives outside this picker — only check stored
  // status when the provider actually maps to a Provider literal we manage.
  const presetIdStr = selectedProvider?.presetId ?? "";
  // A preset that authenticates outside TME (the local agent CLI) has no key
  // to store either, so it is read off the preset rather than re-listed here.
  const isLocalProvider =
    presetIdStr === "ollama" ||
    presetIdStr === "lm-studio" ||
    presetIdStr === "llama-cpp" ||
    getPreset(presetIdStr as ProviderId)?.externalAuth === true;
  const keyStored = selectedProvider
    ? keys.isStored(selectedProvider.presetId as Provider)
    : false;
  const showKeyMissing =
    !!selectedProvider && !isLocalProvider && keys.storedLoaded && !keyStored;

  // "Custom mode" lets the user type a model ID that isn't in the curated
  // catalog (the providers expose hundreds; we only ship a popular subset).
  // Auto-enable when the stored value isn't recognized so a previously typed
  // ID stays editable rather than getting silently swapped out.
  const [customMode, setCustomMode] = useState(
    !!selectedProvider && !!modelValue && !selectedDescriptor,
  );
  // Reset customMode when the provider changes (handled inside the handler).
  // Also clear it if the resolved descriptor *becomes* known later (e.g. the
  // catalog gained a new entry on a hot reload).
  const [previousDescriptor, setPreviousDescriptor] = useState(selectedDescriptor);
  if (previousDescriptor !== selectedDescriptor) {
    setPreviousDescriptor(selectedDescriptor);
    if (selectedDescriptor) setCustomMode(false);
  }

  function handleProviderChange(providerId: string): void {
    const next = options.find((o) => o.presetId === providerId);
    if (!next) return;
    // Pick the new provider's *recommended* default model rather than carrying
    // over the previous provider's modelId — that string is almost always
    // invalid for the new provider and would just produce a 404 on first send.
    const nextModels = getProviderChatModels(next.presetId);
    const defaultModel = nextModels[0]?.id ?? next.modelId;
    setCustomMode(false);
    onChange(encodeChatModelBinding(next.presetId, defaultModel));
  }

  function handleModelChange(modelId: string): void {
    if (!selectedProvider) {
      onChange(modelId);
      return;
    }
    onChange(encodeChatModelBinding(selectedProvider.presetId, modelId));
  }

  function handleModelSelectChange(value: string): void {
    if (value === "__custom__") {
      // User chose "Other (custom ID)" — switch to text input. Keep the
      // current modelValue as the starting text so they can edit rather
      // than starting from blank.
      setCustomMode(true);
      return;
    }
    setCustomMode(false);
    handleModelChange(value);
  }

  const isCoveredByQuickStart = QUICK_START_PROVIDERS.has(presetIdStr);

  function handleAddKey(): void {
    if (isCoveredByQuickStart) {
      // QuickStartRow lives inside the same Models section above the rows. A
      // smooth scroll keeps the user in context instead of bouncing tabs.
      const el = document.querySelector("[data-quickstart-anchor]");
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      return;
    }
    // Provider isn't in Quick-start (e.g. DeepSeek, Mistral, xAI). Jump to
    // the Providers page where the user either finds a dedicated row or, for
    // providers without one, can fall back to the Custom Endpoint section.
    router.push("/settings/providers");
  }

  return (
    <SettingsRow
      title={label}
      description={
        <>
          {hint}
          {selectedProvider && selectedProvider.badges.length > 0 ? (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {selectedProvider.badges.map((b) => (
                <span
                  key={`${b.kind}-${b.label}`}
                  className="inline-flex items-center rounded-full border border-rule-soft bg-paper-2 px-2 py-0.5 font-mono text-[10.5px] text-ink-2"
                >
                  {b.label}
                </span>
              ))}
            </div>
          ) : null}
        </>
      }
    >
      <div className="grid gap-3 lg:grid-cols-[220px_minmax(0,1fr)] lg:items-end">
        <label className="grid min-w-0 gap-1">
          <span className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-3">
            {pick("Sağlayıcı", "Provider")}
          </span>
          <select
            value={selectedProvider?.presetId ?? ""}
            onChange={(e) => handleProviderChange(e.target.value)}
            aria-label={`${label} provider`}
            className="h-10 w-full min-w-0 rounded-md border border-rule-strong bg-paper px-2.5 font-mono text-[12.5px] text-ink shadow-[var(--shadow-soft)] focus:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
          >
            {options.map((o) => (
              <option key={o.presetId} value={o.presetId}>
                {o.label.split(" · ")[0]}
              </option>
            ))}
          </select>
        </label>
        <label className="grid min-w-0 gap-1">
          <span className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-3">
            {pick("Model", "Model")}
          </span>
          {availableModels.length === 0 || customMode ? (
            <Input
              variant="mono"
              value={modelValue}
              onChange={(e) => handleModelChange(e.target.value)}
              placeholder={selectedProvider?.modelId ?? "model-id"}
              className="h-10 w-full min-w-0"
            />
          ) : (
            <select
              value={modelValue}
              onChange={(e) => handleModelSelectChange(e.target.value)}
              aria-label={`${label} model`}
              className="h-10 w-full min-w-0 rounded-md border border-rule-strong bg-paper px-2.5 text-[12.5px] text-ink shadow-[var(--shadow-soft)] focus:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
            >
              {/* Surface a custom modelValue that isn't in the curated catalog
                  (e.g. user typed it in a previous build) so they can still
                  see + replace it instead of silently losing the binding. */}
              {!selectedDescriptor && modelValue ? (
                <option value={modelValue}>{modelValue}</option>
              ) : null}
              {availableModels.map((m) => {
                const tierLabel = pick(
                  MODEL_TIER_LABEL[m.tier].tr,
                  MODEL_TIER_LABEL[m.tier].en,
                );
                const price = formatModelPriceLabel(m.id);
                // Avoid "Free · Free" — when tier is "free" the price chip
                // would just repeat the tier label, so drop one.
                const showPrice = price && !(price === "Free" && m.tier === "free");
                const tail = showPrice ? ` · ${tierLabel} · ${price}` : ` · ${tierLabel}`;
                return (
                  <option key={m.id} value={m.id}>
                    {m.displayName}{tail}
                  </option>
                );
              })}
              <option value="__custom__">
                {pick("Diğer (model ID gir)…", "Other (enter model ID)…")}
              </option>
            </select>
          )}
          {customMode && availableModels.length > 0 ? (
            <button
              type="button"
              onClick={() => {
                setCustomMode(false);
                const fallback = availableModels[0]?.id;
                if (fallback) handleModelChange(fallback);
              }}
              className="self-start pt-0.5 font-mono text-[10.5px] text-ink-3 underline-offset-2 hover:text-ink hover:underline"
            >
              {pick("← Önerilenlere dön", "← Back to suggestions")}
            </button>
          ) : (
            <>
              {selectedDescriptor ? (
                <div className="flex items-center gap-1.5 pt-0.5">
                  <span
                    className={`inline-flex items-center rounded-full border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.06em] ${TIER_CHIP_STYLES[selectedDescriptor.tier]}`}
                  >
                    {pick(
                      MODEL_TIER_LABEL[selectedDescriptor.tier].tr,
                      MODEL_TIER_LABEL[selectedDescriptor.tier].en,
                    )}
                  </span>
                  <code className="truncate font-mono text-[10.5px] text-ink-4">
                    {selectedDescriptor.id}
                  </code>
                </div>
              ) : modelValue ? (
                <code className="truncate pt-0.5 font-mono text-[10.5px] text-ink-4">
                  {modelValue}
                </code>
              ) : null}
              {availableModels.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setCustomMode(true)}
                  className="self-start pt-0.5 text-[10.5px] text-ink-3 underline-offset-2 hover:text-ink hover:underline"
                >
                  {pick(
                    "Listede yoksa elle model ID yaz →",
                    "Not in the list? Type a custom model ID →",
                  )}
                </button>
              ) : null}
            </>
          )}
        </label>
      </div>
      {showKeyMissing ? (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-[12px] text-warn">
          <span className="truncate">
            {pick(
              "Bu sağlayıcı için API anahtarı yok.",
              "No API key for this provider.",
            )}
          </span>
          <button
            type="button"
            onClick={handleAddKey}
            className="shrink-0 font-medium underline-offset-2 hover:underline"
          >
            {isCoveredByQuickStart
              ? pick("Quick-start ile ekle →", "Add via Quick-start →")
              : pick("API anahtarlarına git →", "Open API Keys →")}
          </button>
        </div>
      ) : null}
      {note ? (
        <p className="mt-2 text-[11.5px] text-ink-3">{note}</p>
      ) : null}
      {supportsModelFetch(presetIdForCatalog) ? (
        <div className="mt-2 flex items-center justify-between gap-2 font-mono text-[10.5px] text-ink-3">
          <span className="truncate">
            {modelsFetching
              ? pick("Model listesi yenileniyor…", "Refreshing catalog…")
              : modelsError === "missing_api_key"
                ? pick(
                    "API anahtarı ekleyince güncel liste çekilecek",
                    "Add an API key to fetch the live catalog",
                  )
                : modelsError === "empty_catalog"
                  ? pick(
                      "Sağlayıcı boş katalog döndü — statik liste gösteriliyor",
                      "Provider returned an empty catalog — showing static fallback",
                    )
                  : modelsError
                    ? pick(
                        `Katalog çekilemedi — statik liste gösteriliyor`,
                        `Catalog fetch failed — showing static fallback`,
                      )
                    : modelsSource === "dynamic" && modelsFetchedAt
                      ? pick(
                          `Dinamik · ${formatCatalogRelative(modelsFetchedAt, "tr")} · ${availableModels.length} model`,
                          `Dynamic · ${formatCatalogRelative(modelsFetchedAt, "en")} · ${availableModels.length} models`,
                        )
                      : modelsSource === "static"
                        ? pick("Statik liste", "Static list")
                        : pick("Yükleniyor…", "Loading…")}
          </span>
          <button
            type="button"
            onClick={() => void refreshModels()}
            disabled={modelsFetching}
            className="shrink-0 font-medium underline-offset-2 hover:text-ink hover:underline disabled:cursor-wait disabled:opacity-60"
            aria-label={pick("Model listesini yenile", "Refresh model list")}
          >
            {pick("↻ Yenile", "↻ Refresh")}
          </button>
        </div>
      ) : null}
    </SettingsRow>
  );
}

/**
 * Short relative-time string for the dynamic catalog "fetched X ago" line.
 * `Intl.RelativeTimeFormat` covers minute / hour / day automatically but
 * we want a compact unit-letter form ("3 dk önce", "3 min ago") rather
 * than the verbose "3 minutes ago" Intl produces.
 */
function formatCatalogRelative(
  timestamp: number,
  locale: "tr" | "en",
  now: number = Date.now(),
): string {
  const delta = Math.max(0, now - timestamp);
  if (delta < 60_000) return locale === "tr" ? "az önce" : "just now";
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 60) {
    return locale === "tr" ? `${minutes} dk önce` : `${minutes} min ago`;
  }
  const hours = Math.floor(delta / 3_600_000);
  if (hours < 24) {
    return locale === "tr" ? `${hours} sa önce` : `${hours} h ago`;
  }
  const days = Math.floor(delta / 86_400_000);
  return locale === "tr" ? `${days} gün önce` : `${days} d ago`;
}


export function ModelRow({
  label,
  value,
  onChange,
  options,
  hint,
  note,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: ModelRowOption[];
  hint?: string;
  note?: string;
}) {
  // Selected option may be missing if a stale binding refers to a preset
  // removed between releases — fall back to the raw id so the user still sees
  // what is stored and can pick a valid replacement.
  const selected = options.find((o) => o.id === value);
  return (
    <SettingsRow
      title={label}
      description={
        <>
          {hint}
          {selected && selected.badges.length > 0 ? (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {selected.badges.map((b) => (
                <span
                  key={`${b.kind}-${b.label}`}
                  className="inline-flex items-center rounded-full border border-rule-soft bg-paper-2 px-2 py-0.5 font-mono text-[10.5px] text-ink-2"
                >
                  {b.label}
                </span>
              ))}
            </div>
          ) : null}
        </>
      }
      control={
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label={label}
          className="max-w-[320px] rounded-md border border-rule bg-paper px-2.5 py-1 font-mono text-[12.5px] text-ink focus:border-ink-5 focus:outline-none"
        >
          {!selected ? (
            <option value={value}>{value}</option>
          ) : null}
          {options.map((o) => {
            const badgeText = o.badges.map((b) => b.label).join(" · ");
            return (
              <option key={o.id} value={o.id}>
                {o.label}
                {badgeText ? ` — ${badgeText}` : ""}
              </option>
            );
          })}
        </select>
      }
    >
      {note ? (
        <p className="text-[11.5px] text-ink-3">{note}</p>
      ) : null}
    </SettingsRow>
  );
}


export function QuickStartRow({
  keys,
}: {
  keys: ApiKeyManager;
}) {
  const pick = useLocalePick();
  const { toast } = useToast();
  const setModelBinding = usePrefs((s) => s.setModelBinding);
  const [selectedId, setSelectedId] = useState<QuickStartPresetId | null>(null);
  const [keyValue, setKeyValue] = useState("");
  const [applying, setApplying] = useState(false);

  const preset = useMemo(
    () => (selectedId ? (getQuickStartPreset(selectedId) ?? null) : null),
    [selectedId],
  );

  const canApply = preset
    ? !preset.requiresKey || keyValue.trim().length > 0
    : false;

  function handleSelect(id: QuickStartPresetId): void {
    setSelectedId(id);
    setKeyValue("");
  }

  async function handleApply(): Promise<void> {
    if (!preset) return;
    setApplying(true);
    try {
      if (preset.requiresKey) {
        keys.setDraft(preset.providerId, keyValue.trim());
      }
      // Apply bindings before the (potentially async) saveAll so the toast
      // fires once both have landed.
      for (const [task, model] of Object.entries(preset.defaultBindings)) {
        if (model) {
          setModelBinding(task as keyof ModelBindings, model);
        }
      }
      await keys.saveAll();
      toast({
        variant: "success",
        title: pick(
          `${preset.label} hızlı başlangıç uygulandı`,
          `${preset.label} quick-start applied`,
        ),
        description: pick(
          "Sohbet, özet ve gömme modelleri güncellendi.",
          "Chat, summary, and embed models updated.",
        ),
      });
      setKeyValue("");
    } finally {
      setApplying(false);
    }
  }

  return (
    <div className="p-5 sm:p-6" data-quickstart-anchor="">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-accent" aria-hidden />
        <h3 className="font-serif text-[18px] font-medium text-ink">
          {pick("Hızlı başlangıç", "Quick start")}
        </h3>
      </div>
      <p className="mt-1.5 max-w-[60ch] text-[13px] text-ink-3">
        {pick(
          "Tek tıkla bir sağlayıcı seç — aşağıdaki dört model satırı otomatik güncellenir.",
          "Pick one provider — the four model rows below get updated automatically.",
        )}
      </p>
      <div className="mt-4">
        <PresetChooser selectedId={selectedId} onSelect={handleSelect} />
      </div>
      <div className="mt-4">
        <DynamicKeyField
          preset={preset}
          value={keyValue}
          onChange={setKeyValue}
          inputId="settings-quickstart-key"
        />
      </div>
      <div className="mt-4 flex items-center justify-end">
        <Button
          size="md"
          variant="primary"
          onClick={() => void handleApply()}
          disabled={!canApply || applying}
        >
          {applying
            ? pick("Uygulanıyor…", "Applying…")
            : pick("Uygula", "Apply")}
        </Button>
      </div>
    </div>
  );
}
