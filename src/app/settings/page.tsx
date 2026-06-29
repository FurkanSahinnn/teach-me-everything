"use client";

import {
  Check,
  ExternalLink,
  Info,
  Lock,
  Palette,
  ShieldCheck,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useLocalePick } from "@/i18n/IntlProvider";
import { testApiKey } from "@/lib/ai/upstream/test-key";
import { AppShell } from "@/components/shell/AppShell";
import { isKeychainAvailable } from "@/lib/crypto/keychain";
import {
  DynamicKeyField,
  PresetChooser,
} from "@/components/setup/PresetChooser";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { Input } from "@/components/ui/Input";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Switch } from "@/components/ui/Switch";
import { useToast } from "@/components/ui/Toast";
import { useApiKeyManager } from "@/hooks/useApiKeyManager";
import {
  getQuickStartPreset,
  type QuickStartPresetId,
} from "@/lib/ai/quick-start-presets";
import { type Provider } from "@/lib/db/schema";
import { cn } from "@/lib/utils/cn";
import { type ModelBindings, usePrefs } from "@/stores/prefs";
import { BackupSection } from "@/components/settings/BackupSection";
import { QuotaSection } from "@/components/settings/QuotaSection";
import { AILocaleSection } from "@/components/settings/AILocaleSection";
import { WebSearchSection } from "@/components/settings/WebSearchSection";
import { SearchProvidersSection } from "@/components/settings/SearchProvidersSection";
import { DailyNotesSection } from "@/components/settings/DailyNotesSection";
import { VaultSection } from "@/components/settings/VaultSection";
import { AutoLaunchSection } from "@/components/settings/AutoLaunchSection";
import { UpdatesSection } from "@/components/settings/UpdatesSection";
import { TtsProviderSection } from "@/components/settings/TtsProviderSection";
import { PodcastFeatureSection } from "@/components/settings/PodcastFeatureSection";
import { CostSection } from "@/components/settings/CostSection";
import { CustomEndpointSection } from "@/components/settings/CustomEndpointSection";
import { EmbedSection } from "@/components/settings/EmbedSection";
import { ConceptsSection } from "@/components/settings/ConceptsSection";
import {
  encodeChatModelBinding,
  findChatOption,
  findModelDescriptor,
  formatModelPriceLabel,
  getProviderChatModels,
  listChatOptions,
  listEmbedOptions,
  MODEL_TIER_LABEL,
  type CapabilityBadge,
  type ChatOption,
} from "@/lib/ai/model-options";
import type { ModelTier, ProviderId } from "@/lib/ai/providers/types";
import { useProviderChatModels } from "@/hooks/useProviderChatModels";
import { supportsModelFetch } from "@/lib/ai/providers/model-fetch/adapter";

type SectionKey =
  | "api"
  | "models"
  | "embed"
  | "concepts"
  | "preferences"
  | "learning"
  | "data"
  | "about";

// Wizard's 4 + the 5 quick-start providerIds (deduped). Without the wider
// list, useApiKeyManager would silently drop drafts for gemini / groq /
// openrouter / ollama coming from the QuickStart row in the Models tab.
const SETTINGS_PROVIDERS: Provider[] = [
  "anthropic",
  "claude-code-oauth",
  "openai",
  "firecrawl",
  "diffbot",
  "brightdata",
  "brave",
  "google-gemini",
  "groq",
  "openrouter",
  "ollama",
];

