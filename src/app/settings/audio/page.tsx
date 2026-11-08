"use client";

import { useTranslations } from "next-intl";
import { useLocalePick } from "@/i18n/IntlProvider";
import { SettingsPage, SettingsSection } from "@/components/settings/layout/SettingsPrimitives";
import { PodcastFeatureSection } from "@/components/settings/PodcastFeatureSection";
import { TtsProviderSection } from "@/components/settings/TtsProviderSection";

export default function AudioSettingsPage() {
  const t = useTranslations("settings");
  const pick = useLocalePick();
  return (
    <SettingsPage
      title={t("nav.audio")}
      description={pick(
        "Podcast ve sesli özet özellikleri ile konuşma sentezi sağlayıcısı.",
        "Podcast and audio summary features, plus the speech synthesis provider.",
      )}
    >
      <SettingsSection title={pick("Özellik", "Feature")}>
        <PodcastFeatureSection />
      </SettingsSection>
      <SettingsSection>
        <TtsProviderSection />
      </SettingsSection>
    </SettingsPage>
  );
}
