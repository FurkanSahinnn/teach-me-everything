"use client";

import { useTranslations } from "next-intl";

import { CostSection } from "@/components/settings/CostSection";
import { SettingsPage, SettingsSection } from "@/components/settings/layout/SettingsPrimitives";
import { UsageView } from "@/components/settings/usage/UsageView";
import { useLocalePick } from "@/i18n/IntlProvider";

export default function UsageSettingsPage() {
  const t = useTranslations("settings");
  const pick = useLocalePick();
  return (
    <SettingsPage
      title={t("nav.usage")}
      description={pick(
        "Bu bilgisayardaki Claude Code ve Codex kullanımın: abonelik limitleri, token'lar ve liste fiyatlarıyla tahmini API maliyeti. Günlükler yalnız okunur, hiçbir yere gönderilmez.",
        "Your Claude Code and Codex usage on this computer: subscription limits, tokens and estimated API cost at list prices. Logs are only read, never sent anywhere.",
      )}
    >
      <UsageView />
      <SettingsSection title={pick("Uygulama içi maliyet gösterimi", "In-app cost display")}>
        <CostSection />
      </SettingsSection>
    </SettingsPage>
  );
}
