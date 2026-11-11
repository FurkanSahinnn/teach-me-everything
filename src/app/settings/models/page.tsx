"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useLocalePick } from "@/i18n/IntlProvider";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import {
  SettingsGroup,
  SettingsPage,
  SettingsSection,
} from "@/components/settings/layout/SettingsPrimitives";
import { SETTINGS_PROVIDERS } from "@/components/settings/ApiKeyRow";
import {
  ChatModelRow,
  ModelRow,
  QuickStartRow,
} from "@/components/settings/ModelBindingRows";
import { useApiKeyManager } from "@/hooks/useApiKeyManager";
import { listChatOptions, listEmbedOptions } from "@/lib/ai/model-options";
import { filterEnabledChatOptions } from "@/lib/ai/provider-catalog";
import { type ModelBindings, usePrefs } from "@/stores/prefs";

const BINDING_KEYS: (keyof ModelBindings)[] = [
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

export default function ModelsSettingsPage() {
  const t = useTranslations("settings");
  const pick = useLocalePick();

  // Quick-start writes keys for gemini / groq / openrouter / ollama beyond the
  // wizard's classic 4, so this page needs the wider provider list too.
  const keys = useApiKeyManager(SETTINGS_PROVIDERS);

  const modelBindings = usePrefs((s) => s.modelBindings);
  const setModelBinding = usePrefs((s) => s.setModelBinding);
  const { toast } = useToast();

  // Draft pattern: bindings are edited locally and committed with an explicit
  // Save. Quick-start applies write straight to the store; the sync below
  // catches that and refreshes the draft.
  const [draftBindings, setDraftBindings] = useState<ModelBindings>(modelBindings);
  const [previousBindings, setPreviousBindings] = useState(modelBindings);
  if (previousBindings !== modelBindings) {
    setPreviousBindings(modelBindings);
    setDraftBindings(modelBindings);
  }

  const isModelDraftDirty = useMemo(
    () => BINDING_KEYS.some((k) => draftBindings[k] !== modelBindings[k]),
    [draftBindings, modelBindings],
  );

  function setDraftBinding(task: keyof ModelBindings, value: string): void {
    setDraftBindings((prev) => ({ ...prev, [task]: value }));
  }

  function handleSaveModels(): void {
    for (const k of BINDING_KEYS) {
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
  const disabledProviders = usePrefs((s) => s.disabledProviders);
  const boundBindings = useMemo(() => Object.values(draftBindings), [draftBindings]);
  const enabledOnly = useMemo(() => {
    const disabled = new Set(disabledProviders);
    return <T extends { presetId: string }>(options: readonly T[]) =>
      filterEnabledChatOptions(options, disabled, boundBindings);
  }, [disabledProviders, boundBindings]);
  const chatOptions = useMemo(() => enabledOnly(listChatOptions({ requireToolUse: true })), [enabledOnly]);
  const summaryOptions = useMemo(() => enabledOnly(listChatOptions()), [enabledOnly]);
  const quickOptions = useMemo(() => enabledOnly(listChatOptions()), [enabledOnly]);
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

  return (
    <SettingsPage
      title={t("varsayilan_modeller")}
      description={pick(
        "Hangi görevin hangi modele gideceği. Her çağrıda manuel olarak değiştirebilirsin.",
        "Which task goes to which model. You can override manually on every call.",
      )}
    >
      <SettingsSection>
        <SettingsGroup>
          <QuickStartRow
            keys={keys}
            onApplied={(applied) =>
              setDraftBindings((prev) => ({ ...prev, ...applied }))
            }
          />
        </SettingsGroup>
      </SettingsSection>

      <SettingsSection title={pick("Görev modelleri", "Task models")}>
        <SettingsGroup>
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
            label={pick("Hızlı görevler (tag, başlık)", "Quick tasks (tags, titles)")}
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
              "Yeni source'lar bu modelle gömülür. Mevcut workspace'leri yeniden gömmek için Embedding sayfasını kullan.",
              "New sources are embedded with this model. To reembed existing workspaces, use the Embedding page.",
            )}
            note={pick(
              "Mevcut chunks değişmez; yeniden gömmek için Embedding sayfası → 'Yeniden göm' kullan.",
              "Existing chunks are not touched; to reembed, use the Embedding page → 'Reembed'.",
            )}
          />
        </SettingsGroup>
      </SettingsSection>

      <div className="sticky bottom-4 z-10 flex items-center justify-between gap-3 rounded-lg border border-rule-strong bg-paper px-4 py-3 shadow-[var(--shadow-medium)]">
        <span className="font-mono text-[11.5px] text-ink-3">
          {isModelDraftDirty
            ? pick("Kaydedilmemiş değişiklikler var.", "You have unsaved changes.")
            : pick("Tüm değişiklikler kaydedildi.", "All changes saved.")}
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
    </SettingsPage>
  );
}
