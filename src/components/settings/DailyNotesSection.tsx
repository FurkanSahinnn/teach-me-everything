"use client";

// Phase 6.7 — Settings → Tercihler: user-tunable defaults for the "Bugünün
// notu" sidebar button. Empty values mean "use the locale-aware default"
// so a future TR↔EN flip swaps copy automatically without the user having
// to reset anything. The preview pane resolves the same effective template
// the runtime would use, so what the user sees here is exactly what the
// next click of "Bugün" will produce.

import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { SettingsGroup, SettingsRow } from "@/components/settings/layout/SettingsPrimitives";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";
import { usePrefs } from "@/stores/prefs";
import {
  formatDateForLocale,
  getDefaultDailyFolderName,
  getDefaultDailyTemplate,
  renderDailyTemplate,
} from "@/lib/notes/daily";

export function DailyNotesSection() {
  const t = useTranslations("notes.daily");
  const locale = usePrefs((s) => s.locale);
  const dailyTemplate = usePrefs((s) => s.notesUi.dailyTemplate);
  const dailyFolderName = usePrefs((s) => s.notesUi.dailyFolderName);
  const setNotesDailyTemplate = usePrefs((s) => s.setNotesDailyTemplate);
  const setNotesDailyFolderName = usePrefs((s) => s.setNotesDailyFolderName);
  const resetNotesDailyDefaults = usePrefs((s) => s.resetNotesDailyDefaults);
  const { toast } = useToast();

  const dailyLocale = locale === "tr" ? "tr" : "en";
  const defaultFolder = getDefaultDailyFolderName(dailyLocale);
  const defaultTemplate = getDefaultDailyTemplate(dailyLocale);

  // Effective values — what the "Bugün" button would actually use. Empty
  // user input falls back to the locale default.
  const effectiveTemplate =
    dailyTemplate.trim().length > 0 ? dailyTemplate : defaultTemplate;

  const preview = useMemo(() => {
    const dateString = formatDateForLocale(new Date(), dailyLocale);
    return renderDailyTemplate(effectiveTemplate, {
      dateString,
      locale: dailyLocale,
    });
  }, [effectiveTemplate, dailyLocale]);

  const isCustom =
    dailyTemplate.trim().length > 0 || dailyFolderName.trim().length > 0;

  return (
    <SettingsGroup>
      <SettingsRow
        title={t("section_title")}
        description={t("description")}
        control={
          isCustom ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                resetNotesDailyDefaults();
                toast({
                  title: t("restored_toast"),
                  variant: "success",
                });
              }}
            >
              {t("restore_defaults")}
            </Button>
          ) : null
        }
      />
      <SettingsRow
        title={t("folder_name_label")}
        description={t("folder_name_hint")}
        htmlFor="daily-folder-name"
      >
        <Input
          id="daily-folder-name"
          value={dailyFolderName}
          onChange={(e) => setNotesDailyFolderName(e.target.value)}
          placeholder={t("folder_name_placeholder", { default: defaultFolder })}
          autoComplete="off"
        />
      </SettingsRow>
      <SettingsRow
        title={t("template_label")}
        description={t("template_hint")}
        htmlFor="daily-template"
      >
        <textarea
          id="daily-template"
          value={dailyTemplate}
          onChange={(e) => setNotesDailyTemplate(e.target.value)}
          placeholder={defaultTemplate}
          rows={6}
          className="block w-full rounded-[8px] border border-rule bg-paper-2 px-3 py-2 font-mono text-[12.5px] leading-6 text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          spellCheck={false}
        />
      </SettingsRow>
      <SettingsRow title={t("preview_title")}>
        <pre className="max-h-48 overflow-auto rounded-[8px] border border-rule bg-paper-2 px-3 py-2 font-mono text-[12px] leading-6 text-ink whitespace-pre-wrap">
          {preview}
        </pre>
      </SettingsRow>
    </SettingsGroup>
  );
}
