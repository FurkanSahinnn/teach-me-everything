"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { RefreshCw } from "@/components/icons";
import { SettingsGroup, SettingsRow, SettingsSection } from "@/components/settings/layout/SettingsPrimitives";
import { LimitMeter } from "@/components/settings/usage/LimitMeter";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useLocalePick } from "@/i18n/IntlProvider";
import { useAgentStatus } from "@/lib/ai/agent-status/store";
import type { AgentAccountStatus, AgentCliId } from "@/lib/ai/agent-status/types";
import { CLAUDE_CLI_BINARY } from "@/lib/ai/providers/claude-cli";
import { CODEX_CLI_BINARY } from "@/lib/ai/providers/codex-cli";
import { probeAgentCli, type AgentCliProbe } from "@/lib/tauri/agent-cli";
import { isTauriEnvWithOverride } from "@/lib/tauri/env";
import { usePrefs, type AgentCliPrefs } from "@/stores/prefs";

type LocalePick = (tr: string, en: string) => string;

type CliSpec = {
  binary: string;
  pathKey: "claudePath" | "codexPath";
  homeKey: "claudeHome" | "codexHome";
  homeEnv: string;
  homeDefault: string;
  pathPlaceholder: string;
  installHint: [string, string];
  signInHint: [string, string];
};

const SPECS: Readonly<Record<AgentCliId, CliSpec>> = {
  claude: {
    binary: CLAUDE_CLI_BINARY,
    pathKey: "claudePath",
    homeKey: "claudeHome",
    homeEnv: "CLAUDE_CONFIG_DIR",
    homeDefault: "~/.claude",
    pathPlaceholder: "C:/Users/you/.local/bin/claude.exe",
    installHint: [
      "Windows'ta .cmd yerine claude.exe yolunu kullan; eski JavaScript kurulumlarında cli.js de desteklenir.",
      "On Windows, use claude.exe instead of the .cmd shim; legacy JavaScript installs can also use cli.js.",
    ],
    signInHint: ["Terminalde `claude` çalıştır ve `/login` ile giriş yap.", "Run `claude` in a terminal and sign in with `/login`."],
  },
  codex: {
    binary: CODEX_CLI_BINARY,
    pathKey: "codexPath",
    homeKey: "codexHome",
    homeEnv: "CODEX_HOME",
    homeDefault: "~/.codex",
    pathPlaceholder: "C:/Users/you/AppData/Roaming/npm/node_modules/@openai/codex/.../codex.exe",
    installHint: [
      "npm ile kurduysan paketin içindeki codex.exe dosyasını göster; .cmd sarmalayıcısı çalıştırılamaz.",
      "If you installed via npm, point at the codex.exe inside the package; the .cmd wrapper cannot be launched.",
    ],
    signInHint: ["Terminalde `codex login` çalıştır.", "Run `codex login` in a terminal."],
  },
};

/** Only proxy settings are editable here; API keys belong in the keychain-backed key fields. */
const PROXY_ENV_KEYS = ["HTTPS_PROXY", "HTTP_PROXY", "ALL_PROXY", "NO_PROXY"] as const;

function statusLine(status: AgentAccountStatus | undefined, spec: CliSpec, pick: LocalePick): { title: string; detail?: string } {
  if (!status) return { title: pick("Kontrol ediliyor…", "Checking…") };
  switch (status.state) {
    case "authenticated": {
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
  const loading = useAgentStatus((s) => s.loading);
  const refresh = useAgentStatus((s) => s.refresh);
  const agentCli = usePrefs((s) => s.agentCli);
  const setAgentCli = usePrefs((s) => s.setAgentCli);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const savePrefs = useCallback(
    (next: AgentCliPrefs) => {
      setAgentCli(next);
      void refresh(cli, { force: true });
    },
    [cli, refresh, setAgentCli],
  );

  const line = statusLine(status, spec, pick);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-ink">{label}</h2>
          <p className="mt-0.5 text-[12.5px] text-ink-3">
            {pick("Kendi aboneliğinle çalışan yerel komut satırı aracı; uygulamada anahtar saklanmaz.", "Local command-line tool running on your own subscription; no key is stored in the app.")}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {status?.version ? <span className="font-mono text-[12px] text-ink-3">v{status.version}</span> : null}
          <Button size="icon-sm" onClick={() => void refresh(cli, { force: true })} disabled={loading} aria-label={pick("Yeniden kontrol et", "Check again")}>
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          </Button>
        </div>
      </div>

      <SettingsGroup>
        <SettingsRow title={pick("Durum", "Status")} description={line.detail} control={<span className="text-[12.5px] font-medium text-ink-2">{line.title}</span>} />
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
          <SettingsGroup>
            {status.limits.map((w) => (
              <LimitMeter key={w.id} cli={cli} window={w} now={now} size="sm" />
            ))}
          </SettingsGroup>
        </SettingsSection>
      ) : status?.limitsError ? (
        <p className="text-[12.5px] text-ink-3">{pick("Limitler okunamadı: ", "Could not read limits: ")}{status.limitsError}</p>
      ) : null}

      <SettingsSection title={pick("Çalışma ortamı", "Runtime")}>
        <SettingsGroup>
          <BinaryPathRow spec={spec} agentCli={agentCli} onSave={savePrefs} pick={pick} />
          <PrefTextRow
            id={`cli-home-${cli}`}
            title={pick(`${spec.homeEnv} klasörü`, `${spec.homeEnv} folder`)}
            description={pick(
              `Yapılandırma ve oturum klasörü. Boş bırakırsan ${spec.homeDefault} kullanılır; tam yol olmalı ve var olmalı.`,
              `Config and session folder. Empty means ${spec.homeDefault}; must be an absolute path that exists.`,
            )}
            saved={agentCli?.[spec.homeKey] ?? ""}
            placeholder={spec.homeDefault}
            onSave={(value) => savePrefs(withField(agentCli, spec.homeKey, value))}
            pick={pick}
          />
        </SettingsGroup>
      </SettingsSection>

      <SettingsSection
        title={pick("Ortam değişkenleri", "Environment variables")}
        description={pick("Vekil sunucu ayarları; iki CLI için ortaktır.", "Proxy settings, shared by both CLIs.")}
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
  onSave: (next: AgentCliPrefs) => void;
  pick: LocalePick;
};

function BinaryPathRow({ spec, agentCli, onSave, pick }: BinaryRowProps) {
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
  }, [saved, spec.binary]);

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
