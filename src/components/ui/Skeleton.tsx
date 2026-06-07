import type { CSSProperties, HTMLAttributes } from "react";
import { cn } from "@/lib/utils/cn";

export type SkeletonVariant = "text" | "rect" | "circle";

type SkeletonProps = HTMLAttributes<HTMLDivElement> & {
  variant?: SkeletonVariant;
  width?: number | string;
  height?: number | string;
  lines?: number;
};

function toSize(v: number | string): string {
  return typeof v === "number" ? `${v}px` : v;
}

export function Skeleton({
  variant = "rect",
  width,
  height,
  lines,
  className,
  style,
  ...rest
}: SkeletonProps) {
  if (variant === "text" && lines && lines > 1) {
    return (
      <div
        aria-hidden="true"
        className={cn("flex flex-col gap-1.5", className)}
        {...rest}
      >
        {Array.from({ length: lines }).map((_, i) => (
          <span
            key={i}
            className="h-3 animate-pulse rounded-[6px] bg-paper-3"
            style={{ width: i === lines - 1 ? "62%" : "100%" }}
          />
        ))}
      </div>
    );
  }

  const dims: CSSProperties = {};
  if (width !== undefined) dims.width = toSize(width);
  if (height !== undefined) dims.height = toSize(height);

  return (
    <div
      aria-hidden="true"
      className={cn(
        "animate-pulse bg-paper-3",
        variant === "circle" && "rounded-full",
        variant === "rect" && "rounded-[var(--radius-sm)]",
        variant === "text" && "h-3 rounded-[6px]",
        className,
      )}
      style={{ ...dims, ...style }}
      {...rest}
    />
  );
}