export default function SettingsPage() {
  const t = useTranslations("settings");
  const pick = useLocalePick();

  const [active, setActive] = useState<SectionKey>("api");

  // Deep-link from reader page banner: `/settings#embed` lands on the Embed
  // section directly. Listening on hashchange keeps the nav reactive when the
  // user clicks a same-page hash link.
  useEffect(() => {
    function applyHash(): void {
      const hash = window.location.hash.replace(/^#/, "");
      const known: SectionKey[] = [
        "api",
        "models",
        "embed",
        "concepts",
        "preferences",
        "learning",
        "data",
        "about",
      ];
      if ((known as string[]).includes(hash)) {
        setActive(hash as SectionKey);
      }
    }
    applyHash();
    window.addEventListener("hashchange", applyHash);
    return () => window.removeEventListener("hashchange", applyHash);
  }, []);

  // Quick-start needs to be able to write keys for gemini / groq / openrouter
  // / ollama beyond the wizard's classic 4. Keeping a single hook instance so
  // the saved/dirty state is shared between the API and Models tabs.
  const keys = useApiKeyManager(SETTINGS_PROVIDERS);

  const modelBindings = usePrefs((s) => s.modelBindings);
  const setModelBinding = usePrefs((s) => s.setModelBinding);
  const { toast } = useToast();

  // Draft pattern: model bindings auto-saved to the prefs store as the user
  // edits, but tweaking individual rows benefits from a deliberate Save action
  // so the user knows their changes have been committed (matches the API Keys
  // section's mental model). Quick-start tile applies still write straight to
  // the store; the sync effect below catches that and refreshes the draft.
  const [draftBindings, setDraftBindings] = useState<ModelBindings>(modelBindings);
  useEffect(() => {
    setDraftBindings(modelBindings);
  }, [modelBindings]);

  const isModelDraftDirty = useMemo(() => {
    const keys: (keyof ModelBindings)[] = [
      "chat",
      "summary",
      "quick",
      "embedPresetId",
      "flashcardGen",
      "roadmapGen",
      "analysisExtract",
      "analysisSynthesize",
      "analysisCritique",
    ];
    return keys.some((k) => draftBindings[k] !== modelBindings[k]);
  }, [draftBindings, modelBindings]);

  function setDraftBinding(task: keyof ModelBindings, value: string): void {
    setDraftBindings((prev) => ({ ...prev, [task]: value }));
  }

  function handleSaveModels(): void {
    const keys: (keyof ModelBindings)[] = [
      "chat",
      "summary",
      "quick",
      "embedPresetId",
      "flashcardGen",
      "roadmapGen",
      "analysisExtract",
      "analysisSynthesize",
      "analysisCritique",
    ];
    for (const k of keys) {
      if (draftBindings[k] !== modelBindings[k]) {
        setModelBinding(k, draftBindings[k]);
      }
    }
    toast({
      title: pick("Modeller kaydedildi", "Models saved"),
      variant: "success",
    });
  }

  function handleDiscardModels(): void {
    setDraftBindings(modelBindings);
  }

  // listChatOptions / listEmbedOptions are pure derivations of PROVIDER_PRESETS
  // + EMBED_PRESETS — memoising keeps badge re-renders cheap on every prefs
  // store tick.
  const chatOptions = useMemo(
    () => listChatOptions({ requireToolUse: true }),
    [],
  );
  const summaryOptions = useMemo(() => listChatOptions(), []);
  const quickOptions = useMemo(() => listChatOptions(), []);
  const embedOptions = useMemo(() => listEmbedOptions(), []);
  // Hide retired/deprecated embedders from NEW selection, but keep the one the
  // user is currently bound to visible so the picker reflects their choice.
  const visibleEmbedOptions = useMemo(
    () =>
      embedOptions.filter(
        (o) => !o.deprecated || o.id === draftBindings.embedPresetId,
      ),
    [embedOptions, draftBindings.embedPresetId],
  );

  const sections = useMemo<{ key: SectionKey; tr: string; en: string }[]>(
    () => [
      { key: "api", tr: "API anahtarları", en: "API keys" },
      { key: "models", tr: "Varsayılan modeller", en: "Default models" },
      { key: "embed", tr: "Embedding", en: "Embedding" },
      { key: "concepts", tr: "Konseptler", en: "Concepts" },
      { key: "preferences", tr: "Tercihler", en: "Preferences" },
      { key: "learning", tr: "Öğrenme davranışı", en: "Learning behaviour" },
      { key: "data", tr: "Veri klasörü", en: "Data folder" },
      { key: "about", tr: "Hakkında", en: "About" },
    ],
    [],
  );

  return (
    <AppShell
      title={t("ayarlar")}
      breadcrumb={[t("dashboard"), t("ayarlar")]}
    >
      <div className="mx-auto grid max-w-[1080px] grid-cols-1 gap-6 px-4 pb-20 pt-5 sm:px-6 lg:grid-cols-[200px_1fr] lg:gap-10 lg:px-8 lg:pt-7">
        <aside className="self-start lg:sticky lg:top-4">
          <div className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-3">
            {t("bolumler")}
          </div>
          <nav className="mt-2 flex gap-1.5 overflow-x-auto pb-1 lg:block lg:space-y-0.5 lg:overflow-visible lg:pb-0">
            {sections.map((s) => (
              <button
                key={s.key}
                onClick={() => setActive(s.key)}
                className={cn(
                  "block shrink-0 rounded-[9px] border px-2.5 py-1.5 text-left text-[13px] font-medium transition-[background,border-color,color,box-shadow] lg:w-full",
                  active === s.key
                    ? "border-accent bg-accent-wash text-accent-ink shadow-[var(--shadow-soft)]"
                    : "border-transparent text-ink-2 hover:border-rule-strong hover:bg-paper-2 hover:text-ink",
                )}
              >
                {pick(s.tr, s.en)}
              </button>
            ))}
          </nav>
        </aside>

        <div className="space-y-10">
          <header>
            <h1 className="font-serif text-[32px] font-normal leading-tight tracking-[-0.015em]">
              {t("ayarlar")}
            </h1>
            <p className="mt-1 text-[13.5px] text-ink-3">
              {pick("Her şey yerel olarak saklanır. Anahtarlar Web Crypto ile şifrelenir, asla açık metin olarak diske yazılmaz.",
                "Everything is stored locally. Keys are encrypted with Web Crypto, never written to disk as plain text.",)}
            </p>
          </header>

          {active === "api" ? (
            <Section
              title={t("api_anahtarlari")}
              desc={pick("BYOK. Anahtarları sen girersin, TME senin adına istek yapar. Anahtarlar local olarak şifrelenir.",
                "BYOK. You enter the keys, TME makes requests on your behalf. Keys are encrypted locally.",)}
            >
              <VaultBanner />
              <ApiKeyRow
                title="Anthropic · API key"
                desc={pick("Anthropic Console'dan üretilen API anahtarı. Kullandıkça faturalanır.",
                  "API key from the Anthropic Console. Pay-per-use billing.",)}
                placeholder="sk-ant-api03-•••••••••••••••••••••••"
                provider="anthropic"
                keys={keys}
                pick={pick}
              />
              <ApiKeyRow
                title="Claude Code · OAuth token"
                desc={pick("Claude Code aboneliğini kullanmak istersen. Terminalde `claude setup-token` ile üret — istekler kullandıkça yerine planın üzerinden gider.",
                  "Use your Claude Code subscription. Generate with `claude setup-token` in your terminal — requests run against your plan instead of pay-per-use.",)}
                placeholder="sk-ant-oat01-•••••••••••••••••••••••"
                provider="claude-code-oauth"
                keys={keys}
                optional
                pick={pick}
              />
              <AnthropicPreferenceRow pick={pick} />
              <ApiKeyRow
                title="Google Gemini"
                desc={pick(
                  "Gemini sohbet, özetleme ve embedding modelleri için kullanılır. Google AI Studio'dan API key üret.",
                  "Used for Gemini chat, summarization and embedding models. Generate an API key from Google AI Studio.",
                )}
                placeholder="AIza•••••••••••••••••••••••••••••••••••"
                provider="google-gemini"
                keys={keys}
                pick={pick}
              />
              <ApiKeyRow
                title="OpenAI"
                desc={pick("Embedding ve Whisper transkripti için kullanılır.", "Used for embeddings and Whisper transcripts.",)}
                placeholder="sk-proj-•••••••••••••••••••••••"
                provider="openai"
                keys={keys}
                pick={pick}
              />
              <ApiKeyRow
                title="OpenRouter"
                desc={pick(
                  "OpenRouter üzerinden çok sayıda chat modelini tek anahtarla kullanmak için.",
                  "Use many chat models through OpenRouter with one key.",
                )}
                placeholder="sk-or-v1-•••••••••••••••••••••••"
                provider="openrouter"
                keys={keys}
                pick={pick}
              />
              <ApiKeyRow
                title="Firecrawl"
                desc={pick("Web sayfası parse etmek ve arşiv çekmek için.", "For scraping web pages and archives.",)}
                placeholder="fc-•••••••••••••••••••••••"
                provider="firecrawl"
                keys={keys}
                optional
                pick={pick}
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
                pick={pick}
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
                pick={pick}
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
                pick={pick}
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
                pick={pick}
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
                pick={pick}
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
                pick={pick}
              />
              <ApiKeyRow
                title="Perplexity"
                desc={pick(
                  "\"Konu ara\" zincirinde Sonar tabanlı web arama. perplexity.ai/account/api'dan üret.",
                  "Sonar-backed web search in the \"Search topic\" chain. Generate from perplexity.ai/account/api.",
                )}
                placeholder="pplx-•••••••••••••••••••••••"
                provider="perplexity"
                keys={keys}
                optional
                pick={pick}
              />
              <ApiKeyRow
                title="xAI (Grok)"
                desc={pick(
                  "\"Konu ara\" zincirinde Grok-4 live search. console.x.ai üzerinden üret.",
                  "Grok-4 live search in the \"Search topic\" chain. Generate from console.x.ai.",
                )}
                placeholder="xai-•••••••••••••••••••••••"
                provider="xai"
                keys={keys}
                optional
                pick={pick}
              />
              <ApiKeyRow
                title="Mistral"
                desc={pick(
                  "\"Konu ara\" zincirinde mistral-large agents web search. console.mistral.ai üzerinden üret.",
                  "mistral-large agents web search in the \"Search topic\" chain. Generate from console.mistral.ai.",
                )}
                placeholder="•••••••••••••••••••••••"
                provider="mistral"
                keys={keys}
                optional
                pick={pick}
              />
              <ApiKeyRow
                title="GLM (Zhipu)"
                desc={pick(
                  "\"Konu ara\" zincirinde GLM-4.6 web search. open.bigmodel.cn dashboard'undan üret.",
                  "GLM-4.6 web search in the \"Search topic\" chain. Generate from the open.bigmodel.cn dashboard.",
                )}
                placeholder="•••••••••••••••••••••••"
                provider="glm"
                keys={keys}
                optional
                pick={pick}
              />
              <CustomEndpointSection pick={pick} />
              {isKeychainAvailable() ? (
                <div className="mt-3 rounded-lg border border-rule-soft bg-paper-2 px-4 py-3 text-[12.5px] text-ink-3">
                  <ShieldCheck className="mr-1.5 inline h-3.5 w-3.5 text-[color:var(--moss)]" aria-hidden />
                  {pick(
                    "Anahtarlar işletim sisteminin keychain'inde saklanır. OS oturumu ve disk şifrelemesi koruma katmanını sağlar.",
                    "Keys are stored in the operating system's keychain. OS login and disk encryption provide the protection layer.",
                  )}
                </div>
              ) : (
                <div className="mt-3 rounded-lg border border-rule-soft bg-paper-2 px-4 py-3 text-[12.5px] text-ink-3">
                  <Lock className="mr-1.5 inline h-3.5 w-3.5" aria-hidden />
                  {pick(
                    "Dev modu — anahtarlar yerel veritabanında düz metin olarak saklanır. Web build dağıtılmaz; sadece geliştirme için kullanılır.",
                    "Dev mode — keys are stored in plaintext in the local database. The web build is not distributed; it exists for development only.",
                  )}
                </div>
              )}

            </Section>
          ) : null}

          {active === "models" ? (
            <>
            <Section
              title={t("varsayilan_modeller")}
              desc={pick("Hangi görevin hangi modele gideceği. Her çağrıda manuel olarak değiştirebilirsin.", "Which task goes to which model. You can override manually on every call.",)}
            >
              <QuickStartRow keys={keys} pick={pick} />
              <ChatModelRow
                label={t("sohbet_derin_analiz")}
                value={draftBindings.chat}
                onChange={(v) => setDraftBinding("chat", v)}
                options={chatOptions}
                keys={keys}
                hint={pick(
                  "Notebook chat tool kullanımına ihtiyaç duyar — yalnız tool destekli modeller listelenir.",
                  "Notebook chat needs tool use — only tool-capable models are listed.",
                )}
              />
              <ChatModelRow
                label={t("ozetleme_flashcard")}
                value={draftBindings.summary}
                onChange={(v) => setDraftBinding("summary", v)}
                options={summaryOptions}
                keys={keys}
                hint={pick(
                  "Özet ve flashcard hazırlama — dengeli model önerilir.",
                  "Summarization and flashcard prep — a balanced model is recommended.",
                )}
              />
              <ChatModelRow
                label={pick("Hızlı görevler (tag, başlık)",
                  "Quick tasks (tags, titles)",
                )}
                value={draftBindings.quick}
                onChange={(v) => setDraftBinding("quick", v)}
                options={quickOptions}
                keys={keys}
                hint={pick(
                  "Tag ve başlık üretimi — haiku-sınıf modeller en ucuzu.",
                  "Tag and title generation — haiku-class models are the cheapest.",
                )}
              />
              <ChatModelRow
                label={pick("Roadmap üretimi", "Roadmap generation")}
                value={draftBindings.roadmapGen}
                onChange={(v) => setDraftBinding("roadmapGen", v)}
                options={summaryOptions}
                keys={keys}
                hint={pick(
                  "Roadmap sihirbazı ve alt konu üretimi — dengeli bir model önerilir.",
                  "The roadmap wizard + subtask generation — a balanced model is recommended.",
                )}
              />
              <ChatModelRow
                label={pick("Makale analizi · Çıkarım", "Article analysis · Extraction")}
                value={draftBindings.analysisExtract}
                onChange={(v) => setDraftBinding("analysisExtract", v)}
                options={summaryOptions}
                keys={keys}
                hint={pick(
                  "Makale analizinin çıkarım adımı. OpenRouter ve özel modeller de seçilebilir.",
                  "The extraction step of article analysis. OpenRouter and custom models are also selectable.",
                )}
              />
              <ChatModelRow
                label={pick("Makale analizi · Sentez", "Article analysis · Synthesis")}
                value={draftBindings.analysisSynthesize}
                onChange={(v) => setDraftBinding("analysisSynthesize", v)}
                options={summaryOptions}
                keys={keys}
                hint={pick(
                  "Makale analizinin sentez adımı. OpenRouter ve özel modeller de seçilebilir.",
                  "The synthesis step of article analysis. OpenRouter and custom models are also selectable.",
                )}
              />
              <ChatModelRow
                label={pick("Makale analizi · Eleştiri", "Article analysis · Critique")}
                value={draftBindings.analysisCritique}
                onChange={(v) => setDraftBinding("analysisCritique", v)}
                options={summaryOptions}
                keys={keys}
                hint={pick(
                  "Makale analizinin eleştiri adımı. OpenRouter ve özel modeller de seçilebilir.",
                  "The critique step of article analysis. OpenRouter and custom models are also selectable.",
                )}
              />
              <ModelRow
                label={pick("Embedding (varsayılan)", "Embedding (default)")}
                value={draftBindings.embedPresetId}
                onChange={(v) => setDraftBinding("embedPresetId", v)}
                options={visibleEmbedOptions}
                hint={pick(
                  "Yeni source'lar bu modelle gömülür. Mevcut workspace'leri yeniden gömmek için aşağıdaki Embedding sekmesini kullan.",
                  "New sources are embedded with this model. To reembed existing workspaces, use the Embedding tab below.",
                )}
                note={pick(
                  "Mevcut chunks değişmez; yeniden gömmek için Embedding sekmesi → 'Yeniden göm' kullan.",
                  "Existing chunks are not touched; to reembed, use the Embedding tab → 'Reembed'.",
                )}
              />
              <SearchProvidersSection />
              <div className="sticky bottom-4 z-10 flex items-center justify-between gap-3 rounded-lg border border-rule-strong bg-paper px-4 py-3 shadow-[var(--shadow-medium)]">
                <span className="font-mono text-[11.5px] text-ink-3">
                  {isModelDraftDirty
                    ? pick(
                        "Kaydedilmemiş değişiklikler var.",
                        "You have unsaved changes.",
                      )
                    : pick(
                        "Tüm değişiklikler kaydedildi.",
                        "All changes saved.",
                      )}
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleDiscardModels}
                    disabled={!isModelDraftDirty}
                  >
                    {pick("Vazgeç", "Discard")}
                  </Button>
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    onClick={handleSaveModels}
                    disabled={!isModelDraftDirty}
                  >
                    {pick("Kaydet", "Save")}
                  </Button>
                </div>
              </div>
            </Section>
            <TtsProviderSection />
            </>
          ) : null}

          {active === "embed" ? (
            <Section
              title={pick("Embedding", "Embedding")}
              desc={pick(
                "Workspace içindeki chunks'ı tutarlı bir embedding modeline yeniden göm.",
                "Reembed workspace chunks to a consistent embedding model.",
              )}
            >
              <EmbedSection />
            </Section>
          ) : null}

          {active === "concepts" ? (
            <Section
              title={pick("Konsept grafiği", "Concept graph")}
              desc={pick(
                "Mind map için workspace başına konsept ve ilişki grafiği üret. Mevcut grafik yenilenir.",
                "Generate a per-workspace concept and relation graph for the mind map. Replaces the existing graph.",
              )}
            >
              <ConceptsSection />
            </Section>
          ) : null}

          {active === "preferences" ? (
            <>
              <PreferencesSection pick={pick} />
              <AILocaleSection />
              <WebSearchSection />
              <DailyNotesSection />
              <VaultSection />
              <AutoLaunchSection />
              <PodcastFeatureSection />
            </>
          ) : null}

          {active === "learning" ? (
            <Section
              title={t("ogrenme_davranisi")}
              desc={pick("SRS algoritmasını ve günlük hedeflerini ayarla.", "Configure the SRS algorithm and daily targets.",)}
            >
              <SelectRow
                label={t("srs_algoritmasi")}
                value="sm2"
                options={[
                  { value: "sm2", tr: "SM-2 (klasik)", en: "SM-2 (classic)" },
                  {
                    value: "fsrs",
                    tr: "FSRS (deneysel)",
                    en: "FSRS (experimental)",
                  },
                ]}
                pick={pick}
              />
              <NumberRow
                label={t("gunluk_yeni_kart")}
                value={20}
                hint={t("onerilen_1030")}
              />
              <NumberRow
                label={t("maksimum_gunluk_tekrar")}
                value={200}
                hint={pick("Birikim varsa geçici olarak artır", "Increase temporarily when backlog builds up",)}
              />
              <ToggleRow
                label={pick("Quiz yanlışlarından kart üret", "Generate cards from quiz misses",)}
                desc={pick("Açık uçlu quizde hatalı cevaplar için otomatik kart önerisi", "Auto-suggest cards for wrong answers in open-ended quiz",)}
                defaultOn
              />
            </Section>
          ) : null}

          {active === "data" ? (
            <Section
              title={pick("Veri klasörü ve depolama", "Data folder and storage",)}
              desc={pick("Yedekleme, geri yükleme ve depolama kotası. apiKeys + vault yedeğe dahil edilmez.", "Backup, restore and storage quota. apiKeys + vault are excluded from backups.",)}
            >
              <BackupSection />
              <QuotaSection />
              <CostSection />
            </Section>
          ) : null}

          {active === "about" ? (
            <>
            <UpdatesSection />
            <Section
              title={t("hakkinda")}
              desc={pick("Teach Me Everything · MIT lisansı · yerel olarak çalışır.", "Teach Me Everything · MIT license · runs locally.",)}
            >
              <div className="grid gap-3 md:grid-cols-2">
                <Card padding="md">
                  <div className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-3">
                    {t("surum")}
                  </div>
                  <div className="mt-1 font-serif text-[18px] font-medium">
                    v0.1.0
                  </div>
                  <div className="mt-1 font-mono text-[11px] text-ink-3">
                    build · 2026-04-20
                  </div>
                </Card>
                <Card padding="md">
                  <div className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-3">
                    {t("katki")}
                  </div>
                  <Button size="sm" className="mt-2">
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                    github.com/teach-me-everything
                  </Button>
                </Card>
              </div>
              <div className="mt-4 flex items-center gap-2 text-[12px] text-ink-3">
                <Info className="h-3.5 w-3.5" aria-hidden />
                {pick("Sorun yaşıyorsan README'ye bak ya da bir issue aç.", "If you hit a bug check the README or open an issue.",)}
              </div>
            </Section>
            </>
          ) : null}
        </div>
      </div>
      
    </AppShell>
  );
}

