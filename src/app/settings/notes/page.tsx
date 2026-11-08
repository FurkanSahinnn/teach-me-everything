"use client";

import { useTranslations } from "next-intl";
import { useLocalePick } from "@/i18n/IntlProvider";
import { SettingsPage, SettingsSection } from "@/components/settings/layout/SettingsPrimitives";
import { DailyNotesSection } from "@/components/settings/DailyNotesSection";
import { VaultSection } from "@/components/settings/VaultSection";

export default function NotesSettingsPage() {
  const t = useTranslations("settings");
  const pick = useLocalePick();
  return (
    <SettingsPage
      title={t("nav.notes")}
      description={pick(
        "Not kasası klasörü ve günlük not şablonu.",
        "Notes vault folder and the daily note template.",
      )}
    >
      <SettingsSection>
        <VaultSection />
      </SettingsSection>
      <SettingsSection title={pick("Günlük notlar", "Daily notes")}>
        <DailyNotesSection />
      </SettingsSection>
    </SettingsPage>
  );
}
