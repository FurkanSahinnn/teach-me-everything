"use client";

import { useTranslations } from "next-intl";
import { useLocalePick } from "@/i18n/IntlProvider";
import { SettingsPage, SettingsSection } from "@/components/settings/layout/SettingsPrimitives";
import { BackupSection } from "@/components/settings/BackupSection";
import { QuotaSection } from "@/components/settings/QuotaSection";

export default function DataSettingsPage() {
  const t = useTranslations("settings");
  const pick = useLocalePick();
  return (
    <SettingsPage
      title={t("nav.data")}
      description={pick(
        "Yedekleme, geri yükleme ve depolama kotası. apiKeys + vault yedeğe dahil edilmez.",
        "Backup, restore and storage quota. apiKeys + vault are excluded from backups.",
      )}
    >
      <SettingsSection>
        <BackupSection />
        <QuotaSection />
      </SettingsSection>
    </SettingsPage>
  );
}
