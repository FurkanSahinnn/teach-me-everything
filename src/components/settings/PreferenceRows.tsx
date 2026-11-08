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

const THEME_SWATCH: Record<string, { bg: string; accent: string }> = {
  white: { bg: "#FFFFFF", accent: "#F4F4F2" },
  sepia: { bg: "#F6EAD2", accent: "#E5D2AC" },
  dark: { bg: "#0E0E10", accent: "#242428" },
  // İkinci yarı burada yüzey değil aksan: GitHub'ın #0D1117/#21262D çifti
  // 28px'lik çipte "dark"tan ayırt edilemiyordu, imza mavisi ayırt ediyor.
  github: { bg: "#0D1117", accent: "#1F6FEB" },
};

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
                    className="h-full flex-1"
                    style={{ backgroundColor: swatch?.bg ?? "var(--paper)" }}
                  />
                  <span
                    className="h-full flex-1"
                    style={{ backgroundColor: swatch?.accent ?? "var(--paper-2)" }}
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
        options={[
          { value: "white", tr: "Beyaz", en: "White" },
          { value: "sepia", tr: "Sepya", en: "Sepia" },
          { value: "dark", tr: "Koyu", en: "Dark" },
          { value: "github", tr: "GitHub", en: "GitHub" },
        ]}
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
