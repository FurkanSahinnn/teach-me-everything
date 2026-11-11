"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { RefreshCw } from "@/components/icons";
import { SettingsGroup, SettingsRow, SettingsSection } from "@/components/settings/layout/SettingsPrimitives";
import { LimitMeter } from "@/components/settings/usage/LimitMeter";
import { formatCompactNumber, formatUsd } from "@/components/settings/usage/usage-format";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useLocalePick } from "@/i18n/IntlProvider";
import { useAgentStatus } from "@/lib/ai/agent-status/store";
import type { AgentAccountStatus, AgentCliId, OpencodeUsageStats } from "@/lib/ai/agent-status/types";
import { CLAUDE_CLI_BINARY } from "@/lib/ai/providers/claude-cli";
import { CODEX_CLI_BINARY } from "@/lib/ai/providers/codex-cli";
import { OPENCODE_CLI_BINARY } from "@/lib/ai/providers/opencode-cli";
import { probeAgentCli, type AgentCliProbe } from "@/lib/tauri/agent-cli";
import { isTauriEnvWithOverride } from "@/lib/tauri/env";
import { cn } from "@/lib/utils/cn";
import { usePrefs, type AgentCliPrefs } from "@/stores/prefs";

type LocalePick = (tr: string, en: string) => string;

const SUBSCRIPTION_DESCRIPTION: [string, string] = [
  "Kendi aboneliğinle çalışan yerel komut satırı aracı; uygulamada anahtar saklanmaz.",
  "Local command-line tool running on your own subscription; no key is stored in the app.",
];

type CliSpec = {
  binary: string;
  pathKey: "claudePath" | "codexPath" | "opencodePath";
  /** Config-home variable, for CLIs that have one. */
  home?: { key: "claudeHome" | "codexHome"; env: string; fallback: string };
  pathPlaceholder: string;
  installHint: [string, string];
  signInHint: [string, string];
  description: [string, string];
};

const SPECS: Readonly<Record<AgentCliId, CliSpec>> = {
  claude: {
    binary: CLAUDE_CLI_BINARY,
    pathKey: "claudePath",
    home: { key: "claudeHome", env: "CLAUDE_CONFIG_DIR", fallback: "~/.claude" },
    pathPlaceholder: "C:/Users/you/.local/bin/claude.exe",
    installHint: [
      "Windows'ta .cmd yerine claude.exe yolunu kullan; eski JavaScript kurulumlarında cli.js de desteklenir.",
      "On Windows, use claude.exe instead of the .cmd shim; legacy JavaScript installs can also use cli.js.",
    ],
    signInHint: ["Terminalde `claude` çalıştır ve `/login` ile giriş yap.", "Run `claude` in a terminal and sign in with `/login`."],
    description: SUBSCRIPTION_DESCRIPTION,
  },
  codex: {
    binary: CODEX_CLI_BINARY,
    pathKey: "codexPath",
    home: { key: "codexHome", env: "CODEX_HOME", fallback: "~/.codex" },
    pathPlaceholder: "C:/Users/you/AppData/Roaming/npm/node_modules/@openai/codex/.../codex.exe",
    installHint: [
      "npm ile kurduysan paketin içindeki codex.exe dosyasını göster; .cmd sarmalayıcısı çalıştırılamaz.",
      "If you installed via npm, point at the codex.exe inside the package; the .cmd wrapper cannot be launched.",
    ],
    signInHint: ["Terminalde `codex login` çalıştır.", "Run `codex login` in a terminal."],
    description: SUBSCRIPTION_DESCRIPTION,
  },
  opencode: {
    binary: OPENCODE_CLI_BINARY,
    pathKey: "opencodePath",
    pathPlaceholder: "C:/Users/you/AppData/Roaming/ai.opencode.desktop/cli/2.2.6-x64/opencode-cli.exe",
    installHint: [
      "OpenCode 2 gerekir. Masaüstü uygulamasının CLI'ı, npm (@opencode/cli) ve kurulum betiği otomatik bulunur; .cmd sarmalayıcısı çalıştırılamaz.",
      "Requires OpenCode 2. The desktop app's CLI, npm (@opencode/cli) and the install script are found automatically; the .cmd wrapper cannot be launched.",
    ],
    signInHint: [
      "Terminalde `opencode auth login` çalıştır ya da OpenCode uygulamasında bir sağlayıcı bağla.",
      "Run `opencode auth login` in a terminal, or connect a provider in the OpenCode app.",
    ],
    description: [
      "Yerel OpenCode; OpenCode'da bağladığın sağlayıcıların modellerini kullanır. Uygulamada anahtar saklanmaz.",
      "Local OpenCode; uses the models of the providers you connected in OpenCode. No key is stored in the app.",
    ],
  },
};

