"use client";

import { ExternalLink, Trash2 } from "@/components/icons";
import { AnthropicPreferenceRow, ApiKeyRow, type ApiKeyManager } from "@/components/settings/ApiKeyRow";
import { SettingsGroup, SettingsRow, SettingsSection } from "@/components/settings/layout/SettingsPrimitives";
import { Button } from "@/components/ui/Button";
import { useLocalePick } from "@/i18n/IntlProvider";
import type { ProviderEntry } from "@/lib/ai/provider-catalog";
import { getPreset } from "@/lib/ai/providers/presets";
import type { ProviderId } from "@/lib/ai/providers/types";
import type { Provider } from "@/lib/db/schema";
import { usePrefs } from "@/stores/prefs";

type LocalePick = (tr: string, en: string) => string;

type KeyCopy = { desc: [string, string]; placeholder: string };

const KEY_COPY: Readonly<Record<string, KeyCopy>> = {
  anthropic: {
    desc: ["Anthropic Console'dan üretilen API anahtarı. Kullandıkça faturalanır.", "API key from the Anthropic Console. Pay-per-use billing."],
    placeholder: "sk-ant-api03-•••••••••••••••••••••••",
  },
  "claude-code-oauth": {
    desc: [
      "Claude aboneliğini anahtar olarak kullanmak istersen: terminalde `claude setup-token` ile üret. Yerel Claude Code CLI sağlayıcısı token gerektirmez.",
      "To use your Claude subscription as a key: generate one with `claude setup-token`. The local Claude Code CLI provider needs no token.",
    ],
    placeholder: "sk-ant-oat01-•••••••••••••••••••••••",
  },
  "google-gemini": {
    desc: ["Gemini sohbet, özet ve embedding modelleri. Google AI Studio'dan üret.", "Gemini chat, summary and embedding models. Generate in Google AI Studio."],
    placeholder: "AIza•••••••••••••••••••••••••••••••••••",
  },
  openai: { desc: ["OpenAI sohbet ve embedding modelleri.", "OpenAI chat and embedding models."], placeholder: "sk-proj-•••••••••••••••••••••••" },
  openrouter: {
    desc: ["Çok sayıda modeli tek anahtarla kullanmak için.", "Use many models through one key."],
    placeholder: "sk-or-v1-•••••••••••••••••••••••",
  },
  perplexity: { desc: ["Sonar modelleri ve \"Konu ara\" web araması.", "Sonar models and \"Search topic\" web search."], placeholder: "pplx-•••••••••••••••••••••••" },
  xai: { desc: ["Grok modelleri ve canlı arama.", "Grok models and live search."], placeholder: "xai-•••••••••••••••••••••••" },
};

const GENERIC_COPY: KeyCopy = {
  desc: ["API anahtarını sağlayıcının konsolundan al.", "Get the API key from the provider's console."],
  placeholder: "•••••••••••••••••••••••",
};

function KeyRow({ provider, title, keys, optional, pick }: { provider: Provider; title: string; keys: ApiKeyManager; optional?: boolean; pick: LocalePick }) {
  const copy = KEY_COPY[provider] ?? GENERIC_COPY;
  return (
    <ApiKeyRow title={title} desc={pick(...copy.desc)} placeholder={copy.placeholder} provider={provider} keys={keys} {...(optional ? { optional } : {})} />
  );
}

type Props = { entry: ProviderEntry; keys: ApiKeyManager };

