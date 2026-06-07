"use client";

// Phase 7.3 — Settings → Tercihler card for the filesystem vault. Shows
// the current path, lets the user re-open the wizard to change it, run a
// one-shot full re-export, toggle auto-sync, or disable the vault
// entirely. Web users see a "desktop app only" notice instead of the
// controls (the underlying fs adapter throws on web).

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
// next-intl namespace for the shared cancel/etc strings.
import { HardDrive, FolderOpen, RefreshCw, Power } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Switch } from "@/components/ui/Switch";
import { useToast } from "@/components/ui/Toast";
import { Modal } from "@/components/ui/Modal";
import { VaultSetupModal } from "@/components/vault/VaultSetupModal";
import { usePrefs } from "@/stores/prefs";
import { isTauriEnv } from "@/lib/tauri/env";
import { exportVault } from "@/lib/vault/export";
import { listWorkspaces } from "@/lib/db/workspaces";
import {
  CONFLICT_POLICIES,
  type ConflictPolicy,
} from "@/lib/vault/conflict-policy";

export function VaultSection() {
  const t = useTranslations("vault_sync");
  const tVault = useTranslations("vault");
  const { toast } = useToast();
  const vault = usePrefs((s) => s.vault);
  const setVaultAutoSync = usePrefs((s) => s.setVaultAutoSync);
  const setVaultConflictPolicy = usePrefs((s) => s.setVaultConflictPolicy);
  const resetVault = usePrefs((s) => s.resetVault);

  const [wizardOpen, setWizardOpen] = useState(false);
  const [confirmDisableOpen, setConfirmDisableOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  // Server-render safe: hide controls until we know whether we're in Tauri.
  // Avoids a flash of "desktop app only" notice during hydration in dev mode
  // when the user is actually inside the Tauri webview.
  const inTauri = mounted ? isTauriEnv() : false;

  const onReexport = useCallback(async () => {
    if (!vault.rootPath) return;
    setBusy(true);
    try {
      const workspaces = await listWorkspaces({ includeArchived: false });
      let totalWritten = 0;
      const failed: string[] = [];
      for (const ws of workspaces) {
        const result = await exportVault({
          workspaceId: ws.id,
          vaultRoot: vault.rootPath,
        });
        totalWritten += result.notesWritten;
        if (result.errors.length > 0) {
          failed.push(...result.errors.map((e) => e.noteTitle));
        }
      }
      if (failed.length > 0) {
        toast({
          title: t("export_partial_toast", {
            success: totalWritten,
            total: totalWritten + failed.length,
            failed: failed.length,
          }),
          variant: "warn",
        });
      } else {
        toast({
          title: t("export_success_toast", {
            count: totalWritten,
            path: vault.rootPath,
          }),
          variant: "success",
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast({ title: t("export_failure_toast", { message }), variant: "error" });
    } finally {
      setBusy(false);
    }
  }, [t, toast, vault.rootPath]);

  const onConfirmDisable = useCallback(() => {
    resetVault();
    setConfirmDisableOpen(false);
    toast({ title: t("settings_status_disabled"), variant: "info" });
  }, [resetVault, t, toast]);

  return (
    <Card padding="md" variant="default">
      <div className="flex items-start gap-3">
        <span
          className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border border-rule bg-paper-2 text-accent"
          aria-hidden
        >
          <HardDrive className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-[15px] font-semibold leading-tight text-ink">
              {t("settings_section_title")}
            </h3>
            {inTauri ? (
              <span
                data-testid="vault-status"
                className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                  vault.rootPath
                    ? "bg-success/15 text-success"
                    : "bg-paper-3 text-ink-soft"
                }`}
              >
                {vault.rootPath
                  ? t("settings_status_active")
                  : t("settings_status_disabled")}
              </span>
            ) : null}
          </div>
          <p className="mt-1 max-w-[60ch] text-[13px] leading-6 text-ink-3">
            {t("settings_section_description")}
          </p>

          {!inTauri ? (
            <div className="mt-4 rounded-md border border-rule bg-paper-2 px-3 py-2 text-[13px] text-ink-soft">
              {t("settings_web_disabled_notice")}
            </div>
          ) : (
            <>
              <div className="mt-4">
                <div className="text-[12.5px] font-medium text-ink-soft">
                  {t("settings_path_label")}
                </div>
                <code
                  data-testid="vault-current-path"
                  className="mt-1 block break-all rounded-md bg-paper-2 px-2 py-1.5 text-[12.5px]"
                >
                  {vault.rootPath ?? t("settings_path_empty")}
                </code>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  variant={vault.rootPath ? "ghost" : "primary"}
                  size="sm"
                  onClick={() => setWizardOpen(true)}
                  data-testid="vault-open-wizard"
                >
                  <FolderOpen className="size-4" aria-hidden="true" />
                  {vault.rootPath
                    ? t("settings_change_button")
                    : t("settings_setup_button")}
                </Button>
                {vault.rootPath ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={onReexport}
                    loading={busy}
                    disabled={busy}
                    data-testid="vault-reexport"
                  >
                    <RefreshCw className="size-4" aria-hidden="true" />
                    {busy
                      ? t("settings_resync_busy")
                      : t("settings_resync_button")}
                  </Button>
                ) : null}
                {vault.rootPath ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setConfirmDisableOpen(true)}
                    data-testid="vault-disable"
                  >
                    <Power className="size-4" aria-hidden="true" />
                    {t("settings_disable_button")}
                  </Button>
                ) : null}
              </div>

              {vault.rootPath ? (
                <div className="mt-5 flex items-start justify-between gap-4 rounded-md border border-rule bg-paper-2 px-3 py-2.5">
                  <div className="min-w-0">
                    <div className="text-[13.5px] font-medium text-ink">
                      {t("settings_autosync_label")}
                    </div>
                    <div className="mt-0.5 text-[12px] leading-snug text-ink-soft">
                      {t("settings_autosync_description")}
                    </div>
                  </div>
                  <Switch
                    checked={vault.autoSync}
                    onCheckedChange={setVaultAutoSync}
                    ariaLabel={t("settings_autosync_label")}
                  />
                </div>
              ) : null}

              {vault.rootPath ? (
                <fieldset
                  className="mt-4 rounded-md border border-rule bg-paper-2 px-3 py-2.5"
                  data-testid="vault-policy-group"
                >
                  <legend className="px-1 text-[13.5px] font-medium text-ink">
                    {t("settings_policy_label")}
                  </legend>
                  <p className="mb-2 mt-0.5 text-[12px] leading-snug text-ink-soft">
                    {t("settings_policy_description")}
                  </p>
                  <div className="flex flex-col gap-2">
                    {CONFLICT_POLICIES.map((policy) => {
                      const selected = vault.conflictPolicy === policy;
                      const labelKey = `policy_${policy.replace(/-/g, "_")}` as const;
                      const descKey =
                        `policy_${policy.replace(/-/g, "_")}_description` as const;
                      return (
                        <label
                          key={policy}
                          className={`flex cursor-pointer items-start gap-2.5 rounded-md border px-2.5 py-2 transition-colors ${
                            selected
                              ? "border-accent bg-accent/8"
                              : "border-rule bg-paper hover:bg-paper-3"
                          }`}
                        >
                          <input
                            type="radio"
                            name="vault-conflict-policy"
                            value={policy}
                            checked={selected}
                            onChange={() =>
                              setVaultConflictPolicy(policy as ConflictPolicy)
                            }
                            className="mt-0.5 accent-accent"
                            data-testid={`vault-policy-${policy}`}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="text-[13px] font-medium text-ink">
                              {t(labelKey)}
                            </div>
                            <div className="mt-0.5 text-[12px] leading-snug text-ink-soft">
                              {t(descKey)}
                            </div>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
              ) : null}
            </>
          )}
        </div>
      </div>

      <VaultSetupModal open={wizardOpen} onClose={() => setWizardOpen(false)} />
      <Modal
        open={confirmDisableOpen}
        onClose={() => setConfirmDisableOpen(false)}
        size="sm"
        title={t("settings_disable_confirm_title")}
        description={t("settings_disable_confirm_body")}
        footer={
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => setConfirmDisableOpen(false)}
            >
              {tVault("iptal")}
            </Button>
            <Button
              variant="danger"
              onClick={onConfirmDisable}
              data-testid="vault-disable-confirm"
            >
              {t("settings_disable_confirm_yes")}
            </Button>
          </div>
        }
      />
    </Card>
  );
}
