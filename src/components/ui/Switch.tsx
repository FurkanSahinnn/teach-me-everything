"use client";

import { cn } from "@/lib/utils/cn";

type Size = "sm" | "md";

type Props = {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  size?: Size;
  disabled?: boolean;
  ariaLabel?: string;
  id?: string;
};

const TRACK: Record<Size, string> = {
  sm: "h-7 w-12",
  md: "h-8 w-16",
};

const KNOB_BASE: Record<Size, string> = {
  sm: "h-5 w-5",
  md: "h-6 w-6",
};

const KNOB_OFF: Record<Size, string> = {
  sm: "translate-x-[4px]",
  md: "translate-x-[4px]",
};

const KNOB_ON: Record<Size, string> = {
  sm: "translate-x-[22px]",
  md: "translate-x-[34px]",
};

export function Switch({
  checked,
  onCheckedChange,
  size = "md",
  disabled,
  ariaLabel,
  id,
}: Props) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => !disabled && onCheckedChange(!checked)}
      className={cn(
        "relative shrink-0 cursor-pointer overflow-hidden rounded-full border shadow-[var(--shadow-soft)]",
        "transition-[background,border-color,box-shadow,transform] duration-[160ms] ease-[cubic-bezier(0.2,0.6,0.2,1)]",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-paper",
        "hover:-translate-y-[1px] active:translate-y-0",
        "disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0",
        TRACK[size],
        checked
          ? "bg-accent-hot border-accent shadow-[var(--shadow-medium)]"
          : "bg-paper-4 border-rule-strong hover:bg-paper-3 hover:border-accent",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "absolute inset-y-0 flex items-center font-mono font-bold uppercase tracking-[0.04em] transition-opacity duration-[160ms]",
          size === "sm" ? "right-2 text-[9px]" : "right-2.5 text-[10px]",
          checked ? "text-white opacity-100" : "text-ink-3 opacity-0",
        )}
      >
        on
      </span>
      <span
        aria-hidden
        className={cn(
          "absolute inset-y-0 flex items-center font-mono font-bold uppercase tracking-[0.04em] transition-opacity duration-[160ms]",
          size === "sm" ? "left-2 text-[9px]" : "left-2.5 text-[10px]",
          checked ? "text-white/0 opacity-0" : "text-ink-3 opacity-100",
        )}
      >
        off
      </span>
      <span
        aria-hidden
        className={cn(
          "absolute left-0 top-1/2 -translate-y-1/2 rounded-full bg-white",
          "shadow-[0_2px_5px_rgba(0,0,0,0.28),0_0_0_1px_rgba(0,0,0,0.10)]",
          "transition-transform duration-[180ms] ease-[cubic-bezier(0.34,1.56,0.64,1)]",
          KNOB_BASE[size],
          checked ? KNOB_ON[size] : KNOB_OFF[size],
        )}
      />
    </button>
  );
}
