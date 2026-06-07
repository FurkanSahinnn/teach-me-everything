import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils/cn";

export function Kbd({
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLSpanElement>) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-[6px] border border-rule bg-paper-2 px-1.5",
        "font-mono text-[10.5px] text-ink-3",
        "shadow-[inset_0_-1px_0_var(--color-rule)]",
        className,
      )}
      {...rest}
    >
      {children}
    </kbd>
  );
}
