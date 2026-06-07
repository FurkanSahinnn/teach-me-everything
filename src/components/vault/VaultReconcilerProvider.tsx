"use client";

// Phase 7.4.D — Mounts the two-way vault reconciler for the focused
// workspace. Single active subscription; swaps on workspace change.
//
// Mount sites: workspace layout (`/w/[id]/layout.tsx`) so the watcher
// only runs while the user is actively in that workspace. Web users
// never see this — `isTauriEnv()` short-circuits the effect and no
// Tauri plugin is loaded.
//
// `getPolicy` reads `usePrefs.getState()` synchronously per-event so a
// Settings change is picked up without restarting the watcher. That
// also keeps the effect deps stable (re-running on every policy
// keystroke would tear down + recreate the watcher, which loses
// in-flight reconciliation).
//
// Phase 7.4.G — added cross-process `.tme-lock` acquire on mount, undo
// button on conflict-dexie-wins toast, and a Tauri-only
// `window.__tmeVaultReconciler` devtools handle.

import { useEffect, useMemo, useRef } from "react";
import { useTranslations } from "next-intl";
import { useToast } from "@/components/ui/Toast";
import { isTauriEnv } from "@/lib/tauri/env";
import { usePrefs } from "@/stores/prefs";
import {
  dispatchVaultReconciler,
  type VaultReconcilerHandle,
} from "@/lib/vault/reconcile-dispatch";
import type { ReconcileAction } from "@/lib/vault/reconcile";
import type { VaultWatchEvent } from "@/lib/vault/watcher";
import {
  acquireVaultProcessLock,
  type AcquireLockResult,
} from "@/lib/vault/process-lock";

declare global {
  interface Window {
    __tmeVaultReconciler?: {
      triggerEvent: VaultReconcilerHandle["triggerEvent"];
      rebuildIndex: VaultReconcilerHandle["rebuildIndex"];
      undoConflict: VaultReconcilerHandle["undoConflict"];
    };
  }
}

export type VaultReconcilerProviderProps = {
  workspaceId: string | null | undefined;
};

