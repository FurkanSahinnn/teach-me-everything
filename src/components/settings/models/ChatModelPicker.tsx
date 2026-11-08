"use client";

import { Command } from "cmdk";
import { useRef, useState } from "react";

import { Check, ChevronDown, RefreshCw, Search } from "@/components/icons";
import { Button } from "@/components/ui/Button";
import { useProviderChatModels } from "@/hooks/useProviderChatModels";
import { useLocalePick } from "@/i18n/IntlProvider";
import {
  encodeChatModelBinding,
  findChatOption,
  findModelDescriptor,
  formatModelPriceLabel,
  MODEL_TIER_LABEL,
  type ChatOption,
} from "@/lib/ai/model-options";
import { supportsModelFetch } from "@/lib/ai/providers/model-fetch/adapter";
import type { ModelDescriptor, ProviderId } from "@/lib/ai/providers/types";
import { cn } from "@/lib/utils/cn";

import { AnchoredPopover } from "./AnchoredPopover";
import { formatCatalogRelative, providerShortLabel } from "./picker-utils";

type LocalePick = (tr: string, en: string) => string;

const POPOVER_WIDTH = 600;
const POPOVER_HEIGHT = 440;

type Props = {
  label: string;
  value: string;
  options: readonly ChatOption[];
  onChange: (binding: string) => void;
  /** False when the provider still needs a key; shown on the trigger and in the provider column. */
  isProviderReady: (presetId: ProviderId) => boolean;
  /** Where to send the user to add a missing key. */
  onAddKey: () => void;
};

function tierAndPrice(model: ModelDescriptor, pick: LocalePick): string {
  const tier = pick(MODEL_TIER_LABEL[model.tier].tr, MODEL_TIER_LABEL[model.tier].en);
  const price = formatModelPriceLabel(model.id);
  return price && !(price === "Free" && model.tier === "free") ? `${tier} · ${price}` : tier;
}

export function ChatModelPicker({ label, value, options, onChange, isProviderReady, onAddKey }: Props) {
  const pick = useLocalePick();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const resolved = findChatOption(value);
  const currentPreset = (resolved?.presetId ?? options[0]?.presetId) as ProviderId | undefined;
  const currentModel = resolved?.modelId ?? value;
  const currentOption = options.find((o) => o.presetId === currentPreset);
  const currentDescriptor = currentPreset ? findModelDescriptor(currentPreset, currentModel) : undefined;

  const close = () => setOpen(false);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={pick(`${label} için model seç`, `Choose model for ${label}`)}
        className={cn(
          "flex w-full items-center gap-3 rounded-[var(--radius-sm)] border border-rule bg-paper px-3 py-2 text-left transition-colors sm:w-[300px]",
          "hover:border-rule-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
          open && "border-rule-strong",
        )}
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium text-ink">{currentDescriptor?.displayName ?? currentModel}</span>
          <span className="block truncate text-[11.5px] text-ink-3">
            {currentOption ? providerShortLabel(currentOption.label) : ""}
            {currentPreset && !isProviderReady(currentPreset) ? (
              <span className="text-warn"> · {pick("Anahtar yok", "No key")}</span>
            ) : null}
          </span>
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-ink-4" aria-hidden />
      </button>
      <AnchoredPopover
        anchorRef={triggerRef}
        open={open}
        onClose={close}
        width={POPOVER_WIDTH}
        height={POPOVER_HEIGHT}
        label={pick(`${label} için model`, `Model for ${label}`)}
      >
        {currentPreset ? (
          <PickerBody
            key={currentPreset}
            initialPreset={currentPreset}
            currentPreset={currentPreset}
            currentModel={currentModel}
            options={options}
            isProviderReady={isProviderReady}
            onAddKey={() => {
              close();
              onAddKey();
            }}
            onPick={(presetId, modelId) => {
              onChange(encodeChatModelBinding(presetId, modelId));
              close();
              triggerRef.current?.focus();
            }}
            pick={pick}
          />
        ) : null}
      </AnchoredPopover>
    </>
  );
}

type BodyProps = {
  initialPreset: ProviderId;
  currentPreset: ProviderId;
  currentModel: string;
  options: readonly ChatOption[];
  isProviderReady: (presetId: ProviderId) => boolean;
  onAddKey: () => void;
  onPick: (presetId: ProviderId, modelId: string) => void;
  pick: LocalePick;
};

