"use client";

// Local agent CLI settings.
//
// One row per supported CLI (`claude`, `codex`): detects the binary the user
// already installed and lets them point at it explicitly when auto-detection
// misses. Once found, the matching "(local CLI)" provider becomes selectable
// in Settings → Default models like any other provider, and requests run
// against the user's own subscription with no API key stored anywhere.
//
// Desktop only, like AutoLaunchSection: a browser cannot spawn a process, so on
// the web build this renders nothing rather than offering a control that could
// never work.
//
// Strings are inline TR/EN via useLocalePick rather than message-catalog keys,
// following the precedent CompatibilityChip sets for a self-contained
// desktop-only panel.

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, RefreshCw, Terminal } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useLocalePick } from "@/i18n/IntlProvider";
import { isTauriEnvWithOverride } from "@/lib/tauri/env";
import { probeAgentCli, type AgentCliProbe } from "@/lib/tauri/agent-cli";
import { CLAUDE_CLI_BINARY } from "@/lib/ai/providers/claude-cli";
import { CODEX_CLI_BINARY } from "@/lib/ai/providers/codex-cli";
import { usePrefs, type AgentCliPrefs } from "@/stores/prefs";

type ProbeState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "done"; probe: AgentCliProbe };

type PathKey = "claudePath" | "codexPath";

type CliSpec = {
  cli: string;
  pathKey: PathKey;
  title: [tr: string, en: string];
  blurb: [tr: string, en: string];
  notFound: [tr: string, en: string];
  installHint: [tr: string, en: string];
  placeholder: string;
};

const CLIS: readonly CliSpec[] = [
  {
    cli: CLAUDE_CLI_BINARY,
    pathKey: "claudePath",
    title: ["Claude Code CLI", "Claude Code CLI"],
    blurb: [
      "Bilgisayarında kurulu olan claude komutunu kullan. İstekler senin Claude aboneliğin üzerinden gider; uygulamada saklanan bir API anahtarı olmaz ve süresi dolabilecek bir token yapıştırman gerekmez.",
      "Use the claude command already installed on your machine. Requests run against your own Claude subscription — no API key is stored in the app, and there is no token to paste that can later expire.",
    ],
    notFound: [
      "claude komutu bilinen konumlarda bulunamadı.",
      "The claude command was not found in any known location.",
    ],
    installHint: [
      "Windows'ta .cmd dosyası yerine claude.exe yolunu kullan. npm kurulumlarında paketin bin/claude.exe dosyasını seç; eski JavaScript kurulumlarında cli.js de desteklenir.",
      "On Windows, use claude.exe instead of the .cmd shim. For npm installs, select the package's bin/claude.exe; legacy JavaScript installs can also use cli.js.",
    ],
    placeholder: "C:/Users/you/.local/bin/claude.exe",
  },
  {
    cli: CODEX_CLI_BINARY,
    pathKey: "codexPath",
    title: ["Codex CLI", "Codex CLI"],
    blurb: [
      "Bilgisayarında kurulu olan codex komutunu kullan. İstekler senin ChatGPT aboneliğin üzerinden gider — bu planın API karşılığı yoktur, tek yol budur. Uygulamada saklanan bir anahtar olmaz.",
      "Use the codex command already installed on your machine. Requests run against your own ChatGPT subscription — that plan has no API equivalent, so this is the only route. No key is stored in the app.",
    ],
    notFound: [
      "codex komutu bilinen konumlarda bulunamadı.",
      "The codex command was not found in any known location.",
    ],
    installHint: [
      "npm ile kurduysan paketin içindeki codex.exe dosyasını göster (node_modules/@openai/codex/…/bin/codex.exe); .cmd sarmalayıcısı çalıştırılamaz.",
      "If you installed via npm, point at the codex.exe inside the package (node_modules/@openai/codex/…/bin/codex.exe); the .cmd wrapper cannot be launched.",
    ],
    placeholder: "C:/Users/you/AppData/Roaming/npm/node_modules/@openai/codex/.../codex.exe",
  },
];

export function AgentCliSection(): React.ReactElement | null {
  const pick = useLocalePick();

  if (!isTauriEnvWithOverride()) return null;

  return (
    <section
      className="rounded-2xl border border-rule bg-paper-2 p-5 shadow-sm"
      data-testid="agent-cli-section"
    >
      <header className="flex items-start gap-3">
        <span
          className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent-wash text-accent-ink"
          aria-hidden
        >
          <Terminal size={18} strokeWidth={1.6} />
        </span>
        <div className="flex-1">
          <h2 className="text-sm font-semibold text-ink">
            {pick("Yerel ajan CLI'ları", "Local agent CLIs")}
          </h2>
          <p className="mt-1 text-xs text-ink-3">
            {pick(
              "Abonelikle giriş yapılmış bir komut satırı aracını sağlayıcı olarak kullan. Anahtar saklanmaz; istekler senin hesabın üzerinden gider.",
              "Use a subscription-signed-in command-line tool as a provider. No key is stored; requests run through your own account.",
            )}
          </p>
        </div>
      </header>

      <div className="mt-4 flex flex-col gap-5">
        {CLIS.map((spec) => (
          <CliRow key={spec.cli} spec={spec} />
        ))}
      </div>
    </section>
  );
}

