import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { installEmbedModel, listInstalledEmbedModels } from "@/lib/embed-local/install";
import { LocalEmbedModelsSection } from "./LocalEmbedModelsSection";

vi.mock("@/i18n/IntlProvider", () => ({ useLocalePick: () => (_tr: string, en: string) => en }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/hooks/useSystemCheck", () => ({
  useSystemCheck: () => ({
    state: "ready",
    system: { totalRamBytes: 16 * 1024 ** 3, freeDiskBytes: 100 * 1024 ** 3 },
    gpu: null,
  }),
}));
vi.mock("@/lib/tauri/env", () => ({ isTauriEnvWithOverride: () => true }));
vi.mock("@/stores/prefs", () => ({ usePrefs: (selector: (state: unknown) => unknown) => selector({ modelBindings: { embedPresetId: "openai-3-small" } }) }));
vi.mock("@/lib/embed-local/install", () => ({
  listInstalledEmbedModels: vi.fn(),
  installEmbedModel: vi.fn(),
  deleteEmbedModel: vi.fn(),
}));

describe("LocalEmbedModelsSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listInstalledEmbedModels).mockResolvedValue([]);
    vi.mocked(installEmbedModel).mockResolvedValue({
      modelId: "local-qwen3-0.6b",
      hfRepo: "onnx-community/Qwen3-Embedding-0.6B-ONNX",
      sizeBytes: 625_000_000,
      installedAt: 1700000000000,
    });
  });

  it("lists the core models without downloading until the user clicks", async () => {
    render(<LocalEmbedModelsSection />);
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Download" })).toHaveLength(5));
    expect(installEmbedModel).not.toHaveBeenCalled();

    fireEvent.click(screen.getAllByRole("button", { name: "Download" })[0]!);
    await waitFor(() => expect(installEmbedModel).toHaveBeenCalledWith(
      expect.objectContaining({ modelId: "local-qwen3-0.6b" }),
    ));
  });
});
