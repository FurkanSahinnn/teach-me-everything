"use client";

// Phase 7.5.D — Native menu bar ⇄ webview bridge.
//
// The Rust shell builds the OS-level application menu (visible in the
// macOS menu bar / Windows title bar) with custom items that emit
// `tme://menu` events. This component subscribes and re-dispatches each
// event as a typed window CustomEvent so pages can opt-in to specific
// keyboard shortcuts (Cmd+N → new note, Cmd+, → settings, Cmd+B →
// toggle sidebar, …) without knowing anything about Tauri.
//
// As with TrayMount, page-level handlers (e.g. wiring Cmd+N to the
// notes-page create flow) land in follow-up sub-phases.

import { useEffect } from "react";
import { isTauriEnv } from "@/lib/tauri/env";

// Stable ids of the custom menu items. Mirrors the routed match arms in
// lib.rs `build_app_menu`. Predefined items (quit, copy, paste, etc.) are
// handled natively and do NOT round-trip through this listener.
export type MenuActionId =
  | "new-note"
  | "today"
  | "settings"
  | "toggle-sidebar"
  | "palette";

export interface MenuActionEventDetail {
  actionId: MenuActionId;
}

export const MENU_EVENT_NAME = "tme:menu" as const;

function isKnownAction(value: string): value is MenuActionId {
  return (
    value === "new-note" ||
    value === "today" ||
    value === "settings" ||
    value === "toggle-sidebar" ||
    value === "palette"
  );
}

export function MenuMount(): null {
  useEffect(() => {
    if (!isTauriEnv()) return;

    let cancelled = false;
    let unlisten: (() => void) | null = null;

    void (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        const handle = await listen<string>("tme://menu", (event) => {
          const payload = event.payload;
          if (typeof payload !== "string") return;
          if (!isKnownAction(payload)) return;
          const detail: MenuActionEventDetail = { actionId: payload };
          window.dispatchEvent(
            new CustomEvent<MenuActionEventDetail>(MENU_EVENT_NAME, {
              detail,
            }),
          );
        });
        if (cancelled) {
          handle();
          return;
        }
        unlisten = handle;
      } catch (err) {
        console.warn("[MenuMount] Failed to subscribe to menu events", err);
      }
    })();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  return null;
}
