"use client";

import { ExternalLink, Info } from "@/components/icons";
import { useTranslations } from "next-intl";
import { useLocalePick } from "@/i18n/IntlProvider";
import { Button } from "@/components/ui/Button";
import {
  SettingsGroup,
  SettingsPage,
  SettingsRow,
  SettingsSection,
} from "@/components/settings/layout/SettingsPrimitives";

export default function AboutSettingsPage() {
  const t = useTranslations("settings");
  const pick = useLocalePick();
  return (
    <SettingsPage
      title={t("nav.about")}
      description={pick(
        "Teach Me Everything · MIT lisansı · yerel olarak çalışır.",
        "Teach Me Everything · MIT license · runs locally.",
      )}
    >
      <SettingsSection>
        <SettingsGroup>
          <SettingsRow
            title={t("surum")}
            description="build · 2026-04-20"
            control={<span className="font-serif text-[18px] font-medium text-ink">v0.1.0</span>}
          />
          <SettingsRow
            title={t("katki")}
            control={
              <Button size="sm">
                <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                github.com/teach-me-everything
              </Button>
            }
          />
        </SettingsGroup>
        <div className="flex items-center gap-2 text-[12px] text-ink-3">
          <Info className="h-3.5 w-3.5" aria-hidden />
          {pick(
            "Sorun yaşıyorsan README'ye bak ya da bir issue aç.",
            "If you hit a bug check the README or open an issue.",
          )}
        </div>
      </SettingsSection>
    </SettingsPage>
  );
}
