"use client";

import { type Theme, usePrefs } from "@/stores/prefs";
import { THEME_OPTIONS, THEME_SWATCH } from "@/components/settings/PreferenceRows";
import { useLocalePick } from "@/i18n/IntlProvider";
import { cn } from "@/lib/utils/cn";

type Props = {
  className?: string;
  size?: "sm" | "md";
};

export function ThemeToggle({ className, size = "sm" }: Props) {
  const theme = usePrefs((s) => s.theme);
  const setTheme = usePrefs((s) => s.setTheme);
  const pick = useLocalePick();

  const dim = size === "sm" ? "h-6 w-6" : "h-7 w-7";

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className={cn(
        "inline-flex flex-wrap items-center gap-1 rounded-[12px] border border-rule-strong bg-paper-2 p-1.5 shadow-[var(--shadow-soft)]",
        className,
      )}
    >
      {THEME_OPTIONS.map((opt) => {
        const value = opt.value as Theme;
        const active = theme === value;
        const swatch = THEME_SWATCH[value];
        const label = pick(opt.tr, opt.en);
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={label}
            title={label}
            onClick={() => setTheme(value)}
            className={cn(
              "relative grid place-items-center overflow-hidden rounded-[7px] border cursor-pointer",
              "transition-[box-shadow,border-color,transform] duration-[160ms] ease-[cubic-bezier(0.2,0.6,0.2,1)]",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent",
              "active:scale-[0.92]",
              dim,
              active
                ? "border-accent ring-2 ring-accent/40 scale-105 shadow-[var(--shadow-medium)]"
                : "border-rule hover:border-rule-strong hover:scale-105",
            )}
          >
            <span className="flex h-full w-full">
              <span
                className="h-full flex-1"
                style={{ backgroundColor: swatch?.bg ?? "#101216" }}
              />
              <span
                className="h-full flex-1"
                style={{ backgroundColor: swatch?.accent ?? "#E59947" }}
              />
            </span>
          </button>
        );
      })}
    </div>
  );
}