/** Only proxy settings are editable here; API keys belong in the keychain-backed key fields. */
const PROXY_ENV_KEYS = ["HTTPS_PROXY", "HTTP_PROXY", "ALL_PROXY", "NO_PROXY"] as const;

function statusLine(status: AgentAccountStatus | undefined, spec: CliSpec, pick: LocalePick): { title: string; detail?: string } {
  if (!status) return { title: pick("Kontrol ediliyor…", "Checking…") };
  switch (status.state) {
    case "authenticated": {
      if (status.cli === "opencode") {
        const count = status.modelCount ?? 0;
        const providers = status.providers?.join(", ") ?? "";
        return {
          title: pick("Hazır", "Ready"),
          detail: pick(`${count} model · ${providers}`, `${count} models · ${providers}`),
        };
      }
      const who = [status.email, status.planLabel].filter(Boolean).join(" · ");
      return { title: pick("Oturum açık", "Authenticated"), ...(who ? { detail: who } : {}) };
    }
    case "unauthenticated":
      return { title: pick("Oturum açılmamış", "Not signed in"), detail: pick(...spec.signInHint) };
    case "not_installed":
      if (!isTauriEnvWithOverride()) {
        return {
          title: pick("Yalnız masaüstünde", "Desktop only"),
          detail: pick("Yerel CLI'lar masaüstü uygulamasında algılanır.", "Local CLIs are detected in the desktop app."),
        };
      }
      return { title: pick("Bulunamadı", "Not found"), detail: status.error ?? pick(...spec.installHint) };
    case "error":
      return { title: pick("Kontrol başarısız", "Check failed"), ...(status.error ? { detail: status.error } : {}) };
  }
}

type Props = { cli: AgentCliId; label: string };

export function CliProviderDetail({ cli, label }: Props) {
  const pick = useLocalePick();
  const spec = SPECS[cli];
  const status = useAgentStatus((s) => s.statuses[cli]);
  const isRefreshing = useAgentStatus((s) => Boolean(s.refreshing[cli]));
  const refresh = useAgentStatus((s) => s.refresh);
  const agentCli = usePrefs((s) => s.agentCli);
  const setAgentCli = usePrefs((s) => s.setAgentCli);
  const [now, setNow] = useState(() => Date.now());
  const [refreshCount, setRefreshCount] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const handleRefresh = useCallback(() => {
    setNow(Date.now());
    setRefreshCount((c) => c + 1);
    void refresh(cli, { force: true }).finally(() => {
      setNow(Date.now());
    });
  }, [cli, refresh]);

  const savePrefs = useCallback(
    (next: AgentCliPrefs) => {
      setAgentCli(next);
      handleRefresh();
    },
    [handleRefresh, setAgentCli],
  );

  const line = statusLine(status, spec, pick);
  const effectiveNow = Math.max(now, status?.checkedAt ?? 0);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-ink">{label}</h2>
          <p className="mt-0.5 text-[12.5px] text-ink-3">{pick(...spec.description)}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {status?.version ? <span className="font-mono text-[12px] text-ink-3">v{status.version}</span> : null}
          <Button size="icon-sm" onClick={handleRefresh} disabled={isRefreshing} aria-label={pick("Yeniden kontrol et", "Check again")}>
            <RefreshCw className={cn("h-3.5 w-3.5", isRefreshing && "animate-spin")} aria-hidden />
          </Button>
        </div>
      </div>

      <SettingsGroup>
        <SettingsRow
          title={pick("Durum", "Status")}
          description={line.detail}
          control={
            <span className="text-[12.5px] font-medium text-ink-2">
              {isRefreshing ? pick("Kontrol ediliyor…", "Checking…") : line.title}
            </span>
          }
        />
      </SettingsGroup>

      {status?.limits.length ? (
        <SettingsSection
          title={pick("Kullanım limitleri", "Usage limits")}
          action={
            <Link href="/settings/usage" className="text-[12.5px] text-accent hover:underline">
              {pick("Ayrıntılı kullanım", "Detailed usage")}
            </Link>
          }
        >
          <div className={cn("transition-opacity duration-150", isRefreshing && "opacity-60")}>
            <SettingsGroup>
              {status.limits.map((w) => (
                <LimitMeter key={w.id} cli={cli} window={w} now={effectiveNow} size="sm" />
              ))}
            </SettingsGroup>
          </div>
        </SettingsSection>
      ) : status?.opencodeStats ? (
        <SettingsSection
          title={pick(
            `Kullanım özeti (Son ${status.opencodeStats.days} gün)`,
            `Usage summary (Last ${status.opencodeStats.days} days)`,
          )}
          description={pick(
            "OpenCode çoklu sağlayıcı kullandığı için tek bir abonelik kotası yerine yerel token ve model istatistiklerini raporlar.",
            "Because OpenCode routes across multiple providers, it reports local token and model statistics instead of a single subscription quota.",
          )}
          action={
            <Link href="/settings/usage" className="text-[12.5px] text-accent hover:underline">
              {pick("Ayrıntılı kullanım", "Detailed usage")}
            </Link>
          }
        >
          <div className={cn("transition-opacity duration-150", isRefreshing && "opacity-60")}>
            <OpencodeStatsGroup stats={status.opencodeStats} pick={pick} />
          </div>
        </SettingsSection>
      ) : status?.limitsError ? (
        <p className="text-[12.5px] text-ink-3">{pick("Limitler okunamadı: ", "Could not read limits: ")}{status.limitsError}</p>
      ) : null}

      <SettingsSection title={pick("Çalışma ortamı", "Runtime")}>
        <SettingsGroup>
          <BinaryPathRow
            spec={spec}
            agentCli={agentCli}
            refreshSignal={refreshCount}
            onSave={savePrefs}
            pick={pick}
          />
          {spec.home ? <HomeRow cli={cli} home={spec.home} agentCli={agentCli} onSave={savePrefs} pick={pick} /> : null}
        </SettingsGroup>
      </SettingsSection>

      <SettingsSection
        title={pick("Ortam değişkenleri", "Environment variables")}
        description={pick("Vekil sunucu ayarları; tüm yerel CLI'lar için ortaktır.", "Proxy settings, shared by all local CLIs.")}
      >
        <SettingsGroup>
          {PROXY_ENV_KEYS.map((key) => (
            <PrefTextRow
              key={key}
              id={`cli-env-${cli}-${key}`}
              title={<span className="font-mono text-[12.5px]">{key}</span>}
              saved={agentCli?.env?.[key] ?? ""}
              placeholder={key === "NO_PROXY" ? "localhost,127.0.0.1" : "http://proxy.example:8080"}
              onSave={(value) => savePrefs(withEnv(agentCli, key, value))}
              pick={pick}
            />
          ))}
        </SettingsGroup>
      </SettingsSection>
    </div>
  );
}

