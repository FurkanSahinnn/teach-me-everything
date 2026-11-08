"use client";

import { Cloud, Plug, Server, Terminal, type LucideIcon } from "@/components/icons";
import { Switch } from "@/components/ui/Switch";
import { useLocalePick } from "@/i18n/IntlProvider";
import type { ProviderEntry, ProviderGroup, ProviderStatus } from "@/lib/ai/provider-catalog";
import { cn } from "@/lib/utils/cn";

type LocalePick = (tr: string, en: string) => string;

const GROUP_ICON: Readonly<Record<ProviderGroup, LucideIcon>> = {
  cli: Terminal,
  local: Server,
  cloud: Cloud,
  custom: Plug,
};

const GROUP_LABEL: Readonly<Record<ProviderGroup, [string, string]>> = {
  cli: ["Bu bilgisayarda", "On this computer"],
  local: ["Yerel sunucular", "Local servers"],
  cloud: ["Bulut (API anahtarı)", "Cloud (API key)"],
  custom: ["Özel uç noktalar", "Custom endpoints"],
};

const GROUPS: readonly ProviderGroup[] = ["cli", "local", "cloud", "custom"];

export function formatProviderStatus(status: ProviderStatus, pick: LocalePick): string {
  switch (status.key) {
    case "cli_checking":
      return pick("Kontrol ediliyor…", "Checking…");
    case "cli_not_installed":
      return pick("Kurulu değil", "Not installed");
    case "cli_signed_out":
      return pick("Oturum açılmamış", "Not signed in");
    case "cli_error":
      return pick("Kontrol başarısız", "Check failed");
    case "cli_authenticated":
      return pick(`Oturum açık · ${status.values?.plan ?? ""}`, `Authenticated · ${status.values?.plan ?? ""}`);
    case "cli_authenticated_no_plan":
      return pick("Oturum açık", "Authenticated");
    case "cli_ready":
      return pick(`Hazır · ${status.values?.count ?? "0"} model`, `Ready · ${status.values?.count ?? "0"} models`);
    case "local_server":
      return pick("Yerel · anahtar gerekmez", "Local · no key needed");
    case "key_saved":
      return pick("Anahtar kayıtlı", "Key saved");
    case "key_missing":
      return pick("Anahtar yok", "No key");
  }
}

const TONE_DOT: Readonly<Record<ProviderStatus["tone"], string>> = {
  ok: "bg-ok",
  warn: "bg-warn",
  error: "bg-err",
  muted: "bg-ink-5",
};

type Props = {
  entries: readonly ProviderEntry[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onToggle: (id: string, enabled: boolean) => void;
};

export function ProviderList({ entries, selectedId, onSelect, onToggle }: Props) {
  const pick = useLocalePick();
  return (
    <div className="flex flex-col gap-3 py-2">
      {GROUPS.map((group) => {
        const items = entries.filter((e) => e.group === group);
        if (items.length === 0) return null;
        return (
          <div key={group}>
            <div className="px-3 pb-1 text-[11.5px] font-medium text-ink-4">{pick(...GROUP_LABEL[group])}</div>
            <ul>
              {items.map((entry) => (
                <ProviderListItem
                  key={entry.id}
                  entry={entry}
                  selected={entry.id === selectedId}
                  onSelect={onSelect}
                  onToggle={onToggle}
                  pick={pick}
                />
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

type ItemProps = {
  entry: ProviderEntry;
  selected: boolean;
  onSelect: (id: string) => void;
  onToggle: (id: string, enabled: boolean) => void;
  pick: LocalePick;
};

function ProviderListItem({ entry, selected, onSelect, onToggle, pick }: ItemProps) {
  const Icon = GROUP_ICON[entry.group];
  return (
    <li className="px-1.5">
      <div
        className={cn(
          "flex items-center gap-2.5 rounded-[var(--radius-sm)] px-2 py-2 transition-colors",
          selected ? "bg-paper-3" : "hover:bg-paper-3",
          !entry.enabled && "opacity-60",
        )}
      >
        <button
          type="button"
          onClick={() => onSelect(entry.id)}
          aria-current={selected ? "true" : undefined}
          className="flex min-w-0 flex-1 items-start gap-2.5 text-left"
        >
          <Icon className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" aria-hidden />
          <span className="min-w-0">
            <span className="flex items-baseline gap-1.5">
              <span className="truncate text-[13.5px] font-medium text-ink">{entry.label}</span>
              {entry.version ? (
                <span className="shrink-0 font-mono text-[11px] text-ink-4">v{entry.version}</span>
              ) : null}
            </span>
            <span className="mt-0.5 flex items-center gap-1.5 text-[12px] text-ink-3">
              <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", TONE_DOT[entry.status.tone])} aria-hidden />
              <span className="truncate">{formatProviderStatus(entry.status, pick)}</span>
            </span>
          </span>
        </button>
        <Switch
          size="sm"
          checked={entry.enabled}
          onCheckedChange={(next) => onToggle(entry.id, next)}
          ariaLabel={pick(`${entry.label} etkin`, `${entry.label} enabled`)}
        />
      </div>
    </li>
  );
}
