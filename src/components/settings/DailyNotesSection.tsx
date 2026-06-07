"use client";

// Phase 6.7 — Settings → Tercihler: user-tunable defaults for the "Bugünün
// notu" sidebar button. Empty values mean "use the locale-aware default"
// so a future TR↔EN flip swaps copy automatically without the user having
// to reset anything. The preview pane resolves the same effective template
// the runtime would use, so what the user sees here is exactly what the
// next click of "Bugün" will produce.

import { CalendarDays } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { Card } from "@/components/ui/Card";
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
    <Card padding="md" variant="default">
      <div className="flex items-start gap-3">
        <span
          className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border border-rule bg-paper-2 text-accent"
          aria-hidden
        >
          <CalendarDays className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] font-semibold leading-tight text-ink">
            {t("section_title")}
          </h3>
          <p className="mt-1 max-w-[60ch] text-[13px] leading-6 text-ink-3">
            {t("description")}
          </p>

          <div className="mt-4">
            <label
              className="block text-[13.5px] font-medium text-ink"
              htmlFor="daily-folder-name"
            >
              {t("folder_name_label")}
            </label>
            <Input
              id="daily-folder-name"
              value={dailyFolderName}
              onChange={(e) => setNotesDailyFolderName(e.target.value)}
              placeholder={t("folder_name_placeholder", { default: defaultFolder })}
              className="mt-2"
              autoComplete="off"
            />
            <p className="mt-1.5 text-[12px] leading-5 text-ink-3">
              {t("folder_name_hint")}
            </p>
          </div>

          <div className="mt-5">
            <label
              className="block text-[13.5px] font-medium text-ink"
              htmlFor="daily-template"
            >
              {t("template_label")}
            </label>
            <textarea
              id="daily-template"
              value={dailyTemplate}
              onChange={(e) => setNotesDailyTemplate(e.target.value)}
              placeholder={defaultTemplate}
              rows={6}
              className="mt-2 block w-full rounded-[8px] border border-rule bg-paper-2 px-3 py-2 font-mono text-[12.5px] leading-6 text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
              spellCheck={false}
            />
            <p className="mt-1.5 text-[12px] leading-5 text-ink-3">
              {t("template_hint")}
            </p>
          </div>

          <div className="mt-5">
            <div className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-3">
              {t("preview_title")}
            </div>
            <pre className="mt-2 max-h-48 overflow-auto rounded-[8px] border border-rule bg-paper-2 px-3 py-2 font-mono text-[12px] leading-6 text-ink whitespace-pre-wrap">
              {preview}
            </pre>
          </div>

          {isCustom ? (
            <div className="mt-4 flex justify-end">
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
            </div>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
