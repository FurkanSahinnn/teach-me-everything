"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Search } from "@/components/icons";
import { cn } from "@/lib/utils/cn";

import {
  SETTINGS_GROUPS,
  filterSettingsSections,
  settingsSectionForPath,
  type SettingsSectionId,
} from "./settings-nav";

export function SettingsSidebarNav() {
  const t = useTranslations("settings");
  const pathname = usePathname();
  const active = settingsSectionForPath(pathname).id;
  const [query, setQuery] = useState("");
  const labelOf = (id: SettingsSectionId) => t(`nav.${id}`);
  const visible = filterSettingsSections(query, labelOf);

  return (
    <nav aria-label={t("ayarlar")} className="flex flex-col gap-4">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-4" aria-hidden />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("nav_search")}
          aria-label={t("nav_search")}
          className="h-8 w-full rounded-[var(--radius-sm)] border border-rule bg-paper-2 pl-8 pr-2 text-[13px] text-ink placeholder:text-ink-4 focus:border-rule-strong focus:outline-none"
        />
      </div>
      {SETTINGS_GROUPS.map((group) => {
        const items = visible.filter((s) => s.group === group);
        if (items.length === 0) return null;
        return (
          <div key={group}>
            {group !== "app" ? (
              <div className="mb-1 px-2 text-[11.5px] font-medium text-ink-4">{t(`nav_group.${group}`)}</div>
            ) : null}
            <ul className="space-y-0.5">
              {items.map((s) => {
                const Icon = s.icon;
                const isActive = s.id === active;
                return (
                  <li key={s.id}>
                    <Link
                      href={s.href}
                      aria-current={isActive ? "page" : undefined}
                      className={cn(
                        "flex items-center gap-2.5 rounded-[var(--radius-sm)] px-2 py-1.5 text-[13px] transition-colors",
                        isActive
                          ? "bg-paper-3 font-medium text-ink"
                          : "text-ink-2 hover:bg-paper-3 hover:text-ink",
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0 text-ink-3" aria-hidden />
                      {labelOf(s.id)}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
      {visible.length === 0 ? (
        <p className="px-2 text-[12.5px] text-ink-4">{t("nav_no_match")}</p>
      ) : null}
    </nav>
  );
}
