"use client";

import { useEffect, useState } from "react";

import { RefreshCw } from "@/components/icons";
import { Button } from "@/components/ui/Button";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { useLocalePick } from "@/i18n/IntlProvider";
import { useAgentStatus } from "@/lib/ai/agent-status/store";
import { scanUsage } from "@/lib/tauri/usage";
import { aggregateUsage, rangeToSinceMs, type UsageRange, type UsageSummary } from "@/lib/usage";
import { usePrefs } from "@/stores/prefs";

import { UsageLimitsPanel } from "./UsageLimitsPanel";
import { UsageTotalsPanel } from "./UsageTotalsPanel";

type Metric = "cost" | "tokens" | "limits";

type ScanState =
  | { kind: "loading" }
  | { kind: "ready"; summary: UsageSummary }
  | { kind: "unavailable" }
  | { kind: "error"; message: string };

const UNKNOWN_MODEL = "unknown";

export function UsageView() {
  const pick = useLocalePick();
  const [metric, setMetric] = useState<Metric>("cost");
  const [range, setRange] = useState<UsageRange>("30d");
  const [nonce, setNonce] = useState(0);
  const [scanResult, setScanResult] = useState<{ key: string; state: ScanState } | null>(null);
  const claudeHome = usePrefs((s) => s.agentCli?.claudeHome);
  const codexHome = usePrefs((s) => s.agentCli?.codexHome);
  const refreshLimits = useAgentStatus((s) => s.refresh);

  // A result is only shown for the request that produced it; anything else reads as loading.
  const requestKey = `${range}|${nonce}|${claudeHome ?? ""}|${codexHome ?? ""}`;
  const scan: ScanState = scanResult?.key === requestKey ? scanResult.state : { kind: "loading" };

  useEffect(() => {
    if (metric === "limits") return;
    let current = true;
    const now = Date.now();
    const tzOffsetMinutes = -new Date(now).getTimezoneOffset();
    const finish = (state: ScanState) => {
      if (current) setScanResult({ key: requestKey, state });
    };
    scanUsage({ sinceMs: rangeToSinceMs(range, now), tzOffsetMinutes, claudeHome, codexHome })
      .then((result) =>
        finish(result ? { kind: "ready", summary: aggregateUsage(result, { range, now, tzOffsetMinutes }) } : { kind: "unavailable" }),
      )
      .catch((error: unknown) => finish({ kind: "error", message: error instanceof Error ? error.message : String(error) }));
    return () => {
      current = false;
    };
  }, [metric, range, requestKey, claudeHome, codexHome]);

  function handleRefresh(): void {
    if (metric === "limits") void refreshLimits(undefined, { force: true });
    else setNonce((n) => n + 1);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl
          size="sm"
          value={metric}
          onChange={setMetric}
          ariaLabel={pick("Görünüm", "View")}
          options={[
            { value: "cost", label: pick("Maliyet", "Cost") },
            { value: "tokens", label: pick("Token", "Tokens") },
            { value: "limits", label: pick("Limitler", "Limits") },
          ]}
        />
        <div className="flex items-center gap-2">
          {metric !== "limits" ? (
            <SegmentedControl
              size="sm"
              value={range}
              onChange={setRange}
              ariaLabel={pick("Zaman aralığı", "Time range")}
              options={[
                { value: "24h", label: pick("24 saat", "24h") },
                { value: "7d", label: pick("7 gün", "7 days") },
                { value: "30d", label: pick("30 gün", "30 days") },
                { value: "90d", label: pick("90 gün", "90 days") },
              ]}
            />
          ) : null}
          <Button size="icon-sm" variant="ghost" onClick={handleRefresh} aria-label={pick("Yenile", "Refresh")}>
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          </Button>
        </div>
      </div>

      {metric === "limits" ? <UsageLimitsPanel /> : <ScanBody scan={scan} metric={metric} pick={pick} />}
    </div>
  );
}

function ScanBody({ scan, metric, pick }: { scan: ScanState; metric: "cost" | "tokens"; pick: (tr: string, en: string) => string }) {
  if (scan.kind === "loading") {
    return (
      <p className="rounded-[var(--radius-lg)] border border-rule bg-paper-2 px-4 py-6 text-center text-[13px] text-ink-3" aria-live="polite">
        {pick("Claude Code ve Codex günlükleri taranıyor… İlk tarama uzun geçmişte birkaç saniye sürebilir.", "Scanning Claude Code and Codex logs… The first scan of a long history can take a few seconds.")}
      </p>
    );
  }
  if (scan.kind === "unavailable") {
    return (
      <p className="rounded-[var(--radius-lg)] border border-rule bg-paper-2 px-4 py-6 text-center text-[13px] text-ink-3">
        {pick("Kullanım günlükleri yalnız masaüstü uygulamasında okunabilir.", "Usage logs can only be read in the desktop app.")}
      </p>
    );
  }
  if (scan.kind === "error") {
    return <p className="rounded-[var(--radius-lg)] border border-rule bg-paper-2 px-4 py-4 text-[13px] text-err">{scan.message}</p>;
  }
  const { summary } = scan;
  const unpriced = summary.unpricedModels.filter((m) => m !== UNKNOWN_MODEL);
  const missingRoots = (["claude", "codex"] as const).filter((p) => !summary.roots[p].found);
  return (
    <div className="space-y-6">
      {summary.malformed > 0 || unpriced.length > 0 || missingRoots.length > 0 ? (
        <ul className="space-y-1 text-[12.5px] text-ink-3">
          {summary.malformed > 0 ? (
            <li>{pick(`${summary.malformed} hatalı ya da tutarsız kayıt atlandı; kullanım eksik olabilir.`, `${summary.malformed} malformed or inconsistent usage record(s) were skipped; usage may be incomplete.`)}</li>
          ) : null}
          {unpriced.length > 0 ? (
            <li>{pick(`Fiyatı bilinmeyen modeller maliyete katılmadı: ${unpriced.join(", ")}`, `Models without a known price are left out of cost: ${unpriced.join(", ")}`)}</li>
          ) : null}
          {missingRoots.map((p) => (
            <li key={p}>{pick(`${p === "claude" ? "Claude Code" : "Codex"} günlükleri bulunamadı: ${summary.roots[p].path}`, `${p === "claude" ? "Claude Code" : "Codex"} logs not found: ${summary.roots[p].path}`)}</li>
          ))}
        </ul>
      ) : null}
      <UsageTotalsPanel summary={summary} metric={metric} />
    </div>
  );
}