type HomeRowProps = {
  cli: AgentCliId;
  home: NonNullable<CliSpec["home"]>;
  agentCli: AgentCliPrefs | undefined;
  onSave: (next: AgentCliPrefs) => void;
  pick: LocalePick;
};

function HomeRow({ cli, home, agentCli, onSave, pick }: HomeRowProps) {
  return (
    <PrefTextRow
      id={`cli-home-${cli}`}
      title={pick(`${home.env} klasörü`, `${home.env} folder`)}
      description={pick(
        `Yapılandırma ve oturum klasörü. Boş bırakırsan ${home.fallback} kullanılır; tam yol olmalı ve var olmalı.`,
        `Config and session folder. Empty means ${home.fallback}; must be an absolute path that exists.`,
      )}
      saved={agentCli?.[home.key] ?? ""}
      placeholder={home.fallback}
      onSave={(value) => onSave(withField(agentCli, home.key, value))}
      pick={pick}
    />
  );
}

function withField(prefs: AgentCliPrefs | undefined, key: keyof AgentCliPrefs, value: string): AgentCliPrefs {
  const next: AgentCliPrefs = { ...(prefs ?? {}) };
  delete next[key];
  return value ? { ...next, [key]: value } : next;
}

function withEnv(prefs: AgentCliPrefs | undefined, key: string, value: string): AgentCliPrefs {
  const env: Record<string, string> = { ...(prefs?.env ?? {}) };
  delete env[key];
  if (value) env[key] = value;
  const next: AgentCliPrefs = { ...(prefs ?? {}) };
  delete next.env;
  return Object.keys(env).length > 0 ? { ...next, env } : next;
}

type TextRowProps = {
  id: string;
  title: ReactNode;
  description?: string;
  saved: string;
  placeholder: string;
  onSave: (value: string) => void;
  pick: LocalePick;
  children?: ReactNode;
};

function PrefTextRow({ id, title, description, saved, placeholder, onSave, pick, children }: TextRowProps) {
  const [draft, setDraft] = useState(saved);
  const dirty = draft.trim() !== saved;
  const field = (
    <div className="flex w-full items-center gap-2">
      <Input id={id} variant="mono" value={draft} placeholder={placeholder} spellCheck={false} onChange={(e) => setDraft(e.target.value)} />
      <Button size="sm" variant="primary" disabled={!dirty} onClick={() => onSave(draft.trim())}>
        {pick("Kaydet", "Save")}
      </Button>
    </div>
  );
  // Rows with a description stack the field under the text: the detail pane is too narrow for side-by-side.
  if (description) {
    return (
      <SettingsRow title={title} description={description} htmlFor={id}>
        <div className="space-y-2">
          {field}
          {children}
        </div>
      </SettingsRow>
    );
  }
  return (
    <SettingsRow title={title} htmlFor={id} control={<div className="w-full sm:w-[300px]">{field}</div>}>
      {children}
    </SettingsRow>
  );
}

