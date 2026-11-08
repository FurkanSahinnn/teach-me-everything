"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useLocalePick } from "@/i18n/IntlProvider";
import {
  SettingsGroup,
  SettingsPage,
  SettingsSection,
} from "@/components/settings/layout/SettingsPrimitives";
import { resolveLegacySettingsHash } from "@/components/settings/layout/settings-nav";
import { AILocaleSection } from "@/components/settings/AILocaleSection";
import { AutoLaunchSection } from "@/components/settings/AutoLaunchSection";
import { isTauriEnv } from "@/lib/tauri/env";
import { LanguagePreferenceRow } from "@/components/settings/PreferenceRows";

export default function GeneralSettingsPage() {
  const t = useTranslations("settings");
  const pick = useLocalePick();
  const router = useRouter();

  // Old single-page settings used `/settings#api`-style hashes; keep external
  // and bookmarked deep links working by forwarding them to the new routes.
  useEffect(() => {
    const href = resolveLegacySettingsHash(window.location.hash);
    if (href && href !== "/settings") router.replace(href);
  }, [router]);

  return (
    <SettingsPage
      title={t("nav.general")}
      description={pick(
        "Arayüz dili, yapay zeka yanıt dili ve başlangıç davranışı.",
        "Interface language, AI response language and startup behaviour.",
      )}
    >
      <SettingsSection title={pick("Dil", "Language")}>
        <SettingsGroup>
          <LanguagePreferenceRow />
        </SettingsGroup>
        <AILocaleSection />
      </SettingsSection>
      {isTauriEnv() ? (
        <SettingsSection title={pick("Başlangıç", "Startup")}>
          <AutoLaunchSection />
        </SettingsSection>
      ) : null}
    </SettingsPage>
  );
}