function Section({
  title,
  desc,
  children,
}: {
  title: string;
  desc: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-4">
        <h2 className="font-serif text-[22px] font-medium leading-tight tracking-[-0.01em]">
          {title}
        </h2>
        <p className="mt-1 text-[13px] text-ink-3">{desc}</p>
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function AnthropicPreferenceRow({
  pick,
}: {
  pick: (tr: string, en: string) => string;
}) {
  const value = usePrefs((s) => s.preferredAnthropicAuth);
  const setValue = usePrefs((s) => s.setPreferredAnthropicAuth);
  const strict = usePrefs((s) => s.strictAnthropicAuth);
  const setStrict = usePrefs((s) => s.setStrictAnthropicAuth);
  return (
    <Card padding="md">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h3 className="font-serif text-[14px] font-medium">
            {pick("Anthropic önceliği", "Anthropic preference")}
          </h3>
          <p className="mt-0.5 text-[12px] text-ink-3">
            {strict
              ? pick(
                  "Yalnız seçili olan kullanılır — boş ya da hatalıysa istek başarısız olur.",
                  "Only the selected one is used — request fails if it's empty or invalid.",
                )
              : pick(
                  "Seçili olan denenir; boş ya da hatalıysa diğerine düşülür.",
                  "The selected one is tried first; falls back to the other if empty or invalid.",
                )}
          </p>
        </div>
        <SegmentedControl
          value={value}
          onChange={setValue}
          ariaLabel={pick("Anthropic önceliği", "Anthropic preference")}
          options={[
            { value: "oauth", label: pick("Önce OAuth", "Prefer OAuth") },
            { value: "api-key", label: pick("Önce API key", "Prefer API key") },
          ]}
        />
      </div>
      <div className="mt-3 flex items-center justify-between gap-4 border-t border-rule-soft pt-3">
        <div className="min-w-0">
          <div className="text-[13px] font-medium text-ink">
            {pick("Yalnız bunu kullan", "Use only this one")}
          </div>
          <p className="mt-0.5 text-[12px] text-ink-3">
            {pick(
              "Yedeğe düşmeyi kapatır — diğer credential kayıtlı kalır ama AI çağrılarında kullanılmaz.",
              "Disables fallback — the other credential stays saved but is never used in AI calls.",
            )}
          </p>
        </div>
        <Switch
          checked={strict}
          onCheckedChange={setStrict}
          ariaLabel={pick("Yalnız bunu kullan", "Use only this one")}
        />
      </div>
    </Card>
  );
}

function VaultBanner() {
  const pick = useLocalePick();
  const keychainBacked = isKeychainAvailable();
  // Phase 9 — Two flavours, both read-only:
  //   • Tauri  → "Keys stored in OS keychain" (existing 8.D pill).
  //   • Web    → "Dev mode: keys are stored unencrypted in local storage."
  //     The web build is not distributed (Tauri binary via GitHub Releases is
  //     the only release channel), so this is just a transparency banner for
  //     `npm run dev` users.
  if (keychainBacked) {
    return (
      <div
        className={cn(
          "flex items-center justify-between gap-3 rounded-lg border px-4 py-2.5",
          "border-[color:color-mix(in_srgb,var(--moss)_30%,transparent)] bg-[color:color-mix(in_srgb,var(--moss)_8%,transparent)]",
        )}
      >
        <div className="flex items-center gap-2">
          <ShieldCheck
            className="h-4 w-4 text-[color:var(--moss)]"
            aria-hidden
          />
          <span className="text-[13px] text-ink-2">
            {pick(
              "Anahtarlar OS keychain'de saklanıyor",
              "Keys stored in OS keychain",
            )}
          </span>
        </div>
      </div>
    );
  }
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 rounded-lg border px-4 py-2.5",
        "border-rule-soft bg-paper-2",
      )}
    >
      <div className="flex items-center gap-2">
        <Lock className="h-4 w-4 text-ink-3" aria-hidden />
        <span className="text-[13px] text-ink-2">
          {pick(
            "Dev modu — anahtarlar yerel veritabanında düz metin olarak tutulur.",
            "Dev mode — keys are stored in plaintext in the local database.",
          )}
        </span>
      </div>
    </div>
  );
}

