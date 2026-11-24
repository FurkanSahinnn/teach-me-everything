"use client";

import { useTranslations } from "next-intl";
import { useLocalePick } from "@/i18n/IntlProvider";
import { SettingsPage, SettingsSection } from "@/components/settings/layout/SettingsPrimitives";
import { EmbedSection } from "@/components/settings/EmbedSection";
import { LocalEmbedModelsSection } from "@/components/settings/LocalEmbedModelsSection";
import { RechunkSection } from "@/components/settings/RechunkSection";

export default function EmbeddingSettingsPage() {
  const t = useTranslations("settings");
  const pick = useLocalePick();
  return (
    <SettingsPage
      title={t("nav.embedding")}
      description={pick(
        "Workspace içindeki chunks'ı tutarlı bir embedding modeline yeniden göm.",
        "Reembed workspace chunks to a consistent embedding model.",
      )}
    >
      <SettingsSection>
        <LocalEmbedModelsSection />
        <EmbedSection />
        <RechunkSection />
      </SettingsSection>
    </SettingsPage>
  );
}
