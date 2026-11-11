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
import { useToast } from "@/components/ui/Toast";
import { SettingsRow } from "@/components/settings/layout/SettingsPrimitives";
import type { ApiKeyManager } from "@/components/settings/ApiKeyRow";
import {
  getQuickStartPreset,
  type QuickStartPreset,
  type QuickStartPresetId,
} from "@/lib/ai/quick-start-presets";
import { type Provider } from "@/lib/db/schema";
import { type ModelBindings, usePrefs } from "@/stores/prefs";
import { type CapabilityBadge, type ChatOption } from "@/lib/ai/model-options";
import type { ProviderId } from "@/lib/ai/providers/types";
import { getPreset } from "@/lib/ai/providers/presets";
import { ChatModelPicker } from "@/components/settings/models/ChatModelPicker";
import { ListPicker } from "@/components/settings/models/ListPicker";

export type ModelRowOption = {
  id: string;
  label: string;
  badges: CapabilityBadge[];
};

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
  const router = useRouter();

  // Until stored keys load, treat every provider as ready so the picker does
  // not flash "No key" on first paint.
  const isProviderReady = (presetId: ProviderId): boolean => {
    if (!keys.storedLoaded) return true;
    if (KEYLESS_PRESETS.has(presetId) || getPreset(presetId)?.externalAuth === true) return true;
    const slots = presetId === "anthropic" ? ["anthropic", "claude-code-oauth"] : [presetId];
    return slots.some((slot) => keys.isStored(slot as Provider));
  };

  return (
    <SettingsRow
      title={label}
      description={
        hint || note ? (
          <>
            {hint}
            {note ? <span className="mt-1 block text-ink-4">{note}</span> : null}
          </>
        ) : undefined
      }
      control={
        <ChatModelPicker
          label={label}
          value={value}
          options={options}
          onChange={onChange}
          isProviderReady={isProviderReady}
          onAddKey={() => router.push("/settings/providers")}
        />
      }
    />
  );
}

const KEYLESS_PRESETS = new Set<string>(["ollama", "lm-studio", "llama-cpp"]);

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
  return (
    <SettingsRow
      title={label}
      description={
        hint || note ? (
          <>
            {hint}
            {note ? <span className="mt-1 block text-ink-4">{note}</span> : null}
          </>
        ) : undefined
      }
      control={
        <ListPicker
          label={label}
          value={value}
          onChange={onChange}
          options={options.map((o) => ({
            id: o.id,
            label: o.label,
            detail: o.badges.map((b) => b.label.replace(/^\S+\s/, "")).join(" · "),
          }))}
        />
      }
    />
  );
}

function isPresetKeyStored(
  preset: QuickStartPreset,
  keys: ApiKeyManager,
): boolean {
  if (!keys.storedLoaded || !preset.requiresKey) return false;
  if (preset.providerId === "anthropic") {
    return keys.isStored("anthropic") || keys.isStored("claude-code-oauth");
  }
  return keys.isStored(preset.providerId);
}

export function QuickStartRow({
  keys,
  onApplied,
}: {
  keys: ApiKeyManager;
  onApplied?: ((applied: Partial<ModelBindings>) => void) | undefined;
}) {
  const pick = useLocalePick();
  const { toast } = useToast();
  const setModelBinding = usePrefs((s) => s.setModelBinding);
  const setProviderEnabled = usePrefs((s) => s.setProviderEnabled);
  const [selectedId, setSelectedId] = useState<QuickStartPresetId | null>(null);
  const [keyValue, setKeyValue] = useState("");
  const [applying, setApplying] = useState(false);

  const preset = useMemo(
    () => (selectedId ? (getQuickStartPreset(selectedId) ?? null) : null),
    [selectedId],
  );

  const hasStoredKey = preset ? isPresetKeyStored(preset, keys) : false;

  const canApply = preset
    ? !preset.requiresKey || hasStoredKey || keyValue.trim().length > 0
    : false;

  function handleSelect(id: QuickStartPresetId): void {
    setSelectedId(id);
    setKeyValue("");
  }

  async function handleApply(): Promise<void> {
    if (!preset) return;
    setApplying(true);
    try {
      const trimmedKey = keyValue.trim();
      if (preset.requiresKey && trimmedKey.length > 0) {
        await keys.save(preset.providerId, trimmedKey);
      }
      setProviderEnabled(preset.providerId, true);
      for (const [task, model] of Object.entries(preset.defaultBindings)) {
        if (model) {
          setModelBinding(task as keyof ModelBindings, model);
        }
      }
      onApplied?.(preset.defaultBindings);
      await keys.saveAll();
      const updatedEmbed = Boolean(preset.defaultBindings.embedPresetId);
      toast({
        variant: "success",
        title: pick(
          `${preset.label} hızlı başlangıç uygulandı`,
          `${preset.label} quick-start applied`,
        ),
        description: updatedEmbed
          ? pick(
              "Tüm görev ve gömme (embedding) modelleri güncellendi.",
              "All task and embedding models updated.",
            )
          : pick(
              "Tüm sohbet ve analiz görev modelleri güncellendi (embedding modeli korundu).",
              "All chat and analysis task models updated (embedding model kept).",
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
          "Tek tıkla bir sağlayıcı seç — aşağıdaki görev modelleri otomatik güncellenir.",
          "Pick one provider — the task models below get updated automatically.",
        )}
      </p>
      <div className="mt-4">
        <PresetChooser
          selectedId={selectedId}
          onSelect={handleSelect}
          isPresetConfigured={(p) => isPresetKeyStored(p, keys)}
        />
      </div>
      <div className="mt-4">
        <DynamicKeyField
          preset={preset}
          value={keyValue}
          onChange={setKeyValue}
          inputId="settings-quickstart-key"
          hasStoredKey={hasStoredKey}
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
