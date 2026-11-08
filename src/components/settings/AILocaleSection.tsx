"use client";

import { useTranslations } from "next-intl";
import { SettingsGroup, SettingsRow } from "@/components/settings/layout/SettingsPrimitives";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { usePrefs, type AiResponseLocale } from "@/stores/prefs";

export function AILocaleSection(): React.ReactElement {
  const t = useTranslations("ai_locale");
  const aiResponseLocale = usePrefs((s) => s.aiResponseLocale);
  const setAiResponseLocale = usePrefs((s) => s.setAiResponseLocale);

  return (
    <SettingsGroup>
      <SettingsRow
        title={t("section_title")}
        description={t("description")}
        control={
          <SegmentedControl<AiResponseLocale>
            size="sm"
            value={aiResponseLocale}
            onChange={setAiResponseLocale}
            options={[
              { value: "tr", label: t("option_tr") },
              { value: "en", label: t("option_en") },
              { value: "follow_source", label: t("option_follow") },
            ]}
            ariaLabel={t("section_title")}
          />
        }
      />
    </SettingsGroup>
  );
}
