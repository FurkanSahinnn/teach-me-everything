"use client";

import { useTranslations } from "next-intl";
import { useLocalePick } from "@/i18n/IntlProvider";
import { SettingsPage, SettingsSection } from "@/components/settings/layout/SettingsPrimitives";
import { SettingsGroup } from "@/components/settings/layout/SettingsPrimitives";
import { AppearancePreferenceRows } from "@/components/settings/PreferenceRows";

export default function AppearanceSettingsPage() {
  const t = useTranslations("settings");
  const pick = useLocalePick();
  return (
    <SettingsPage
      title={t("nav.appearance")}
      description={pick(
        "Görsel tema, yazı tipi ve yoğunluk. Anında uygulanır.",
        "Theme, font and density. Applied instantly.",
      )}
    >
      <SettingsSection>
        <SettingsGroup>
          <AppearancePreferenceRows />
        </SettingsGroup>
      </SettingsSection>
    </SettingsPage>
  );
}