type TestState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; model: string | null; latencyMs: number }
  | { kind: "fail"; error: string; status?: number }
  | { kind: "skip"; reason: string };

function ApiKeyRow({
  title,
  desc,
  placeholder,
  provider,
  keys,
  optional,
  pick,
}: {
  title: string;
  desc: string;
  placeholder: string;
  provider: Provider;
  keys: ReturnType<typeof useApiKeyManager>;
  optional?: boolean;
  pick: (tr: string, en: string) => string;
}) {
  const t = useTranslations("settings");
  const vaultT = useTranslations("vault");
  const value = keys.drafts[provider] ?? "";
  const dirty = keys.isDirty(provider);
  const stored = keys.isStored(provider);
  const storedLoaded = keys.storedLoaded;
  const storedLocked = stored && !value;
  const testable =
    provider === "anthropic" ||
    provider === "claude-code-oauth" ||
    provider === "google-gemini" ||
    provider === "openai" ||
    provider === "openrouter" ||
    provider === "firecrawl";

  const [test, setTest] = useState<TestState>({ kind: "idle" });

  async function runTest(): Promise<void> {
    if (!testable || !value) return;
    setTest({ kind: "loading" });
    try {
      const data = await testApiKey({ provider, key: value });
      if (data.skipped) {
        setTest({
          kind: "skip",
          reason:
            data.skipReason ??
            pick(
              "Bu sağlayıcı doğrudan test edilemez. Kaydet, sohbette dene.",
              "This provider can't be tested directly. Save and try in chat.",
            ),
        });
      } else if (data.ok) {
        setTest({
          kind: "ok",
          model: data.model ?? null,
          latencyMs: data.latencyMs ?? 0,
        });
      } else {
        setTest({
          kind: "fail",
          error: data.error ?? pick("Bilinmeyen hata", "Unknown error"),
          ...(data.status !== undefined ? { status: data.status } : {}),
        });
      }
    } catch (err) {
      setTest({
        kind: "fail",
        error: err instanceof Error ? err.message : pick("Ağ hatası", "Network error"),
      });
    }
  }

  return (
    <Card padding="md">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-serif text-[15px] font-medium">{title}</h3>
            {optional ? <Chip>{t("opsiyonel")}</Chip> : null}
            {!storedLoaded ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-rule-soft px-2 py-0.5 font-mono text-[10.5px] text-ink-3">
                {pick("Kontrol", "Checking")}
              </span>
            ) : stored ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-[color:color-mix(in_srgb,var(--color-ok)_50%,transparent)] bg-[color:color-mix(in_srgb,var(--color-ok)_22%,transparent)] px-2 py-0.5 font-mono text-[10.5px] text-[color:var(--color-ok)]">
                <Check className="h-3 w-3" aria-hidden />
                {pick("KayÄ±tlÄ±", "Saved")}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full border border-rule-soft px-2 py-0.5 font-mono text-[10.5px] text-ink-3">
                {t("bos")}
              </span>
            )}
            {dirty ? (
              <span
                className="inline-flex h-2 w-2 rounded-full bg-accent"
                aria-label={pick("Kaydedilmedi", "Unsaved")}
              />
            ) : null}
          </div>
          <p className="mt-1 text-[12.5px] text-ink-3">{desc}</p>
          <div className="mt-3 grid gap-2 md:grid-cols-[minmax(220px,1fr)_auto_auto_auto] md:items-center">
            <Input
              type="password"
              variant="mono"
              value={value}
              onChange={(e) => {
                keys.setDraft(provider, e.target.value);
                if (test.kind !== "idle") setTest({ kind: "idle" });
              }}
              placeholder={
                storedLocked
                  ? pick(
                      "KayÄ±tlÄ± anahtar gizli - gÃ¶rmek/test etmek iÃ§in kilidi aÃ§ veya yenisini yapÄ±ÅŸtÄ±r",
                      "Saved key hidden - unlock to reveal/test, or paste a replacement",
                    )
                  : placeholder
              }
              className="min-w-0"
            />
            <Button
              size="md"
              variant={dirty ? "primary" : "default"}
              onClick={() => void keys.save(provider)}
              disabled={!dirty}
              className="w-full md:min-w-[104px]"
            >
              {vaultT("kaydet")}
            </Button>
            {testable ? (
              <Button
                size="md"
                variant="default"
                onClick={() => void runTest()}
                disabled={!value || test.kind === "loading"}
                className="w-full md:min-w-[170px]"
              >
                {test.kind === "loading"
                  ? pick("Test ediliyor…", "Testing…")
                  : pick("Bağlantıyı test et", "Test connection")}
              </Button>
            ) : null}
            {stored ? (
              <Button
                size="md"
                variant="ghost"
                onClick={() => void keys.remove(provider)}
                aria-label={vaultT("sil")}
                className="w-full md:w-11 md:px-0"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
              </Button>
            ) : null}
          </div>
          {test.kind === "ok" ? (
            <div className="mt-2 flex items-center gap-2 rounded-md border border-[color:color-mix(in_srgb,var(--moss)_30%,transparent)] bg-[color:color-mix(in_srgb,var(--moss)_8%,transparent)] px-3 py-2 text-[12.5px] text-[color:var(--moss)]">
              <Check className="h-3.5 w-3.5" aria-hidden />
              <span className="font-medium">
                {pick("Bağlantı başarılı", "Connection successful")}
              </span>
              <span className="font-mono text-[11px] text-ink-3">
                · {test.model ?? "—"} · {test.latencyMs}ms
              </span>
            </div>
          ) : null}
          {test.kind === "fail" ? (
            <div className="mt-2 rounded-md border border-[color:color-mix(in_srgb,var(--err)_40%,transparent)] bg-[color:color-mix(in_srgb,var(--err)_10%,transparent)] px-3 py-2 text-[12.5px] text-[color:var(--err)]">
              <span className="font-medium">
                {pick("Hata", "Error")}
                {test.status ? ` · ${test.status}` : ""}:
              </span>{" "}
              <span className="font-mono text-[11.5px]">{test.error}</span>
            </div>
          ) : null}
          {test.kind === "skip" ? (
            <div className="mt-2 rounded-md border border-[color:var(--border)] bg-[color:var(--surface-2)] px-3 py-2 text-[12.5px] text-ink-2">
              {test.reason}
            </div>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

type ModelRowOption = {
  id: string;
  label: string;
  badges: CapabilityBadge[];
};

const TIER_CHIP_STYLES: Record<ModelTier, string> = {
  flagship: "border-accent/40 bg-accent/10 text-ink",
  balanced: "border-rule-soft bg-paper-2 text-ink-2",
  fast: "border-rule-soft bg-paper-2 text-ink-2",
  free: "border-ok/40 bg-ok/10 text-ok",
};

// Providers that have a dedicated Quick-start tile. Picking one of these and
// hitting the "no key" chip should scroll the user to the inline form rather
// than sending them to a different tab.
const QUICK_START_PROVIDERS = new Set<string>([
  "anthropic",
  "google-gemini",
  "groq",
  "openrouter",
  "ollama",
]);

function ChatModelRow({
  label,
  value,
  onChange,
  options,
  keys,
  hint,
  note,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: ChatOption[];
  keys: ReturnType<typeof useApiKeyManager>;
  hint?: string;
  note?: string;
}) {
  const pick = useLocalePick();
  const resolved = findChatOption(value);
  const selectedProvider =
    options.find((o) => o.presetId === resolved?.presetId) ?? options[0];
  const modelValue = resolved?.modelId ?? value;
  // Phase 10.D — Dynamic catalog: hook returns either the cached `/models`
  // response (dynamic) or the static preset list (fallback). presetId is
  // never undefined in practice (options always non-empty); the fallback to
  // "anthropic" exists only to satisfy the hook signature on the first paint
  // before useLiveQuery resolves.
  const presetIdForCatalog: ProviderId =
    selectedProvider?.presetId ?? ("anthropic" as ProviderId);
  const {
    models: availableModels,
    source: modelsSource,
    isFetching: modelsFetching,
    error: modelsError,
    fetchedAt: modelsFetchedAt,
    refresh: refreshModels,
  } = useProviderChatModels(presetIdForCatalog);
  const selectedDescriptor = selectedProvider
    ? availableModels.find((m) => m.id === modelValue) ??
      findModelDescriptor(selectedProvider.presetId, modelValue)
    : undefined;
  // Local providers have no key requirement; "claude-code-oauth" uses a
  // separate sentinel that lives outside this picker — only check stored
  // status when the provider actually maps to a Provider literal we manage.
  const presetIdStr = selectedProvider?.presetId ?? "";
  const isLocalProvider =
    presetIdStr === "ollama" ||
    presetIdStr === "lm-studio" ||
    presetIdStr === "llama-cpp";
  const keyStored = selectedProvider
    ? keys.isStored(selectedProvider.presetId as Provider)
    : false;
  const showKeyMissing =
    !!selectedProvider && !isLocalProvider && keys.storedLoaded && !keyStored;

  // "Custom mode" lets the user type a model ID that isn't in the curated
  // catalog (the providers expose hundreds; we only ship a popular subset).
  // Auto-enable when the stored value isn't recognized so a previously typed
  // ID stays editable rather than getting silently swapped out.
  const [customMode, setCustomMode] = useState(
    !!selectedProvider && !!modelValue && !selectedDescriptor,
  );
  // Reset customMode when the provider changes (handled inside the handler).
  // Also clear it if the resolved descriptor *becomes* known later (e.g. the
  // catalog gained a new entry on a hot reload).
  useEffect(() => {
    if (selectedDescriptor) setCustomMode(false);
  }, [selectedDescriptor]);

  function handleProviderChange(providerId: string): void {
    const next = options.find((o) => o.presetId === providerId);
    if (!next) return;
    // Pick the new provider's *recommended* default model rather than carrying
    // over the previous provider's modelId — that string is almost always
    // invalid for the new provider and would just produce a 404 on first send.
    const nextModels = getProviderChatModels(next.presetId);
    const defaultModel = nextModels[0]?.id ?? next.modelId;
    setCustomMode(false);
    onChange(encodeChatModelBinding(next.presetId, defaultModel));
  }

  function handleModelChange(modelId: string): void {
    if (!selectedProvider) {
      onChange(modelId);
      return;
    }
    onChange(encodeChatModelBinding(selectedProvider.presetId, modelId));
  }

  function handleModelSelectChange(value: string): void {
    if (value === "__custom__") {
      // User chose "Other (custom ID)" — switch to text input. Keep the
      // current modelValue as the starting text so they can edit rather
      // than starting from blank.
      setCustomMode(true);
      return;
    }
    setCustomMode(false);
    handleModelChange(value);
  }

  const isCoveredByQuickStart = QUICK_START_PROVIDERS.has(presetIdStr);

  function handleAddKey(): void {
    if (isCoveredByQuickStart) {
      // QuickStartRow lives inside the same Models section above the rows. A
      // smooth scroll keeps the user in context instead of bouncing tabs.
      const el = document.querySelector("[data-quickstart-anchor]");
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      return;
    }
    // Provider isn't in Quick-start (e.g. DeepSeek, Mistral, xAI). Jump to
    // the API Keys tab where the user either finds a dedicated row or, for
    // providers without one, can fall back to the Custom Endpoint section.
    if (typeof window !== "undefined") {
      window.location.hash = "#api";
    }
  }

  return (
    <Card padding="md">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px_minmax(0,1fr)] lg:items-end">
        <div className="min-w-0">
          <div className="font-serif text-[15px] font-medium">{label}</div>
          {hint ? (
            <div className="mt-0.5 text-[12px] text-ink-3">{hint}</div>
          ) : null}
          {selectedProvider && selectedProvider.badges.length > 0 ? (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {selectedProvider.badges.map((b) => (
                <span
                  key={`${b.kind}-${b.label}`}
                  className="inline-flex items-center rounded-full border border-rule-soft bg-paper-2 px-2 py-0.5 font-mono text-[10.5px] text-ink-2"
                >
                  {b.label}
                </span>
              ))}
            </div>
          ) : null}
        </div>
        <label className="grid min-w-0 gap-1">
          <span className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-3">
            {pick("Sağlayıcı", "Provider")}
          </span>
          <select
            value={selectedProvider?.presetId ?? ""}
            onChange={(e) => handleProviderChange(e.target.value)}
            aria-label={`${label} provider`}
            className="h-10 w-full min-w-0 rounded-md border border-rule-strong bg-paper px-2.5 font-mono text-[12.5px] text-ink shadow-[var(--shadow-soft)] focus:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
          >
            {options.map((o) => (
              <option key={o.presetId} value={o.presetId}>
                {o.label.split(" · ")[0]}
              </option>
            ))}
          </select>
        </label>
        <label className="grid min-w-0 gap-1">
          <span className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-3">
            {pick("Model", "Model")}
          </span>
          {availableModels.length === 0 || customMode ? (
            <Input
              variant="mono"
              value={modelValue}
              onChange={(e) => handleModelChange(e.target.value)}
              placeholder={selectedProvider?.modelId ?? "model-id"}
              className="h-10 w-full min-w-0"
            />
          ) : (
            <select
              value={modelValue}
              onChange={(e) => handleModelSelectChange(e.target.value)}
              aria-label={`${label} model`}
              className="h-10 w-full min-w-0 rounded-md border border-rule-strong bg-paper px-2.5 text-[12.5px] text-ink shadow-[var(--shadow-soft)] focus:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
            >
              {/* Surface a custom modelValue that isn't in the curated catalog
                  (e.g. user typed it in a previous build) so they can still
                  see + replace it instead of silently losing the binding. */}
              {!selectedDescriptor && modelValue ? (
                <option value={modelValue}>{modelValue}</option>
              ) : null}
              {availableModels.map((m) => {
                const tierLabel = pick(
                  MODEL_TIER_LABEL[m.tier].tr,
                  MODEL_TIER_LABEL[m.tier].en,
                );
                const price = formatModelPriceLabel(m.id);
                // Avoid "Free · Free" — when tier is "free" the price chip
                // would just repeat the tier label, so drop one.
                const showPrice = price && !(price === "Free" && m.tier === "free");
                const tail = showPrice ? ` · ${tierLabel} · ${price}` : ` · ${tierLabel}`;
                return (
                  <option key={m.id} value={m.id}>
                    {m.displayName}{tail}
                  </option>
                );
              })}
              <option value="__custom__">
                {pick("Diğer (model ID gir)…", "Other (enter model ID)…")}
              </option>
            </select>
          )}
          {customMode && availableModels.length > 0 ? (
            <button
              type="button"
              onClick={() => {
                setCustomMode(false);
                const fallback = availableModels[0]?.id;
                if (fallback) handleModelChange(fallback);
              }}
              className="self-start pt-0.5 font-mono text-[10.5px] text-ink-3 underline-offset-2 hover:text-ink hover:underline"
            >
              {pick("← Önerilenlere dön", "← Back to suggestions")}
            </button>
          ) : (
            <>
              {selectedDescriptor ? (
                <div className="flex items-center gap-1.5 pt-0.5">
                  <span
                    className={`inline-flex items-center rounded-full border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.06em] ${TIER_CHIP_STYLES[selectedDescriptor.tier]}`}
                  >
                    {pick(
                      MODEL_TIER_LABEL[selectedDescriptor.tier].tr,
                      MODEL_TIER_LABEL[selectedDescriptor.tier].en,
                    )}
                  </span>
                  <code className="truncate font-mono text-[10.5px] text-ink-4">
                    {selectedDescriptor.id}
                  </code>
                </div>
              ) : modelValue ? (
                <code className="truncate pt-0.5 font-mono text-[10.5px] text-ink-4">
                  {modelValue}
                </code>
              ) : null}
              {availableModels.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setCustomMode(true)}
                  className="self-start pt-0.5 text-[10.5px] text-ink-3 underline-offset-2 hover:text-ink hover:underline"
                >
                  {pick(
                    "Listede yoksa elle model ID yaz →",
                    "Not in the list? Type a custom model ID →",
                  )}
                </button>
              ) : null}
            </>
          )}
        </label>
      </div>
      {showKeyMissing ? (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-[12px] text-warn">
          <span className="truncate">
            {pick(
              "Bu sağlayıcı için API anahtarı yok.",
              "No API key for this provider.",
            )}
          </span>
          <button
            type="button"
            onClick={handleAddKey}
            className="shrink-0 font-medium underline-offset-2 hover:underline"
          >
            {isCoveredByQuickStart
              ? pick("Quick-start ile ekle →", "Add via Quick-start →")
              : pick("API anahtarlarına git →", "Open API Keys →")}
          </button>
        </div>
      ) : null}
      {note ? (
        <p className="mt-2 text-[11.5px] text-ink-3">{note}</p>
      ) : null}
      {supportsModelFetch(presetIdForCatalog) ? (
        <div className="mt-2 flex items-center justify-between gap-2 font-mono text-[10.5px] text-ink-3">
          <span className="truncate">
            {modelsFetching
              ? pick("Model listesi yenileniyor…", "Refreshing catalog…")
              : modelsError === "missing_api_key"
                ? pick(
                    "API anahtarı ekleyince güncel liste çekilecek",
                    "Add an API key to fetch the live catalog",
                  )
                : modelsError === "empty_catalog"
                  ? pick(
                      "Sağlayıcı boş katalog döndü — statik liste gösteriliyor",
                      "Provider returned an empty catalog — showing static fallback",
                    )
                  : modelsError
                    ? pick(
                        `Katalog çekilemedi — statik liste gösteriliyor`,
                        `Catalog fetch failed — showing static fallback`,
                      )
                    : modelsSource === "dynamic" && modelsFetchedAt
                      ? pick(
                          `Dinamik · ${formatCatalogRelative(modelsFetchedAt, "tr")} · ${availableModels.length} model`,
                          `Dynamic · ${formatCatalogRelative(modelsFetchedAt, "en")} · ${availableModels.length} models`,
                        )
                      : modelsSource === "static"
                        ? pick("Statik liste", "Static list")
                        : pick("Yükleniyor…", "Loading…")}
          </span>
          <button
            type="button"
            onClick={() => void refreshModels()}
            disabled={modelsFetching}
            className="shrink-0 font-medium underline-offset-2 hover:text-ink hover:underline disabled:cursor-wait disabled:opacity-60"
            aria-label={pick("Model listesini yenile", "Refresh model list")}
          >
            {pick("↻ Yenile", "↻ Refresh")}
          </button>
        </div>
      ) : null}
    </Card>
  );
}

