import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils/cn";

type ChipVariant = "default" | "accent" | "muted" | "ok" | "warn" | "err";
type ChipSize = "sm" | "md";

type ChipProps = HTMLAttributes<HTMLSpanElement> & {
  variant?: ChipVariant;
  size?: ChipSize;
  dot?: boolean;
};

const VARIANT: Record<ChipVariant, string> = {
  default: "bg-paper-2 border-rule text-ink-2",
  accent: "bg-accent-wash border-accent-soft text-accent-ink",
  muted: "bg-paper-3 border-rule-soft text-ink-3",
  ok: "bg-paper-2 border-rule text-ok",
  warn: "bg-paper-2 border-rule text-warn",
  err: "bg-paper-2 border-rule text-err",
};

const SIZE: Record<ChipSize, string> = {
  sm: "h-6 px-2 text-[11px] gap-1.5",
  md: "h-7 px-2.5 text-[12px] gap-1.5",
};

export function Chip({
  variant = "default",
  size = "md",
  dot = false,
  className,
  children,
  ...rest
}: ChipProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border font-medium",
        VARIANT[variant],
        SIZE[size],
        className,
      )}
      {...rest}
    >
      {dot ? (
        <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      ) : null}
      {children}
    </span>
  );
}
