import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePrefs } from "@/stores/prefs";

const checkMock = vi.fn();
const relaunchMock = vi.fn();
const toastMock = vi.fn();

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: () => checkMock(),
}));

vi.mock("@tauri-apps/plugin-process", () => ({
  relaunch: () => relaunchMock(),
}));

vi.mock("@/lib/tauri/env", () => ({
  isTauriEnvWithOverride: () => true,
}));

vi.mock("@/components/ui/Toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

vi.mock("@/i18n/IntlProvider", () => ({
  useLocalePick: () => (_tr: string, en: string) => en,
}));

import { UpdateCheckMount } from "./UpdateCheckMount";

describe("UpdateCheckMount", () => {
  beforeEach(() => {
    checkMock.mockReset();
    relaunchMock.mockReset();
    toastMock.mockReset();
    usePrefs.setState({
      autoCheckUpdates: true,
      autoInstallUpdates: false,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("shows the update welcome modal when a newer release is available and installs on click", async () => {
    const downloadAndInstall = vi.fn(async (cb?: (ev: unknown) => void) => {
      cb?.({ event: "Started", data: { contentLength: 100 } });
      cb?.({ event: "Progress", data: { chunkLength: 100 } });
      cb?.({ event: "Finished" });
    });
    checkMock.mockResolvedValueOnce({
      version: "1.2.0",
      body: "New themes and article analysis improvements",
      downloadAndInstall,
    });

    render(<UpdateCheckMount />);

    expect(await screen.findByTestId("update-welcome-modal")).toBeInTheDocument();
    expect(screen.getByText("v1.2.0")).toBeInTheDocument();
    expect(screen.getByText(/New themes and article analysis improvements/)).toBeInTheDocument();

    await userEvent.click(screen.getByTestId("update-welcome-install"));
    await waitFor(() => {
      expect(downloadAndInstall).toHaveBeenCalledTimes(1);
      expect(relaunchMock).toHaveBeenCalledTimes(1);
    });
  });

  it("auto-installs on launch when autoInstallUpdates is enabled", async () => {
    usePrefs.setState({
      autoCheckUpdates: true,
      autoInstallUpdates: true,
    });
    const downloadAndInstall = vi.fn().mockResolvedValue(undefined);
    checkMock.mockResolvedValueOnce({
      version: "1.3.0",
      body: "Auto-update release",
      downloadAndInstall,
    });

    render(<UpdateCheckMount />);

    await waitFor(() => {
      expect(downloadAndInstall).toHaveBeenCalledTimes(1);
      expect(relaunchMock).toHaveBeenCalledTimes(1);
    });
  });
});