/**
 * Short relative-time string for the dynamic catalog "fetched X ago" line.
 * `Intl.RelativeTimeFormat` covers minute / hour / day automatically but
 * we want a compact unit-letter form ("3 dk önce", "3 min ago") rather
 * than the verbose "3 minutes ago" Intl produces.
 */
function formatCatalogRelative(
  timestamp: number,
  locale: "tr" | "en",
  now: number = Date.now(),
): string {
  const delta = Math.max(0, now - timestamp);
  if (delta < 60_000) return locale === "tr" ? "az önce" : "just now";
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 60) {
    return locale === "tr" ? `${minutes} dk önce` : `${minutes} min ago`;
  }
  const hours = Math.floor(delta / 3_600_000);
  if (hours < 24) {
    return locale === "tr" ? `${hours} sa önce` : `${hours} h ago`;
  }
  const days = Math.floor(delta / 86_400_000);
  return locale === "tr" ? `${days} gün önce` : `${days} d ago`;
}

function ModelRow({
  label,
  value,
  onChange,
  options,
  hint,
  note,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: ModelRowOption[];
  hint?: string;
  note?: string;
}) {
  // Selected option may be missing if a stale binding refers to a preset
  // removed between releases — fall back to the raw id so the user still sees
  // what is stored and can pick a valid replacement.
  const selected = options.find((o) => o.id === value);
  return (
    <Card padding="md">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between md:gap-3">
        <div className="min-w-0">
          <div className="font-serif text-[15px] font-medium">{label}</div>
          {hint ? (
            <div className="mt-0.5 text-[12px] text-ink-3">{hint}</div>
          ) : null}
          {selected && selected.badges.length > 0 ? (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {selected.badges.map((b) => (
                <span
                  key={`${b.kind}-${b.label}`}
                  className="inline-flex items-center rounded-full border border-rule-soft bg-paper-2 px-2 py-0.5 font-mono text-[10.5px] text-ink-2"
                >
                  {b.label}
                </span>
              ))}
            </div>
          ) : null}
        </div>
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label={label}
          className="max-w-[320px] rounded-md border border-rule bg-paper px-2.5 py-1 font-mono text-[12.5px] text-ink focus:border-ink-5 focus:outline-none"
        >
          {!selected ? (
            <option value={value}>{value}</option>
          ) : null}
          {options.map((o) => {
            const badgeText = o.badges.map((b) => b.label).join(" · ");
            return (
              <option key={o.id} value={o.id}>
                {o.label}
                {badgeText ? ` — ${badgeText}` : ""}
              </option>
            );
          })}
        </select>
      </div>
      {note ? (
        <p className="mt-2 text-[11.5px] text-ink-3">{note}</p>
      ) : null}
    </Card>
  );
}

