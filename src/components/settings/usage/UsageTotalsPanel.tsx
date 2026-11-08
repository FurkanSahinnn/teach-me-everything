"use client";

import { useState } from "react";

import { Info } from "@/components/icons";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { useLocalePick } from "@/i18n/IntlProvider";
import type { UsageProvider, UsageSummary } from "@/lib/usage";
import { cn } from "@/lib/utils/cn";

import { UsageDailyChart, type ChartMetric } from "./UsageDailyChart";
import { formatCompactNumber, formatUsd } from "./usage-format";

type LocalePick = (tr: string, en: string) => string;

const PROVIDER_LABEL: Readonly<Record<UsageProvider, string>> = { codex: "Codex", claude: "Claude Code" };
const PROVIDER_COLOR: Readonly<Record<UsageProvider, string>> = {
  codex: "var(--color-series-1)",
  claude: "var(--color-series-2)",
};
/** Token types are one magnitude split into parts: neutral ink steps, not categorical hues. */
const TYPE_COLOR = ["var(--color-ink-5)", "var(--color-ink-4)", "var(--color-ink-3)", "var(--color-ink)"] as const;

const UNKNOWN_MODEL = "unknown";

function modelName(model: string, pick: LocalePick): string {
  return model === UNKNOWN_MODEL ? pick("Bilinmeyen model", "Unknown model") : model;
}

type Props = { summary: UsageSummary; metric: ChartMetric };

