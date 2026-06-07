"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo } from "react";
import { ChevronsLeft, ChevronsRight } from "lucide-react";
import { Brand } from "@/components/shell/Brand";
import {
  FOOTER_NAV,
  PRIMARY_NAV,
  WORKSPACE_NAV,
  resolveHref,
  type NavItem,
} from "@/lib/fixtures/navigation";
import { useWorkspaces } from "@/lib/db/hooks";
import type { WorkspaceRecord } from "@/lib/db/types";
import { useLocalePick } from "@/i18n/IntlProvider";
import { cn } from "@/lib/utils/cn";

type SidebarProps = {
  workspaceId?: string | undefined;
  onNavigate?: () => void;
  collapsed?: boolean;
  onCollapsedChange?: () => void;
};

const NO_OP = (): void => {};

export function Sidebar({
  workspaceId,
  onNavigate = NO_OP,
  collapsed = false,
  onCollapsedChange,
}: SidebarProps) {
  const pathname = usePathname();
  const pick = useLocalePick();
  const liveWorkspaces = useWorkspaces(false);
  const workspaces = useMemo(() => liveWorkspaces ?? [], [liveWorkspaces]);
  const activeWorkspace = useMemo<WorkspaceRecord | undefined>(
    () =>
      workspaceId ? workspaces.find((w) => w.id === workspaceId) : undefined,
    [workspaceId, workspaces],
  );

  return (
    <div className="flex h-full w-full flex-col overflow-hidden border-r border-rule bg-paper-2">
      <div
        className={cn(
          "flex items-center border-b border-rule py-4",
          collapsed ? "flex-col justify-center gap-2 px-2" : "justify-between px-4",
        )}
      >
        <Link
          href="/dashboard"
          onClick={onNavigate}
          className="inline-flex items-center"
          title="Teach Me Everything"
        >
          <Brand size="sm" showWordmark={!collapsed} />
        </Link>
        {onCollapsedChange ? (
          <button
            type="button"
            onClick={onCollapsedChange}
            className="hidden h-8 w-8 place-items-center rounded-[8px] border border-rule text-ink-3 transition-colors hover:border-accent hover:text-ink md:grid"
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? (
              <ChevronsRight className="h-4 w-4" aria-hidden />
            ) : (
              <ChevronsLeft className="h-4 w-4" aria-hidden />
            )}
          </button>
        ) : null}
      </div>

      {activeWorkspace ? (
        <div className={cn("border-b border-rule py-3", collapsed ? "px-2" : "px-4")}>
          <div
            className={cn(
              "font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-4",
              collapsed && "sr-only",
            )}
          >
            {pick("Çalışma alanı", "Workspace")}
          </div>
          <Link
            href={`/w/${activeWorkspace.id}`}
            onClick={onNavigate}
            title={pick(activeWorkspace.name, activeWorkspace.nameEn ?? activeWorkspace.name)}
            className={cn(
              "flex items-center rounded-[8px] transition-colors duration-[120ms] hover:bg-paper-3",
              collapsed ? "justify-center py-1" : "mt-2 -mx-1 gap-2.5 px-1 py-1",
            )}
          >
            <span
              className="grid h-6 w-6 place-items-center rounded-[6px] text-[11px] italic text-white"
              style={{
                backgroundColor: activeWorkspace.color,
                fontFamily: "var(--font-serif)",
              }}
              aria-hidden
            >
              {activeWorkspace.initials}
            </span>
            <span className={cn("truncate text-[14px] font-medium text-ink", collapsed && "sr-only")}>
              {pick(activeWorkspace.name, activeWorkspace.nameEn ?? activeWorkspace.name)}
            </span>
          </Link>
        </div>
      ) : null}

      <div className="flex-1 overflow-auto">
        <NavSection
          title={pick("Genel", "General")}
          items={PRIMARY_NAV}
          pathname={pathname}
          pick={pick}
          onNavigate={onNavigate}
          collapsed={collapsed}
        />

        {workspaceId ? (
          <NavSection
            title={pick("Çalışma alanı", "Workspace")}
            items={WORKSPACE_NAV}
            pathname={pathname}
            pick={pick}
            workspaceId={workspaceId}
            onNavigate={onNavigate}
            collapsed={collapsed}
          />
        ) : null}

        <NavSection
          title={pick("Çalışma alanları", "Workspaces")}
          pick={pick}
          pathname={pathname}
          collapsed={collapsed}
        >
          <div className="flex flex-col gap-0.5">
            {(() => {
              // Cap the visible workspace list so the sidebar stays compact
              // even with many workspaces. Recent (latest updatedAt) wins —
              // the "Tümünü gör" overflow link below routes to the full
              // /workspaces page for everything else.
              const VISIBLE_CAP = 5;
              const sorted = [...workspaces].sort(
                (a, b) => b.updatedAt - a.updatedAt,
              );
              const visible = sorted.slice(0, VISIBLE_CAP);
              const overflow = sorted.length - visible.length;
              const isAllActive = pathname === "/workspaces";
              return (
                <>
                  {visible.map((w) => {
                    const href = `/w/${w.id}`;
                    const isActive = pathname.startsWith(href);
                    return (
                      <Link
                        key={w.id}
                        href={href}
                        onClick={onNavigate}
                        title={pick(w.name, w.nameEn ?? w.name)}
                        className={cn(
                          "flex items-center rounded-[8px] text-[13px]",
                          "transition-[background,color,border-color] duration-[120ms] ease-[cubic-bezier(0.2,0.6,0.2,1)]",
                          collapsed ? "justify-center px-0 py-2" : "gap-2.5 px-2.5 py-2",
                          isActive
                            ? "bg-paper text-accent-ink font-semibold border border-accent-soft shadow-[var(--shadow-medium)]"
                            : "border border-transparent text-ink-2 hover:bg-paper-3 hover:text-ink",
                        )}
                      >
                        <span
                          className="grid h-5 w-5 place-items-center rounded-[5px] text-[10.5px] italic text-white"
                          style={{
                            backgroundColor: w.color,
                            fontFamily: "var(--font-serif)",
                          }}
                          aria-hidden
                        >
                          {w.initials}
                        </span>
                        <span className={cn("truncate", collapsed && "sr-only")}>
                          {pick(w.name, w.nameEn ?? w.name)}
                        </span>
                      </Link>
                    );
                  })}
                  <Link
                    href="/workspaces"
                    onClick={onNavigate}
                    title={pick("Tüm çalışma alanları", "All workspaces")}
                    className={cn(
                      "flex items-center rounded-[8px] text-[12.5px]",
                      "transition-[background,color,border-color] duration-[120ms] ease-[cubic-bezier(0.2,0.6,0.2,1)]",
                      collapsed ? "justify-center px-0 py-2" : "gap-2.5 px-2.5 py-2",
                      isAllActive
                        ? "bg-paper text-accent-ink font-semibold border border-accent-soft shadow-[var(--shadow-medium)]"
                        : "border border-transparent text-ink-3 hover:bg-paper-3 hover:text-ink",
                    )}
                  >
                    <span
                      className="grid h-5 w-5 place-items-center rounded-[5px] border border-dashed border-rule text-[11px] text-ink-3"
                      aria-hidden
                    >
                      …
                    </span>
                    <span className={cn("truncate", collapsed && "sr-only")}>
                      {overflow > 0
                        ? pick(`Tümünü gör (${overflow} daha)`, `See all (${overflow} more)`)
                        : sorted.length === 0
                          ? pick("Çalışma alanları", "Workspaces")
                          : pick("Tümünü gör", "See all")}
                    </span>
                  </Link>
                </>
              );
            })()}
          </div>
        </NavSection>
      </div>

      <div className="border-t border-rule p-2">
        {FOOTER_NAV.map((item) => {
          const href = resolveHref(item);
          const isActive = pathname === href;
          const Icon = item.icon;
          return (
            <Link
              key={item.key}
              href={href}
              onClick={onNavigate}
              title={pick(item.label, item.labelEn)}
              className={cn(
                "flex items-center rounded-[8px] text-[13px]",
                "transition-[background,color,border-color] duration-[120ms] ease-[cubic-bezier(0.2,0.6,0.2,1)]",
                collapsed ? "justify-center px-0 py-2" : "gap-2.5 px-3 py-2",
                isActive
                  ? "bg-paper text-accent-ink font-semibold border border-accent-soft shadow-[var(--shadow-medium)]"
                  : "border border-transparent text-ink-2 hover:bg-paper-3 hover:text-ink",
              )}
            >
              <Icon
                className={cn(
                  "h-4 w-4",
                  isActive ? "text-accent" : "text-ink-3",
                )}
                aria-hidden
              />
              <span className={cn(collapsed && "sr-only")}>
                {pick(item.label, item.labelEn)}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

type NavSectionProps = {
  title: string;
  pick: (tr: string, en: string) => string;
  pathname: string;
  items?: NavItem[];
  workspaceId?: string;
  onNavigate?: () => void;
  collapsed?: boolean;
  children?: React.ReactNode;
};

function NavSection({
  title,
  items,
  workspaceId,
  pathname,
  pick,
  onNavigate = NO_OP,
  collapsed = false,
  children,
}: NavSectionProps) {
  return (
    <section className={cn("pb-2 pt-3", collapsed ? "px-2" : "px-3")}>
      <div
        className={cn(
          "px-2.5 pb-1.5 font-mono text-[10.5px] uppercase tracking-[0.1em] text-ink-4",
          collapsed && "sr-only",
        )}
      >
        {title}
      </div>
      {children ?? (
        <div className="flex flex-col gap-0.5">
          {items?.map((item) => {
            const href = resolveHref(item, workspaceId);
            const isActive =
              href === "/dashboard"
                ? pathname === href
                : pathname.startsWith(href);
            const Icon = item.icon;
            return (
              <Link
                key={item.key}
                href={href}
                onClick={onNavigate}
                title={pick(item.label, item.labelEn)}
                className={cn(
                  "group relative flex items-center rounded-[8px] text-[13px]",
                  "transition-[background,color,border-color] duration-[120ms] ease-[cubic-bezier(0.2,0.6,0.2,1)]",
                  collapsed ? "justify-center px-0 py-2" : "gap-2.5 px-2.5 py-2",
                  isActive
                    ? "bg-paper text-accent-ink font-semibold border border-accent-soft shadow-[var(--shadow-medium)]"
                    : "border border-transparent text-ink-2 hover:bg-paper-3 hover:text-ink",
                )}
              >
                {isActive ? (
                  <span
                    className="absolute -left-px top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-r-full bg-accent"
                    aria-hidden
                  />
                ) : null}
                <Icon
                  className={cn(
                    "h-4 w-4",
                    isActive
                      ? "text-accent"
                      : "text-ink-3 group-hover:text-ink-2",
                  )}
                  aria-hidden
                />
                <span className={cn("flex-1 truncate", collapsed && "sr-only")}>
                  {pick(item.label, item.labelEn)}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}