function PreferencesSection({ pick }: { pick: (tr: string, en: string) => string }) {
  const t = useTranslations("settings");
  const theme = usePrefs((s) => s.theme);
  const setTheme = usePrefs((s) => s.setTheme);
  const locale = usePrefs((s) => s.locale);
  const setLocale = usePrefs((s) => s.setLocale);
  const density = usePrefs((s) => s.density);
  const setDensity = usePrefs((s) => s.setDensity);

  return (
    <Section
      title={t("tercihler")}
      desc={pick("Görsel tema, dil ve yoğunluk. Anında uygulanır.",
        "Theme, language and density. Applied instantly.",)}
    >
      <ToggleGroupRow
        label={t("tema")}
        icon={<Palette className="h-4 w-4" aria-hidden />}
        value={theme}
        onChange={(v) => setTheme(v as "white" | "sepia" | "dark")}
        options={[
          { value: "white", tr: "Beyaz", en: "White" },
          { value: "sepia", tr: "Sepya", en: "Sepia" },
          { value: "dark", tr: "Koyu", en: "Dark" },
        ]}
        pick={pick}
        variant="theme"
      />
      <ToggleGroupRow
        label={t("dil")}
        value={locale}
        onChange={(v) => setLocale(v as "tr" | "en")}
        options={[
          { value: "tr", tr: "Türkçe", en: "Turkish" },
          { value: "en", tr: "İngilizce", en: "English" },
        ]}
        pick={pick}
      />
      <SelectRow
        label={t("font")}
        value="serif"
        options={[
          { value: "serif", tr: "Serif (varsayılan)", en: "Serif (default)" },
          { value: "sans", tr: "Sans-serif", en: "Sans-serif" },
        ]}
        pick={pick}
      />
      <ToggleGroupRow
        label={t("yogunluk")}
        value={density}
        onChange={(v) => setDensity(v as "compact" | "normal" | "comfy")}
        options={[
          { value: "compact", tr: "Sıkı", en: "Compact" },
          { value: "normal", tr: "Normal", en: "Normal" },
          { value: "comfy", tr: "Ferah", en: "Comfy" },
        ]}
        pick={pick}
      />
    </Section>
  );
}

