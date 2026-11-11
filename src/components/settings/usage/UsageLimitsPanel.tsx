"use client";

import { useEffect, useState } from "react";

import { SettingsGroup } from "@/components/settings/layout/SettingsPrimitives";
import { OpencodeStatsGroup } from "@/components/settings/providers/CliProviderDetail";
import { useLocalePick } from "@/i18n/IntlProvider";
import { useAgentStatus } from "@/lib/ai/agent-status/store";
import type { AgentAccountStatus, AgentCliId } from "@/lib/ai/agent-status/types";

import { CLI_SERIES_COLOR, LimitMeter } from "./LimitMeter";

const CLIS: readonly { cli: AgentCliId; label: string }[] = [
  { cli: "codex", label: "Codex" },
  { cli: "claude", label: "Claude Code" },
  { cli: "opencode", label: "OpenCode" },
];

const CLOCK_TICK_MS = 30_000;

function emptyReason(status: AgentAccountStatus | undefined, pick: (tr: string, en: string) => string): string {
  if (!status) return pick("Kontrol ediliyor…", "Checking…");
  if (status.state === "not_installed") return pick("CLI bulunamadı.", "CLI not found.");
  if (status.state === "unauthenticated") return pick("Oturum açılmamış.", "Not signed in.");
  if (status.state === "error") return status.error ?? pick("Kontrol başarısız.", "Check failed.");
  if (status.limitsError) return pick(`Limitler okunamadı: ${status.limitsError}`, `Could not read limits: ${status.limitsError}`);
  return pick("Bu hesap için limit bilgisi yok.", "No limit information for this account.");
}

export function UsageLimitsPanel() {
  const pick = useLocalePick();
  const statuses = useAgentStatus((s) => s.statuses);
  const refresh = useAgentStatus((s) => s.refresh);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  return (
    <div className="space-y-6">
      {CLIS.map(({ cli, label }) => {
        const status = statuses[cli];
        const effectiveNow = Math.max(now, status?.checkedAt ?? 0);
        return (
          <section key={cli} className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: CLI_SERIES_COLOR[cli] }} aria-hidden />
              <h3 className="text-[14px] font-semibold text-ink">{label}</h3>
              {status?.planLabel ? <span className="text-[12.5px] text-ink-3">{status.planLabel}</span> : null}
            </div>
            {status?.limits.length ? (
              <SettingsGroup>
                {status.limits.map((w) => (
                  <LimitMeter key={w.id} cli={cli} window={w} now={effectiveNow} />
                ))}
              </SettingsGroup>
            ) : status?.opencodeStats ? (
              <OpencodeStatsGroup stats={status.opencodeStats} pick={pick} />
            ) : (
              <p className="rounded-[var(--radius-lg)] border border-rule bg-paper-2 px-4 py-3 text-[12.5px] text-ink-3">
                {emptyReason(status, pick)}
              </p>
            )}
          </section>
        );
      })}
      <p className="text-[12px] text-ink-4">
        {pick(
          "Limitler kurulu CLI'ların kendisinden okunur; Claude tarafı deneysel bir CLI isteği kullanır ve değişebilir.",
          "Limits are read from the installed CLIs themselves; the Claude side uses an experimental CLI request that may change.",
        )}
      </p>
    </div>
  );
}
