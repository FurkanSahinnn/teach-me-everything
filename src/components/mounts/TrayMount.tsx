"use client";

// Phase 7.5.B — System tray ⇄ webview bridge.
//
// Subscribes to the Rust-side `tme://tray/menu` event (emitted whenever
// the user clicks one of the routed tray menu items: "new-note", "today",
// "open-vault") and re-dispatches it as a typed window CustomEvent so the
// rest of the React tree can opt-in without knowing anything about Tauri.
//
// The `show` / `quit` menu items are handled natively in lib.rs and never
// reach this listener. Everything else round-trips through here.
//
// Page-level handlers (e.g. /w/[id]/notes wiring "new-note" to its
// "create note" intent) land in follow-up sub-phases; this component
// guarantees the foundation works the moment the tray is built.

import { useEffect } from "react";
import { isTauriEnv } from "@/lib/tauri/env";

// Stable id of the menu item that fired. Matches the ids in lib.rs.
export type TrayMenuId = "new-note" | "today" | "open-vault";

export interface TrayMenuEventDetail {
  menuId: TrayMenuId;
}

export const TRAY_EVENT_NAME = "tme:tray:menu" as const;

function isKnownMenuId(value: string): value is TrayMenuId {
  return value === "new-note" || value === "today" || value === "open-vault";
}

export function TrayMount(): null {
  useEffect(() => {
    if (!isTauriEnv()) return;

    let cancelled = false;
    let unlisten: (() => void) | null = null;

    void (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        const handle = await listen<string>("tme://tray/menu", (event) => {
          const payload = event.payload;
          if (typeof payload !== "string") return;
          if (!isKnownMenuId(payload)) return;
          const detail: TrayMenuEventDetail = { menuId: payload };
          window.dispatchEvent(
            new CustomEvent<TrayMenuEventDetail>(TRAY_EVENT_NAME, { detail }),
          );
        });
        if (cancelled) {
          handle();
          return;
        }
        unlisten = handle;
      } catch (err) {
        // The Tauri runtime should always expose the event module when
        // isTauriEnv() is true. A failure here is a real misconfig; log
        // for triage but never throw — the rest of the app keeps working.
        console.warn("[TrayMount] Failed to subscribe to tray events", err);
      }
    })();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  return null;
}