function SelectRow({
  label,
  value,
  options,
  pick,
}: {
  label: string;
  value: string;
  options: { value: string; tr: string; en: string }[];
  pick: (tr: string, en: string) => string;
}) {
  return (
    <Card padding="md">
      <div className="flex items-center justify-between gap-4">
        <div className="font-serif text-[14px] font-medium">{label}</div>
        <select
          defaultValue={value}
          className="rounded-md border border-rule bg-paper px-2.5 py-1 text-[13px] text-ink focus:border-ink-5 focus:outline-none"
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {pick(o.tr, o.en)}
            </option>
          ))}
        </select>
      </div>
    </Card>
  );
}

function NumberRow({
  label,
  value,
  hint,
}: {
  label: string;
  value: number;
  hint: string;
}) {
  return (
    <Card padding="md">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="font-serif text-[14px] font-medium">{label}</div>
          <div className="mt-0.5 text-[12px] text-ink-3">{hint}</div>
        </div>
        <input
          type="number"
          defaultValue={value}
          className="w-24 rounded-md border border-rule bg-paper px-2.5 py-1 font-mono text-[13px] text-ink focus:border-ink-5 focus:outline-none"
        />
      </div>
    </Card>
  );
}

function ToggleRow({
  label,
  desc,
  defaultOn,
}: {
  label: string;
  desc: string;
  defaultOn: boolean;
}) {
  const [on, setOn] = useState(defaultOn);
  return (
    <Card padding="md">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="font-serif text-[14px] font-medium">{label}</div>
          <div className="mt-0.5 text-[12px] text-ink-3">{desc}</div>
        </div>
        <Switch checked={on} onCheckedChange={setOn} ariaLabel={label} />
      </div>
    </Card>
  );
}

