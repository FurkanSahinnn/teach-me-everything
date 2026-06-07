import { describe, it, expect } from "vitest";
import {
  evaluateCompatibility,
  evaluateProvider,
  PROVIDER_REQUIREMENTS,
  type ModelRequirements,
} from "./compatibility";
import type { GpuInfo, SysInfo } from "@/lib/tauri/sysinfo";

const GB = 1024 * 1024 * 1024;
const MB = 1024 * 1024;

function system(overrides: Partial<SysInfo> = {}): SysInfo {
  return {
    totalRamBytes: 16 * GB,
    availableRamBytes: 8 * GB,
    cpuCores: 8,
    freeDiskBytes: 100 * GB,
    osName: "Test OS",
    osVersion: "1.0",
    arch: "x86_64",
    ...overrides,
  };
}

const GPU_PRESENT: GpuInfo = {
  present: true,
  names: ["NVIDIA RTX 4090"],
  totalVramBytes: 24 * GB,
};
const GPU_ABSENT: GpuInfo = { present: false, names: [], totalVramBytes: null };

describe("evaluateCompatibility", () => {
  describe("unknown system", () => {
    it("returns red when system is null", () => {
      const v = evaluateCompatibility(
        PROVIDER_REQUIREMENTS.piper,
        null,
        GPU_PRESENT,
      );
      expect(v.level).toBe("red");
      expect(v.reasonKey).toBe("unknown_system");
    });

    it("returns red when system is null even if gpu is null", () => {
      const v = evaluateCompatibility(PROVIDER_REQUIREMENTS.piper, null, null);
      expect(v.level).toBe("red");
      expect(v.reasonKey).toBe("unknown_system");
    });
  });

  describe("RAM checks", () => {
    it("returns green for piper on a 16GB machine", () => {
      const v = evaluateCompatibility(
        PROVIDER_REQUIREMENTS.piper,
        system(),
        GPU_ABSENT,
      );
      expect(v.level).toBe("green");
      expect(v.reasonKey).toBe("ok");
    });

    it("returns red for vibevoice on a 4GB machine (needs 8GB)", () => {
      const v = evaluateCompatibility(
        PROVIDER_REQUIREMENTS.vibevoice,
        system({ totalRamBytes: 4 * GB }),
        GPU_PRESENT,
      );
      expect(v.level).toBe("red");
      expect(v.reasonKey).toBe("insufficient_ram");
      expect(v.reasonArgs.currentGb).toBe(4);
      expect(v.reasonArgs.requiredGb).toBe(8);
    });

    it("returns yellow for tight_ram when headroom < 1GB", () => {
      const req: ModelRequirements = {
        minRamBytes: 4 * GB,
        diskBytes: 100 * MB,
        gpu: "none",
      };
      const v = evaluateCompatibility(
        req,
        system({ totalRamBytes: 4.5 * GB }),
        GPU_PRESENT,
      );
      expect(v.level).toBe("yellow");
      expect(v.reasonKey).toBe("tight_ram");
    });

    it("returns green when headroom is exactly 1GB", () => {
      const req: ModelRequirements = {
        minRamBytes: 4 * GB,
        diskBytes: 100 * MB,
        gpu: "none",
      };
      const v = evaluateCompatibility(
        req,
        system({ totalRamBytes: 5 * GB + 1 }),
        GPU_PRESENT,
      );
      expect(v.level).toBe("green");
    });
  });

  describe("disk checks", () => {
    it("returns red when free disk < requirement", () => {
      const v = evaluateCompatibility(
        PROVIDER_REQUIREMENTS.xtts,
        system({ freeDiskBytes: 500 * MB }),
        GPU_PRESENT,
      );
      expect(v.level).toBe("red");
      expect(v.reasonKey).toBe("insufficient_disk");
      expect(v.reasonArgs.requiredMb).toBe(2048);
    });

    it("disk check fires after RAM check (RAM red wins)", () => {
      const v = evaluateCompatibility(
        PROVIDER_REQUIREMENTS.xtts,
        system({ totalRamBytes: 1 * GB, freeDiskBytes: 1 * MB }),
        GPU_PRESENT,
      );
      expect(v.reasonKey).toBe("insufficient_ram");
    });
  });

  describe("GPU checks", () => {
    it("returns red for vibevoice without a GPU (required)", () => {
      const v = evaluateCompatibility(
        PROVIDER_REQUIREMENTS.vibevoice,
        system({ totalRamBytes: 16 * GB }),
        GPU_ABSENT,
      );
      expect(v.level).toBe("red");
      expect(v.reasonKey).toBe("no_gpu_required");
    });

    it("returns red for vibevoice with null gpu (required + unknown)", () => {
      const v = evaluateCompatibility(
        PROVIDER_REQUIREMENTS.vibevoice,
        system({ totalRamBytes: 16 * GB }),
        null,
      );
      expect(v.level).toBe("red");
      expect(v.reasonKey).toBe("no_gpu_required");
    });

    it("returns yellow for xtts without a GPU (recommended)", () => {
      const v = evaluateCompatibility(
        PROVIDER_REQUIREMENTS.xtts,
        system({ totalRamBytes: 16 * GB }),
        GPU_ABSENT,
      );
      expect(v.level).toBe("yellow");
      expect(v.reasonKey).toBe("no_gpu_recommended");
    });

    it("returns yellow for xtts with null gpu (recommended + unknown)", () => {
      const v = evaluateCompatibility(
        PROVIDER_REQUIREMENTS.xtts,
        system({ totalRamBytes: 16 * GB }),
        null,
      );
      expect(v.level).toBe("yellow");
      expect(v.reasonKey).toBe("no_gpu_recommended");
    });

    it("returns green for xtts with a GPU", () => {
      const v = evaluateCompatibility(
        PROVIDER_REQUIREMENTS.xtts,
        system({ totalRamBytes: 16 * GB }),
        GPU_PRESENT,
      );
      expect(v.level).toBe("green");
    });

    it("piper (gpu=none) is unaffected by missing GPU", () => {
      const v = evaluateCompatibility(
        PROVIDER_REQUIREMENTS.piper,
        system(),
        GPU_ABSENT,
      );
      expect(v.level).toBe("green");
    });
  });

  describe("verdict precedence", () => {
    it("RAM red wins over GPU red", () => {
      const v = evaluateCompatibility(
        PROVIDER_REQUIREMENTS.vibevoice,
        system({ totalRamBytes: 1 * GB }),
        GPU_ABSENT,
      );
      expect(v.reasonKey).toBe("insufficient_ram");
    });

    it("tight_ram wins over no_gpu_recommended (RAM warning is more actionable)", () => {
      const v = evaluateCompatibility(
        PROVIDER_REQUIREMENTS.xtts,
        system({ totalRamBytes: 4.5 * GB }),
        GPU_ABSENT,
      );
      expect(v.reasonKey).toBe("tight_ram");
    });
  });

  describe("web-speech edge case", () => {
    it("returns green even on a 0-resource fake machine", () => {
      const v = evaluateCompatibility(
        PROVIDER_REQUIREMENTS["web-speech"],
        system({ totalRamBytes: 1 * GB, freeDiskBytes: 0 }),
        GPU_ABSENT,
      );
      expect(v.level).toBe("green");
    });
  });
});

