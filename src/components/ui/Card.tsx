import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils/cn";

type CardVariant = "default" | "sunken" | "floating" | "ghost" | "accent";
type CardPadding = "none" | "sm" | "md" | "lg" | "xl";

type CardProps = HTMLAttributes<HTMLDivElement> & {
  variant?: CardVariant;
  padding?: CardPadding;
  interactive?: boolean;
};

const VARIANT: Record<CardVariant, string> = {
  default: "bg-paper border border-rule-strong shadow-[var(--shadow-soft)]",
  sunken: "bg-paper-2 border border-rule-strong",
  floating: "bg-paper border border-rule shadow-[var(--shadow-medium)]",
  ghost: "bg-transparent border border-rule-soft",
  accent: "bg-accent-wash border border-accent-soft text-accent-ink",
};

const PADDING: Record<CardPadding, string> = {
  none: "",
  sm: "p-3",
  md: "p-4",
  lg: "p-5 sm:p-6",
  xl: "p-6 sm:p-8",
};

export function Card({
  variant = "default",
  padding = "none",
  interactive = false,
  className,
  ...rest
}: CardProps) {
  return (
    <div
      className={cn(
        "rounded-[var(--radius)]",
        "transition-[transform,box-shadow,border-color] duration-[160ms] ease-[cubic-bezier(0.2,0.6,0.2,1)]",
        VARIANT[variant],
        PADDING[padding],
        interactive &&
          "cursor-pointer hover:-translate-y-[2px] hover:shadow-[var(--shadow-lift)] hover:border-rule-strong",
        className,
      )}
      {...rest}
    />
  );
}
