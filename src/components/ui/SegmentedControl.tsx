"use client";

import { type ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

export type SegmentOption<T extends string> = {
  value: T;
  label: ReactNode;
};

type Size = "sm" | "md";
type Tone = "default" | "inverted";

type Props<T extends string> = {
  value: T;
  options: SegmentOption<T>[];
  onChange: (value: T) => void;
  size?: Size;
  tone?: Tone;
  className?: string;
  ariaLabel?: string;
  mono?: boolean;
};

const SIZE_BUTTON: Record<Size, string> = {
  sm: "min-h-8 px-3.5 py-1.5 text-[12px]",
  md: "min-h-10 px-4.5 py-2 text-[13px]",
};

const TONE_CONTAINER: Record<Tone, string> = {
  default: "border-rule-strong bg-paper-2 shadow-[var(--shadow-soft)]",
  inverted: "border-ink-2 bg-ink shadow-[var(--shadow-medium)]",
};

const TONE_ACTIVE: Record<Tone, string> = {
  default: cn(
    "bg-accent-hot text-white border-accent shadow-[var(--shadow-medium)] font-bold",
    "shadow-[var(--shadow-medium)]",
  ),
  inverted: cn(
    "bg-paper text-ink border-accent font-semibold",
    "shadow-[0_2px_6px_rgba(0,0,0,0.40)]",
  ),
};

const TONE_INACTIVE: Record<Tone, string> = {
  default: cn(
    "text-ink border-rule-strong bg-paper cursor-pointer shadow-[var(--shadow-soft)]",
    "hover:text-ink hover:bg-paper-3 hover:border-accent hover:shadow-[var(--shadow-medium)]",
  ),
  inverted: cn(
    "text-paper/75 border-transparent cursor-pointer",
    "hover:text-paper hover:bg-white/8 hover:border-paper/20",
  ),
};

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  size = "md",
  tone = "default",
  className,
  ariaLabel,
  mono = false,
}: Props<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        "inline-flex flex-wrap items-center gap-1.5 rounded-[12px] border p-1.5",
        TONE_CONTAINER[tone],
        className,
      )}
    >
      {options.map((option) => {
        const active = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "inline-flex items-center justify-center rounded-[10px] border font-semibold whitespace-nowrap",
              "transition-[background,color,box-shadow,border-color,transform] duration-[160ms] ease-[cubic-bezier(0.2,0.6,0.2,1)]",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-paper-3",
              "active:scale-[0.97]",
              SIZE_BUTTON[size],
              mono && "font-mono",
              active ? TONE_ACTIVE[tone] : TONE_INACTIVE[tone],
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