type BinaryRowProps = {
  spec: CliSpec;
  agentCli: AgentCliPrefs | undefined;
  refreshSignal: number;
  onSave: (next: AgentCliPrefs) => void;
  pick: LocalePick;
};

function BinaryPathRow({ spec, agentCli, refreshSignal, onSave, pick }: BinaryRowProps) {
  const saved = agentCli?.[spec.pathKey] ?? "";
  const [probe, setProbe] = useState<AgentCliProbe | null>(null);
  const probeVersion = useRef(0);

  useEffect(() => {
    const version = ++probeVersion.current;
    void probeAgentCli(spec.binary, saved.trim() || undefined).then((result) => {
      if (version === probeVersion.current) setProbe(result);
    });
    return () => {
      probeVersion.current += 1;
    };
  }, [saved, spec.binary, refreshSignal]);

  return (
    <PrefTextRow
      id={`cli-path-${spec.binary}`}
      title={pick("İkili dosya yolu", "Binary path")}
      description={pick("Boş bırakırsan bilinen konumlarda otomatik aranır.", "Leave empty to auto-detect from known locations.")}
      saved={saved}
      placeholder={spec.pathPlaceholder}
      onSave={(value) => onSave(withField(agentCli, spec.pathKey, value))}
      pick={pick}
    >
      {probe?.found ? (
        <p className="break-all font-mono text-[11.5px] text-ink-3">
          {probe.path}
          {probe.launcher ? pick(` · ${probe.launcher} ile çalışır`, ` · runs under ${probe.launcher}`) : ""}
        </p>
      ) : probe ? (
        <p className="text-[12px] text-ink-3">{probe.error ?? pick(...spec.installHint)}</p>
      ) : null}
    </PrefTextRow>
  );
}

export function OpencodeStatsGroup({
  stats,
  pick,
}: {
  stats: OpencodeUsageStats;
  pick: LocalePick;
}) {
  const totalTokens =
    stats.inputTokens +
    stats.outputTokens +
    stats.cacheReadTokens +
    stats.cacheWriteTokens;

  return (
    <SettingsGroup>
      <SettingsRow
        title={pick("Toplam aktivite", "Total activity")}
        description={pick(
          `${stats.sessions} oturum · ${stats.prompts} istem · ${stats.steps} adım`,
          `${stats.sessions} sessions · ${stats.prompts} prompts · ${stats.steps} steps`,
        )}
        control={
          <span className="font-mono text-[13px] font-semibold tabular-nums text-ink">
            {formatCompactNumber(totalTokens)} token
            {stats.costUsd > 0 ? ` · ${formatUsd(stats.costUsd)}` : ""}
          </span>
        }
      />
      <SettingsRow
        title={pick("Token dağılımı", "Token breakdown")}
        description={pick(
          `${formatCompactNumber(stats.inputTokens)} girdi · ${formatCompactNumber(stats.outputTokens)} çıktı · ${formatCompactNumber(stats.cacheReadTokens)} önbellek okuma${stats.reasoningTokens > 0 ? ` · ${formatCompactNumber(stats.reasoningTokens)} akıl yürütme` : ""}`,
          `${formatCompactNumber(stats.inputTokens)} input · ${formatCompactNumber(stats.outputTokens)} output · ${formatCompactNumber(stats.cacheReadTokens)} cache read${stats.reasoningTokens > 0 ? ` · ${formatCompactNumber(stats.reasoningTokens)} reasoning` : ""}`,
        )}
      />
      {stats.models.map((m) => {
        const modelTotal =
          m.inputTokens + m.outputTokens + m.cacheReadTokens + m.cacheWriteTokens;
        return (
          <SettingsRow
            key={`${m.providerId}/${m.modelId}`}
            title={
              <span className="font-mono text-[12.5px] text-ink">
                {m.providerId}/{m.modelId}
              </span>
            }
            description={pick(
              `${m.steps} adım · ${formatCompactNumber(m.inputTokens)} girdi · ${formatCompactNumber(m.outputTokens)} çıktı · ${formatCompactNumber(m.cacheReadTokens)} önbellek`,
              `${m.steps} steps · ${formatCompactNumber(m.inputTokens)} input · ${formatCompactNumber(m.outputTokens)} output · ${formatCompactNumber(m.cacheReadTokens)} cache`,
            )}
            control={
              <span className="font-mono text-[12.5px] tabular-nums text-ink-2">
                {formatCompactNumber(modelTotal)} token
                {m.costUsd > 0 ? ` · ${formatUsd(m.costUsd)}` : ""}
              </span>
            }
          />
        );
      })}
    </SettingsGroup>
  );
}
