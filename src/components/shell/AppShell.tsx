"use client";

import {
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useEffect,
  useState,
} from "react";
import { SeedBootstrap } from "@/components/SeedBootstrap";
import { Sidebar } from "@/components/shell/Sidebar";
import { Topbar } from "@/components/shell/Topbar";
import { BottomBar } from "@/components/shell/BottomBar";
import { MobileDrawer } from "@/components/shell/MobileDrawer";
import { SIDEBAR_TOGGLE_EVENT } from "@/components/tray/EventBridgeMount";

type AppShellProps = {
  workspaceId?: string | undefined;
  title?: string | undefined;
  breadcrumb?: string[] | undefined;
  topbarActions?: ReactNode | undefined;
  hideBottomBar?: boolean;
  children: ReactNode;
};

const SIDEBAR_MIN = 72;
const SIDEBAR_MAX = 320;
const SIDEBAR_COLLAPSE_AT = 120;
const SIDEBAR_DEFAULT = 260;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function AppShell({
  workspaceId,
  title,
  breadcrumb,
  topbarActions,
  hideBottomBar = false,
  children,
}: AppShellProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    if (typeof window === "undefined") return SIDEBAR_DEFAULT;
    const stored = Number(window.localStorage.getItem("tme:sidebar-width"));
    if (Number.isFinite(stored) && stored > 0) {
      return clamp(stored, SIDEBAR_MIN, SIDEBAR_MAX);
    }
    return window.localStorage.getItem("tme:sidebar-collapsed") === "1"
      ? SIDEBAR_MIN
      : SIDEBAR_DEFAULT;
  });
  const sidebarCollapsed = sidebarWidth < SIDEBAR_COLLAPSE_AT;

  function setPersistedSidebarWidth(next: number): void {
    const width = clamp(next, SIDEBAR_MIN, SIDEBAR_MAX);
    setSidebarWidth(width);
    window.localStorage.setItem("tme:sidebar-width", String(width));
    window.localStorage.setItem(
      "tme:sidebar-collapsed",
      width < SIDEBAR_COLLAPSE_AT ? "1" : "0",
    );
  }

  function startSidebarResize(event: ReactMouseEvent<HTMLDivElement>): void {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sidebarWidth;

    const onMove = (moveEvent: MouseEvent): void => {
      setPersistedSidebarWidth(startWidth + moveEvent.clientX - startX);
    };
    const onUp = (): void => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function toggleSidebar(): void {
    setPersistedSidebarWidth(sidebarCollapsed ? SIDEBAR_DEFAULT : SIDEBAR_MIN);
  }

  // Phase 7.5.B-tail — Native menu Cmd/Ctrl+B routes through the
  // EventBridgeMount and lands here as a window CustomEvent. Kept as a
  // tiny bridge so the sidebar width state stays encapsulated in
  // AppShell while the menu can still drive it.
  useEffect(() => {
    const onToggle = (): void => {
      setPersistedSidebarWidth(
        sidebarCollapsed ? SIDEBAR_DEFAULT : SIDEBAR_MIN,
      );
    };
    window.addEventListener(SIDEBAR_TOGGLE_EVENT, onToggle);
    return () => window.removeEventListener(SIDEBAR_TOGGLE_EVENT, onToggle);
  }, [sidebarCollapsed]);

  return (
    <div
      className={[
        "flex min-h-[100dvh] flex-col bg-paper",
        "md:grid md:h-[100dvh] md:grid-rows-[56px_1fr]",
        "md:[grid-template-areas:'side_top''side_main']",
      ].join(" ")}
      style={{
        gridTemplateColumns: `${sidebarWidth}px minmax(0,1fr)`,
      }}
    >
      <aside className="relative hidden md:block md:[grid-area:side]">
        <Sidebar
          workspaceId={workspaceId}
          collapsed={sidebarCollapsed}
          onCollapsedChange={toggleSidebar}
        />
        <div
          role="separator"
          aria-orientation="vertical"
          title="Drag to resize sidebar"
          className="absolute right-[-3px] top-0 z-20 h-full w-1.5 cursor-col-resize bg-transparent transition-colors hover:bg-accent/50"
          onMouseDown={startSidebarResize}
        />
      </aside>

      <MobileDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)}>
        <Sidebar
          workspaceId={workspaceId}
          collapsed={false}
          onNavigate={() => setDrawerOpen(false)}
        />
      </MobileDrawer>

      <div className="md:[grid-area:top]">
        <Topbar
          title={title}
          breadcrumb={breadcrumb}
          actions={topbarActions}
          onMenuClick={() => setDrawerOpen(true)}
          searchOpen={searchOpen}
          onSearchOpenChange={setSearchOpen}
        />
      </div>

      <main
        className={[
          "flex-1 overflow-auto",
          hideBottomBar ? "" : "pb-[80px] md:pb-0",
          "md:[grid-area:main]",
        ].join(" ")}
      >
        {children}
      </main>

      {!hideBottomBar ? (
        <BottomBar
          workspaceId={workspaceId}
          onSearchClick={() => setSearchOpen(true)}
        />
      ) : null}

      <SeedBootstrap />
    </div>
  );
}
