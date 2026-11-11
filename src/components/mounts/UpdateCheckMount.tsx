"use client";

// On-launch update check + Update Welcome Panel (desktop only, controlled via
// `prefs.autoCheckUpdates` and `prefs.autoInstallUpdates`). When a newer build
// exists on GitHub Releases, greets the user with an in-app update panel
// showing version + release notes + one-click download/install/relaunch (or
// auto-installs immediately when `autoInstallUpdates` is enabled).

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, Loader2, RefreshCw, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Switch } from "@/components/ui/Switch";
import { useToast } from "@/components/ui/Toast";
import { useLocalePick } from "@/i18n/IntlProvider";
import { isTauriEnvWithOverride } from "@/lib/tauri/env";
import { usePrefs } from "@/stores/prefs";

type UpdateProgressEvent =
  | { event: "Started"; data: { contentLength?: number } }
  | { event: "Progress"; data: { chunkLength: number } }
  | { event: "Finished" };

export interface UpdateHandle {
  version: string;
  body?: string | undefined;
  downloadAndInstall?: (
    onEvent?: (progress: UpdateProgressEvent) => void,
  ) => Promise<void>;
}

interface UpdaterPluginApi {
  check: () => Promise<UpdateHandle | null>;
}

interface ProcessPluginApi {
  relaunch: () => Promise<void>;
}

// Lazy import so the web bundle never pulls the updater module.
async function getUpdaterPlugin(): Promise<UpdaterPluginApi> {
  const mod = (await import("@tauri-apps/plugin-updater")) as UpdaterPluginApi;
  return mod;
}

async function getProcessPlugin(): Promise<ProcessPluginApi> {
  const mod = (await import("@tauri-apps/plugin-process")) as ProcessPluginApi;
  return mod;
}

type InstallState =
  | { kind: "ready" }
  | { kind: "downloading"; pct: number | null }
  | { kind: "installed" }
  | { kind: "error"; message: string };

