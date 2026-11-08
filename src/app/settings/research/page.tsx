"use client";

import { useTranslations } from "next-intl";
import { useLocalePick } from "@/i18n/IntlProvider";
import {
  SettingsGroup,
  SettingsPage,
  SettingsSection,
} from "@/components/settings/layout/SettingsPrimitives";
import { ApiKeyRow, SETTINGS_PROVIDERS } from "@/components/settings/ApiKeyRow";
import { SearchProvidersSection } from "@/components/settings/SearchProvidersSection";
import { WebSearchSection } from "@/components/settings/WebSearchSection";
import { useApiKeyManager } from "@/hooks/useApiKeyManager";

export default function ResearchSettingsPage() {
  const t = useTranslations("settings");
  const pick = useLocalePick();
  const keys = useApiKeyManager(SETTINGS_PROVIDERS);

  return (
    <SettingsPage
      title={t("nav.research")}
      description={pick(
        "Web sayfası çıkarma ve \"Konu ara\" için arama sağlayıcıları ve anahtarları.",
        "Search providers and keys for page extraction and the \"Search topic\" flow.",
      )}
    >
      <SettingsSection title={pick("Anahtarlar", "Keys")}>
        <SettingsGroup>
          <ApiKeyRow
            title="Firecrawl"
            desc={pick("Web sayfası parse etmek ve arşiv çekmek için.", "For scraping web pages and archives.")}
            placeholder="fc-•••••••••••••••••••••••"
            provider="firecrawl"
            keys={keys}
            optional
          />
          <ApiKeyRow
            title="Diffbot"
            desc={pick(
              "JS-render edilen sayfalardan başlık, yazar ve gövde çıkarmak için. Article API kullanılır.",
              "Extract title, author, and body from JS-rendered pages via the Article API.",
            )}
            placeholder="diffbot-token-•••••••••••••••••••••••"
            provider="diffbot"
            keys={keys}
            optional
          />
          <ApiKeyRow
            title="Bright Data"
            desc={pick(
              "Anti-bot korumalı sayfalar için Web Unlocker proxy. Zone adı varsayılan: \"web_unlocker\".",
              "Web Unlocker proxy for anti-bot-protected pages. Default zone: \"web_unlocker\".",
            )}
            placeholder="brd-•••••••••••••••••••••••"
            provider="brightdata"
            keys={keys}
            optional
          />
          <ApiKeyRow
            title="Brave Search"
            desc={pick(
              "\"Konu ara → Kaynak ekle\" modalı için web arama. Brave Search dashboard'undan üret.",
              "Powers the \"Search topic → Add as sources\" modal. Generate from the Brave Search dashboard.",
            )}
            placeholder="BSA-•••••••••••••••••••••••"
            provider="brave"
            keys={keys}
            optional
          />
          <ApiKeyRow
            title="Exa"
            desc={pick(
              "Hem URL içerik çıkarma hem \"Konu ara\" zincirinde neural search. Exa dashboard'undan üret.",
              "Both URL extraction and neural search in the \"Search topic\" chain. Generate from the Exa dashboard.",
            )}
            placeholder="exa-•••••••••••••••••••••••"
            provider="exa"
            keys={keys}
            optional
          />
          <ApiKeyRow
            title="Tavily"
            desc={pick(
              "Search + content extraction. Cömert free tier — research provider olarak veya search zincirinde kullanılabilir.",
              "Search + content extraction. Generous free tier — usable as research provider or in the search chain.",
            )}
            placeholder="tvly-•••••••••••••••••••••••"
            provider="tavily"
            keys={keys}
            optional
          />
          <ApiKeyRow
            title="Jina Reader"
            desc={pick(
              "r.jina.ai proxy ile temiz markdown. Free tier anahtarsız çalışır; anahtar daha yüksek limit sağlar.",
              "Clean markdown via the r.jina.ai proxy. Free tier works without a key; a key raises the rate limit.",
            )}
            placeholder="jina_•••••••••••••••••••••••"
            provider="jina"
            keys={keys}
            optional
          />
        </SettingsGroup>
      </SettingsSection>

      <SettingsSection>
        <SearchProvidersSection />
      </SettingsSection>
      <SettingsSection>
        <WebSearchSection />
      </SettingsSection>
    </SettingsPage>
  );
}
