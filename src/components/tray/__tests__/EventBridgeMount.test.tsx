// Phase 7.5.B-tail — EventBridgeMount unit tests.
//
// Verifies that every tray + menu action id maps to the correct app
// action: navigation, note creation, daily-note find-or-create, vault
// open via plugin-opener, sidebar/palette window-event dispatch, and
// no-workspace / no-vault toast fallbacks.

import { render, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `next/navigation` — capture router.push + report a workspace path.
const pushMock = vi.fn();
let mockPathname: string | null = "/w/ws-1/overview";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: pushMock }),
  usePathname: () => mockPathname,
}));

// `next-intl` — echo the key (no message resolution needed in tests).
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

// Toast — capture every call.
const toastMock = vi.fn();
vi.mock("@/components/ui/Toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

// Dexie repos — controllable per-test.
const createNoteMock = vi.fn();
vi.mock("@/lib/db/notes", () => ({
  createNote: (input: unknown) => createNoteMock(input),
}));

const listWorkspacesMock = vi.fn();
vi.mock("@/lib/db/workspaces", () => ({
  listWorkspaces: (opts: unknown) => listWorkspacesMock(opts),
}));

// Daily-notes module — assert orchestration without hitting Dexie.
const findOrCreateDailyNoteMock = vi.fn();
vi.mock("@/lib/notes/daily", () => ({
  findOrCreateDailyNote: (input: unknown) => findOrCreateDailyNoteMock(input),
  formatDateForLocale: vi.fn(() => "2026-05-17"),
  getDefaultDailyFolderName: vi.fn(() => "Daily"),
  getDefaultDailyTemplate: vi.fn(() => "# Daily-{{date}}\n\n"),
}));

// Prefs — return controllable locale / notesUi / vault slices.
let mockPrefsState: {
  locale: "tr" | "en";
  notesUi: { dailyTemplate: string; dailyFolderName: string };
  vault: { rootPath: string | null };
} = {
  locale: "tr",
  notesUi: { dailyTemplate: "", dailyFolderName: "" },
  vault: { rootPath: "/home/me/vault" },
};
vi.mock("@/stores/prefs", () => ({
  usePrefs: { getState: () => mockPrefsState },
}));

// Tauri env — flip per-test for the open-vault path.
let mockIsTauri = true;
vi.mock("@/lib/tauri/env", () => ({
  isTauriEnv: () => mockIsTauri,
}));

// Tauri opener plugin — capture openPath calls without touching Tauri.
const openPathMock = vi.fn();
vi.mock("@tauri-apps/plugin-opener", () => ({
  openPath: (path: string) => openPathMock(path),
}));

// Import AFTER mocks are registered.
import { EventBridgeMount } from "../EventBridgeMount";
import { TRAY_EVENT_NAME } from "../TrayMount";
import { MENU_EVENT_NAME } from "../MenuMount";

function fireTray(menuId: string): void {
  window.dispatchEvent(
    new CustomEvent(TRAY_EVENT_NAME, { detail: { menuId } }),
  );
}

function fireMenu(actionId: string): void {
  window.dispatchEvent(
    new CustomEvent(MENU_EVENT_NAME, { detail: { actionId } }),
  );
}

// Microtask flush — handlers await Dexie calls + router.push.
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("EventBridgeMount", () => {
  beforeEach(() => {
    pushMock.mockReset();
    toastMock.mockReset();
    createNoteMock.mockReset();
    listWorkspacesMock.mockReset();
    findOrCreateDailyNoteMock.mockReset();
    openPathMock.mockReset();
    mockPathname = "/w/ws-1/overview";
    mockIsTauri = true;
    mockPrefsState = {
      locale: "tr",
      notesUi: { dailyTemplate: "", dailyFolderName: "" },
      vault: { rootPath: "/home/me/vault" },
    };
    createNoteMock.mockResolvedValue({ id: "note-new" });
    listWorkspacesMock.mockResolvedValue([{ id: "ws-fallback" }]);
    findOrCreateDailyNoteMock.mockResolvedValue({
      note: { id: "note-daily" },
      created: true,
    });
    openPathMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
  });

  describe("tray events", () => {
    it("new-note creates note in active workspace and navigates", async () => {
      render(<EventBridgeMount />);
      fireTray("new-note");
      await flush();
      expect(createNoteMock).toHaveBeenCalledWith({ workspaceId: "ws-1" });
      expect(pushMock).toHaveBeenCalledWith("/w/ws-1/notes?id=note-new");
    });

    it("today calls findOrCreateDailyNote with prefs and navigates", async () => {
      render(<EventBridgeMount />);
      fireTray("today");
      await flush();
      expect(findOrCreateDailyNoteMock).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: "ws-1",
          locale: "tr",
          folderName: "Daily",
          template: "# Daily-{{date}}\n\n",
          dateString: "2026-05-17",
        }),
      );
      expect(pushMock).toHaveBeenCalledWith("/w/ws-1/notes?id=note-daily");
    });

    it("today uses custom prefs.notesUi values when set", async () => {
      mockPrefsState = {
        locale: "en",
        notesUi: {
          dailyTemplate: "# My-{{date}}",
          dailyFolderName: "Journal",
        },
        vault: { rootPath: null },
      };
      render(<EventBridgeMount />);
      fireTray("today");
      await flush();
      expect(findOrCreateDailyNoteMock).toHaveBeenCalledWith(
        expect.objectContaining({
          folderName: "Journal",
          template: "# My-{{date}}",
          locale: "en",
        }),
      );
    });

    it("open-vault opens the vault root via plugin-opener", async () => {
      render(<EventBridgeMount />);
      fireTray("open-vault");
      await flush();
      expect(openPathMock).toHaveBeenCalledWith("/home/me/vault");
      expect(toastMock).not.toHaveBeenCalled();
    });

    it("open-vault toasts when rootPath is null", async () => {
      mockPrefsState.vault.rootPath = null;
      render(<EventBridgeMount />);
      fireTray("open-vault");
      await flush();
      expect(openPathMock).not.toHaveBeenCalled();
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "warn" }),
      );
    });

    it("open-vault toasts an error when the plugin throws", async () => {
      openPathMock.mockRejectedValueOnce(new Error("denied"));
      render(<EventBridgeMount />);
      fireTray("open-vault");
      await flush();
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "error",
          description: "/home/me/vault",
        }),
      );
    });
  });

  describe("menu events", () => {
    it("settings navigates to /settings", () => {
      render(<EventBridgeMount />);
      fireMenu("settings");
      expect(pushMock).toHaveBeenCalledWith("/settings");
    });

    it("toggle-sidebar dispatches SIDEBAR_TOGGLE_EVENT", () => {
      const onToggle = vi.fn();
      window.addEventListener("tme:sidebar:toggle", onToggle);
      render(<EventBridgeMount />);
      fireMenu("toggle-sidebar");
      expect(onToggle).toHaveBeenCalledTimes(1);
      window.removeEventListener("tme:sidebar:toggle", onToggle);
    });

    it("palette dispatches PALETTE_OPEN_EVENT", () => {
      const onPalette = vi.fn();
      window.addEventListener("tme:palette:open", onPalette);
      render(<EventBridgeMount />);
      fireMenu("palette");
      expect(onPalette).toHaveBeenCalledTimes(1);
      window.removeEventListener("tme:palette:open", onPalette);
    });

    it("new-note via menu mirrors tray new-note", async () => {
      render(<EventBridgeMount />);
      fireMenu("new-note");
      await flush();
      expect(createNoteMock).toHaveBeenCalledWith({ workspaceId: "ws-1" });
    });
  });

  describe("workspace resolution", () => {
    it("falls back to first workspace when pathname is not under /w/", async () => {
      mockPathname = "/dashboard";
      render(<EventBridgeMount />);
      fireMenu("new-note");
      await flush();
      expect(listWorkspacesMock).toHaveBeenCalled();
      expect(createNoteMock).toHaveBeenCalledWith({
        workspaceId: "ws-fallback",
      });
    });

    it("treats static-export `_` placeholder as no workspace", async () => {
      mockPathname = "/w/_/overview";
      render(<EventBridgeMount />);
      fireMenu("new-note");
      await flush();
      expect(listWorkspacesMock).toHaveBeenCalled();
      expect(createNoteMock).toHaveBeenCalledWith({
        workspaceId: "ws-fallback",
      });
    });

    it("toasts when no workspace exists anywhere", async () => {
      mockPathname = "/dashboard";
      listWorkspacesMock.mockResolvedValueOnce([]);
      render(<EventBridgeMount />);
      fireMenu("new-note");
      await flush();
      expect(createNoteMock).not.toHaveBeenCalled();
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "warn" }),
      );
    });
  });

  describe("error paths", () => {
    it("toasts when createNote rejects", async () => {
      createNoteMock.mockRejectedValueOnce(new Error("dexie down"));
      render(<EventBridgeMount />);
      fireMenu("new-note");
      await flush();
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "error" }),
      );
    });

    it("toasts when daily orchestration rejects", async () => {
      findOrCreateDailyNoteMock.mockRejectedValueOnce(new Error("nope"));
      render(<EventBridgeMount />);
      fireMenu("today");
      await flush();
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "error" }),
      );
    });
  });

  describe("listener lifecycle", () => {
    it("unmount removes tray + menu listeners", async () => {
      const { unmount } = render(<EventBridgeMount />);
      unmount();
      fireTray("new-note");
      fireMenu("settings");
      await flush();
      expect(createNoteMock).not.toHaveBeenCalled();
      expect(pushMock).not.toHaveBeenCalled();
    });

    it("ignores events without a detail payload", () => {
      render(<EventBridgeMount />);
      window.dispatchEvent(new Event(TRAY_EVENT_NAME));
      window.dispatchEvent(new Event(MENU_EVENT_NAME));
      expect(createNoteMock).not.toHaveBeenCalled();
      expect(pushMock).not.toHaveBeenCalled();
    });
  });
});
