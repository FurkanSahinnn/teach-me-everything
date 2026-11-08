"use client";

import { useTranslations } from "next-intl";

import { VaultBanner } from "@/components/settings/ApiKeyRow";
import { SettingsPage } from "@/components/settings/layout/SettingsPrimitives";
import { ProvidersManager } from "@/components/settings/providers/ProvidersManager";
import { useLocalePick } from "@/i18n/IntlProvider";

export default function ProvidersSettingsPage() {
  const t = useTranslations("settings");
  const pick = useLocalePick();

  return (
    <SettingsPage
      title={t("nav.providers")}
      description={pick(
        "Bilgisayarındaki Claude Code ve Codex CLI'ları otomatik bulunur ve kendi aboneliğinle çalışır. Bulut sağlayıcılar için kendi API anahtarını girersin (BYOK). Kapattığın sağlayıcılar model seçicilerde görünmez.",
        "The Claude Code and Codex CLIs on this computer are detected automatically and run on your own subscription. For cloud providers you enter your own API key (BYOK). Providers you switch off are hidden from the model pickers.",
      )}
    >
      <VaultBanner />
      <ProvidersManager />
    </SettingsPage>
  );
}
