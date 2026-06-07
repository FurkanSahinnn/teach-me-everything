// Phase 11.C — Pure helper tests for the Settings → Modeller TTS panel.
//
// The catalog functions imported here register the Piper + Web Speech
// adapters as a side effect of the import. We exercise them with synthetic
// `InstalledVoiceRef[]` arrays so the tests stay fast and never touch Tauri.

import { describe, expect, it } from "vitest";
import {
  getAvailableVoices,
  getInstalledDiskUsageBytes,
  getInstalledVoiceCatalog,
  isProviderUsable,
  listVoicesForProvider,
  type InstalledVoiceRef,
} from "./voices";

// Unique voice ids — the catalog may surface the same voice under more
// than one speaker (e.g. dfki for alev + deniz), but the install list
// dedupes by voiceId so this count is what `getAvailableVoices` returns.
const PIPER_VOICES_TOTAL = new Set(
  listVoicesForProvider("piper").map((v) => v.voiceId),
).size;

describe("getAvailableVoices", () => {
  it("returns the full catalog when nothing is installed", () => {
    const available = getAvailableVoices("piper", []);
    expect(available).toHaveLength(PIPER_VOICES_TOTAL);
  });

  it("filters out installed voices for the same provider", () => {
    const installed: InstalledVoiceRef[] = [
      { provider: "piper", voiceId: "en_US-ryan-medium", sizeBytes: 0 },
    ];
    const available = getAvailableVoices("piper", installed);
    expect(available).toHaveLength(PIPER_VOICES_TOTAL - 1);
    expect(available.some((v) => v.voiceId === "en_US-ryan-medium")).toBe(
      false,
    );
  });

  it("ignores entries from other providers", () => {
    const installed: InstalledVoiceRef[] = [
      { provider: "kokoro", voiceId: "en_US-ryan-medium", sizeBytes: 0 },
    ];
    // Kokoro shouldn't mask a Piper voice with the same id.
    const available = getAvailableVoices("piper", installed);
    expect(available).toHaveLength(PIPER_VOICES_TOTAL);
  });

  it("returns experimental catalog voices for registered heavy providers", () => {
    const available = getAvailableVoices("kokoro", []);
    expect(available.map((v) => v.voiceId)).toEqual([
      "kokoro-af_heart",
      "kokoro-am_adam",
    ]);
  });
});

describe("getInstalledVoiceCatalog", () => {
  it("joins installed entries with their catalog metadata", () => {
    const installed: InstalledVoiceRef[] = [
      { provider: "piper", voiceId: "en_US-ryan-medium", sizeBytes: 63 * 1024 * 1024 },
    ];
    const rows = getInstalledVoiceCatalog("piper", installed);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.voiceId).toBe("en_US-ryan-medium");
    expect(rows[0]?.speaker).toBe("deniz");
    expect(rows[0]?.sizeBytes).toBe(63 * 1024 * 1024);
    expect(rows[0]?.isCustom).toBe(false);
  });

  it("flags catalog-orphan entries as custom so they still render", () => {
    const installed: InstalledVoiceRef[] = [
      { provider: "piper", voiceId: "tr_TR-unknown-medium", sizeBytes: 1000 },
    ];
    const rows = getInstalledVoiceCatalog("piper", installed);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.isCustom).toBe(true);
    expect(rows[0]?.name).toBe("tr_TR-unknown-medium");
  });

  it("filters by provider", () => {
    const installed: InstalledVoiceRef[] = [
      { provider: "piper", voiceId: "en_US-ryan-medium", sizeBytes: 100 },
      { provider: "kokoro", voiceId: "irrelevant", sizeBytes: 200 },
    ];
    const rows = getInstalledVoiceCatalog("piper", installed);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.voiceId).toBe("en_US-ryan-medium");
  });
});

describe("getInstalledDiskUsageBytes", () => {
  it("returns 0 for empty input", () => {
    expect(getInstalledDiskUsageBytes("piper", [])).toBe(0);
  });

  it("sums sizes scoped to the provider", () => {
    const installed: InstalledVoiceRef[] = [
      { provider: "piper", voiceId: "a", sizeBytes: 100 },
      { provider: "piper", voiceId: "b", sizeBytes: 250 },
      { provider: "kokoro", voiceId: "c", sizeBytes: 9999 },
    ];
    expect(getInstalledDiskUsageBytes("piper", installed)).toBe(350);
    expect(getInstalledDiskUsageBytes("kokoro", installed)).toBe(9999);
    expect(getInstalledDiskUsageBytes("xtts", installed)).toBe(0);
  });
});

describe("isProviderUsable", () => {
  it("web-speech is always usable (no install required)", () => {
    expect(isProviderUsable("web-speech", [])).toBe(true);
  });

  it("piper requires at least one installed voice", () => {
    expect(isProviderUsable("piper", [])).toBe(false);
    expect(
      isProviderUsable("piper", [
        { provider: "piper", voiceId: "en_US-ryan-medium", sizeBytes: 1 },
      ]),
    ).toBe(true);
  });

  it("does not get tricked by installs for a different provider", () => {
    expect(
      isProviderUsable("piper", [
        { provider: "kokoro", voiceId: "any", sizeBytes: 1 },
      ]),
    ).toBe(false);
  });
});
