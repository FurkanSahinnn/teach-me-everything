"use client";

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { useLocalePick } from "@/i18n/IntlProvider";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Switch } from "@/components/ui/Switch";
import { SettingsRow } from "@/components/settings/layout/SettingsPrimitives";
import { cn } from "@/lib/utils/cn";
import { type Theme, usePrefs } from "@/stores/prefs";

type Option = { value: string; tr: string; en: string };

export function SelectRow({
  label,
  value,
  options,
}: {
  label: string;
  value: string;
  options: Option[];
}) {
  const pick = useLocalePick();
  return (
    <SettingsRow
      title={label}
      control={
        <select
          defaultValue={value}
          aria-label={label}
          className="rounded-md border border-rule bg-paper px-2.5 py-1 text-[13px] text-ink focus:border-ink-5 focus:outline-none"
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {pick(o.tr, o.en)}
            </option>
          ))}
        </select>
      }
    />
  );
}

export function NumberRow({
  label,
  value,
  hint,
}: {
  label: string;
  value: number;
  hint: string;
}) {
  return (
    <SettingsRow
      title={label}
      description={hint}
      control={
        <input
          type="number"
          defaultValue={value}
          aria-label={label}
          className="w-24 rounded-md border border-rule bg-paper px-2.5 py-1 font-mono text-[13px] text-ink focus:border-ink-5 focus:outline-none"
        />
      }
    />
  );
}

export function ToggleRow({
  label,
  desc,
  defaultOn,
}: {
  label: string;
  desc: string;
  defaultOn: boolean;
}) {
  const [on, setOn] = useState(defaultOn);
  return (
    <SettingsRow
      title={label}
      description={desc}
      control={<Switch checked={on} onCheckedChange={setOn} ariaLabel={label} />}
    />
  );
}

export const THEME_SWATCH: Record<string, { bg: string; surface: string; accent: string }> = {
  white: { bg: "#FDFDFC", surface: "#ECEAE4", accent: "#C06221" },
  "github-light": { bg: "#FFFFFF", surface: "#EAEEF2", accent: "#0969DA" },
  sepia: { bg: "#F5ECD8", surface: "#E1D2B2", accent: "#A64B17" },
  dark: { bg: "#101216", surface: "#20242E", accent: "#E59947" },
  github: { bg: "#0D1117", surface: "#21262D", accent: "#1F6FEB" },
  dracula: { bg: "#282A36", surface: "#44475A", accent: "#BD93F9" },
  monokai: { bg: "#2D2A2E", surface: "#423F43", accent: "#FFD866" },
  nord: { bg: "#2E3440", surface: "#434C5E", accent: "#88C0D0" },
  catppuccin: { bg: "#1E1E2E", surface: "#313244", accent: "#CBA6F7" },
  "tokyo-night": { bg: "#1A1B26", surface: "#24283B", accent: "#7AA2F7" },
};

export const THEME_OPTIONS: Option[] = [
  { value: "white", tr: "Beyaz (Fildişi)", en: "White (Ivory)" },
  { value: "github-light", tr: "GitHub Açık", en: "GitHub Light" },
  { value: "sepia", tr: "Sepya (Parşömen)", en: "Sepia (Parchment)" },
  { value: "dark", tr: "Obsidyen Koyu", en: "Obsidian Dark" },
  { value: "github", tr: "GitHub Koyu", en: "GitHub Dark" },
  { value: "dracula", tr: "Dracula", en: "Dracula" },
  { value: "monokai", tr: "Monokai Pro", en: "Monokai Pro" },
  { value: "nord", tr: "Nord", en: "Nord" },
  { value: "catppuccin", tr: "Catppuccin Mocha", en: "Catppuccin Mocha" },
  { value: "tokyo-night", tr: "Tokyo Night", en: "Tokyo Night" },
];

