"use client";

// Phase 11.B — React hook over the system probe.
//
// State machine:
//
//   idle           — fresh mount, probe hasn't started
//   loading        — probe in flight
//   ready          — system + gpu resolved (system may be `null` if the
//                    probe failed gracefully — surfaces as red verdict
//                    in the compatibility evaluator)
//   not-supported  — web build, no Tauri runtime
//   error          — both probes threw before resolving
//
// A module-level promise cache deduplicates parallel mounts so all
// callers share one Rust roundtrip per `refresh()`. The cache is
// invalidated by `refresh()` and never automatically — the underlying
// hardware doesn't change at runtime, so a single boot-time probe is
// enough for the chip.

import { useCallback, useEffect, useState } from "react";
import { isTauriEnvWithOverride } from "@/lib/tauri/env";
import {
  getGpuInfo,
  getSysInfo,
  type GpuInfo,
  type SysInfo,
} from "@/lib/tauri/sysinfo";

export type SystemCheckState =
  | "idle"
  | "loading"
  | "ready"
  | "not-supported"
  | "error";

export type SystemCheckResult = {
  state: SystemCheckState;
  system: SysInfo | null;
  gpu: GpuInfo | null;
  error: string | null;
  refresh: () => void;
};

type CacheEntry = {
  system: SysInfo | null;
  gpu: GpuInfo | null;
};

let cached: CacheEntry | null = null;
let inFlight: Promise<CacheEntry> | null = null;

function invalidateCache(): void {
  cached = null;
  inFlight = null;
}

async function probeNow(): Promise<CacheEntry> {
  // Run both probes in parallel — they're independent and the GPU probe
  // shells out to a platform command which can take ~150ms on cold cache.
  const [system, gpu] = await Promise.all([getSysInfo(), getGpuInfo()]);
  return { system, gpu };
}

/**
 * Probe the user's system once per session and surface RAM / CPU / disk
 * / GPU info to the compatibility chip. On the web build resolves
 * instantly to `not-supported`.
 *
 * Caller pattern:
 *
 *   const sys = useSystemCheck();
 *   if (sys.state === "loading") return <Spinner />;
 *   if (sys.state === "not-supported") return <DesktopOnlyNotice />;
 *   const verdict = evaluateProvider("piper", sys.system, sys.gpu);
 */
export function useSystemCheck(): SystemCheckResult {
  const [state, setState] = useState<SystemCheckState>(() =>
    cached ? "ready" : "idle",
  );
  const [system, setSystem] = useState<SysInfo | null>(cached?.system ?? null);
  const [gpu, setGpu] = useState<GpuInfo | null>(cached?.gpu ?? null);
  const [error, setError] = useState<string | null>(null);

  const runProbe = useCallback(async () => {
    if (!isTauriEnvWithOverride()) {
      setState("not-supported");
      setSystem(null);
      setGpu(null);
      setError(null);
      return;
    }
    setState("loading");
    setError(null);
    try {
      if (!inFlight) {
        inFlight = probeNow().then((entry) => {
          cached = entry;
          inFlight = null;
          return entry;
        });
      }
      const entry = await inFlight;
      setSystem(entry.system);
      setGpu(entry.gpu);
      setState("ready");
    } catch (err) {
      inFlight = null;
      setError(err instanceof Error ? err.message : String(err));
      setState("error");
    }
  }, []);

  const refresh = useCallback(() => {
    invalidateCache();
    void runProbe();
  }, [runProbe]);

  useEffect(() => {
    if (cached) {
      setSystem(cached.system);
      setGpu(cached.gpu);
      setState("ready");
      return;
    }
    void runProbe();
  }, [runProbe]);

  return { state, system, gpu, error, refresh };
}

// Test seam — Vitest resets the module-level cache between cases so each
// test sees a clean slate. Production callers never need this.
export function _resetSystemCheckCacheForTests(): void {
  invalidateCache();
}