const THEME_SWATCH: Record<string, { bg: string; accent: string }> = {
  white: { bg: "#FFFFFF", accent: "#F4F4F2" },
  sepia: { bg: "#F6EAD2", accent: "#E5D2AC" },
  dark: { bg: "#0E0E10", accent: "#242428" },
};

function ToggleGroupRow({
  label,
  icon,
  value,
  onChange,
  options,
  pick,
  variant = "segment",
}: {
  label: string;
  icon?: React.ReactNode;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; tr: string; en: string }[];
  pick: (tr: string, en: string) => string;
  variant?: "segment" | "theme";
}) {
  return (
    <Card padding="md">
      <div className="flex items-start justify-between gap-6">
        <div className="flex items-center gap-2 pt-1.5">
          {icon ? <span className="text-ink-3">{icon}</span> : null}
          <span className="font-serif text-[14px] font-medium">{label}</span>
        </div>
        {variant === "theme" ? (
          <div className="flex gap-2">
            {options.map((o) => {
              const swatch = THEME_SWATCH[o.value];
              const active = value === o.value;
              return (
                <button
                  key={o.value}
                  onClick={() => onChange(o.value)}
                  className={cn(
                    "flex min-w-[96px] flex-col items-stretch gap-2 overflow-hidden rounded-[10px] border p-2 text-left transition-all shadow-[var(--shadow-soft)]",
                    active
                      ? "border-accent bg-accent-wash ring-2 ring-accent/25"
                      : "border-rule-strong bg-paper hover:-translate-y-0.5 hover:border-accent hover:bg-paper-2",
                  )}
                >
                  <div
                    className="flex h-7 overflow-hidden rounded border border-rule-soft"
                    style={{ backgroundColor: swatch?.bg ?? "var(--paper)" }}
                  >
                    <span
                      className="h-full flex-1"
                      style={{ backgroundColor: swatch?.bg ?? "var(--paper)" }}
                    />
                    <span
                      className="h-full flex-1"
                      style={{
                        backgroundColor: swatch?.accent ?? "var(--paper-2)",
                      }}
                    />
                  </div>
                  <span
                    className={cn(
                      "text-[13px] font-medium",
                      active ? "text-accent-ink" : "text-ink",
                    )}
                  >
                    {pick(o.tr, o.en)}
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <SegmentedControl
            value={value}
            onChange={onChange}
            ariaLabel={label}
            options={options.map((o) => ({
              value: o.value,
              label: pick(o.tr, o.en),
            }))}
          />
        )}
      </div>
    </Card>
  );
}

function QuickStartRow({
  keys,
  pick,
}: {
  keys: ReturnType<typeof useApiKeyManager>;
  pick: (tr: string, en: string) => string;
}) {
  const { toast } = useToast();
  const setModelBinding = usePrefs((s) => s.setModelBinding);
  const [selectedId, setSelectedId] = useState<QuickStartPresetId | null>(null);
  const [keyValue, setKeyValue] = useState("");
  const [applying, setApplying] = useState(false);

  const preset = useMemo(
    () => (selectedId ? (getQuickStartPreset(selectedId) ?? null) : null),
    [selectedId],
  );

  const canApply = preset
    ? !preset.requiresKey || keyValue.trim().length > 0
    : false;

  function handleSelect(id: QuickStartPresetId): void {
    setSelectedId(id);
    setKeyValue("");
  }

  async function handleApply(): Promise<void> {
    if (!preset) return;
    setApplying(true);
    try {
      if (preset.requiresKey) {
        keys.setDraft(preset.providerId, keyValue.trim());
      }
      // Apply bindings before the (potentially async) saveAll so the toast
      // fires once both have landed.
      for (const [task, model] of Object.entries(preset.defaultBindings)) {
        if (model) {
          setModelBinding(task as keyof ModelBindings, model);
        }
      }
      await keys.saveAll();
      toast({
        variant: "success",
        title: pick(
          `${preset.label} hızlı başlangıç uygulandı`,
          `${preset.label} quick-start applied`,
        ),
        description: pick(
          "Sohbet, özet ve gömme modelleri güncellendi.",
          "Chat, summary, and embed models updated.",
        ),
      });
      setKeyValue("");
    } finally {
      setApplying(false);
    }
  }

  return (
    <Card
      padding="lg"
      className="mb-4 border-rule-strong bg-paper shadow-[var(--shadow-medium)]"
      data-quickstart-anchor=""
    >
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-accent" aria-hidden />
        <h3 className="font-serif text-[18px] font-medium text-ink">
          {pick("Hızlı başlangıç", "Quick start")}
        </h3>
      </div>
      <p className="mt-1.5 max-w-[60ch] text-[13px] text-ink-3">
        {pick(
          "Tek tıkla bir sağlayıcı seç — aşağıdaki dört model satırı otomatik güncellenir.",
          "Pick one provider — the four model rows below get updated automatically.",
        )}
      </p>
      <div className="mt-4">
        <PresetChooser selectedId={selectedId} onSelect={handleSelect} />
      </div>
      <div className="mt-4">
        <DynamicKeyField
          preset={preset}
          value={keyValue}
          onChange={setKeyValue}
          inputId="settings-quickstart-key"
        />
      </div>
      <div className="mt-4 flex items-center justify-end">
        <Button
          size="md"
          variant="primary"
          onClick={() => void handleApply()}
          disabled={!canApply || applying}
        >
          {applying
            ? pick("Uygulanıyor…", "Applying…")
            : pick("Uygula", "Apply")}
        </Button>
      </div>
    </Card>
  );
}
