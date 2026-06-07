"use client";

// Silent on-launch update check (desktop only, opt-out via
// `prefs.autoCheckUpdates`). When a newer build exists it toasts a pointer to
// Settings → Updates; it NEVER auto-installs — the user triggers the download
// + relaunch themselves from UpdatesSection. Web builds and the updater being
// inactive are both no-ops.

import { useEffect, useRef } from "react";
import { useToast } from "@/components/ui/Toast";
import { useLocalePick } from "@/i18n/IntlProvider";
import { isTauriEnvWithOverride } from "@/lib/tauri/env";
import { usePrefs } from "@/stores/prefs";

interface UpdateHandle {
  version: string;
}
interface UpdaterPluginApi {
  check: () => Promise<UpdateHandle | null>;
}

// Lazy import so the web bundle never pulls the updater module.
async function getUpdaterPlugin(): Promise<UpdaterPluginApi> {
  const mod = (await import("@tauri-apps/plugin-updater")) as UpdaterPluginApi;
  return mod;
}

export function UpdateCheckMount(): null {
  const autoCheck = usePrefs((s) => s.autoCheckUpdates);
  const { toast } = useToast();
  const pick = useLocalePick();
  // Run exactly once per launch even under React StrictMode double-mount.
  const ran = useRef(false);

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
        toast({
          variant: "info",
          title: pick("Güncelleme mevcut", "Update available"),
          description: pick(
            `Yeni sürüm ${handle.version} hazır. Ayarlar → Güncellemeler'den kurabilirsin.`,
            `Version ${handle.version} is ready — install it from Settings → Updates.`,
          ),
        });
      } catch {
        // A failed background check must never interrupt the user.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [autoCheck, toast, pick]);

  return null;
}
