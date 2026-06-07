"use client";

// Phase 7.5.G — In-app update check + install.
//
// The Tauri shell registers `tauri-plugin-updater` against a `latest.json`
// manifest hosted under our GitHub Releases. The flow:
//
//   1. User clicks "Güncelle" — we call `check()` from the plugin.
//   2. If the remote build is newer the plugin returns an `Update` handle
//      with `version` + release notes.
//   3. User confirms — we call `downloadAndInstall(progress)` which
//      streams progress events to the UI.
//   4. After install completes we call `relaunch()` from
//      `@tauri-apps/plugin-process` so the new binary takes over.
//
// Web builds render nothing — the updater plugin is Tauri-only and the
// auto-deploy path is GitHub Releases, not a cloud CDN.

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Download, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Switch } from "@/components/ui/Switch";
import { useToast } from "@/components/ui/Toast";
import { useLocalePick } from "@/i18n/IntlProvider";
import { isTauriEnv } from "@/lib/tauri/env";
import { usePrefs } from "@/stores/prefs";

// Narrow plugin surface. Lazy-loaded so the web bundle never pulls the
// updater module — same pattern as AutoLaunchSection's plugin shim.
interface UpdateHandle {
  version: string;
  body?: string | undefined;
  downloadAndInstall: (
    onEvent?: (progress: UpdateProgressEvent) => void,
  ) => Promise<void>;
}

type UpdateProgressEvent =
  | { event: "Started"; data: { contentLength?: number } }
  | { event: "Progress"; data: { chunkLength: number } }
  | { event: "Finished" };

interface UpdaterPluginApi {
  check: () => Promise<UpdateHandle | null>;
}

interface ProcessPluginApi {
  relaunch: () => Promise<void>;
}

async function getUpdaterPlugin(): Promise<UpdaterPluginApi> {
  const mod = (await import("@tauri-apps/plugin-updater")) as UpdaterPluginApi;
  return mod;
}

async function getProcessPlugin(): Promise<ProcessPluginApi> {
  const mod = (await import("@tauri-apps/plugin-process")) as ProcessPluginApi;
  return mod;
}

type Status =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "up-to-date" }
  | { kind: "available"; handle: UpdateHandle }
  | { kind: "downloading"; pct: number | null }
  | { kind: "installed" }
  | { kind: "error"; message: string };

export function UpdatesSection(): React.ReactElement | null {
  const t = useTranslations("updates");
  const { toast } = useToast();
  const pick = useLocalePick();
  const autoCheckUpdates = usePrefs((s) => s.autoCheckUpdates);
  const setAutoCheckUpdates = usePrefs((s) => s.setAutoCheckUpdates);
  const toastRef = useRef(toast);
  // Keep the latest toast in a ref for the post-relaunch async callback,
  // synced in an effect (updating a ref during render is disallowed).
  useEffect(() => {
    toastRef.current = toast;
  }, [toast]);

  const [status, setStatus] = useState<Status>({ kind: "idle" });

  useEffect(() => {
    // No auto-check on mount in v1 — user opt-in only. A future
    // sub-phase can add a "check on launch" preference.
  }, []);

  if (!isTauriEnv()) return null;

  async function handleCheck(): Promise<void> {
    setStatus({ kind: "checking" });
    try {
      const plugin = await getUpdaterPlugin();
      const handle = await plugin.check();
      if (handle === null) {
        setStatus({ kind: "up-to-date" });
        return;
      }
      setStatus({ kind: "available", handle });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus({ kind: "error", message });
    }
  }

  async function handleInstall(): Promise<void> {
    if (status.kind !== "available") return;
    const handle = status.handle;
    setStatus({ kind: "downloading", pct: null });
    let receivedBytes = 0;
    let totalBytes: number | null = null;
    try {
      await handle.downloadAndInstall((progress) => {
        if (progress.event === "Started") {
          totalBytes = progress.data.contentLength ?? null;
          setStatus({ kind: "downloading", pct: totalBytes ? 0 : null });
        } else if (progress.event === "Progress") {
          receivedBytes += progress.data.chunkLength;
          const pct =
            totalBytes && totalBytes > 0
              ? Math.min(100, Math.round((receivedBytes / totalBytes) * 100))
              : null;
          setStatus({ kind: "downloading", pct });
        }
      });
      setStatus({ kind: "installed" });
      toastRef.current({
        title: t("installed_toast"),
        description: t("installed_toast_description"),
        variant: "info",
      });
      const proc = await getProcessPlugin();
      await proc.relaunch();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus({ kind: "error", message });
    }
  }

  return (
    <section
      className="rounded-2xl border border-line bg-paper-soft p-5 shadow-sm"
      data-testid="updates-section"
    >
      <header className="flex items-start gap-3">
        <span
          className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent-wash text-accent-ink"
          aria-hidden
        >
          <RefreshCw size={18} strokeWidth={1.6} />
        </span>
        <div className="flex-1">
          <h2 className="text-sm font-semibold text-ink">{t("title")}</h2>
          <p className="mt-1 text-xs text-ink-soft">{t("description")}</p>
        </div>
      </header>

      <div className="mt-4 flex flex-col gap-3 rounded-xl border border-line/60 bg-paper px-4 py-3">
        <StatusLine status={status} t={t} />
        <ActionRow status={status} t={t} onCheck={handleCheck} onInstall={handleInstall} />
      </div>

      <label className="mt-3 flex items-start justify-between gap-3 rounded-xl border border-line/60 bg-paper px-4 py-3">
        <span className="min-w-0">
          <span className="block text-sm font-medium text-ink">
            {pick("Açılışta otomatik kontrol", "Auto-check on launch")}
          </span>
          <span className="mt-0.5 block text-xs text-ink-soft">
            {pick(
              "Uygulama açıldığında yeni sürüm var mı diye bakar; bulursa bildirir, otomatik kurmaz.",
              "On launch, checks GitHub Releases for a newer build; notifies you if found — never installs automatically.",
            )}
          </span>
        </span>
        <Switch
          checked={autoCheckUpdates}
          onCheckedChange={setAutoCheckUpdates}
          size="sm"
          ariaLabel={pick("Açılışta otomatik kontrol", "Auto-check on launch")}
        />
      </label>
    </section>
  );
}

