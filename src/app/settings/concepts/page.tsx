"use client";

import { useTranslations } from "next-intl";
import { useLocalePick } from "@/i18n/IntlProvider";
import { SettingsPage, SettingsSection } from "@/components/settings/layout/SettingsPrimitives";
import { ConceptsSection } from "@/components/settings/ConceptsSection";

export default function ConceptsSettingsPage() {
  const t = useTranslations("settings");
  const pick = useLocalePick();
  return (
    <SettingsPage
      title={t("nav.concepts")}
      description={pick(
        "Mind map için workspace başına konsept ve ilişki grafiği üret. Mevcut grafik yenilenir.",
        "Generate a per-workspace concept and relation graph for the mind map. Replaces the existing graph.",
      )}
    >
      <SettingsSection>
        <ConceptsSection />
      </SettingsSection>
    </SettingsPage>
  );
}
