"use client";

import { useTranslations } from "next-intl";
import { useLocalePick } from "@/i18n/IntlProvider";
import { SettingsPage, SettingsSection } from "@/components/settings/layout/SettingsPrimitives";
import { DailyNotesSection } from "@/components/settings/DailyNotesSection";
import { NoteEditorSection } from "@/components/settings/NoteEditorSection";
import { VaultSection } from "@/components/settings/VaultSection";

export default function NotesSettingsPage() {
  const t = useTranslations("settings");
  const pick = useLocalePick();
  return (
    <SettingsPage
      title={t("nav.notes")}
      description={pick(
        "Not editörü, not kasası klasörü ve günlük not şablonu.",
        "The note editor, notes vault folder and the daily note template.",
      )}
    >
      <SettingsSection id="editor" title={pick("Not editörü", "Note editor")}>
        <NoteEditorSection />
      </SettingsSection>
      <SettingsSection>
        <VaultSection />
      </SettingsSection>
      <SettingsSection title={pick("Günlük notlar", "Daily notes")}>
        <DailyNotesSection />
      </SettingsSection>
    </SettingsPage>
  );
}
