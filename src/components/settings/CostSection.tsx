"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { SettingsGroup, SettingsRow } from "@/components/settings/layout/SettingsPrimitives";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { useCostByModel, useTotalCost } from "@/lib/db/hooks";

type Range = "today" | "alltime";

// Round-down to local midnight. Uses Date math (not UTC) so the chip resets
// when *the user's* day rolls over, not when UTC does.
function startOfDay(now: number = Date.now()): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// Show 4 decimals under $0.10 so cheap Haiku calls don't read as "$0.00".
// Above that, two decimals match how billing pages render dollars.
function formatUsd(n: number): string {
  if (n === 0) return "$0.00";
  if (n < 0.1) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

export function CostSection() {
  const t = useTranslations("cost");
  const [range, setRange] = useState<Range>("today");

  // Recompute the "since" boundary only when the range flips. Recomputing on
  // every render would cause the live-query hook to re-subscribe on every
  // tick because the dep array would change identity.
  const since = useMemo(() => (range === "today" ? startOfDay() : 0), [range]);

  const total = useTotalCost({ since });
  const byModel = useCostByModel({ since });

  const sortedModels = Object.entries(byModel).sort(
    ([, a], [, b]) => b.usd - a.usd,
  );

  return (
    <SettingsGroup>
      <SettingsRow
        title={t("section_title")}
        description={t("description")}
        control={
          <SegmentedControl<Range>
            value={range}
            onChange={setRange}
            ariaLabel={t("section_title")}
            options={[
              { value: "today", label: t("filter_today") },
              { value: "alltime", label: t("filter_alltime") },
            ]}
          />
        }
      >
        <div id="cost" className="flex items-baseline gap-3">
          <span className="font-mono text-[36px] font-semibold tracking-tight text-ink">
            {total.loading ? "—" : formatUsd(total.totalUsd)}
          </span>
          <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-3">
            {range === "today" ? t("total_today") : t("total_alltime")}
            {" · "}
            {total.messageCount} {t("messages_label")}
          </span>
        </div>
        <p className="mt-2 text-[11.5px] italic text-ink-4">{t("disclaimer")}</p>
      </SettingsRow>
      <SettingsRow title={t("model_breakdown_title")}>
        {sortedModels.length === 0 ? (
          <div className="rounded-md border border-rule-soft bg-paper-2 px-3 py-3 text-[12.5px] text-ink-3">
            {t("no_data")}
          </div>
        ) : (
          <div className="overflow-hidden rounded-md border border-rule-soft">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-rule-soft bg-paper-2 text-left font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-3">
                  <th className="px-3 py-2">Model</th>
                  <th className="px-3 py-2 text-right">{t("messages_label")}</th>
                  <th className="px-3 py-2 text-right">USD</th>
                </tr>
              </thead>
              <tbody>
                {sortedModels.map(([model, stats]) => (
                  <tr key={model} className="border-b border-rule-soft last:border-0">
                    <td className="px-3 py-2 font-mono text-[12px] text-ink-2">{model}</td>
                    <td className="px-3 py-2 text-right font-mono text-[12px] text-ink-3">
                      {stats.count}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-[12px] font-medium text-ink">
                      {formatUsd(stats.usd)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SettingsRow>
    </SettingsGroup>
  );
}
