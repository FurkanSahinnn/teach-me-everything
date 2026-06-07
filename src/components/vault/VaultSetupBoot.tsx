"use client";

// Phase 7.3 — First-launch trigger for the vault setup wizard. Only fires
// when (a) we're running inside Tauri, and (b) the user has never
// completed the wizard for this install. Mounted from the root layout so
// the prompt shows up regardless of which route the user lands on first.
//
// Web users never see this — `isTauriEnv()` returns false and the boot
// effect short-circuits.

import { useEffect, useState } from "react";
import { isTauriEnv } from "@/lib/tauri/env";
import { usePrefs } from "@/stores/prefs";
import { VaultSetupModal } from "./VaultSetupModal";

export function VaultSetupBoot() {
  const setupCompleted = usePrefs((s) => s.vault.setupCompleted);
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    if (!isTauriEnv()) return;
    if (setupCompleted) return;
    // Defer one tick so the persist middleware finishes rehydrating
    // before we read `setupCompleted`. Without it the wizard pops on
    // every cold boot before Zustand re-hydrates the v17 vault slice.
    const id = window.setTimeout(() => setOpen(true), 250);
    return () => window.clearTimeout(id);
  }, [mounted, setupCompleted]);

  if (!mounted) return null;
  return <VaultSetupModal open={open} onClose={() => setOpen(false)} />;
}
