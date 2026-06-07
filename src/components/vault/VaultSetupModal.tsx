"use client";

// Phase 7.3 — Filesystem vault setup wizard. Tauri-only (the wrapping
// boot effect in `layout.tsx` only mounts this when `isTauriEnv()`).
// Three primary paths:
//   1) Use default — `~/Documents/TeachMeEverything` (recommended CTA).
//   2) Custom — opens the native directory picker via plugin-dialog.
//   3) Later — sets `vaultSetupCompleted = true` without a rootPath
//      (escape hatch; Settings → Vault can finish setup any time).
//
// On macOS we surface a one-screen "the system will now ask for
// permission" hand-off so a confused user doesn't deny the prompt and
// then wonder why exports fail silently.
//
// Cloud-sync detection is advisory — the user can still continue, but
// they see exactly which folder triggered the warning (Dropbox, iCloud,
// OneDrive, etc.).

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Apple, FolderOpen, HardDrive, MoonStar } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { usePrefs } from "@/stores/prefs";
import { VAULT_DEFAULT_FOLDER_NAME } from "@/lib/vault/paths";
import {
  mkdirRecursive,
  openDirectoryDialog,
  resolveDefaultVaultPath,
} from "@/lib/vault/fs-adapter";
import { detectCloudSyncFolder } from "@/lib/vault/cloud-detect";

type Step = "choose" | "cloud-warning" | "macos-permission" | "complete";

type Props = {
  open: boolean;
  onClose: () => void;
  /** Override the platform detection — primarily for unit tests / Settings. */
  forceMacOsPermissionStep?: boolean;
};

function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  const platform =
    (navigator as Navigator & { userAgentData?: { platform?: string } })
      .userAgentData?.platform ?? navigator.platform;
  return /mac/i.test(platform ?? "");
}