export function ToggleGroupRow({
  label,
  icon,
  value,
  onChange,
  options,
  variant = "segment",
}: {
  label: string;
  icon?: ReactNode;
  value: string;
  onChange: (v: string) => void;
  options: Option[];
  variant?: "segment" | "theme";
}) {
  const pick = useLocalePick();
  const title = (
    <span className="flex items-center gap-2">
      {icon ? <span className="text-ink-3">{icon}</span> : null}
      {label}
    </span>
  );
  if (variant === "theme") {
    return (
      <SettingsRow title={title}>
        <div className="flex flex-wrap gap-2">
          {options.map((o) => {
            const swatch = THEME_SWATCH[o.value];
            const active = value === o.value;
            return (
              <button
                key={o.value}
                onClick={() => onChange(o.value)}
                className={cn(
                  "flex min-w-[96px] flex-col items-stretch gap-2 overflow-hidden rounded-[10px] border p-2 text-left transition-all shadow-[var(--shadow-soft)]",
                  active
                    ? "border-accent bg-accent-wash ring-2 ring-accent/25"
                    : "border-rule-strong bg-paper hover:-translate-y-0.5 hover:border-accent hover:bg-paper-2",
                )}
              >
                <div
                  className="flex h-7 overflow-hidden rounded border border-rule-soft"
                  style={{ backgroundColor: swatch?.bg ?? "var(--paper)" }}
                >
                  <span
                    className="h-full flex-[2]"
                    style={{ backgroundColor: swatch?.bg ?? "var(--paper)" }}
                  />
                  <span
                    className="h-full flex-1"
                    style={{ backgroundColor: swatch?.surface ?? "var(--paper-3)" }}
                  />
                  <span
                    className="h-full flex-1"
                    style={{ backgroundColor: swatch?.accent ?? "var(--accent)" }}
                  />
                </div>
                <span
                  className={cn(
                    "text-[13px] font-medium",
                    active ? "text-accent-ink" : "text-ink",
                  )}
                >
                  {pick(o.tr, o.en)}
                </span>
              </button>
            );
          })}
        </div>
      </SettingsRow>
    );
  }
  return (
    <SettingsRow
      title={title}
      control={
        <SegmentedControl
          value={value}
          onChange={onChange}
          ariaLabel={label}
          options={options.map((o) => ({ value: o.value, label: pick(o.tr, o.en) }))}
        />
      }
    />
  );
}

/** UI language row (General page). */
export function LanguagePreferenceRow() {
  const t = useTranslations("settings");
  const locale = usePrefs((s) => s.locale);
  const setLocale = usePrefs((s) => s.setLocale);
  return (
    <ToggleGroupRow
      label={t("dil")}
      value={locale}
      onChange={(v) => setLocale(v as "tr" | "en")}
      options={[
        { value: "tr", tr: "Türkçe", en: "Turkish" },
        { value: "en", tr: "İngilizce", en: "English" },
      ]}
    />
  );
}

/** Theme, font and density rows (Appearance page). */
export function AppearancePreferenceRows() {
  const t = useTranslations("settings");
  const theme = usePrefs((s) => s.theme);
  const setTheme = usePrefs((s) => s.setTheme);
  const density = usePrefs((s) => s.density);
  const setDensity = usePrefs((s) => s.setDensity);
  return (
    <>
      <ToggleGroupRow
        label={t("tema")}
        value={theme}
        onChange={(v) => setTheme(v as Theme)}
        options={THEME_OPTIONS}
        variant="theme"
      />
      <SelectRow
        label={t("font")}
        value="serif"
        options={[
          { value: "serif", tr: "Serif (varsayılan)", en: "Serif (default)" },
          { value: "sans", tr: "Sans-serif", en: "Sans-serif" },
        ]}
      />
      <ToggleGroupRow
        label={t("yogunluk")}
        value={density}
        onChange={(v) => setDensity(v as "compact" | "normal" | "comfy")}
        options={[
          { value: "compact", tr: "Sıkı", en: "Compact" },
          { value: "normal", tr: "Normal", en: "Normal" },
          { value: "comfy", tr: "Ferah", en: "Comfy" },
        ]}
      />
    </>
  );
}
