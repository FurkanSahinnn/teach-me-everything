"use client";

// Phase 9 — master-password vault removed.
//
// First-run gate now relies solely on the `tme:setup-complete` localStorage
// flag (set by the wizard's DoneStep CTA + the "Atla → Kontrol paneli"
// link). Both runtime backends share the same flag:
//   - Tauri  → API keys live in the OS keychain; the flag is the only signal
//   - Web    → API keys live in plaintext Dexie; the flag is still the only
//     signal (the old `db.vault.get("master")` row no longer exists)
//
// Uses `router.replace` (not `push`) so the browser back button doesn't
// strand the user on a half-mounted landing page.

import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { isSetupComplete } from "@/lib/setup-completion";

export function FirstRunGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    try {
      if (cancelled) return;
      if (isSetupComplete()) {
        router.replace("/dashboard");
      } else {
        router.replace("/setup/1");
      }
    } catch {
      // If localStorage is unavailable (private mode, quota), fall through
      // to landing so the user isn't stuck on a blank screen.
      if (!cancelled) setReady(true);
    }
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (!ready) {
    return (
      <div className="grid min-h-[100dvh] place-items-center bg-paper text-ink-3">
        <div className="font-mono text-[11px] uppercase tracking-[0.14em]">
          …
        </div>
      </div>
    );
  }
  return <>{children}</>;
}