export function VaultSetupModal({
  open,
  onClose,
  forceMacOsPermissionStep,
}: Props) {
  const t = useTranslations("vault_sync");
  const setVaultRootPath = usePrefs((s) => s.setVaultRootPath);
  const setVaultSetupCompleted = usePrefs((s) => s.setVaultSetupCompleted);
  const { toast } = useToast();

  const [step, setStep] = useState<Step>("choose");
  const [defaultPath, setDefaultPath] = useState<string | null>(null);
  const [defaultError, setDefaultError] = useState(false);
  const [pickedPath, setPickedPath] = useState<string | null>(null);
  const [cloudHint, setCloudHint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Resolve the default vault path once when the modal opens. The Tauri
  // path module isn't available pre-mount, so we defer to the effect.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setStep("choose");
    setDefaultError(false);
    resolveDefaultVaultPath(VAULT_DEFAULT_FOLDER_NAME)
      .then((p) => {
        if (cancelled) return;
        setDefaultPath(p);
      })
      .catch(() => {
        if (cancelled) return;
        setDefaultError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const finalize = useCallback(
    async (path: string | null) => {
      // Ensure the directory actually exists on disk before persisting.
      // The "Use default" branch computes a path like
      // `~/Documents/TeachMeEverything` without touching the filesystem,
      // and the custom branch's `openDirectoryDialog` only guarantees
      // existence at pick time (user could delete it before confirming
      // on the cloud-warning / macOS-permission step). `mkdirRecursive`
      // is idempotent — already-exists is a no-op. Failure here is
      // non-fatal; the reconciler will retry mkdir on first sync.
      if (path !== null) {
        try {
          await mkdirRecursive(path);
        } catch {
          // swallow — process-lock acquire will surface a clearer error
        }
      }
      setVaultRootPath(path);
      setVaultSetupCompleted(true);
      onClose();
    },
    [onClose, setVaultRootPath, setVaultSetupCompleted],
  );

  const commitPath = useCallback(
    (path: string) => {
      const detection = detectCloudSyncFolder(path);
      if (detection.detected) {
        setPickedPath(path);
        setCloudHint(detection.hint);
        setStep("cloud-warning");
        return;
      }
      if (forceMacOsPermissionStep ?? isMacPlatform()) {
        setPickedPath(path);
        setStep("macos-permission");
        return;
      }
      finalize(path);
    },
    [finalize, forceMacOsPermissionStep],
  );

  const onUseDefault = useCallback(() => {
    if (!defaultPath) return;
    commitPath(defaultPath);
  }, [commitPath, defaultPath]);

  const onCustom = useCallback(async () => {
    setBusy(true);
    try {
      const picked = await openDirectoryDialog({
        ...(defaultPath ? { defaultPath } : {}),
        title: t("custom_title"),
      });
      if (!picked) {
        toast({ title: t("dialog_canceled_toast"), variant: "info" });
        return;
      }
      commitPath(picked);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast({
        title: t("export_failure_toast", { message }),
        variant: "error",
      });
    } finally {
      setBusy(false);
    }
  }, [commitPath, defaultPath, t, toast]);

  const onLater = useCallback(() => {
    finalize(null);
  }, [finalize]);

  const onCloudContinue = useCallback(() => {
    if (!pickedPath) return;
    if (forceMacOsPermissionStep ?? isMacPlatform()) {
      setStep("macos-permission");
      return;
    }
    finalize(pickedPath);
  }, [finalize, forceMacOsPermissionStep, pickedPath]);

  const onCloudChooseAgain = useCallback(() => {
    setPickedPath(null);
    setCloudHint(null);
    setStep("choose");
  }, []);

  const onMacOsOk = useCallback(() => {
    if (!pickedPath) return;
    finalize(pickedPath);
  }, [finalize, pickedPath]);

  const defaultPathLabel = useMemo(() => {
    if (defaultError) return t("default_path_unavailable");
    if (!defaultPath) return t("default_resolving");
    return t("default_description", { path: defaultPath });
  }, [defaultError, defaultPath, t]);

  if (step === "cloud-warning") {
    return (
      <Modal
        open={open}
        onClose={onClose}
        size="md"
        title={t("cloud_warning_title")}
        description={t("cloud_warning_body", { hint: cloudHint ?? "" })}
        footer={
          <div className="flex flex-wrap gap-2 justify-end">
            <Button variant="ghost" onClick={onCloudChooseAgain}>
              {t("cloud_warning_choose_again")}
            </Button>
            <Button variant="primary" onClick={onCloudContinue}>
              {t("cloud_warning_continue")}
            </Button>
          </div>
        }
      >
        <div className="px-5 py-4 text-[13px] text-ink-soft">
          <code
            data-testid="vault-cloud-warning-path"
            className="break-all rounded-md bg-paper-2 px-2 py-1 text-[12px]"
          >
            {pickedPath}
          </code>
        </div>
      </Modal>
    );
  }

  if (step === "macos-permission") {
    return (
      <Modal
        open={open}
        onClose={onClose}
        size="md"
        title={t("macos_permission_title")}
        description={t("macos_permission_body")}
        footer={
          <div className="flex justify-end">
            <Button variant="primary" onClick={onMacOsOk}>
              {t("macos_permission_understood")}
            </Button>
          </div>
        }
      >
        <div className="px-5 py-4 text-[13px] text-ink-soft flex items-center gap-2">
          <Apple className="size-5" aria-hidden="true" />
          <code
            data-testid="vault-macos-path"
            className="break-all rounded-md bg-paper-2 px-2 py-1 text-[12px]"
          >
            {pickedPath}
          </code>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={t("wizard_title")}
      description={t("wizard_description")}
      closeOnBackdrop={false}
      closeOnEsc={false}
    >
      <div className="flex flex-col gap-3 px-5 py-4">
        <ChoiceCard
          icon={<HardDrive className="size-5" aria-hidden="true" />}
          title={t("default_title")}
          description={defaultPathLabel}
          onClick={onUseDefault}
          disabled={!defaultPath || defaultError}
          recommended
          testId="vault-choice-default"
        />
        <ChoiceCard
          icon={<FolderOpen className="size-5" aria-hidden="true" />}
          title={t("custom_title")}
          description={t("custom_description")}
          onClick={onCustom}
          disabled={busy}
          testId="vault-choice-custom"
        />
        <ChoiceCard
          icon={<MoonStar className="size-5" aria-hidden="true" />}
          title={t("later_title")}
          description={t("later_description")}
          onClick={onLater}
          testId="vault-choice-later"
        />
      </div>
    </Modal>
  );
}

type ChoiceCardProps = {
  icon: React.ReactNode;
  title: string;
  description: string;
  onClick: () => void;
  disabled?: boolean;
  recommended?: boolean;
  testId?: string;
};

function ChoiceCard({
  icon,
  title,
  description,
  onClick,
  disabled,
  recommended,
  testId,
}: ChoiceCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      className={`
        group flex w-full items-start gap-3 rounded-[var(--radius-md)]
        border border-rule bg-paper-2 px-4 py-3 text-left
        transition-colors duration-150
        hover:bg-paper-3 hover:border-accent
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent
        disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-paper-2 disabled:hover:border-rule
        ${recommended ? "ring-1 ring-accent/40" : ""}
      `}
    >
      <span
        aria-hidden="true"
        className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-paper border border-rule text-accent"
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="text-[14px] font-semibold text-ink">{title}</span>
          {recommended ? (
            <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-accent">
              ★
            </span>
          ) : null}
        </span>
        <span className="mt-1 block text-[12.5px] leading-snug text-ink-soft break-words">
          {description}
        </span>
      </span>
    </button>
  );
}
