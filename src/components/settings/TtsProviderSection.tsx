"use client";

// Phase 11.C — Settings → Modeller → 🔊 TTS panel.
//
// Surfaces three things in one card:
//   1. Active provider dropdown (writes prefs.ttsProvider) with the
//      provider's CompatibilityChip rendered beside it.
//   2. "Kurulu Modeller" — voices already on disk for the active provider,
//      each with a smoke-test (▶) and a delete (🗑) button.
//   3. "Yüklenebilir Modeller" — provider catalog minus what's installed,
//      with an install button that pipes through the existing
//      `installVoice` Rust command (same code path as the JIT modal).
//
// Web build renders a "desktop-only" notice instead of the actionable lists
// because installVoice/deleteVoice short-circuit to `not_supported` there.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Download,
  FolderOpen,
  Headphones,
  Loader2,
  Play,
  RefreshCw,
  Square,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { useToast } from "@/components/ui/Toast";
import { useLocalePick } from "@/i18n/IntlProvider";
import { usePrefs } from "@/stores/prefs";
import { CompatibilityChip } from "@/components/podcast/CompatibilityChip";
import { useSystemCheck } from "@/hooks/useSystemCheck";
import { evaluateProvider } from "@/lib/podcast/compatibility";
import {
  getAdapter,
  type TtsProviderId,
} from "@/lib/podcast/adapter";
import {
  getAvailableVoices,
  getInstalledDiskUsageBytes,
  getInstalledVoiceCatalog,
  type InstalledVoiceRef,
  type VoicePickerEntry,
} from "@/lib/podcast/voices";
import {
  deleteVoice,
  installVoice,
  listInstalledVoices,
  type InstallProgress,
  type InstalledVoice,
} from "@/lib/podcast/install";
import { runTtsSmokeTest } from "@/lib/podcast/smoke-test";
import { PIPER_DEFAULT_VOICE_SIZE_BYTES } from "@/lib/podcast/adapters/piper";
import { isTauriEnvWithOverride } from "@/lib/tauri/env";

type ProviderMeta = {
  id: TtsProviderId;
  label: { tr: string; en: string };
  blurb: { tr: string; en: string };
};