function PickerBody({ initialPreset, currentPreset, currentModel, options, isProviderReady, onAddKey, onPick, pick }: BodyProps) {
  const [browsing, setBrowsing] = useState<ProviderId>(initialPreset);
  const [customId, setCustomId] = useState("");
  const catalog = useProviderChatModels(browsing);
  const browsingOption = options.find((o) => o.presetId === browsing);
  const locale = pick("tr", "en") as "tr" | "en";

  const status = catalog.isFetching
    ? pick("Liste yenileniyor…", "Refreshing list…")
    : catalog.error === "missing_api_key"
      ? pick("Güncel liste için API anahtarı gerekli", "Add an API key to fetch the live list")
      : catalog.error
        ? pick("Liste çekilemedi · statik liste", "Couldn't fetch · static list")
        : catalog.source === "dynamic" && catalog.fetchedAt
          ? pick(
              `${catalog.models.length} model · ${formatCatalogRelative(catalog.fetchedAt, locale)}`,
              `${catalog.models.length} models · ${formatCatalogRelative(catalog.fetchedAt, locale)}`,
            )
          : pick(`${catalog.models.length} model · statik liste`, `${catalog.models.length} models · static list`);

  return (
    <div className="grid min-h-0 w-full grid-cols-[176px_minmax(0,1fr)]">
      <div className="min-h-0 overflow-y-auto border-r border-rule bg-paper-2 p-1.5">
        <div className="px-2 pb-1 pt-1 text-[11px] font-medium text-ink-4">{pick("Sağlayıcı", "Provider")}</div>
        <ul>
          {options.map((o) => {
            const presetId = o.presetId as ProviderId;
            const ready = isProviderReady(presetId);
            return (
              <li key={o.presetId}>
                <button
                  type="button"
                  onClick={() => setBrowsing(presetId)}
                  aria-current={presetId === browsing ? "true" : undefined}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-left text-[12.5px] transition-colors",
                    presetId === browsing ? "bg-paper-3 text-ink" : "text-ink-2 hover:bg-paper-3 hover:text-ink",
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{providerShortLabel(o.label)}</span>
                    {!ready ? <span className="block text-[10.5px] text-ink-4">{pick("Anahtar yok", "No key")}</span> : null}
                  </span>
                  {presetId === currentPreset ? <Check className="h-3.5 w-3.5 shrink-0 text-accent" aria-hidden /> : null}
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <Command className="flex min-h-0 flex-col" loop>
        <div className="flex items-center gap-2 border-b border-rule px-3">
          <Search className="h-3.5 w-3.5 shrink-0 text-ink-4" aria-hidden />
          <Command.Input
            autoFocus
            placeholder={pick(`${browsingOption ? providerShortLabel(browsingOption.label) : ""} modellerinde ara…`, `Search ${browsingOption ? providerShortLabel(browsingOption.label) : ""} models…`)}
            className="h-10 w-full bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-4"
          />
        </div>
        {browsingOption && browsingOption.badges.length > 0 ? (
          <div className="border-b border-rule px-3 py-1.5 text-[11px] text-ink-4">
            {browsingOption.badges.map((b) => b.label.replace(/^\S+\s/, "")).join(" · ")}
          </div>
        ) : null}
        <Command.List className="min-h-0 flex-1 overflow-y-auto p-1.5">
          <Command.Empty className="px-3 py-6 text-center text-[12.5px] text-ink-4">
            {pick("Eşleşen model yok. Aşağıya model ID'si yazabilirsin.", "No matching model. You can type a model ID below.")}
          </Command.Empty>
          {catalog.models.map((m) => {
            const selected = browsing === currentPreset && m.id === currentModel;
            return (
              <Command.Item
                key={m.id}
                value={`${m.displayName} ${m.id}`}
                onSelect={() => onPick(browsing, m.id)}
                className="flex cursor-pointer items-center gap-3 rounded-[var(--radius-sm)] px-2.5 py-2 data-[selected=true]:bg-paper-2"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-ink">{m.displayName}</span>
                  <span className="block truncate font-mono text-[11px] text-ink-4">{m.id}</span>
                </span>
                <span className="shrink-0 text-[11.5px] text-ink-3">{tierAndPrice(m, pick)}</span>
                <Check className={cn("h-3.5 w-3.5 shrink-0 text-accent", selected ? "opacity-100" : "opacity-0")} aria-hidden />
              </Command.Item>
            );
          })}
        </Command.List>
        <div className="space-y-2 border-t border-rule bg-paper-2 px-3 py-2">
          {!isProviderReady(browsing) ? (
            <div className="flex items-center justify-between gap-2 text-[11.5px]">
              <span className="text-warn">{pick("Bu sağlayıcı için API anahtarı yok.", "No API key for this provider.")}</span>
              <button type="button" onClick={onAddKey} className="shrink-0 font-medium text-accent hover:underline">
                {pick("Anahtar ekle", "Add key")}
              </button>
            </div>
          ) : null}
          <div className="flex items-center justify-between gap-2 text-[11.5px] text-ink-3">
            <span className="truncate">{status}</span>
            {supportsModelFetch(browsing) ? (
              <button
                type="button"
                onClick={() => void catalog.refresh()}
                disabled={catalog.isFetching}
                className="inline-flex shrink-0 items-center gap-1 hover:text-ink disabled:opacity-60"
              >
                <RefreshCw className="h-3 w-3" aria-hidden />
                {pick("Yenile", "Refresh")}
              </button>
            ) : null}
          </div>
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const id = customId.trim();
              if (id) onPick(browsing, id);
            }}
          >
            <input
              value={customId}
              onChange={(e) => setCustomId(e.target.value)}
              placeholder={pick("Listede yok mu? Model ID yaz", "Not listed? Type a model ID")}
              aria-label={pick("Özel model ID", "Custom model ID")}
              spellCheck={false}
              className="h-8 min-w-0 flex-1 rounded-[var(--radius-sm)] border border-rule bg-paper px-2.5 font-mono text-[12px] text-ink placeholder:font-sans placeholder:text-ink-4 focus:border-rule-strong focus:outline-none"
            />
            <Button type="submit" size="sm" disabled={!customId.trim()}>
              {pick("Kullan", "Use")}
            </Button>
          </form>
        </div>
      </Command>
    </div>
  );
}
