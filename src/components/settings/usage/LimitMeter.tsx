"use client";

import { RefreshCw } from "@/components/icons";
import { useLocalePick } from "@/i18n/IntlProvider";
import type { AgentCliId, LimitWindow } from "@/lib/ai/agent-status/types";
import { cn } from "@/lib/utils/cn";

import { formatDurationShort, limitLabel, percentLeft } from "./limit-format";

/** Codex is series 1, Claude series 2 everywhere a provider gets a color. */
export const CLI_SERIES_COLOR: Readonly<Record<AgentCliId, string>> = {
  codex: "var(--color-series-1)",
  claude: "var(--color-series-2)",
};

const LOW_LEFT_PERCENT = 10;

type Props = {
  cli: AgentCliId;
  window: LimitWindow;
  now: number;
  /** Compact rows for the provider detail; large for the Usage page. */
  size?: "sm" | "lg";
};

export function LimitMeter({ cli, window, now, size = "lg" }: Props) {
  const pick = useLocalePick();
  const left = percentLeft(window.usedPercent);
  const label = limitLabel(window, pick);
  const resetIn = window.resetsAt !== undefined ? formatDurationShort(window.resetsAt - now, pick) : null;
  const low = left <= LOW_LEFT_PERCENT;

  return (
    <div className={cn("flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-6", size === "lg" ? "px-4 py-4" : "px-4 py-3")}>
      <div className={cn("shrink-0", size === "lg" ? "sm:w-40" : "sm:w-36")}>
        <div className="text-[12.5px] font-medium text-ink-2">{label}</div>
        <div className="mt-0.5 flex items-baseline gap-1.5">
          <span className={cn("font-semibold tracking-[-0.02em] text-ink tabular-nums", size === "lg" ? "text-[26px] leading-8" : "text-[18px] leading-6")}>
            {left}%
          </span>
          <span className="text-[12px] text-ink-3">{pick("kaldı", "left")}</span>
          {low ? <span className="text-[11.5px] font-medium text-warn">{pick("az kaldı", "low")}</span> : null}
        </div>
      </div>
      <div className="relative min-w-0 flex-1">
        <div
          role="meter"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={left}
          aria-valuetext={pick(`%${left} kaldı`, `${left}% left`)}
          className={cn("overflow-hidden rounded-[6px] bg-paper-3", size === "lg" ? "h-7" : "h-2.5")}
        >
          <div
            className="h-full rounded-[6px] transition-[width] duration-300"
            style={{ width: `${left}%`, backgroundColor: CLI_SERIES_COLOR[cli] }}
          />
        </div>
        {resetIn ? (
          <span
            className={cn(
              "inline-flex items-center gap-1 font-mono text-[11px] text-ink-3",
              size === "lg" ? "absolute right-2 top-1/2 -translate-y-1/2 rounded-[4px] bg-paper-2/90 px-1.5 py-0.5" : "mt-1",
            )}
            title={pick("Sıfırlanma", "Resets in")}
          >
            <RefreshCw className="h-3 w-3" aria-hidden />
            {resetIn}
          </span>
        ) : null}
      </div>
    </div>
  );
}
