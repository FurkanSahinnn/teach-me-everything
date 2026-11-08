"use client";

import { useTranslations } from "next-intl";
import { useLocalePick } from "@/i18n/IntlProvider";
import { SettingsPage, SettingsSection } from "@/components/settings/layout/SettingsPrimitives";
import { UpdatesSection } from "@/components/settings/UpdatesSection";

export default function UpdatesSettingsPage() {
  const t = useTranslations("settings");
  const pick = useLocalePick();
  return (
    <SettingsPage
      title={t("nav.updates")}
      description={pick(
        "Uygulama sürümü ve güncelleme denetimi.",
        "App version and update checks.",
      )}
    >
      <SettingsSection>
        <UpdatesSection />
      </SettingsSection>
    </SettingsPage>
  );
}
