/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getGpuInfo,
  getSysInfo,
  _setSysInfoInvokeForTests,
} from "./sysinfo";
import { _setTauriEnvForTests } from "./env";

afterEach(() => {
  _setTauriEnvForTests(null);
  _setSysInfoInvokeForTests(null);
});

describe("getSysInfo", () => {
  it("returns null when not in Tauri env", async () => {
    _setTauriEnvForTests(false);
    const result = await getSysInfo();
    expect(result).toBeNull();
  });

  it("invokes the Rust command when in Tauri env", async () => {
    _setTauriEnvForTests(true);
    const invoke = vi.fn().mockResolvedValue({
      totalRamBytes: 16_000_000_000,
      availableRamBytes: 8_000_000_000,
      cpuCores: 8,
      freeDiskBytes: 100_000_000_000,
      osName: "Linux",
      osVersion: "5.15",
      arch: "x86_64",
    });
    _setSysInfoInvokeForTests(invoke);

    const result = await getSysInfo();
    expect(invoke).toHaveBeenCalledWith("sysinfo_probe");
    expect(result?.cpuCores).toBe(8);
    expect(result?.osName).toBe("Linux");
  });

  it("returns null on invoke error (collapses to unknown_system)", async () => {
    _setTauriEnvForTests(true);
    const invoke = vi.fn().mockRejectedValue(new Error("probe failed"));
    _setSysInfoInvokeForTests(invoke);

    const result = await getSysInfo();
    expect(result).toBeNull();
  });
});

describe("getGpuInfo", () => {
  it("returns null when not in Tauri env", async () => {
    _setTauriEnvForTests(false);
    const result = await getGpuInfo();
    expect(result).toBeNull();
  });

  it("returns parsed GPU info from invoke", async () => {
    _setTauriEnvForTests(true);
    const invoke = vi.fn().mockResolvedValue({
      present: true,
      names: ["NVIDIA RTX 4090"],
      totalVramBytes: 24_000_000_000,
    });
    _setSysInfoInvokeForTests(invoke);

    const result = await getGpuInfo();
    expect(invoke).toHaveBeenCalledWith("sysinfo_gpu");
    expect(result?.present).toBe(true);
    expect(result?.names).toEqual(["NVIDIA RTX 4090"]);
    expect(result?.totalVramBytes).toBe(24_000_000_000);
  });

  it("returns {present:false, names:[]} on invoke error (not null)", async () => {
    _setTauriEnvForTests(true);
    const invoke = vi.fn().mockRejectedValue(new Error("lspci missing"));
    _setSysInfoInvokeForTests(invoke);

    const result = await getGpuInfo();
    // GPU probe failures collapse to a structured "no GPU" result so
    // the chip can render the appropriate verdict instead of treating
    // it as a complete probe failure.
    expect(result).toEqual({ present: false, names: [], totalVramBytes: null });
  });
});

describe("invoke caching", () => {
  beforeEach(() => {
    _setTauriEnvForTests(true);
  });

  it("reuses the same invoke across calls", async () => {
    const invoke = vi.fn().mockResolvedValue({
      totalRamBytes: 0,
      availableRamBytes: 0,
      cpuCores: 0,
      freeDiskBytes: 0,
      osName: "",
      osVersion: "",
      arch: "",
    });
    _setSysInfoInvokeForTests(invoke);

    await getSysInfo();
    await getSysInfo();
    expect(invoke).toHaveBeenCalledTimes(2);
  });
});
