import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SETTINGS_PROVIDERS } from "./ApiKeyRow";
import { QuickStartRow } from "./ModelBindingRows";
import { useApiKeyManager } from "@/hooks/useApiKeyManager";
import { DEFAULT_MODEL_BINDINGS, usePrefs } from "@/stores/prefs";
import type { Provider } from "@/lib/db/schema";

const repoMocks = vi.hoisted(() => {
  const store = new Map<Provider, string>();
  return {
    store,
    getApiKey: vi.fn(async (p: Provider) => store.get(p) ?? null),
    setApiKey: vi.fn(async (p: Provider, val: string) => {
      if (val) store.set(p, val);
      else store.delete(p);
    }),
    deleteApiKey: vi.fn(async (p: Provider) => {
      store.delete(p);
    }),
    listStoredProviders: vi.fn(async () => Array.from(store.keys())),
    toast: vi.fn(),
  };
});

vi.mock("@/lib/db/api-keys-repo", () => ({
  getApiKey: repoMocks.getApiKey,
  setApiKey: repoMocks.setApiKey,
  deleteApiKey: repoMocks.deleteApiKey,
  listStoredProviders: repoMocks.listStoredProviders,
}));

vi.mock("@/components/ui/Toast", () => ({
  useToast: () => ({ toast: repoMocks.toast }),
}));

vi.mock("@/i18n/IntlProvider", () => ({
  useLocalePick: () => (_tr: string, en: string) => en,
}));

function Harness({
  onApplied,
}: {
  onApplied?: (applied: Partial<Record<string, string>>) => void;
}) {
  const keys = useApiKeyManager(SETTINGS_PROVIDERS);
  return <QuickStartRow keys={keys} onApplied={onApplied} />;
}

beforeEach(() => {
  window.localStorage.clear();
  repoMocks.store.clear();
  repoMocks.getApiKey.mockClear();
  repoMocks.setApiKey.mockClear();
  repoMocks.deleteApiKey.mockClear();
  repoMocks.listStoredProviders.mockClear();
  repoMocks.toast.mockClear();
  usePrefs.setState({
    modelBindings: { ...DEFAULT_MODEL_BINDINGS },
    disabledProviders: [],
  });
});

afterEach(() => {
  cleanup();
});

describe("QuickStartRow integration", () => {
  it("persists the entered API key and updates all task + embed bindings on Apply", async () => {
    const user = userEvent.setup();
    const onApplied = vi.fn();
    render(<Harness onApplied={onApplied} />);

    const geminiTile = screen
      .getAllByRole("radio")
      .find((t) => t.textContent?.includes("Google Gemini"))!;
    await user.click(geminiTile);

    const input = document.querySelector("input")!;
    await user.type(input, "AIzaSyTestKey123");

    const applyBtn = screen.getByRole("button", { name: /^Apply$/i });
    expect(applyBtn).not.toBeDisabled();
    await user.click(applyBtn);

    await waitFor(() => {
      expect(repoMocks.setApiKey).toHaveBeenCalledWith(
        "google-gemini",
        "AIzaSyTestKey123",
      );
    });
    expect(repoMocks.store.get("google-gemini")).toBe("AIzaSyTestKey123");

    const mb = usePrefs.getState().modelBindings;
    expect(mb.chat).toBe("google-gemini::gemini-3.5-flash");
    expect(mb.summary).toBe("google-gemini::gemini-3.5-flash");
    expect(mb.quick).toBe("google-gemini::gemini-3.1-flash-lite");
    expect(mb.flashcardGen).toBe("google-gemini::gemini-3.5-flash");
    expect(mb.roadmapGen).toBe("google-gemini::gemini-3.5-flash");
    expect(mb.analysisExtract).toBe("google-gemini::gemini-3.1-flash-lite");
    expect(mb.analysisSynthesize).toBe("google-gemini::gemini-3.5-flash");
    expect(mb.analysisCritique).toBe("google-gemini::gemini-3.5-flash");
    expect(mb.embedPresetId).toBe("gemini-embed-2");
    expect(onApplied).toHaveBeenCalledTimes(1);
  });

  it("allows one-click Apply without re-entering the key when the provider key is already stored", async () => {
    repoMocks.store.set("openrouter", "sk-or-existing");
    usePrefs.setState({ disabledProviders: ["openrouter"] });

    const user = userEvent.setup();
    render(<Harness />);

    await waitFor(() => {
      expect(screen.getByText(/key saved/i)).toBeInTheDocument();
    });

    const openrouterTile = screen
      .getAllByRole("radio")
      .find((t) => t.textContent?.includes("OpenRouter"))!;
    await user.click(openrouterTile);

    const applyBtn = screen.getByRole("button", { name: /^Apply$/i });
    expect(applyBtn).not.toBeDisabled();
    await user.click(applyBtn);

    await waitFor(() => {
      expect(usePrefs.getState().modelBindings.chat).toBe(
        "openrouter::z-ai/glm-5",
      );
    });
    expect(usePrefs.getState().modelBindings.roadmapGen).toBe(
      "openrouter::z-ai/glm-5",
    );
    expect(usePrefs.getState().modelBindings.embedPresetId).toBe(
      "openrouter-3-small",
    );
    // Stored key is preserved (never overwritten with empty string)
    expect(repoMocks.store.get("openrouter")).toBe("sk-or-existing");
    // Disabled provider was re-enabled
    expect(usePrefs.getState().disabledProviders).not.toContain("openrouter");
  });
});
