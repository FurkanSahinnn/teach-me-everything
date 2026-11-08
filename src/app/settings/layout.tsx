"use client";

import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { AppShell } from "@/components/shell/AppShell";
import { SettingsSidebarNav } from "@/components/settings/layout/SettingsSidebarNav";
import { settingsSectionForPath } from "@/components/settings/layout/settings-nav";

export default function SettingsLayout({ children }: { children: ReactNode }) {
  const t = useTranslations("settings");
  const section = settingsSectionForPath(usePathname());

  return (
    <AppShell title={t("ayarlar")} breadcrumb={[t("ayarlar"), t(`nav.${section.id}`)]}>
      <div className="mx-auto grid max-w-[1180px] grid-cols-1 gap-6 px-4 pb-20 pt-5 sm:px-6 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-10 lg:px-8 lg:pt-7">
        <aside className="lg:sticky lg:top-4 lg:self-start">
          <SettingsSidebarNav />
        </aside>
        <main className="min-w-0">{children}</main>
      </div>
    </AppShell>
  );
}