export function VaultReconcilerProvider({
  workspaceId,
}: VaultReconcilerProviderProps) {
  const rootPath = usePrefs((s) => s.vault.rootPath);
  const autoSync = usePrefs((s) => s.vault.autoSync);
  const setupCompleted = usePrefs((s) => s.vault.setupCompleted);
  const { toast } = useToast();
  const t = useTranslations("vault_sync.reconcile");
  const tLock = useTranslations("vault_sync.process_lock");

  // Capture the latest toast translator + dispatcher in refs so the
  // effect deps stay minimal — only workspaceId, rootPath, autoSync,
  // setupCompleted should re-mount the watcher. A new `toast` or `t`
  // identity from the IntlProvider re-render must not.
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const tRef = useRef(t);
  tRef.current = t;
  const tLockRef = useRef(tLock);
  tLockRef.current = tLock;

  const enabled = useMemo(() => {
    if (!isTauriEnv()) return false;
    if (!setupCompleted) return false;
    if (rootPath === null || rootPath.length === 0) return false;
    if (!autoSync) return false;
    if (workspaceId === null || workspaceId === undefined) return false;
    if (workspaceId.length === 0 || workspaceId === "_") return false;
    return true;
  }, [autoSync, rootPath, setupCompleted, workspaceId]);

  useEffect(() => {
    if (!enabled || rootPath === null || workspaceId == null) return;
    let handle: VaultReconcilerHandle | null = null;
    let lockRelease: (() => Promise<void>) | null = null;
    let cancelled = false;

    const renderConflictToast = (
      event: VaultWatchEvent,
      action: Extract<ReconcileAction, { kind: "conflict-dexie-wins" }>,
    ): void => {
      const tx = tRef.current;
      const show = toastRef.current;
      const eventPath = event.path;
      const { noteId, diskContent } = action;
      show({
        title: tx("conflict_dexie_won"),
        variant: "warn",
        action: {
          label: tx("conflict_dexie_won_undo_label"),
          onClick: () => {
            const current = handle;
            if (current === null) return;
            void current
              .undoConflict({ noteId, path: eventPath, diskContent })
              .then(
                () => {
                  toastRef.current({
                    title: tRef.current("conflict_undo_toast"),
                    variant: "success",
                  });
                },
                (err: unknown) => {
                  const msg = err instanceof Error ? err.message : String(err);
                  toastRef.current({
                    title: tRef.current("error_toast", { message: msg }),
                    variant: "error",
                  });
                },
              );
          },
        },
      });
    };

    const onAction = (event: VaultWatchEvent, action: ReconcileAction): void => {
      const tx = tRef.current;
      const show = toastRef.current;
      switch (action.kind) {
        case "import-new":
          show({ title: tx("imported_new"), variant: "info" });
          return;
        case "import-update":
          show({ title: tx("updated_from_disk"), variant: "info" });
          return;
        case "delete-note":
          show({ title: tx("deleted_from_disk"), variant: "warn" });
          return;
        case "conflict-dexie-wins":
          renderConflictToast(event, action);
          return;
        case "rename":
          show({ title: tx("renamed_on_disk"), variant: "info" });
          return;
        case "noop":
        case "skip-hash-match":
          return;
      }
    };

    const onError = (_e: VaultWatchEvent, err: unknown): void => {
      const tx = tRef.current;
      const show = toastRef.current;
      const msg = err instanceof Error ? err.message : String(err);
      show({ title: tx("error_toast", { message: msg }), variant: "error" });
    };

    const mountDispatcher = async (): Promise<void> => {
      if (cancelled) return;
      const h = await dispatchVaultReconciler({
        workspaceId,
        vaultRoot: rootPath,
        getPolicy: () => usePrefs.getState().vault.conflictPolicy,
        onAction,
        onError,
      });
      if (cancelled) {
        void h.stop();
        return;
      }
      handle = h;
      // Expose a devtools handle for live QA — Tauri-only since the
      // effect itself is gated by `isTauriEnv()`. Replaced on workspace
      // swap; cleared on cleanup.
      window.__tmeVaultReconciler = {
        triggerEvent: h.triggerEvent,
        rebuildIndex: h.rebuildIndex,
        undoConflict: h.undoConflict,
      };
    };

    const startWithLock = async (
      forceFromHeld?: AcquireLockResult,
    ): Promise<void> => {
      let acquired: AcquireLockResult;
      try {
        acquired = forceFromHeld ?? (await acquireVaultProcessLock(rootPath));
      } catch (err) {
        // Lock acquire IO failure — surface as a sync error but don't
        // mount the dispatcher; the user can re-pick the vault or
        // restart the app to retry.
        const msg = err instanceof Error ? err.message : String(err);
        toastRef.current({
          title: tRef.current("error_toast", { message: msg }),
          variant: "error",
        });
        return;
      }
      if (cancelled) {
        if (acquired.kind === "acquired") void acquired.release();
        return;
      }
      if (acquired.kind === "held") {
        const tx = tLockRef.current;
        toastRef.current({
          title: tx("held_title"),
          description: tx("held_body"),
          variant: "warn",
          duration: 0,
          action: {
            label: tx("steal_button"),
            onClick: () => {
              void acquired.force().then(
                (next) => startWithLock(next),
                (err: unknown) => {
                  const msg = err instanceof Error ? err.message : String(err);
                  toastRef.current({
                    title: tRef.current("error_toast", { message: msg }),
                    variant: "error",
                  });
                },
              );
            },
          },
        });
        return;
      }
      lockRelease = acquired.release;
      await mountDispatcher();
    };

    void startWithLock();

    return () => {
      cancelled = true;
      if (typeof window !== "undefined") {
        delete window.__tmeVaultReconciler;
      }
      if (handle) void handle.stop();
      if (lockRelease) void lockRelease();
    };
  }, [enabled, rootPath, workspaceId]);

  return null;
}