export function UsageTotalsPanel({ summary, metric }: Props) {
  const pick = useLocalePick();
  const [breakdown, setBreakdown] = useState<"model" | "day">("model");
  const { totals } = summary;
  const sessions = summary.sessions.claude + summary.sessions.codex;
  const fmt = (n: number) => (metric === "cost" ? formatUsd(n) : formatCompactNumber(n));
  const hero = metric === "cost" ? totals.costUsd : totals.processedTokens;

  const types =
    metric === "cost"
      ? [summary.costByType.input, summary.costByType.cacheRead, summary.costByType.cacheWrite, summary.costByType.output]
      : [totals.uncachedInput, totals.cachedInput, totals.cacheWrite, totals.output];
  const typeLabels = [pick("Girdi", "Input"), pick("Önbellek okuma", "Cache read"), pick("Önbellek yazma", "Cache write"), pick("Çıktı", "Output")];
  const typeTotal = types.reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-8">
      <div className="grid gap-6 lg:grid-cols-[250px_minmax(0,1fr)]">
        <div>
          <div className="text-[34px] font-semibold leading-tight tracking-[-0.03em] text-ink tabular-nums">{fmt(hero)}</div>
          <div className="mt-1 flex items-center gap-1 text-[12.5px] text-ink-3">
            {pick(`${sessions} oturum`, `${sessions} sessions`)}
            {metric === "cost" ? (
              <span
                className="inline-flex items-center gap-1"
                title={pick(
                  "Liste fiyatlarıyla API karşılığı tahmini; abonelikte ödediğin tutar değildir. Önbellek yazma 5 dakikalık ücretle hesaplanır.",
                  "Estimated API-equivalent at list prices, not what a subscription bills. Cache writes use the 5-minute rate.",
                )}
              >
                · {pick("API tahmini", "API estimate")}
                <Info className="h-3.5 w-3.5" aria-hidden />
              </span>
            ) : null}
          </div>
          <ul className="mt-5 space-y-3">
            {summary.providers.map((p) => (
              <li key={p.provider}>
                <div className="flex items-center gap-2 text-[13px]">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: PROVIDER_COLOR[p.provider] }} aria-hidden />
                  <span className="font-medium text-ink">{PROVIDER_LABEL[p.provider]}</span>
                  <span className="text-[11.5px] text-ink-4">{pick(`${p.sessions} oturum`, `${p.sessions} sessions`)}</span>
                  <span className="ml-auto font-medium tabular-nums text-ink">{fmt(metric === "cost" ? p.costUsd : p.tokens)}</span>
                </div>
                <div className="ml-4 mt-0.5 text-[11.5px] text-ink-3">
                  {metric === "cost"
                    ? pick(
                        `Maliyetin %${totals.costUsd > 0 ? ((p.costUsd / totals.costUsd) * 100).toFixed(1) : "0"} · ${formatCompactNumber(p.tokens)} token`,
                        `${totals.costUsd > 0 ? ((p.costUsd / totals.costUsd) * 100).toFixed(1) : "0"}% of cost · ${formatCompactNumber(p.tokens)} tokens`,
                      )
                    : pick(`Tokenların %${p.share.toFixed(1)} · ${formatUsd(p.costUsd)}`, `${p.share.toFixed(1)}% of tokens · ${formatUsd(p.costUsd)}`)}
                </div>
              </li>
            ))}
          </ul>
        </div>
        <div className="min-w-0">
          <h3 className="mb-1 text-[13px] font-medium text-ink-2">
            {metric === "cost" ? pick("Günlük maliyet", "Daily cost") : pick("Günlük işlenen token", "Daily processed tokens")}
          </h3>
          <UsageDailyChart daily={summary.daily} metric={metric} />
        </div>
      </div>

      <section>
        <h3 className="mb-3 text-[13px] font-medium text-ink-2">{pick("Toplamlar", "Totals")}</h3>
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          <Stat label={pick("İşlenen token", "Processed tokens")} value={formatCompactNumber(totals.processedTokens)} />
          <Stat label={pick("Önbellekten girdi", "Cached input")} value={formatCompactNumber(totals.cachedInput)} />
          <Stat label={pick("Önbelleksiz girdi", "Uncached input")} value={formatCompactNumber(totals.uncachedInput)} />
          <Stat label={pick("Çıktı", "Output")} value={formatCompactNumber(totals.output)} />
          <Stat label={pick("Önbellek tasarrufu", "Cache savings")} value={formatUsd(totals.cacheSavingsUsd)} />
        </dl>
      </section>

      <section>
        <h3 className="mb-3 text-[13px] font-medium text-ink-2">
          {metric === "cost" ? pick("Türe göre maliyet", "Cost by type") : pick("Türe göre token", "Tokens by type")}
        </h3>
        <div className="flex h-2.5 max-w-[440px] gap-[2px] overflow-hidden rounded-[4px]" role="img" aria-label={typeLabels.map((l, i) => `${l} ${fmt(types[i] ?? 0)}`).join(", ")}>
          {types.map((v, i) =>
            typeTotal > 0 && v > 0 ? (
              <div key={typeLabels[i]} className="h-full first:rounded-l-[4px] last:rounded-r-[4px]" style={{ flexGrow: v, flexBasis: 0, minWidth: 2, backgroundColor: TYPE_COLOR[i] }} />
            ) : null,
          )}
        </div>
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-3">
          {typeLabels.map((label, i) => (
            <li key={label} className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-[2px]" style={{ backgroundColor: TYPE_COLOR[i] }} aria-hidden />
              {label} <span className="font-medium tabular-nums text-ink-2">{fmt(types[i] ?? 0)}</span>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-[13px] font-medium text-ink-2">{pick("Döküm", "Breakdown")}</h3>
          <SegmentedControl
            size="sm"
            value={breakdown}
            onChange={setBreakdown}
            ariaLabel={pick("Döküm türü", "Breakdown type")}
            options={[
              { value: "model", label: pick("Model", "Model") },
              { value: "day", label: pick("Gün", "Day") },
            ]}
          />
        </div>
        {breakdown === "model" ? <ModelTable summary={summary} metric={metric} pick={pick} /> : <DayTable summary={summary} pick={pick} />}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[12px] text-ink-3">{label}</dt>
      <dd className="mt-0.5 text-[17px] font-semibold tabular-nums text-ink">{value}</dd>
    </div>
  );
}

function ModelTable({ summary, metric, pick }: { summary: UsageSummary; metric: ChartMetric; pick: LocalePick }) {
  const rows = [...summary.models].sort((a, b) => (metric === "cost" ? b.costUsd - a.costUsd : 0) || b.tokens - a.tokens);
  const costTotal = summary.totals.costUsd;
  return (
    <table className="w-full text-[13px]">
      <thead>
        <tr className="border-b border-rule text-left text-[11.5px] text-ink-4">
          <th className="w-8 py-2 font-medium">#</th>
          <th className="py-2 font-medium">{pick("Model", "Model")}</th>
          <th className="py-2 text-right font-medium">{pick("Maliyet", "Cost")}</th>
          <th className="py-2 text-right font-medium">{pick("Pay", "Share")}</th>
          <th className="py-2 text-right font-medium">{pick("Token", "Tokens")}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((m, i) => {
          const share = metric === "cost" ? (costTotal > 0 ? (m.costUsd / costTotal) * 100 : 0) : m.share;
          return (
            <tr key={`${m.provider}|${m.model}`} className="border-b border-rule last:border-b-0">
              <td className="py-2.5 text-ink-4 tabular-nums">{i + 1}</td>
              <td className="py-2.5">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: PROVIDER_COLOR[m.provider] }} aria-hidden />
                  <span className="truncate font-mono text-[12.5px] text-ink">{modelName(m.model, pick)}</span>
                  {!m.priced ? <span className="shrink-0 text-[11px] text-ink-4">{pick("fiyatsız", "unpriced")}</span> : null}
                </div>
                <div className="ml-4 mt-1 h-[2px] max-w-[200px] rounded-full bg-paper-3">
                  <div className="h-full rounded-full" style={{ width: `${Math.min(100, share)}%`, backgroundColor: PROVIDER_COLOR[m.provider] }} />
                </div>
              </td>
              <td className={cn("py-2.5 text-right tabular-nums", m.priced ? "text-ink" : "text-ink-4")}>{m.priced ? formatUsd(m.costUsd) : "—"}</td>
              <td className="py-2.5 text-right tabular-nums text-ink-2">{share.toFixed(1)}%</td>
              <td className="py-2.5 text-right tabular-nums text-ink-2">{formatCompactNumber(m.tokens)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function DayTable({ summary, pick }: { summary: UsageSummary; pick: LocalePick }) {
  const locale = pick("tr-TR", "en-US");
  const rows = [...summary.daily].reverse().filter((d) => d.total > 0);
  if (rows.length === 0) return <p className="text-[12.5px] text-ink-3">{pick("Bu aralıkta kullanım yok.", "No usage in this range.")}</p>;
  return (
    <table className="w-full text-[13px]">
      <thead>
        <tr className="border-b border-rule text-left text-[11.5px] text-ink-4">
          <th className="py-2 font-medium">{pick("Gün", "Day")}</th>
          <th className="py-2 text-right font-medium">Codex</th>
          <th className="py-2 text-right font-medium">Claude Code</th>
          <th className="py-2 text-right font-medium">{pick("Maliyet", "Cost")}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((d) => (
          <tr key={d.day} className="border-b border-rule last:border-b-0">
            <td className="py-2 text-ink">{new Date(`${d.day}T00:00:00`).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" })}</td>
            <td className="py-2 text-right tabular-nums text-ink-2">{formatCompactNumber(d.codex)}</td>
            <td className="py-2 text-right tabular-nums text-ink-2">{formatCompactNumber(d.claude)}</td>
            <td className="py-2 text-right tabular-nums text-ink">{formatUsd(d.totalCost)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
