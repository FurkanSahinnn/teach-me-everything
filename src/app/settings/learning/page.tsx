"use client";

import { useTranslations } from "next-intl";
import { useLocalePick } from "@/i18n/IntlProvider";
import {
  SettingsGroup,
  SettingsPage,
  SettingsSection,
} from "@/components/settings/layout/SettingsPrimitives";
import { NumberRow, SelectRow, ToggleRow } from "@/components/settings/PreferenceRows";

export default function LearningSettingsPage() {
  const t = useTranslations("settings");
  const pick = useLocalePick();
  return (
    <SettingsPage
      title={t("nav.learning")}
      description={pick(
        "SRS algoritmasını ve günlük hedeflerini ayarla.",
        "Configure the SRS algorithm and daily targets.",
      )}
    >
      <SettingsSection title={t("ogrenme_davranisi")}>
        <SettingsGroup>
          <SelectRow
            label={t("srs_algoritmasi")}
            value="sm2"
            options={[
              { value: "sm2", tr: "SM-2 (klasik)", en: "SM-2 (classic)" },
              { value: "fsrs", tr: "FSRS (deneysel)", en: "FSRS (experimental)" },
            ]}
          />
          <NumberRow
            label={t("gunluk_yeni_kart")}
            value={20}
            hint={t("onerilen_1030")}
          />
          <NumberRow
            label={t("maksimum_gunluk_tekrar")}
            value={200}
            hint={pick(
              "Birikim varsa geçici olarak artır",
              "Increase temporarily when backlog builds up",
            )}
          />
          <ToggleRow
            label={pick("Quiz yanlışlarından kart üret", "Generate cards from quiz misses")}
            desc={pick(
              "Açık uçlu quizde hatalı cevaplar için otomatik kart önerisi",
              "Auto-suggest cards for wrong answers in open-ended quiz",
            )}
            defaultOn
          />
        </SettingsGroup>
      </SettingsSection>
    </SettingsPage>
  );
}