// Order intentionally surfaces local-first defaults at the top; heavier
// providers sit below so users land on the cheap option by default.
const PROVIDER_META: ProviderMeta[] = [
  {
    id: "piper",
    label: { tr: "Piper", en: "Piper" },
    blurb: {
      tr: "Yerel · CPU · ~63 MB başına ses · Varsayılan",
      en: "Local · CPU · ~63 MB per voice · Default",
    },
  },
  {
    id: "web-speech",
    label: { tr: "Web Speech", en: "Web Speech" },
    blurb: {
      tr: "Tarayıcı yedeği · Kayıt desteklenmez",
      en: "Browser fallback · Recording not supported",
    },
  },
  {
    id: "kokoro",
    label: { tr: "Kokoro", en: "Kokoro" },
    blurb: {
      tr: "Yerel · CPU · Deneysel (Faz 11.D)",
      en: "Local · CPU · Experimental (Phase 11.D)",
    },
  },
  {
    id: "xtts",
    label: { tr: "XTTS", en: "XTTS" },
    blurb: {
      tr: "Yerel · GPU önerilir · Deneysel (Faz 11.D)",
      en: "Local · GPU recommended · Experimental (Phase 11.D)",
    },
  },
  {
    id: "vibevoice",
    label: { tr: "VibeVoice", en: "VibeVoice" },
    blurb: {
      tr: "Yerel · GPU şart · Deneysel (Faz 11.D)",
      en: "Local · GPU required · Experimental (Phase 11.D)",
    },
  },
];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function TtsProviderSection(): React.ReactElement {
  const pick = useLocalePick();
  const { toast } = useToast();
  const toastRef = useRef(toast);

  const ttsProvider = usePrefs((s) => s.ttsProvider);
  const setTtsProvider = usePrefs((s) => s.setTtsProvider);

  const sys = useSystemCheck();
  const verdict = useMemo(
    () => evaluateProvider(ttsProvider, sys.system, sys.gpu),
    [ttsProvider, sys.system, sys.gpu],
  );

  const isTauri = isTauriEnvWithOverride();

  const [installed, setInstalled] = useState<InstalledVoice[]>([]);
  const [installedLoading, setInstalledLoading] = useState(true);
  // Per-voice state: install progress, deleting, playing
  const [installing, setInstalling] = useState<Record<string, InstallProgress>>(
    {},
  );
  const [deleting, setDeleting] = useState<Record<string, true>>({});
  const [playing, setPlaying] = useState<string | null>(null);
  const playerRef = useRef<{ audio: HTMLAudioElement; url: string } | null>(
    null,
  );

  useEffect(() => {
    toastRef.current = toast;
  }, [toast]);

  const stopActivePlayback = useCallback((): void => {
    const p = playerRef.current;
    if (!p) return;
    try {
      p.audio.pause();
    } catch {
      /* ignore */
    }
    URL.revokeObjectURL(p.url);
    playerRef.current = null;
  }, []);

  const refreshInstalled = useCallback(async (): Promise<void> => {
    setInstalledLoading(true);
    try {
      const next = await listInstalledVoices();
      setInstalled(next);
    } catch (err) {
      console.warn("[TtsProviderSection] listInstalledVoices failed", err);
      setInstalled([]);
    } finally {
      setInstalledLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isTauri) {
      queueMicrotask(() => setInstalledLoading(false));
      return;
    }
    queueMicrotask(() => {
      void refreshInstalled();
    });
  }, [isTauri, refreshInstalled]);

  // Tear down any active sample audio when the section unmounts or when
  // the user switches providers mid-playback.
  useEffect(() => {
    return () => {
      stopActivePlayback();
    };
  }, [stopActivePlayback]);
  useEffect(() => {
    stopActivePlayback();
    queueMicrotask(() => setPlaying(null));
  }, [stopActivePlayback, ttsProvider]);

  const installedRefs: InstalledVoiceRef[] = useMemo(
    () => installed.map((v) => ({ provider: v.provider, voiceId: v.voiceId, sizeBytes: v.sizeBytes })),
    [installed],
  );

  const catalogRows = useMemo(
    () => getInstalledVoiceCatalog(ttsProvider, installedRefs),
    [ttsProvider, installedRefs],
  );
  const availableRows = useMemo(
    () => getAvailableVoices(ttsProvider, installedRefs),
    [ttsProvider, installedRefs],
  );
  const diskBytes = useMemo(
    () => getInstalledDiskUsageBytes(ttsProvider, installedRefs),
    [ttsProvider, installedRefs],
  );

  async function handleSmokeTest(voice: VoicePickerEntry): Promise<void> {
    const key = `${ttsProvider}/${voice.voiceId}`;
    // If the same row is already playing, stop it (toggle behaviour).
    if (playing === key) {
      stopActivePlayback();
      setPlaying(null);
      return;
    }
    stopActivePlayback();
    setPlaying(key);
    try {
      const adapter = getAdapter(ttsProvider);
      const result = await runTtsSmokeTest({ adapter, voice });
      const blob = new Blob([result.audio], { type: result.mimeType });
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      playerRef.current = { audio, url };
      audio.addEventListener("ended", () => {
        if (playerRef.current?.audio === audio) {
          URL.revokeObjectURL(url);
          playerRef.current = null;
        }
        setPlaying((cur) => (cur === key ? null : cur));
      });
      audio.addEventListener("error", () => {
        if (playerRef.current?.audio === audio) {
          URL.revokeObjectURL(url);
          playerRef.current = null;
        }
        setPlaying((cur) => (cur === key ? null : cur));
        toastRef.current({
          variant: "warn",
          title: pick("Örnek oynatılamadı", "Sample playback failed"),
        });
      });
      await audio.play();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setPlaying(null);
      toastRef.current({
        variant: "warn",
        title: pick("Test başarısız", "Test failed"),
        description: message,
      });
    }
  }

  async function handleInstall(voice: VoicePickerEntry): Promise<void> {
    const key = `${ttsProvider}/${voice.voiceId}`;
    if (installing[key]) return;
    setInstalling((p) => ({
      ...p,
      [key]: { voiceId: voice.voiceId, downloadedBytes: 0, totalBytes: 0 },
    }));
    try {
      await installVoice({
        provider: ttsProvider,
        voiceId: voice.voiceId,
        onProgress: (progress) => {
          setInstalling((p) =>
            p[key] ? { ...p, [key]: progress } : p,
          );
        },
      });
      toastRef.current({
        variant: "success",
        title: pick("Ses modeli kuruldu", "Voice model installed"),
        description: voice.name,
      });
      await refreshInstalled();
      toastRef.current({
        variant: "info",
        title: pick("Ses testi başlatılıyor", "Starting voice smoke test"),
        description: voice.name,
      });
      await handleSmokeTest(voice);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toastRef.current({
        variant: "warn",
        title: pick("Kurulum başarısız", "Install failed"),
        description: message,
      });
    } finally {
      setInstalling((p) => {
        const next = { ...p };
        delete next[key];
        return next;
      });
    }
  }

  async function handleDelete(voice: VoicePickerEntry): Promise<void> {
    const key = `${ttsProvider}/${voice.voiceId}`;
    if (deleting[key]) return;
    // No second confirmation here — clicking the trash icon IS the
    // explicit intent. Tauri's webview blocks `window.confirm()` and the
    // plugin-dialog `confirm()` permission has been unreliable in
    // practice. A successful delete surfaces a toast immediately below;
    // a mis-click is recoverable with one re-install click.
    setDeleting((p) => ({ ...p, [key]: true }));
    try {
      // Stop sample playback if we're deleting the voice that's currently
      // playing — Audio with a revoked blob URL throws on the renderer.
      if (playing === key) {
        stopActivePlayback();
        setPlaying(null);
      }
      await deleteVoice({ provider: ttsProvider, voiceId: voice.voiceId });
      toastRef.current({
        variant: "info",
        title: pick("Ses silindi", "Voice deleted"),
      });
      await refreshInstalled();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toastRef.current({
        variant: "warn",
        title: pick("Silme başarısız", "Delete failed"),
        description: message,
      });
    } finally {
      setDeleting((p) => {
        const next = { ...p };
        delete next[key];
        return next;
      });
    }
  }

  async function handleOpenModelsFolder(): Promise<void> {
    if (!isTauri) return;
    try {
      const [{ appDataDir, join }, { openPath }] = await Promise.all([
        import("@tauri-apps/api/path"),
        import("@tauri-apps/plugin-opener"),
      ]);
      const root = await appDataDir();
      const dir = await join(root, "tts-models");
      await openPath(dir);
    } catch (err) {
      toastRef.current({
        variant: "warn",
        title: pick("Klasör açılamadı", "Could not open folder"),
        description: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return (
    <section
      className="rounded-2xl border border-line bg-paper-soft p-5 shadow-sm"
      data-testid="tts-provider-section"
    >
      <header className="flex items-start gap-3">
        <span
          className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent-wash text-accent-ink"
          aria-hidden
        >
          <Headphones size={18} strokeWidth={1.6} />
        </span>
        <div className="flex-1">
          <h2 className="text-sm font-semibold text-ink">
            {pick("Konuşma sentezi (TTS)", "Text-to-speech (TTS)")}
          </h2>
          <p className="mt-1 text-xs text-ink-soft">
            {pick(
              "Podcast üretiminin hangi yerel motoru kullanacağını seç. Modeller talep üzerine indirilir; sadece kullandıkların indirilir.",
              "Pick the local engine that drives podcast synthesis. Models download on demand; only what you use lands on disk.",
            )}
          </p>
        </div>
      </header>

      {/* Provider dropdown + compatibility chip */}
      <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-center">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-ink-soft">
            {pick("Aktif sağlayıcı", "Active provider")}
          </span>
          <select
            value={ttsProvider}
            onChange={(e) => setTtsProvider(e.target.value as TtsProviderId)}
            className="h-9 rounded-[8px] border border-rule bg-paper px-2.5 text-[13px] text-ink outline-none focus:border-accent"
            aria-label={pick("TTS sağlayıcı seç", "Select TTS provider")}
          >
            {PROVIDER_META.map((p) => (
              <option key={p.id} value={p.id}>
                {pick(p.label.tr, p.label.en)}
              </option>
            ))}
          </select>
          <span className="text-[11px] text-ink-3">
            {pick(
              PROVIDER_META.find((p) => p.id === ttsProvider)?.blurb.tr ?? "",
              PROVIDER_META.find((p) => p.id === ttsProvider)?.blurb.en ?? "",
            )}
          </span>
        </label>
        <div className="flex items-center gap-2">
          <CompatibilityChip verdict={verdict} showReason size="sm" />
          {sys.state === "ready" || sys.state === "not-supported" ? null : (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => sys.refresh()}
              aria-label={pick("Sistemi yeniden tara", "Rescan system")}
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      {!isTauri ? (
        <div className="mt-5 rounded-[10px] border border-rule bg-paper p-3 text-[12px] text-ink-3">
          <span className="inline-flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5 text-warn" aria-hidden />
            {pick(
              "Model yönetimi yalnızca masaüstü uygulamasında kullanılabilir. Tarayıcıda yalnızca Web Speech yedeği çalışır.",
              "Model management is desktop-only. The browser build can only use the Web Speech fallback.",
            )}
          </span>
        </div>
      ) : null}

      {/* Installed list */}
      <div className="mt-6">
        <div className="mb-2 flex items-baseline justify-between">
          <h3 className="text-[13px] font-semibold text-ink">
            {pick("Kurulu modeller", "Installed models")}
          </h3>
          <span className="text-[11px] text-ink-3">
            {catalogRows.length > 0
              ? pick(
                  `${catalogRows.length} ses · ${formatBytes(diskBytes)}`,
                  `${catalogRows.length} voices · ${formatBytes(diskBytes)}`,
                )
              : null}
          </span>
        </div>
        {installedLoading ? (
          <div className="flex h-14 items-center justify-center rounded-[8px] border border-rule bg-paper text-[12px] text-ink-3">
            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
            {pick("Yükleniyor…", "Loading…")}
          </div>
        ) : catalogRows.length === 0 ? (
          <div className="rounded-[8px] border border-dashed border-rule bg-paper px-3 py-4 text-center text-[12px] text-ink-3">
            {pick(
              "Henüz kurulu ses yok. Aşağıdan bir model seç ve indir.",
              "No installed voices yet. Pick a model below and install it.",
            )}
          </div>
        ) : (
          <ul className="space-y-2">
            {catalogRows.map((v) => {
              const key = `${ttsProvider}/${v.voiceId}`;
              const isPlaying = playing === key;
              const isDeletingNow = deleting[key] === true;
              return (
                <li
                  key={v.voiceId}
                  className="flex items-center gap-3 rounded-[10px] border border-rule bg-paper px-3 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-[13px] font-medium text-ink">
                        {v.name}
                      </span>
                      <Chip size="sm" variant="muted">
                        {v.speaker === "alev"
                          ? pick("Alev", "Alev")
                          : pick("Deniz", "Deniz")}
                      </Chip>
                      <Chip size="sm" variant="default">
                        {v.nativeLocale.toUpperCase()}
                      </Chip>
                      {v.isCustom ? (
                        <Chip size="sm" variant="warn">
                          {pick("Özel", "Custom")}
                        </Chip>
                      ) : null}
                    </div>
                    <div className="mt-0.5 truncate text-[11px] text-ink-3">
                      {pick(v.description.tr, v.description.en)} ·{" "}
                      <span className="font-mono">{v.voiceId}</span> ·{" "}
                      {formatBytes(v.sizeBytes)}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void handleSmokeTest(v)}
                      aria-label={pick("Örneği oynat", "Play sample")}
                      title={pick("Örneği oynat", "Play sample")}
                    >
                      {isPlaying ? (
                        <Square className="h-3.5 w-3.5" />
                      ) : (
                        <Play className="h-3.5 w-3.5" />
                      )}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void handleDelete(v)}
                      disabled={isDeletingNow}
                      aria-label={pick("Sesi sil", "Delete voice")}
                      title={pick("Sesi sil", "Delete voice")}
                    >
                      {isDeletingNow ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Available list */}
      {availableRows.length > 0 && isTauri ? (
        <div className="mt-6">
          <h3 className="mb-2 text-[13px] font-semibold text-ink">
            {pick("Yüklenebilir modeller", "Available models")}
          </h3>
          <ul className="space-y-2">
            {availableRows.map((v) => {
              const key = `${ttsProvider}/${v.voiceId}`;
              const progress = installing[key];
              const isInstalling = progress !== undefined;
              const pct =
                progress && progress.totalBytes > 0
                  ? Math.round(
                      (progress.downloadedBytes / progress.totalBytes) * 100,
                    )
                  : null;
              return (
                <li
                  key={v.voiceId}
                  className="rounded-[10px] border border-rule bg-paper px-3 py-2.5"
                >
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-[13px] font-medium text-ink">
                          {v.name}
                        </span>
                        <Chip size="sm" variant="muted">
                          {v.speaker === "alev"
                            ? pick("Alev", "Alev")
                            : pick("Deniz", "Deniz")}
                        </Chip>
                        <Chip size="sm" variant="default">
                          {v.nativeLocale.toUpperCase()}
                        </Chip>
                      </div>
                      <div className="mt-0.5 truncate text-[11px] text-ink-3">
                        {pick(v.description.tr, v.description.en)} ·{" "}
                        <span className="font-mono">{v.voiceId}</span> · ~
                        {formatBytes(PIPER_DEFAULT_VOICE_SIZE_BYTES)}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void handleInstall(v)}
                      disabled={isInstalling}
                      aria-label={pick("Sesi indir", "Install voice")}
                      title={pick("Sesi indir", "Install voice")}
                    >
                      {isInstalling ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Download className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </div>
                  {isInstalling ? (
                    <div className="mt-2 space-y-1">
                      <div className="flex items-center justify-between text-[11px] text-ink-3">
                        <span>
                          {pick("İndiriliyor…", "Downloading…")}
                          {pct !== null ? ` ${pct}%` : ""}
                        </span>
                        <span className="font-mono">
                          {formatBytes(progress.downloadedBytes)}
                          {progress.totalBytes > 0
                            ? ` / ${formatBytes(progress.totalBytes)}`
                            : ""}
                        </span>
                      </div>
                      <div className="h-1 overflow-hidden rounded bg-ink-5/40">
                        <div
                          className="h-full bg-accent transition-[width]"
                          style={{
                            width:
                              pct !== null
                                ? `${pct}%`
                                : progress.downloadedBytes > 0
                                  ? "5%"
                                  : "0%",
                          }}
                        />
                      </div>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {isTauri ? (
        <div className="mt-5 flex items-center justify-end gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void refreshInstalled()}
          >
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            {pick("Yenile", "Refresh")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void handleOpenModelsFolder()}
          >
            <FolderOpen className="mr-1.5 h-3.5 w-3.5" />
            {pick("Klasörü aç", "Open folder")}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
