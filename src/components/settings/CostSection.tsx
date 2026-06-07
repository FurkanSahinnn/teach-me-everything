"use client";

import { useMemo, useState } from "react";
import { Receipt } from "lucide-react";
import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/Card";
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
    <Card padding="md" id="cost">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Receipt className="h-4 w-4 text-ink-3" aria-hidden />
            <h3 className="font-serif text-[15px] font-medium">
              {t("section_title")}
            </h3>
          </div>
          <p className="mt-1 text-[12.5px] text-ink-3">{t("description")}</p>
        </div>
        <SegmentedControl<Range>
          value={range}
          onChange={setRange}
          ariaLabel={t("section_title")}
          options={[
            { value: "today", label: t("filter_today") },
            { value: "alltime", label: t("filter_alltime") },
          ]}
        />
      </div>

      <div className="mt-5 flex items-baseline gap-3">
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

      <div className="mt-6">
        <h4 className="mb-2 font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-3">
          {t("model_breakdown_title")}
        </h4>
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
                  <th className="px-3 py-2 text-right">
                    {t("messages_label")}
                  </th>
                  <th className="px-3 py-2 text-right">USD</th>
                </tr>
              </thead>
              <tbody>
                {sortedModels.map(([model, stats]) => (
                  <tr key={model} className="border-b border-rule-soft last:border-0">
                    <td className="px-3 py-2 font-mono text-[12px] text-ink-2">
                      {model}
                    </td>
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
      </div>
    </Card>
  );
}
