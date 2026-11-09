import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db/schema";
import { AppShell } from "./AppShell";

// The chrome needs the router and i18n providers; it is not what this test is
// about. The database stays real (fake-indexeddb from vitest.setup).
vi.mock("@/components/shell/Sidebar", () => ({ Sidebar: () => null }));
vi.mock("@/components/shell/Topbar", () => ({ Topbar: () => null }));
vi.mock("@/components/shell/BottomBar", () => ({ BottomBar: () => null }));
vi.mock("@/components/shell/MobileDrawer", () => ({ MobileDrawer: () => null }));

describe("AppShell", () => {
  beforeEach(async () => {
    await db.workspaces.clear();
    await db.seedFlags.clear();
  });

  afterEach(async () => {
    await db.workspaces.clear();
    await db.seedFlags.clear();
  });

  it("does not add the example workspaces to a fresh store; only the setup wizard may", async () => {
    render(
      <AppShell>
        <p>content</p>
      </AppShell>,
    );
    expect(screen.getByText("content")).toBeInTheDocument();

    // Give any mount effect time to write before asserting nothing was written.
    await waitFor(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(await db.seedFlags.count()).toBe(0);
    });
    expect(await db.workspaces.count()).toBe(0);
  });
});
