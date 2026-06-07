"use client";

import {
  AlertTriangle,
  Download,
  HardDrive,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { useLocalePick } from "@/i18n/IntlProvider";
import type { TtsProviderId, TtsReadinessState } from "@/lib/podcast/adapter";
import {
  installVoice,
  type InstallProgress,
} from "@/lib/podcast/install";
import { PIPER_DEFAULT_VOICE_SIZE_BYTES } from "@/lib/podcast/adapters/piper";
import { evaluateProvider } from "@/lib/podcast/compatibility";
import { useSystemCheck } from "@/hooks/useSystemCheck";
import { CompatibilityChip } from "@/components/podcast/CompatibilityChip";

type Props = {
  open: boolean;
  providerId: TtsProviderId;
  readiness: TtsReadinessState | null;
  onClose: () => void;
  onInstalled: () => void;
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
}

export function InstallModelModal({
  open,
  providerId,
  readiness,
  onClose,
  onInstalled,
}: Props) {
  const pick = useLocalePick();
  const { toast } = useToast();
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState<InstallProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sys = useSystemCheck();
  const verdict = evaluateProvider(providerId, sys.system, sys.gpu);

  useEffect(() => {
    if (!open) {
      queueMicrotask(() => {
        setInstalling(false);
        setProgress(null);
        setError(null);
      });
    }
  }, [open]);

  if (!readiness) return null;

  const isMissingModel = readiness.kind === "missing-model";
  const isMissingBinary = readiness.kind === "missing-binary";
  const isNotSupported = readiness.kind === "not-supported-on-platform";

  const expectedSize =
    readiness.kind === "missing-model"
      ? readiness.sizeBytes ?? PIPER_DEFAULT_VOICE_SIZE_BYTES
      : PIPER_DEFAULT_VOICE_SIZE_BYTES;

  async function handleInstall() {
    if (readiness?.kind !== "missing-model") return;
    setInstalling(true);
    setError(null);
    try {
      await installVoice({
        provider: providerId,
        voiceId: readiness.modelId,
        onProgress: (p) => setProgress(p),
      });
      toast({
        variant: "success",
        description: pick("Ses modeli kuruldu.", "Voice model installed."),
      });
      onInstalled();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    } finally {
      setInstalling(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!installing) onClose();
      }}
      size="md"
      title={
        <span className="inline-flex items-center gap-2">
          <Download className="h-4 w-4" aria-hidden />
          {pick("Ses modeli gerekli", "Voice model required")}
        </span>
      }
      closeOnBackdrop={!installing}
    >
      <div className="space-y-5">
        {isMissingModel ? (
          <>
            <p className="text-[13px] leading-[1.6] text-ink-2">
              {pick(
                `Podcast oluşturmak için ses modeli gerekli. Yaklaşık ${formatBytes(expectedSize)} indirilecek.`,
                `A voice model is required to generate a podcast. About ${formatBytes(expectedSize)} will be downloaded.`,
              )}
            </p>

            <div className="rounded-[10px] border border-rule bg-paper-2 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3">
                    {pick("Model", "Model")}
                  </div>
                  <div className="mt-1 truncate font-mono text-[12px] text-ink">
                    {readiness.modelId}
                  </div>
                </div>
                <div className="shrink-0 rounded-[7px] border border-rule-soft bg-paper px-2 py-1 text-[11px] font-medium text-ink-2">
                  {formatBytes(expectedSize)}
                </div>
              </div>
            </div>

            {sys.state === "ready" || sys.state === "loading" ? (
              <div className="rounded-[10px] border border-rule bg-paper-2 p-3 text-[12.5px]">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className="grid h-7 w-7 shrink-0 place-items-center rounded-[8px] bg-paper text-ink-3"
                      aria-hidden
                    >
                      <HardDrive className="h-3.5 w-3.5" />
                    </span>
                    <span className="font-medium text-ink-2">
                      {pick("Sistem uyumluluğu", "System compatibility")}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={sys.refresh}
                    disabled={sys.state === "loading"}
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-[8px] border border-rule-soft bg-paper text-ink-3 transition-[background,color,border] hover:border-accent hover:bg-paper-3 hover:text-ink disabled:opacity-50"
                    aria-label={pick("Sistemi tekrar kontrol et", "Re-check system")}
                    title={pick("Sistemi tekrar kontrol et", "Re-check system")}
                  >
                    <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                  </button>
                </div>
                <div className="mt-2 pl-9">
                  {sys.state === "loading" ? (
                    <span className="inline-flex items-center gap-1.5 text-ink-3">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                      {pick("Kontrol ediliyor...", "Checking...")}
                    </span>
                  ) : (
                    <CompatibilityChip
                      verdict={verdict}
                      showReason={false}
                      size="sm"
                    />
                  )}
                </div>
              </div>
            ) : null}
          </>
        ) : null}

        {isMissingBinary ? (
          <div className="flex items-start gap-2 rounded-[8px] border border-rule bg-paper-2 px-3 py-2 text-[12.5px] text-ink-2">
            <AlertTriangle
              className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500"
              aria-hidden
            />
            <div>
              <div className="font-medium">
                {pick("Piper ikilisi bulunamadı.", "Piper binary not found.")}
              </div>
              <div className="mt-0.5 text-ink-3">
                {pick(
                  "Masaüstü uygulaması bu sürümde Piper ikilisi olmadan derlenmiş. README'deki kurulum adımlarını izleyin.",
                  "This build was packaged without the Piper sidecar binary. Follow the install steps in the README.",
                )}
              </div>
            </div>
          </div>
        ) : null}

        {isNotSupported ? (
          <div className="flex items-start gap-2 rounded-[8px] border border-rule bg-paper-2 px-3 py-2 text-[12.5px] text-ink-2">
            <AlertTriangle
              className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500"
              aria-hidden
            />
            <div>
              <div className="font-medium">
                {pick(
                  "Bu özellik yalnızca masaüstü uygulamasında kullanılabilir.",
                  "This feature is only available in the desktop app.",
                )}
              </div>
              <div className="mt-0.5 text-ink-3">{readiness.reason}</div>
            </div>
          </div>
        ) : null}

        {installing && progress ? (
          <div className="space-y-1.5 rounded-[10px] border border-rule bg-paper-2 p-3">
            <div className="flex items-center justify-between gap-3 text-[12px] text-ink-3">
              <span className="inline-flex items-center gap-1.5">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                {pick("İndiriliyor...", "Downloading...")}
              </span>
              <span className="shrink-0 font-mono">
                {formatBytes(progress.downloadedBytes)} /{" "}
                {formatBytes(progress.totalBytes)}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded bg-ink-5/40">
              <div
                className="h-full bg-accent transition-[width]"
                style={{
                  width: `${
                    progress.totalBytes === 0
                      ? 0
                      : (progress.downloadedBytes / progress.totalBytes) * 100
                  }%`,
                }}
              />
            </div>
          </div>
        ) : null}

        {error ? (
          <div className="rounded-[8px] border border-rule bg-paper-2 px-3 py-2 text-[12.5px] text-red-600">
            {error}
          </div>
        ) : null}

        <div className="flex flex-col-reverse gap-2 border-t border-rule-soft pt-4 sm:flex-row sm:justify-end">
          <Button
            variant="ghost"
            onClick={onClose}
            disabled={installing}
            className="sm:min-w-[92px]"
          >
            {pick("Kapat", "Close")}
          </Button>
          {isMissingModel ? (
            <Button
              variant="primary"
              onClick={() => void handleInstall()}
              disabled={installing}
              className="sm:min-w-[180px]"
            >
              <Download className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              {installing
                ? pick("İndiriliyor...", "Downloading...")
                : pick("Modeli indir", "Download model")}
            </Button>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}
