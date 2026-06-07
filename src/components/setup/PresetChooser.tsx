"use client";

import { useId, useRef } from "react";
import { Check, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useLocalePick } from "@/i18n/IntlProvider";
import { Chip } from "@/components/ui/Chip";
import { Input } from "@/components/ui/Input";
import {
  QUICK_START_PRESETS,
  type QuickStartPreset,
  type QuickStartPresetId,
} from "@/lib/ai/quick-start-presets";

// Two responsibilities, one file:
//   1. PresetChooser — radiogroup of 5 tiles with keyboard nav (←↑↓→ + Home/End)
//   2. DynamicKeyField — the input that shape-shifts based on selected preset
// Both rendered together in Setup Wizard Step 2 and Settings → Models tab.
// Kept colocated because changing one almost always changes the other (e.g.
// adding a new preset requires both a tile and a key-field branch).

type PresetChooserProps = {
  selectedId: QuickStartPresetId | null;
  onSelect: (id: QuickStartPresetId) => void;
  // Optional override — defaults to the global QUICK_START_PRESETS list.
  // Useful for tests and Storybook variants that want a subset.
  presets?: QuickStartPreset[];
};

export function PresetChooser({
  selectedId,
  onSelect,
  presets = QUICK_START_PRESETS,
}: PresetChooserProps) {
  const t = useLocalePick();
  const groupId = useId();
  const tileRefs = useRef<Array<HTMLButtonElement | null>>([]);

  function focusByIndex(idx: number) {
    const len = presets.length;
    const wrapped = ((idx % len) + len) % len;
    const el = tileRefs.current[wrapped];
    if (el) {
      el.focus();
      const preset = presets[wrapped];
      if (preset) onSelect(preset.id);
    }
  }

  function handleKey(e: React.KeyboardEvent<HTMLButtonElement>, idx: number) {
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        e.preventDefault();
        focusByIndex(idx + 1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        e.preventDefault();
        focusByIndex(idx - 1);
        break;
      case "Home":
        e.preventDefault();
        focusByIndex(0);
        break;
      case "End":
        e.preventDefault();
        focusByIndex(presets.length - 1);
        break;
    }
  }

  return (
    <div
      role="radiogroup"
      aria-label={t("Hızlı başlangıç sağlayıcı seçimi", "Quick-start provider")}
      className="grid grid-cols-2 gap-3 sm:grid-cols-3"
    >
      {presets.map((preset, idx) => {
        const selected = preset.id === selectedId;
        return (
          <button
            key={preset.id}
            ref={(el) => {
              tileRefs.current[idx] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            // Roving tabindex: only the selected tile (or the first if nothing
            // selected) sits in the tab order. Arrow keys move focus inside.
            tabIndex={selected || (selectedId === null && idx === 0) ? 0 : -1}
            id={`${groupId}-${preset.id}`}
            onClick={() => onSelect(preset.id)}
            onKeyDown={(e) => handleKey(e, idx)}
            className={cn(
              // Always 2px border so layout doesn't shift on selection.
              "group relative flex min-h-[118px] flex-col gap-2 rounded-[var(--radius)] border-2 p-3.5 text-left shadow-[var(--shadow-soft)]",
              "transition-[transform,box-shadow,border-color,background-color,color] duration-[180ms] ease-[cubic-bezier(0.2,0.6,0.2,1)]",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-paper",
              "active:scale-[0.98]",
              selected
                ? // Solid amber fill — unmistakable "this one is on" cue.
                  "border-accent bg-accent text-paper shadow-[var(--shadow-medium)]"
                : // Outlined: deepest neutral fill + warm tan border so the
                  // tile reads as a clear card on any theme surface.
                  "border-rule-strong bg-paper-2 text-ink hover:-translate-y-[2px] hover:border-accent hover:bg-paper hover:shadow-[var(--shadow-medium)]",
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <span className="text-[14px] font-semibold leading-tight">
                {preset.label}
              </span>
              {selected ? (
                <span
                  aria-hidden
                  className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-paper text-accent shadow-sm"
                >
                  <Check className="h-3 w-3" strokeWidth={3} aria-hidden />
                </span>
              ) : null}
            </div>
            <p
              className={cn(
                "text-[12px] leading-snug",
                selected ? "text-paper/85" : "text-ink-3",
              )}
            >
              {t(preset.tagline.tr, preset.tagline.en)}
            </p>
            <div className="mt-1 flex flex-wrap gap-1">
              {preset.isLocal ? (
                <Chip size="sm" variant="ok">
                  {t("yerel", "local")}
                </Chip>
              ) : null}
              {preset.freeTier ? (
                <Chip size="sm" variant="muted">
                  {t("ücretsiz katman", "free tier")}
                </Chip>
              ) : null}
              {!preset.requiresKey ? (
                <Chip size="sm" variant="default">
                  {t("anahtar yok", "no key")}
                </Chip>
              ) : null}
            </div>
          </button>
        );
      })}
    </div>
  );
}

type DynamicKeyFieldProps = {
  preset: QuickStartPreset | null;
  value: string;
  onChange: (next: string) => void;
  invalid?: boolean;
  // Optional id for label association — Setup Wizard supplies one.
  inputId?: string;
};

export function DynamicKeyField({
  preset,
  value,
  onChange,
  invalid = false,
  inputId,
}: DynamicKeyFieldProps) {
  const t = useLocalePick();

  if (!preset) {
    return (
      <p className="text-[13px] text-ink-3">
        {t(
          "Devam etmek için yukarıdan bir sağlayıcı seç.",
          "Pick a provider above to continue.",
        )}
      </p>
    );
  }

  if (!preset.requiresKey) {
    return (
      <div className="rounded-[10px] border border-ok/30 bg-ok/5 p-3">
        <p className="text-[13px] font-medium text-ok">
          {t("Anahtar gerekmiyor", "No API key needed")}
        </p>
        <p className="mt-1 text-[12px] text-ink-3">
          {t(
            `${preset.label} senin makinende çalışıyor — hiçbir trafik dışarı çıkmıyor. Kurulu değilse:`,
            `${preset.label} runs on your own machine — no traffic leaves your network. If it isn't installed yet:`,
          )}{" "}
          <a
            href={preset.providerHomeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-accent underline-offset-2 hover:underline"
          >
            {t("Kurulum talimatları", "Install guide")}
            <ExternalLink className="h-3 w-3" aria-hidden />
          </a>
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <label
          htmlFor={inputId}
          className="text-[13px] font-medium text-ink-2"
        >
          {t(`${preset.label} API anahtarı`, `${preset.label} API key`)}
        </label>
        <a
          href={preset.providerHomeUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[12px] text-accent underline-offset-2 hover:underline"
        >
          {t("Anahtar al", "Get a key")}
          <ExternalLink className="h-3 w-3" aria-hidden />
        </a>
      </div>
      <Input
        id={inputId}
        variant="mono"
        type="password"
        autoComplete="off"
        spellCheck={false}
        placeholder={
          preset.id === "anthropic"
            ? "sk-ant-..."
            : preset.id === "openrouter"
              ? "sk-or-..."
              : preset.id === "groq"
                ? "gsk_..."
                : preset.id === "gemini"
                  ? "AIza..."
                  : ""
        }
        value={value}
        invalid={invalid}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
