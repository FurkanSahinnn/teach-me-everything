"use client";

import { Languages } from "lucide-react";
import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/Card";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { usePrefs, type AiResponseLocale } from "@/stores/prefs";

export function AILocaleSection(): React.ReactElement {
  const t = useTranslations("ai_locale");
  const aiResponseLocale = usePrefs((s) => s.aiResponseLocale);
  const setAiResponseLocale = usePrefs((s) => s.setAiResponseLocale);

  return (
    <Card padding="md" variant="default">
      <div className="flex items-start gap-3">
        <span
          className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border border-rule bg-paper-2 text-accent"
          aria-hidden
        >
          <Languages className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] font-semibold leading-tight text-ink">
            {t("section_title")}
          </h3>
          <p className="mt-1 max-w-[60ch] text-[13px] leading-6 text-ink-3">
            {t("description")}
          </p>
          <div className="mt-4">
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
          </div>
        </div>
      </div>
    </Card>
  );
}
