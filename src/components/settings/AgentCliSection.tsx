"use client";

// Local agent CLI settings.
//
// Detects the `claude` binary the user already installed and lets them point at
// it explicitly when auto-detection misses. Once found, "Claude Code (local
// CLI)" becomes selectable in Settings → Default models like any other
// provider, and requests run against the user's own Claude subscription with no
// API key stored anywhere.
//
// Desktop only, like AutoLaunchSection: a browser cannot spawn a process, so on
// the web build this renders nothing rather than offering a control that could
// never work.
//
// Strings are inline TR/EN via useLocalePick rather than message-catalog keys,
// following the precedent CompatibilityChip sets for a self-contained
// desktop-only panel.

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, RefreshCw, Terminal } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useLocalePick } from "@/i18n/IntlProvider";
import { isTauriEnvWithOverride } from "@/lib/tauri/env";
import { probeAgentCli, type AgentCliProbe } from "@/lib/tauri/agent-cli";
import { CLAUDE_CLI_BINARY } from "@/lib/ai/providers/claude-cli";
import { usePrefs } from "@/stores/prefs";

type ProbeState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "done"; probe: AgentCliProbe };

export function AgentCliSection(): React.ReactElement | null {
  const pick = useLocalePick();
  const agentCli = usePrefs((s) => s.agentCli);
  const setAgentCli = usePrefs((s) => s.setAgentCli);

  const [draftPath, setDraftPath] = useState(agentCli?.claudePath ?? "");
  const [state, setState] = useState<ProbeState>({ kind: "idle" });

  const runProbe = useCallback(async (path: string) => {
    setState({ kind: "checking" });
    const probe = await probeAgentCli(
      CLAUDE_CLI_BINARY,
      path.trim().length > 0 ? path.trim() : undefined,
    );
    setState(probe ? { kind: "done", probe } : { kind: "idle" });
  }, []);

  // The podcast hardware probe caches for the session because hardware does not
  // change mid-run; a typed binary path does, so this re-runs when it changes.
  // runProbe is stable (useCallback with no deps), so listing it does not add a
  // second trigger.
  const savedPath = agentCli?.claudePath ?? "";
  useEffect(() => {
    void runProbe(savedPath);
  }, [savedPath, runProbe]);

  if (!isTauriEnvWithOverride()) return null;

  const probe = state.kind === "done" ? state.probe : null;
  const ok = probe?.found === true;

  const save = (): void => {
    const next = draftPath.trim();
    // Clearing the path must not also discard `env`; only the path is edited
    // here.
    const { claudePath: _dropped, ...rest } = agentCli ?? {};
    void _dropped;
    setAgentCli(next.length > 0 ? { ...rest, claudePath: next } : rest);
  };

  return (
    <section
      className="rounded-2xl border border-line bg-paper-soft p-5 shadow-sm"
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
            {pick("Yerel Claude Code CLI", "Local Claude Code CLI")}
          </h2>
          <p className="mt-1 text-xs text-ink-soft">
            {pick(
              "Bilgisayarında kurulu olan claude komutunu kullan. İstekler senin Claude aboneliğin üzerinden gider; uygulamada saklanan bir API anahtarı olmaz ve süresi dolabilecek bir token yapıştırman gerekmez.",
              "Use the claude command already installed on your machine. Requests run against your own Claude subscription — no API key is stored in the app, and there is no token to paste that can later expire.",
            )}
          </p>
        </div>
      </header>

      <div
        className="mt-4 flex items-start gap-3 rounded-xl border border-line/60 bg-paper px-4 py-3"
        role="status"
        aria-live="polite"
      >
        <span aria-hidden className={ok ? "text-emerald-600" : "text-amber-600"}>
          {ok ? (
            <CheckCircle2 size={18} strokeWidth={1.8} />
          ) : (
            <AlertTriangle size={18} strokeWidth={1.8} />
          )}
        </span>
        <div className="min-w-0 flex-1">
          {state.kind === "checking" ? (
            <p className="text-sm text-ink-soft">
              {pick("Aranıyor…", "Looking for it…")}
            </p>
          ) : ok && probe ? (
            <>
              <p className="text-sm font-medium text-ink">
                {pick("Bulundu", "Found")} · {probe.version}
              </p>
              <p className="mt-0.5 break-all font-mono text-xs text-ink-soft">
                {probe.path}
              </p>
              {probe.launcher ? (
                <p className="mt-0.5 text-xs text-ink-soft">
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
              <p className="mt-0.5 text-xs text-ink-soft">
                {probe?.error ??
                  pick(
                    "claude komutu bilinen konumlarda bulunamadı.",
                    "The claude command was not found in any known location.",
                  )}
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
        <label
          className="text-xs font-medium text-ink-soft"
          htmlFor="agent-cli-path"
        >
          {pick(
            "CLI yolu (boş bırakırsan otomatik bulunur)",
            "CLI path (leave empty to auto-detect)",
          )}
        </label>
        <div className="mt-1.5 flex gap-2">
          <Input
            id="agent-cli-path"
            variant="mono"
            value={draftPath}
            onChange={(e) => setDraftPath(e.target.value)}
            placeholder="C:/Users/you/.local/bin/claude.exe"
            spellCheck={false}
          />
          <Button variant="primary" size="sm" onClick={save}>
            {pick("Kaydet", "Save")}
          </Button>
        </div>
        <p className="mt-1.5 text-xs text-ink-soft">
          {pick(
            "npm ile kurduysan .cmd dosyasını değil, paketin .cjs sarmalayıcısını göster — Windows kabuk sarmalayıcılarını doğrudan çalıştırmaya izin vermiyor. Yerel kurulumda claude.exe yolunu kullan.",
            "If you installed via npm, point at the package's .cjs wrapper rather than the .cmd file — Windows does not allow launching shell wrappers directly. For a native install, use the claude.exe path.",
          )}
        </p>
      </div>
    </section>
  );
}
