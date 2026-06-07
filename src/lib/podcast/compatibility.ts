// Phase 11.B — TTS provider compatibility heuristic.
//
// Pure module. Given a provider's hardware requirements and a system
// probe result (from `lib/tauri/sysinfo.ts`), returns a `green | yellow
// | red` verdict the UI can render as a chip. No I/O, no Tauri, no
// React — just data → verdict.
//
// Verdict semantics:
//
//   green  — every requirement met with margin. "Should run smoothly."
//   yellow — minimum requirements met but tight, or a GPU is only
//            *recommended* and the user lacks one. "Should work but
//            slow / lower quality."
//   red    — a hard requirement is missing (insufficient RAM, GPU
//            required but absent, system unknown, web build).
//
// We never promise "guaranteed success" — driver / runtime issues won't
// show up in a hardware probe. The chip copy reflects that uncertainty
// ("muhtemelen çalışır" / "should run smoothly") rather than committing.

import type { TtsProviderId } from "./adapter";
import type { GpuInfo, SysInfo } from "@/lib/tauri/sysinfo";

export type GpuRequirement = "none" | "recommended" | "required";

export type ModelRequirements = {
  minRamBytes: number;
  diskBytes: number;
  gpu: GpuRequirement;
};

export type CompatibilityLevel = "green" | "yellow" | "red";

export type CompatibilityReasonKey =
  | "ok"
  | "tight_ram"
  | "insufficient_ram"
  | "insufficient_disk"
  | "no_gpu_recommended"
  | "no_gpu_required"
  | "unknown_system"
  | "web_unsupported";

export type CompatibilityVerdict = {
  level: CompatibilityLevel;
  reasonKey: CompatibilityReasonKey;
  /**
   * Numeric values the i18n template can format. Shape is intentionally
   * a Record so the UI layer can `pick(reasonKey, args)` without
   * branching per reason.
   */
  reasonArgs: Record<string, number>;
};

const GB = 1024 * 1024 * 1024;
const MB = 1024 * 1024;

// Per-provider hardware requirements. Numbers come from Phase 11 plan
// doc's "Provider Matrix" — keep these in lockstep with the matrix when
// new providers ship.
export const PROVIDER_REQUIREMENTS: Record<TtsProviderId, ModelRequirements> = {
  piper: {
    minRamBytes: 200 * MB,
    diskBytes: 70 * MB,
    gpu: "none",
  },
  "web-speech": {
    minRamBytes: 0,
    diskBytes: 0,
    gpu: "none",
  },
  kokoro: {
    minRamBytes: 500 * MB,
    diskBytes: 100 * MB,
    gpu: "none",
  },
  xtts: {
    minRamBytes: 4 * GB,
    diskBytes: 2 * GB,
    gpu: "recommended",
  },
  vibevoice: {
    minRamBytes: 8 * GB,
    diskBytes: 3 * GB,
    gpu: "required",
  },
};

/**
 * Evaluate whether a provider can run on the user's system.
 *
 * - `system === null` → red `unknown_system` (the web build, or a Tauri
 *   probe failure). Callers can override the copy to "desktop-only" or
 *   "probe failed" depending on which they intended.
 * - `gpu === null` is treated as "GPU presence unknown" — for `required`
 *   providers we conservatively return red; for `recommended` providers
 *   we return yellow so the user is warned but not blocked.
 */
export function evaluateCompatibility(
  req: ModelRequirements,
  system: SysInfo | null,
  gpu: GpuInfo | null,
): CompatibilityVerdict {
  if (system === null) {
    return {
      level: "red",
      reasonKey: "unknown_system",
      reasonArgs: {},
    };
  }

  // Hard requirements first — failing any of these is red.
  if (system.totalRamBytes < req.minRamBytes) {
    return {
      level: "red",
      reasonKey: "insufficient_ram",
      reasonArgs: {
        currentGb: round1(system.totalRamBytes / GB),
        requiredGb: round1(req.minRamBytes / GB),
      },
    };
  }

  if (system.freeDiskBytes < req.diskBytes) {
    return {
      level: "red",
      reasonKey: "insufficient_disk",
      reasonArgs: {
        currentMb: Math.round(system.freeDiskBytes / MB),
        requiredMb: Math.round(req.diskBytes / MB),
      },
    };
  }

  if (req.gpu === "required") {
    if (gpu === null || !gpu.present) {
      return {
        level: "red",
        reasonKey: "no_gpu_required",
        reasonArgs: {},
      };
    }
  }

  // Soft warnings — yellow.
  // Tight RAM: total - min < 1GB headroom (system would swap during
  // synthesis or block other apps).
  const ramHeadroom = system.totalRamBytes - req.minRamBytes;
  if (ramHeadroom < GB) {
    return {
      level: "yellow",
      reasonKey: "tight_ram",
      reasonArgs: {
        currentGb: round1(system.totalRamBytes / GB),
        requiredGb: round1(req.minRamBytes / GB),
      },
    };
  }

  if (req.gpu === "recommended" && (gpu === null || !gpu.present)) {
    return {
      level: "yellow",
      reasonKey: "no_gpu_recommended",
      reasonArgs: {},
    };
  }

  return {
    level: "green",
    reasonKey: "ok",
    reasonArgs: {},
  };
}

/**
 * Convenience overload for the common "lookup by provider id" case.
 * Returns `null` if the provider id isn't registered in the
 * requirements table (defensive — caller passed a string-typed id).
 */
export function evaluateProvider(
  providerId: TtsProviderId,
  system: SysInfo | null,
  gpu: GpuInfo | null,
): CompatibilityVerdict {
  const req = PROVIDER_REQUIREMENTS[providerId];
  return evaluateCompatibility(req, system, gpu);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
