"use client";

import { BookOpen, Moon, Sun } from "lucide-react";
import { type Theme, usePrefs } from "@/stores/prefs";
import { cn } from "@/lib/utils/cn";

type Option = {
  value: Theme;
  icon: typeof Sun;
  label: string;
};

const OPTIONS: readonly Option[] = [
  { value: "white", icon: Sun, label: "White" },
  { value: "sepia", icon: BookOpen, label: "Sepia" },
  { value: "dark", icon: Moon, label: "Dark" },
];

type Props = {
  className?: string;
  size?: "sm" | "md";
};

export function ThemeToggle({ className, size = "sm" }: Props) {
  const theme = usePrefs((s) => s.theme);
  const setTheme = usePrefs((s) => s.setTheme);

  const dim = size === "sm" ? "h-7 w-7" : "h-8 w-8";
  const iconSize = size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4";

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-[12px] border border-rule-strong bg-paper-2 p-1.5 shadow-[var(--shadow-soft)]",
        className,
      )}
    >
      {OPTIONS.map(({ value, icon: Icon, label }) => {
        const active = theme === value;
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
              "grid place-items-center rounded-[9px] border cursor-pointer",
              "transition-[background,color,box-shadow,border-color,transform] duration-[160ms] ease-[cubic-bezier(0.2,0.6,0.2,1)]",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-paper-3",
              "active:scale-[0.92]",
              dim,
              active
                ? "border-accent bg-accent-hot text-white shadow-[var(--shadow-medium)]"
                : cn(
                    "border-transparent text-ink-3",
                    "hover:border-rule-strong hover:text-ink hover:bg-paper hover:shadow-[var(--shadow-soft)]",
                    "hover:scale-[1.08]",
                  ),
            )}
          >
            <Icon className={iconSize} aria-hidden />
          </button>
        );
      })}
    </div>
  );
}