export function ApiProviderDetail({ entry, keys }: Props) {
  const pick = useLocalePick();
  if (entry.group === "custom") return <CustomEndpointDetail entry={entry} keys={keys} pick={pick} />;

  const preset = getPreset(entry.id as ProviderId);
  const isLocal = entry.group === "local";

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-ink">{entry.label}</h2>
          <p className="mt-0.5 text-[12.5px] text-ink-3">
            {isLocal
              ? pick("Kendi bilgisayarında ya da ağında çalışan sunucu; istekler doğrudan gider.", "A server on your machine or network; requests go to it directly.")
              : pick("Kendi API anahtarınla (BYOK) kullanılan bulut sağlayıcı.", "Cloud provider used with your own API key (BYOK).")}
          </p>
        </div>
        {preset?.docsUrl ? (
          <a href={preset.docsUrl} target="_blank" rel="noopener noreferrer" className="inline-flex shrink-0 items-center gap-1 text-[12.5px] text-accent hover:underline">
            {pick("Belgeler", "Docs")}
            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          </a>
        ) : null}
      </div>

      <SettingsSection title={isLocal ? pick("Erişim", "Access") : pick("Kimlik bilgisi", "Credentials")}>
        <SettingsGroup>
          {entry.id === "anthropic" ? (
            <>
              <KeyRow provider="anthropic" title="API key" keys={keys} pick={pick} />
              <KeyRow provider="claude-code-oauth" title="Claude OAuth token" keys={keys} optional pick={pick} />
              <AnthropicPreferenceRow />
            </>
          ) : (
            <KeyRow provider={entry.id as Provider} title={pick("API anahtarı", "API key")} keys={keys} optional={isLocal} pick={pick} />
          )}
        </SettingsGroup>
      </SettingsSection>

      {preset ? (
        <SettingsSection title={pick("Bağlantı", "Connection")}>
          <SettingsGroup>
            <SettingsRow title={pick("Adres", "Base URL")} control={<span className="break-all font-mono text-[12px] text-ink-2">{preset.baseUrl}</span>} />
            <SettingsRow
              title={pick("Araç kullanımı", "Tool use")}
              description={pick("Kart ekleme gibi uygulama araçlarının nasıl çağrıldığı.", "How app tools such as adding a card are invoked.")}
              control={<span className="text-[12.5px] text-ink-2">{toolUseLabel(preset.capabilities.toolUse, pick)}</span>}
            />
            {preset.availableModels?.length ? (
              <SettingsRow
                title={pick("Modeller", "Models")}
                description={pick("Varsayılan model seçimi Modeller sayfasındadır.", "Default model selection lives on the Models page.")}
                control={<span className="text-[12.5px] text-ink-2 tabular-nums">{preset.availableModels.length}</span>}
              />
            ) : null}
          </SettingsGroup>
          {isLocal ? (
            <p className="text-[12px] text-ink-3">
              {pick("Farklı bir adres ya da port için Özel uç nokta ekle.", "For a different address or port, add a custom endpoint.")}
            </p>
          ) : null}
        </SettingsSection>
      ) : null}
    </div>
  );
}

function toolUseLabel(toolUse: "native" | "json" | "none", pick: LocalePick): string {
  if (toolUse === "native") return pick("Yerel", "Native");
  if (toolUse === "json") return pick("JSON protokolü", "JSON protocol");
  return pick("Desteklenmiyor", "Not supported");
}

function CustomEndpointDetail({ entry, keys, pick }: { entry: ProviderEntry; keys: ApiKeyManager; pick: LocalePick }) {
  const endpointId = entry.id.replace(/^custom:/, "");
  const endpoint = usePrefs((s) => s.customEndpoints.find((e) => e.id === endpointId));
  const removeCustomEndpoint = usePrefs((s) => s.removeCustomEndpoint);
  if (!endpoint) return null;

  async function handleRemove(): Promise<void> {
    if (!endpoint) return;
    const ok = window.confirm(pick(`"${endpoint.label}" sağlayıcısını silmek istediğine emin misin?`, `Remove "${endpoint.label}"?`));
    if (!ok) return;
    if (endpoint.hasKey) await keys.remove(`custom:${endpoint.id}`);
    removeCustomEndpoint(endpoint.id);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-ink">{endpoint.label}</h2>
          <p className="mt-0.5 text-[12.5px] text-ink-3">{pick("Kendi eklediğin uç nokta.", "An endpoint you added.")}</p>
        </div>
        <Button size="sm" variant="danger" onClick={() => void handleRemove()}>
          <Trash2 className="h-3.5 w-3.5" aria-hidden />
          {pick("Sil", "Remove")}
        </Button>
      </div>
      <SettingsGroup>
        <SettingsRow title={pick("Adres", "Base URL")} control={<span className="break-all font-mono text-[12px] text-ink-2">{endpoint.baseUrl}</span>} />
        <SettingsRow title={pick("Protokol", "Protocol")} control={<span className="text-[12.5px] text-ink-2">{endpoint.family}</span>} />
        <SettingsRow
          title={pick("Anahtar", "Key")}
          control={<span className="text-[12.5px] text-ink-2">{endpoint.hasKey ? pick("Kayıtlı", "Saved") : pick("Yok", "None")}</span>}
        />
      </SettingsGroup>
    </div>
  );
}