function StatusLine({
  status,
  t,
}: {
  status: Status;
  t: ReturnType<typeof useTranslations>;
}): React.ReactElement {
  switch (status.kind) {
    case "idle":
      return (
        <p className="text-xs text-ink-soft">{t("status_idle")}</p>
      );
    case "checking":
      return (
        <p className="text-xs text-ink-soft">{t("status_checking")}</p>
      );
    case "up-to-date":
      return (
        <p className="text-xs text-ink-soft">{t("status_up_to_date")}</p>
      );
    case "available":
      return (
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium text-ink">
            {t("status_available", { version: status.handle.version })}
          </p>
          {status.handle.body !== undefined && status.handle.body.length > 0 ? (
            <p className="line-clamp-3 whitespace-pre-line text-xs text-ink-soft">
              {status.handle.body}
            </p>
          ) : null}
        </div>
      );
    case "downloading":
      return (
        <p className="text-xs text-ink-soft">
          {status.pct === null
            ? t("status_downloading_indeterminate")
            : t("status_downloading_pct", { pct: status.pct })}
        </p>
      );
    case "installed":
      return (
        <p className="text-xs text-ink-soft">{t("status_installed")}</p>
      );
    case "error":
      return (
        <p className="text-xs text-red-600">
          {t("status_error", { message: status.message })}
        </p>
      );
  }
}

function ActionRow({
  status,
  t,
  onCheck,
  onInstall,
}: {
  status: Status;
  t: ReturnType<typeof useTranslations>;
  onCheck: () => Promise<void>;
  onInstall: () => Promise<void>;
}): React.ReactElement {
  if (status.kind === "available") {
    return (
      <div className="flex items-center gap-2">
        <Button
          variant="primary"
          size="sm"
          onClick={() => void onInstall()}
          data-testid="updates-install"
        >
          <Download size={14} strokeWidth={1.8} />
          {t("install_action")}
        </Button>
      </div>
    );
  }
  if (status.kind === "downloading") {
    return (
      <Button variant="ghost" size="sm" disabled>
        {t("install_action_busy")}
      </Button>
    );
  }
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => void onCheck()}
      disabled={status.kind === "checking"}
      data-testid="updates-check"
    >
      <RefreshCw size={14} strokeWidth={1.8} />
      {t("check_action")}
    </Button>
  );
}
