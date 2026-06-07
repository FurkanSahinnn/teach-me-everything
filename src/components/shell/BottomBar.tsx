"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Layers,
  LayoutGrid,
  Plus,
  Search,
  Settings,
} from "lucide-react";
import { useLocalePick } from "@/i18n/IntlProvider";
import { cn } from "@/lib/utils/cn";

type BottomBarProps = {
  workspaceId?: string | undefined;
  onSearchClick?: () => void;
  onAddClick?: () => void;
};

export function BottomBar({ workspaceId, onSearchClick, onAddClick }: BottomBarProps) {
  const pathname = usePathname();
  const pick = useLocalePick();

  const items = [
    {
      key: "home",
      href: "/dashboard",
      label: pick("Ana", "Home"),
      icon: LayoutGrid,
      isActive: pathname === "/dashboard",
    },
    {
      key: "cards",
      href: workspaceId ? `/w/${workspaceId}/cards` : "/dashboard",
      label: pick("Kartlar", "Cards"),
      icon: Layers,
      disabled: !workspaceId,
      isActive: workspaceId ? pathname === `/w/${workspaceId}/cards` : false,
    },
  ];

  const tail = [
    {
      key: "search",
      label: pick("Ara", "Search"),
      icon: Search,
      onClick: onSearchClick,
    },
    {
      key: "settings",
      label: pick("Ayarlar", "Settings"),
      icon: Settings,
      href: "/settings",
      isActive: pathname === "/settings",
    },
  ] as const;

  return (
    <nav
      role="navigation"
      aria-label={pick("Hızlı erişim", "Quick access")}
      className={cn(
        "fixed bottom-0 left-0 right-0 z-30 flex h-[68px] items-center justify-around",
        "border-t border-rule bg-paper/95 px-2 backdrop-blur-md",
        "pb-[env(safe-area-inset-bottom)] md:hidden",
      )}
    >
      {items.map(({ key, href, label, icon: Icon, isActive, disabled }) => (
        <Link
          key={key}
          href={href}
          aria-current={isActive ? "page" : undefined}
          aria-disabled={disabled}
          tabIndex={disabled ? -1 : 0}
          className={cn(
            "flex h-12 min-w-[52px] flex-col items-center justify-center gap-1 rounded-[10px] px-3",
            "transition-[background,color] duration-[120ms] ease-[cubic-bezier(0.2,0.6,0.2,1)]",
            isActive
              ? "bg-accent-wash text-accent-ink font-semibold"
              : "text-ink-3 active:text-ink hover:bg-paper-2",
            disabled && "pointer-events-none opacity-40",
          )}
        >
          <Icon className="h-5 w-5" aria-hidden />
          <span className="text-[10.5px] font-medium leading-none">{label}</span>
        </Link>
      ))}

      <button
        type="button"
        onClick={onAddClick}
        aria-label={pick("Ekle", "Add")}
        className={cn(
          "grid h-12 w-12 -translate-y-3 place-items-center rounded-full",
          "bg-accent-hot text-white shadow-[var(--shadow-medium)]",
          "transition-transform duration-[160ms] ease-[cubic-bezier(0.34,1.56,0.64,1)]",
          "hover:-translate-y-4 active:translate-y-[-10px] active:scale-95",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-paper",
        )}
      >
        <Plus className="h-5 w-5" aria-hidden />
      </button>

      {tail.map((item) => {
        const Icon = item.icon;
        const baseClass = cn(
          "flex h-12 min-w-[52px] flex-col items-center justify-center gap-1 rounded-[10px] px-3",
          "transition-[background,color] duration-[120ms] ease-[cubic-bezier(0.2,0.6,0.2,1)]",
        );
        const isActive = "isActive" in item ? item.isActive : false;
        const className = cn(
          baseClass,
          isActive
            ? "bg-accent-wash text-accent-ink font-semibold"
            : "text-ink-3 active:text-ink hover:bg-paper-2",
        );

        if ("href" in item) {
          return (
            <Link
              key={item.key}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              className={className}
            >
              <Icon className="h-5 w-5" aria-hidden />
              <span className="text-[10.5px] font-medium leading-none">{item.label}</span>
            </Link>
          );
        }
        return (
          <button
            key={item.key}
            type="button"
            onClick={item.onClick}
            aria-label={item.label}
            className={className}
          >
            <Icon className="h-5 w-5" aria-hidden />
            <span className="text-[10.5px] font-medium leading-none">{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
