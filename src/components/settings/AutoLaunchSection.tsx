"use client";

// Phase 7.5.E — Auto-launch toggle.
//
// The Tauri shell registers `tauri-plugin-autostart` so the JS side can
// toggle the OS-level "open at startup" hook (LaunchAgent on macOS,
// `Run` registry key on Windows, .desktop autostart on Linux). The OS is
// the single source of truth: we never persist this in prefs because
// users can disable it from system settings without TME being open, and
// re-mirroring on every render would race with that path.
//
// On non-Tauri builds the section renders nothing. The web app cannot
// run at OS startup so the toggle would be misleading.

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Power } from "lucide-react";
import { Switch } from "@/components/ui/Switch";
import { useToast } from "@/components/ui/Toast";
import { isTauriEnv } from "@/lib/tauri/env";

// Mirrors the surface we use from the plugin. Lazy-loaded so the web
// bundle never pulls the module and the test surface stays narrow.
interface AutostartPluginApi {
  enable: () => Promise<void>;
  disable: () => Promise<void>;
  isEnabled: () => Promise<boolean>;
}

let pluginCache: AutostartPluginApi | null = null;

async function getAutostartPlugin(): Promise<AutostartPluginApi> {
  if (pluginCache) return pluginCache;
  const mod = (await import(
    "@tauri-apps/plugin-autostart"
  )) as AutostartPluginApi;
  pluginCache = mod;
  return mod;
}

export function AutoLaunchSection(): React.ReactElement | null {
  const t = useTranslations("auto_launch");
  const { toast } = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;

  // `null` = "loading", `true | false` = "synced with OS state". Render
  // a disabled placeholder during the load so a fast user can't toggle a
  // value we haven't fetched yet (would race the enable() / disable()).
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isTauriEnv()) return;
    let cancelled = false;
    void (async () => {
      try {
        const plugin = await getAutostartPlugin();
        const current = await plugin.isEnabled();
        if (!cancelled) setEnabled(current);
      } catch (err) {
        if (!cancelled) {
          console.warn("[AutoLaunchSection] isEnabled failed", err);
          setEnabled(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!isTauriEnv()) return null;

  async function handleToggle(next: boolean): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      const plugin = await getAutostartPlugin();
      if (next) {
        await plugin.enable();
      } else {
        await plugin.disable();
      }
      // Re-read the OS state so a partial-failure (e.g. user denied a
      // permission prompt) settles to the truth instead of the optimistic
      // value the Switch is about to render.
      const verified = await plugin.isEnabled();
      setEnabled(verified);
      toastRef.current({
        title: verified ? t("enabled_toast") : t("disabled_toast"),
        variant: "info",
      });
    } catch (err) {
      console.warn("[AutoLaunchSection] toggle failed", err);
      toastRef.current({
        title: t("error_toast"),
        description: err instanceof Error ? err.message : String(err),
        variant: "warn",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="rounded-2xl border border-line bg-paper-soft p-5 shadow-sm"
      data-testid="auto-launch-section"
    >
      <header className="flex items-start gap-3">
        <span
          className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent-wash text-accent-ink"
          aria-hidden
        >
          <Power size={18} strokeWidth={1.6} />
        </span>
        <div className="flex-1">
          <h2 className="text-sm font-semibold text-ink">{t("title")}</h2>
          <p className="mt-1 text-xs text-ink-soft">{t("description")}</p>
        </div>
      </header>
      <div className="mt-4 flex items-center justify-between gap-4 rounded-xl border border-line/60 bg-paper px-4 py-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink">{t("toggle_label")}</p>
          <p className="mt-0.5 text-xs text-ink-soft">
            {enabled === null
              ? t("loading_state")
              : enabled
                ? t("currently_on")
                : t("currently_off")}
          </p>
        </div>
        <Switch
          checked={enabled === true}
          disabled={enabled === null || busy}
          onCheckedChange={(next) => {
            void handleToggle(next);
          }}
          ariaLabel={t("toggle_aria")}
        />
      </div>
    </section>
  );
}