describe("evaluateProvider", () => {
  it("dispatches by provider id", () => {
    const v = evaluateProvider("piper", system(), GPU_PRESENT);
    expect(v.level).toBe("green");
  });

  it("returns red unknown_system when system is null", () => {
    const v = evaluateProvider("xtts", null, null);
    expect(v.level).toBe("red");
    expect(v.reasonKey).toBe("unknown_system");
  });
});

describe("PROVIDER_REQUIREMENTS table", () => {
  it("has an entry for every TtsProviderId", () => {
    // If a new provider id is added without a requirements entry, this
    // test fails at typecheck rather than at runtime — a Record<id, R>
    // misses keys at compile time. The runtime assertion catches the
    // case where a future refactor loosens the type to Partial<>.
    expect(PROVIDER_REQUIREMENTS.piper).toBeDefined();
    expect(PROVIDER_REQUIREMENTS["web-speech"]).toBeDefined();
    expect(PROVIDER_REQUIREMENTS.kokoro).toBeDefined();
    expect(PROVIDER_REQUIREMENTS.xtts).toBeDefined();
    expect(PROVIDER_REQUIREMENTS.vibevoice).toBeDefined();
  });

  it("orders providers by RAM requirement (sanity check on the matrix)", () => {
    expect(PROVIDER_REQUIREMENTS["web-speech"].minRamBytes).toBeLessThanOrEqual(
      PROVIDER_REQUIREMENTS.piper.minRamBytes,
    );
    expect(PROVIDER_REQUIREMENTS.piper.minRamBytes).toBeLessThan(
      PROVIDER_REQUIREMENTS.kokoro.minRamBytes,
    );
    expect(PROVIDER_REQUIREMENTS.kokoro.minRamBytes).toBeLessThan(
      PROVIDER_REQUIREMENTS.xtts.minRamBytes,
    );
    expect(PROVIDER_REQUIREMENTS.xtts.minRamBytes).toBeLessThan(
      PROVIDER_REQUIREMENTS.vibevoice.minRamBytes,
    );
  });
});
