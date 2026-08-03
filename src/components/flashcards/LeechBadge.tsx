"use client";

import { Snail } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils/cn";

// Leech indicator. Pure presentation — `isLeech()` from sm2.ts decides when to
// render this. Uses --warn token for color so it inherits from the active theme
// without hard-coding palette values.
export function LeechBadge({ className }: { className?: string }) {
  const t = useTranslations("leech");
  return (
    <span
      title={t("tooltip_desc")}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-[color:color-mix(in_srgb,var(--warn)_40%,transparent)] bg-[color:color-mix(in_srgb,var(--warn)_10%,transparent)] px-2 py-0.5 font-mono text-[10.5px] uppercase tracking-[0.06em] text-[color:var(--warn)]",
        className,
      )}
    >
      <Snail className="h-3 w-3" aria-hidden />
      {t("badge_label")}
    </span>
  );
}
