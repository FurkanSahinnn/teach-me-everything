"use client";

// Phase 7.5.B-tail — Page-level wiring of tray + menu events.
//
// `TrayMount`, `MenuMount`, and `DeepLinkMount` own the Tauri-side
// integration (each subscribes to a native event and re-dispatches it as
// a typed window CustomEvent). This component owns the React-side
// translation layer: it listens for those window events and routes each
// one to a concrete app action — navigation, create note, find-or-create
// today's daily note, open vault folder in the OS file browser, toggle
// the sidebar, open the command palette, route to settings.
//
// Two of the actions (sidebar collapse, palette open) live in stateful
// components further down the tree (`AppShell`, `Topbar`). We bridge
// them through secondary window events that the owning component
// subscribes to. That keeps each owner's state encapsulated while still
// letting the menu / tray drive it.
//
// Mounted unconditionally from the root layout: the tray / menu events
// only fire under Tauri, so on web this component is an inert listener.

import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";
import { useToast } from "@/components/ui/Toast";
import { createNote } from "@/lib/db/notes";
import { listWorkspaces } from "@/lib/db/workspaces";
import {
  findOrCreateDailyNote,
  formatDateForLocale,
  getDefaultDailyFolderName,
  getDefaultDailyTemplate,
  type DailyLocale,
} from "@/lib/notes/daily";
import { isTauriEnv } from "@/lib/tauri/env";
import { usePrefs } from "@/stores/prefs";
import {
  MENU_EVENT_NAME,
  type MenuActionEventDetail,
} from "@/components/tray/MenuMount";
import {
  TRAY_EVENT_NAME,
  type TrayMenuEventDetail,
} from "@/components/tray/TrayMount";

// Secondary window events owned by `AppShell` (sidebar toggle) and
// `Topbar` (command palette). Page-level wiring dispatches these; the
// owning component subscribes and flips its local state.
export const SIDEBAR_TOGGLE_EVENT = "tme:sidebar:toggle" as const;
export const PALETTE_OPEN_EVENT = "tme:palette:open" as const;

// Resolve the workspace id the user is currently "in" by parsing the
// URL (/w/<id>/...). When we're outside a workspace (dashboard, root,
// settings), fall back to the most recently updated workspace so menu
// actions still work — surfacing a toast prompt rather than silently
// failing.
async function resolveWorkspaceId(
  pathname: string | null,
): Promise<string | null> {
  if (pathname) {
    const match = /^\/w\/([^/]+)/.exec(pathname);
    if (match && match[1] && match[1] !== "_") return match[1];
  }
  try {
    const all = await listWorkspaces({ includeArchived: false });
    return all[0]?.id ?? null;
  } catch {
    return null;
  }
}

// Lazy-import the opener plugin so the web bundle never tries to
// resolve the Tauri-only module at startup. Caller gates on
// `isTauriEnv()`; on web this throws synchronously and the caller
// surfaces a toast.
type OpenerPlugin = { openPath: (path: string) => Promise<void> };

async function openVaultInOs(rootPath: string): Promise<void> {
  if (!isTauriEnv()) {
    throw new Error("openVaultInOs called outside Tauri runtime");
  }
  const mod = (await import("@tauri-apps/plugin-opener")) as OpenerPlugin;
  await mod.openPath(rootPath);
}