function CliRow({ spec }: { spec: CliSpec }): React.ReactElement {
  const pick = useLocalePick();
  const agentCli = usePrefs((s) => s.agentCli);
  const setAgentCli = usePrefs((s) => s.setAgentCli);

  const savedPath = agentCli?.[spec.pathKey] ?? "";
  const [draftPath, setDraftPath] = useState(savedPath);
  const [state, setState] = useState<ProbeState>({ kind: "idle" });
  const probeVersion = useRef(0);

  const runProbe = useCallback(
    async (path: string) => {
      const version = ++probeVersion.current;
      setState({ kind: "checking" });
      const probe = await probeAgentCli(
        spec.cli,
        path.trim().length > 0 ? path.trim() : undefined,
      );
      if (version === probeVersion.current) setState(probe ? { kind: "done", probe } : { kind: "idle" });
    },
    [spec.cli],
  );

  // A typed binary path changes what the probe should test, so it re-runs when
  // the saved value changes; runProbe is stable per cli.
  useEffect(() => {
    let active = true;
    queueMicrotask(() => { if (active) void runProbe(savedPath); });
    return () => { active = false; probeVersion.current += 1; };
  }, [savedPath, runProbe]);

  const probe = state.kind === "done" ? state.probe : null;
  const ok = probe?.found === true;

  const save = (): void => {
    const next = draftPath.trim();
    // Only this row's path is edited; the other CLI's path and `env` stay.
    const rest: AgentCliPrefs = { ...(agentCli ?? {}) };
    delete rest[spec.pathKey];
    setAgentCli(next.length > 0 ? { ...rest, [spec.pathKey]: next } : rest);
  };

  const inputId = `agent-cli-path-${spec.cli}`;

  return (
    <div data-testid={`agent-cli-row-${spec.cli}`}>
      <h3 className="text-sm font-semibold text-ink">{pick(...spec.title)}</h3>
      <p className="mt-1 text-xs text-ink-3">{pick(...spec.blurb)}</p>

      <div
        className="mt-3 flex items-start gap-3 rounded-xl border border-rule-soft bg-paper px-4 py-3"
        role="status"
        aria-live="polite"
      >
        <span aria-hidden className={ok ? "text-ok" : "text-warn"}>
          {ok ? (
            <CheckCircle2 size={18} strokeWidth={1.8} />
          ) : (
            <AlertTriangle size={18} strokeWidth={1.8} />
          )}
        </span>
        <div className="min-w-0 flex-1">
          {state.kind === "checking" ? (
            <p className="text-sm text-ink-3">
              {pick("Aranıyor…", "Looking for it…")}
            </p>
          ) : ok && probe ? (
            <>
              <p className="text-sm font-medium text-ink">
                {pick("Bulundu", "Found")} · {probe.version}
              </p>
              <p className="mt-0.5 break-all font-mono text-xs text-ink-3">
                {probe.path}
              </p>
              {probe.launcher ? (
                <p className="mt-0.5 text-xs text-ink-3">
                  {pick(
                    `Bir betik sarmalayıcısı; ${probe.launcher} ile çalıştırılacak.`,
                    `A script wrapper; it will be run under ${probe.launcher}.`,
                  )}
                </p>
              ) : null}
            </>
          ) : (
            <>
              <p className="text-sm font-medium text-ink">
                {pick("Kullanılamıyor", "Not usable")}
              </p>
              <p className="mt-0.5 text-xs text-ink-3">
                {probe?.error ?? pick(...spec.notFound)}
              </p>
            </>
          )}
        </div>
        <Button
          size="sm"
          onClick={() => void runProbe(draftPath)}
          disabled={state.kind === "checking"}
          aria-label={pick("Yeniden ara", "Check again")}
        >
          <RefreshCw size={14} strokeWidth={1.8} aria-hidden />
        </Button>
      </div>

      <div className="mt-3">
        <label className="text-xs font-medium text-ink-3" htmlFor={inputId}>
          {pick(
            "CLI yolu (boş bırakırsan otomatik bulunur)",
            "CLI path (leave empty to auto-detect)",
          )}
        </label>
        <div className="mt-1.5 flex gap-2">
          <Input
            id={inputId}
            variant="mono"
            value={draftPath}
            onChange={(e) => setDraftPath(e.target.value)}
            placeholder={spec.placeholder}
            spellCheck={false}
          />
          <Button variant="primary" size="sm" onClick={save}>
            {pick("Kaydet", "Save")}
          </Button>
        </div>
        <p className="mt-1.5 text-xs text-ink-3">{pick(...spec.installHint)}</p>
      </div>
    </div>
  );
}
