"use client";

// Phase 7.5.C — File association bridge.
//
// When the user double-clicks an `.md` file in the OS file manager, the
// Tauri shell either:
//   - (macOS) receives the path through `RunEvent::Opened` and emits
//     `tme://open-file` with the resolved absolute path.
//   - (Win / Linux) reads the path from `std::env::args()` at startup and
//     emits the same event.
//
// This component subscribes to that event and re-dispatches it as a typed
// window CustomEvent so the rest of the React tree can opt-in to a real
// import flow in a follow-up sub-phase. For v1 we also surface a
// confirmation toast so the user knows TME received the request — without
// it the OS-level association is invisible (the window just appears).
//
// Actual file ingestion (read → parse → import into the active workspace
// vault → navigate to the new note) is deferred to a 7.5.C-tail
// follow-up; the contract here is just "the event reaches React".

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { isTauriEnv } from "@/lib/tauri/env";
import { useToast } from "@/components/ui/Toast";

export const OPEN_FILE_EVENT_NAME = "tme:open-file" as const;

export interface OpenFileEventDetail {
  path: string;
}

function basename(p: string): string {
  // POSIX + Windows separators both folded so an OS-agnostic basename
  // works whether the Rust side normalised the path or not.
  const lastWin = p.split("\\").pop() ?? p;
  return lastWin.split("/").pop() ?? lastWin;
}

export function DeepLinkMount(): null {
  const { toast } = useToast();
  const t = useTranslations();
  const toastRef = useRef(toast);
  const tRef = useRef(t);
  // Refs keep the latest closures available to the listener without
  // forcing the effect to tear down whenever IntlProvider or
  // ToastProvider re-renders (same pattern as VaultReconcilerProvider).
  toastRef.current = toast;
  tRef.current = t;

  useEffect(() => {
    if (!isTauriEnv()) return;

    let cancelled = false;
    let unlisten: (() => void) | null = null;

    void (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        const handle = await listen<string>("tme://open-file", (event) => {
          if (typeof event.payload !== "string") return;
          const path = event.payload;
          const detail: OpenFileEventDetail = { path };
          window.dispatchEvent(
            new CustomEvent<OpenFileEventDetail>(OPEN_FILE_EVENT_NAME, {
              detail,
            }),
          );
          toastRef.current({
            title: tRef.current("deep_link.opened_title"),
            description: basename(path),
            variant: "info",
          });
        });
        if (cancelled) {
          handle();
          return;
        }
        unlisten = handle;
      } catch (err) {
        console.warn(
          "[DeepLinkMount] Failed to subscribe to open-file events",
          err,
        );
      }
    })();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  return null;
}