export function EventBridgeMount(): null {
  const router = useRouter();
  const pathname = usePathname();
  const { toast } = useToast();
  const t = useTranslations("bridge");

  // Ref-stabilize the closures so an `IntlProvider` / `ToastProvider`
  // re-render doesn't tear down the window-event subscriptions. Same
  // pattern as `DeepLinkMount` + `VaultReconcilerProvider`.
  const toastRef = useRef(toast);
  const tRef = useRef(t);
  const routerRef = useRef(router);
  const pathnameRef = useRef(pathname);
  toastRef.current = toast;
  tRef.current = t;
  routerRef.current = router;
  pathnameRef.current = pathname;

  useEffect(() => {
    async function handleNewNote(): Promise<void> {
      const wsId = await resolveWorkspaceId(pathnameRef.current);
      if (!wsId) {
        toastRef.current({
          title: tRef.current("no_workspace_title"),
          description: tRef.current("no_workspace_description"),
          variant: "warn",
        });
        return;
      }
      try {
        const created = await createNote({ workspaceId: wsId });
        routerRef.current.push(`/w/${wsId}/notes?id=${created.id}`);
      } catch {
        toastRef.current({
          title: tRef.current("create_note_failed"),
          variant: "error",
        });
      }
    }

    async function handleToday(): Promise<void> {
      const wsId = await resolveWorkspaceId(pathnameRef.current);
      if (!wsId) {
        toastRef.current({
          title: tRef.current("no_workspace_title"),
          description: tRef.current("no_workspace_description"),
          variant: "warn",
        });
        return;
      }
      try {
        const prefs = usePrefs.getState();
        const dailyLocale: DailyLocale =
          prefs.locale === "tr" ? "tr" : "en";
        const folderName =
          prefs.notesUi.dailyFolderName.trim().length > 0
            ? prefs.notesUi.dailyFolderName
            : getDefaultDailyFolderName(dailyLocale);
        const template =
          prefs.notesUi.dailyTemplate.trim().length > 0
            ? prefs.notesUi.dailyTemplate
            : getDefaultDailyTemplate(dailyLocale);
        const dateString = formatDateForLocale(new Date(), dailyLocale);
        const { note } = await findOrCreateDailyNote({
          workspaceId: wsId,
          folderName,
          dateString,
          template,
          locale: dailyLocale,
        });
        routerRef.current.push(`/w/${wsId}/notes?id=${note.id}`);
      } catch {
        toastRef.current({
          title: tRef.current("daily_failed"),
          variant: "error",
        });
      }
    }

    async function handleOpenVault(): Promise<void> {
      const rootPath = usePrefs.getState().vault.rootPath;
      if (!rootPath) {
        toastRef.current({
          title: tRef.current("no_vault_title"),
          description: tRef.current("no_vault_description"),
          variant: "warn",
        });
        return;
      }
      try {
        await openVaultInOs(rootPath);
      } catch {
        toastRef.current({
          title: tRef.current("open_vault_failed"),
          description: rootPath,
          variant: "error",
        });
      }
    }

    function handleSettings(): void {
      routerRef.current.push("/settings");
    }

    function handleToggleSidebar(): void {
      window.dispatchEvent(new CustomEvent(SIDEBAR_TOGGLE_EVENT));
    }

    function handlePalette(): void {
      window.dispatchEvent(new CustomEvent(PALETTE_OPEN_EVENT));
    }

    function onTray(event: Event): void {
      const detail = (event as CustomEvent<TrayMenuEventDetail>).detail;
      if (!detail) return;
      switch (detail.menuId) {
        case "new-note":
          void handleNewNote();
          break;
        case "today":
          void handleToday();
          break;
        case "open-vault":
          void handleOpenVault();
          break;
      }
    }

    function onMenu(event: Event): void {
      const detail = (event as CustomEvent<MenuActionEventDetail>).detail;
      if (!detail) return;
      switch (detail.actionId) {
        case "new-note":
          void handleNewNote();
          break;
        case "today":
          void handleToday();
          break;
        case "settings":
          handleSettings();
          break;
        case "toggle-sidebar":
          handleToggleSidebar();
          break;
        case "palette":
          handlePalette();
          break;
      }
    }

    window.addEventListener(TRAY_EVENT_NAME, onTray);
    window.addEventListener(MENU_EVENT_NAME, onMenu);
    return () => {
      window.removeEventListener(TRAY_EVENT_NAME, onTray);
      window.removeEventListener(MENU_EVENT_NAME, onMenu);
    };
  }, []);

  return null;
}