export function UpdateCheckMount(): React.ReactElement | null {
  const autoCheck = usePrefs((s) => s.autoCheckUpdates);
  const autoInstall = usePrefs((s) => s.autoInstallUpdates);
  const setAutoInstall = usePrefs((s) => s.setAutoInstallUpdates);
  const { toast } = useToast();
  const pick = useLocalePick();

  const [updateHandle, setUpdateHandle] = useState<UpdateHandle | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [installState, setInstallState] = useState<InstallState>({ kind: "ready" });

  // Run exactly once per launch even under React StrictMode double-mount.
  const ran = useRef(false);

  const runInstall = useCallback(
    async (handle: UpdateHandle) => {
      if (!handle.downloadAndInstall) return;
      setInstallState({ kind: "downloading", pct: null });
      let receivedBytes = 0;
      let totalBytes: number | null = null;
      try {
        await handle.downloadAndInstall((progress) => {
          if (progress.event === "Started") {
            totalBytes = progress.data.contentLength ?? null;
            setInstallState({ kind: "downloading", pct: totalBytes ? 0 : null });
          } else if (progress.event === "Progress") {
            receivedBytes += progress.data.chunkLength;
            const pct =
              totalBytes && totalBytes > 0
                ? Math.min(100, Math.round((receivedBytes / totalBytes) * 100))
                : null;
            setInstallState({ kind: "downloading", pct });
          }
        });
        setInstallState({ kind: "installed" });
        toast({
          variant: "success",
          title: pick("Güncelleme tamamlandı", "Update installed"),
          description: pick(
            "Uygulama yeni sürümle yeniden başlatılıyor…",
            "Restarting the application with the new version…",
          ),
        });
        const proc = await getProcessPlugin();
        await proc.relaunch();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setInstallState({ kind: "error", message });
      }
    },
    [pick, toast],
  );

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    if (!isTauriEnvWithOverride() || !autoCheck) return;

    let cancelled = false;
    void (async () => {
      try {
        const plugin = await getUpdaterPlugin();
        const handle = await plugin.check();
        if (cancelled || !handle) return;
        setUpdateHandle(handle);
        setModalOpen(true);
        toast({
          variant: "info",
          title: pick("Güncelleme mevcut", "Update available"),
          description: pick(
            `Yeni sürüm v${handle.version} hazır.`,
            `Version v${handle.version} is ready.`,
          ),
        });
        if (usePrefs.getState().autoInstallUpdates && handle.downloadAndInstall) {
          void runInstall(handle);
        }
      } catch {
        // A failed background check must never interrupt the user.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [autoCheck, toast, pick, runInstall]);

  if (!modalOpen || !updateHandle) return null;

  const isBusy =
    installState.kind === "downloading" || installState.kind === "installed";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="update-welcome-title"
      data-testid="update-welcome-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-xs"
    >
      <div className="w-full max-w-[480px] overflow-hidden rounded-2xl border border-rule bg-paper shadow-[var(--shadow-deep)]">
        <div className="flex items-start justify-between gap-3 border-b border-rule-soft bg-paper-2 px-5 py-4">
          <div className="flex items-center gap-3">
            <span
              className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-accent-soft bg-accent-wash text-accent-ink"
              aria-hidden
            >
              <Sparkles className="h-5 w-5" />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h2
                  id="update-welcome-title"
                  className="font-serif text-[18px] font-medium text-ink"
                >
                  {pick("Yeni Güncelleme Hazır", "New Update Available")}
                </h2>
                <span className="rounded-full border border-accent-soft bg-accent-wash px-2 py-0.5 font-mono text-[11px] font-medium text-accent-ink">
                  v{updateHandle.version}
                </span>
              </div>
              <p className="mt-0.5 text-[12px] text-ink-3">
                {pick(
                  "Teach Me Everything için yeni bir masaüstü sürümü yayınlandı.",
                  "A new desktop release of Teach Me Everything is ready to install.",
                )}
              </p>
            </div>
          </div>
          {!isBusy ? (
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              aria-label={pick("Kapat", "Close")}
              className="rounded-lg p-1.5 text-ink-3 transition-colors hover:bg-paper-3 hover:text-ink"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          ) : null}
        </div>

        <div className="space-y-4 px-5 py-4">
          {updateHandle.body && updateHandle.body.trim().length > 0 ? (
            <div className="rounded-xl border border-rule-soft bg-paper-2 p-3.5">
              <p className="mb-1.5 font-mono text-[10.5px] uppercase tracking-wider text-ink-4">
                {pick("Sürüm Notları", "Release Notes")}
              </p>
              <p className="max-h-40 overflow-y-auto whitespace-pre-line text-[13px] leading-relaxed text-ink-2">
                {updateHandle.body}
              </p>
            </div>
          ) : (
            <p className="text-[13px] leading-relaxed text-ink-2">
              {pick(
                "Bu güncelleme son özellik iyileştirmelerini, arayüz düzenlemelerini ve kararlılık düzeltmelerini içerir. Güncelleme tamamlandığında uygulama otomatik olarak yeniden başlatılır.",
                "This update includes the latest feature improvements, UI refinements, and stability fixes. The app will restart automatically once installed.",
              )}
            </p>
          )}

          {installState.kind === "downloading" ? (
            <div className="space-y-2 rounded-xl border border-accent-soft bg-accent-wash/40 p-3.5">
              <div className="flex items-center justify-between text-[12px] font-medium text-accent-ink">
                <span className="flex items-center gap-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  {pick("Güncelleme indiriliyor ve kuruluyor…", "Downloading and installing update…")}
                </span>
                {installState.pct !== null ? (
                  <span className="font-mono">{installState.pct}%</span>
                ) : null}
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-paper-3">
                <div
                  className="h-full rounded-full bg-accent transition-all duration-200"
                  style={{
                    width:
                      installState.pct !== null ? `${installState.pct}%` : "45%",
                  }}
                />
              </div>
            </div>
          ) : null}

          {installState.kind === "error" ? (
            <div
              role="alert"
              className="rounded-xl border border-err/30 bg-err/10 px-3.5 py-2.5 text-[12px] text-err"
            >
              {pick("Güncelleme hatası: ", "Update failed: ")}
              {installState.message}
            </div>
          ) : null}

          <label className="flex items-center justify-between gap-3 rounded-xl border border-rule-soft bg-paper-2 px-3.5 py-2.5">
            <span className="text-[12px] text-ink-2">
              {pick(
                "Sonraki güncellemeleri açılışta otomatik kur",
                "Auto-install future updates on launch",
              )}
            </span>
            <Switch
              checked={autoInstall}
              onCheckedChange={setAutoInstall}
              size="sm"
              ariaLabel={pick(
                "Sonraki güncellemeleri açılışta otomatik kur",
                "Auto-install future updates on launch",
              )}
            />
          </label>
        </div>

        <div className="flex items-center justify-end gap-2.5 border-t border-rule-soft bg-paper-2 px-5 py-3.5">
          <Button
            variant="ghost"
            size="sm"
            disabled={isBusy}
            onClick={() => setModalOpen(false)}
          >
            {pick("Daha Sonra", "Remind Me Later")}
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={isBusy}
            onClick={() => void runInstall(updateHandle)}
            data-testid="update-welcome-install"
          >
            {isBusy ? (
              <RefreshCw className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <Download className="h-3.5 w-3.5" aria-hidden />
            )}
            {isBusy
              ? pick("Kuruluyor…", "Installing…")
              : pick("Şimdi Güncelle ve Yeniden Başlat", "Update & Restart Now")}
          </Button>
        </div>
      </div>
    </div>
  );
}
