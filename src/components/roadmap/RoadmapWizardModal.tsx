"use client";

import { Loader2, Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Switch } from "@/components/ui/Switch";
import { useToast } from "@/components/ui/Toast";
import { useLocalePick } from "@/i18n/IntlProvider";
import {
  runRoadmapGen,
  runRoadmapTranslate,
  RoadmapGenError,
  type RoadmapTranslation,
} from "@/lib/ai/roadmap-gen";
import { findChatOption } from "@/lib/ai/model-options";
import { getApiKey } from "@/lib/db/api-keys-repo";
import {
  createRoadmap,
  replaceRoadmapGraph,
  type RoadmapNodeInput,
} from "@/lib/db/roadmaps";
import { useSources } from "@/lib/db/hooks";
import type { SourceRecord } from "@/lib/db/types";
import { buildRoadmapSourceContext } from "@/lib/roadmap/source-context";
import type {
  RoadmapLangMode,
  RoadmapLevel,
  RoadmapTimeframe,
} from "@/lib/roadmap/types";
import { usePrefs } from "@/stores/prefs";

type Step = 1 | 2 | 3;

// Map the wizard's language-mode choice to generation params: which language
// the single canonical generation runs in, whether to keep English terms, and
// (for "both") which language to translate the result into afterwards.
function deriveGenLocale(
  langMode: RoadmapLangMode,
  baseLocale: "tr" | "en",
): { primary: "tr" | "en"; keepEnglishTerms: boolean; translateTo: "tr" | "en" | null } {
  switch (langMode) {
    case "tr":
      return { primary: "tr", keepEnglishTerms: false, translateTo: null };
    case "en":
      return { primary: "en", keepEnglishTerms: false, translateTo: null };
    case "en_terms_tr":
      return { primary: "tr", keepEnglishTerms: true, translateTo: null };
    case "both":
      return {
        primary: baseLocale,
        keepEnglishTerms: false,
        translateTo: baseLocale === "tr" ? "en" : "tr",
      };
  }
}

// Sentinel translate-item id for the roadmap title (rides the same batched
// translation call as the nodes).
const TITLE_ITEM_ID = "__roadmap_title__";

type Props = {
  open: boolean;
  onClose: () => void;
  workspaceId: string;
  onCreated: (roadmapId: string) => void;
};

export function RoadmapWizardModal({
  open,
  onClose,
  workspaceId,
  onCreated,
}: Props) {
  const pick = useLocalePick();
  const locale = usePrefs((s) => s.locale);
  const aiResponseLocale = usePrefs((s) => s.aiResponseLocale);
  // Default language mode follows the user's existing output-locale settings:
  // an explicit tr/en AI-response locale wins, else the UI locale.
  const defaultLangMode: RoadmapLangMode =
    aiResponseLocale === "en"
      ? "en"
      : aiResponseLocale === "tr"
        ? "tr"
        : locale === "en"
          ? "en"
          : "tr";
  // The roadmap model is configured in Settings → Default models (full
  // catalog) rather than a cramped in-wizard picker.
  const roadmapModelId = usePrefs((s) => s.modelBindings.roadmapGen);
  const { toast } = useToast();
  const sources = useSources(workspaceId);
  // Only ingested (embedded) sources can be retrieved over for grounding.
  const readySources = useMemo(
    () => (sources ?? []).filter((s) => s.ingestStatus === "ready"),
    [sources],
  );
  const hasSources = readySources.length > 0;

  const [step, setStep] = useState<Step>(1);
  const [topic, setTopic] = useState("");
  const [groundInSources, setUseSources] = useState(false);
  // Which documents the grounding retrieval is scoped to (subset of the
  // workspace). Defaults to all ready sources when the toggle is turned on.
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);
  const [timeframe, setTimeframe] = useState<RoadmapTimeframe>("weekly");
  const [level, setLevel] = useState<RoadmapLevel>("beginner");
  const [langMode, setLangMode] = useState<RoadmapLangMode>(defaultLangMode);
  const [goal, setGoal] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Reset the wizard's form state each time it (re)opens so a previous run's
  // data doesn't leak into the next. Done as a render-phase adjustment (React's
  // documented "reset state when a prop changes" pattern) rather than an effect
  // to avoid a setState-in-effect cascade.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setStep(1);
      setTopic("");
      setUseSources(false);
      setSelectedSourceIds([]);
      setTimeframe("weekly");
      setLevel("beginner");
      setLangMode(defaultLangMode);
      setGoal("");
      setBusy(false);
      setError(null);
    }
  }

  // Abort any in-flight generation when the modal closes.
  useEffect(() => {
    if (open) return;
    abortRef.current?.abort();
    abortRef.current = null;
  }, [open]);

  const canAdvance = useMemo(() => {
    if (step === 1) return topic.trim().length >= 4;
    return true;
  }, [step, topic]);

  // Friendly label for the configured roadmap model, shown read-only in
  // step 3 with a pointer to Settings.
  const modelLabel = useMemo(
    () => findChatOption(roadmapModelId)?.label ?? roadmapModelId,
    [roadmapModelId],
  );

  function handleToggleSources(on: boolean): void {
    setUseSources(on);
    // Default to all ready sources when enabling so the toggle is useful out
    // of the box; clear when disabling.
    setSelectedSourceIds(on ? readySources.map((s) => s.id) : []);
  }
  function handleToggleSource(id: string): void {
    setSelectedSourceIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }
  function handleSelectAllSources(all: boolean): void {
    setSelectedSourceIds(all ? readySources.map((s) => s.id) : []);
  }

  async function handleCreate(): Promise<void> {
    setBusy(true);
    setError(null);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const option = findChatOption(roadmapModelId);
      if (!option) {
        throw new RoadmapGenError(
          "unknown_model",
          `Model not registered: ${roadmapModelId}`,
        );
      }
      const apiKeyProvider = option.presetId as Parameters<typeof getApiKey>[0];
      const apiKey = await getApiKey(apiKeyProvider);
      if (!apiKey || apiKey.length === 0) {
        throw new Error(
          pick(
            "API anahtarı bulunamadı. Ayarlar → API anahtarları üzerinden ekleyin.",
            "No API key found. Add one under Settings → API keys.",
          ),
        );
      }
      // Grounding retrieves only the top excerpts from the selected documents
      // (bounded by token budget) — never the full text — so cost/context
      // stay small. An empty selection means "no grounding".
      const sourceContext =
        groundInSources && selectedSourceIds.length > 0
          ? await buildRoadmapSourceContext(workspaceId, {
              topic: topic.trim(),
              sourceIds: selectedSourceIds,
            })
          : undefined;
      const { primary, keepEnglishTerms, translateTo } = deriveGenLocale(
        langMode,
        locale,
      );
      // One canonical generation produces the structure + text in `primary`.
      const result = await runRoadmapGen({
        topic: topic.trim(),
        timeframe,
        level,
        ...(goal.trim() ? { goal: goal.trim() } : {}),
        ...(sourceContext ? { sourceContext } : {}),
        locale: primary,
        keepEnglishTerms,
        modelId: roadmapModelId,
        apiKey,
        signal: controller.signal,
      });

      // "both": translate the canonical graph into the other language with a
      // parallel batched pass; structure (ids/edges) is untouched.
      let translations = new Map<string, RoadmapTranslation>();
      let translatePartial = false;
      if (translateTo) {
        const items = result.response.nodes.map((n) => ({
          id: n.id,
          title: n.title,
          description: n.description,
        }));
        items.push({
          id: TITLE_ITEM_ID,
          title: result.response.title,
          description: result.response.title,
        });
        const tr = await runRoadmapTranslate({
          target: translateTo,
          items,
          modelId: roadmapModelId,
          apiKey,
          signal: controller.signal,
        });
        translations = tr.translations;
        translatePartial = tr.partial;
      }

      // Resolve a (base = Turkish, English) pair for a source item. The base
      // `title`/`description` fields always hold Turkish and `*En` always hold
      // English, matching the dual-field convention used across the app.
      const resolvePair = (
        id: string,
        srcTitle: string,
        srcDesc: string,
      ): {
        title: string;
        description: string;
        titleEn?: string;
        descriptionEn?: string;
      } => {
        if (!translateTo) return { title: srcTitle, description: srcDesc };
        const t = translations.get(id);
        if (primary === "tr") {
          return {
            title: srcTitle,
            description: srcDesc,
            titleEn: t?.title ?? srcTitle,
            descriptionEn: t?.description ?? srcDesc,
          };
        }
        return {
          title: t?.title ?? srcTitle,
          description: t?.description ?? srcDesc,
          titleEn: srcTitle,
          descriptionEn: srcDesc,
        };
      };

      const titlePair = resolvePair(
        TITLE_ITEM_ID,
        result.response.title,
        result.response.title,
      );

      const rmp = await createRoadmap({
        workspaceId,
        title: titlePair.title,
        ...(titlePair.titleEn ? { titleEn: titlePair.titleEn } : {}),
        langMode,
        topic: topic.trim(),
        timeframe,
        level,
        ...(goal.trim() ? { goal: goal.trim() } : {}),
        usedSources: groundInSources,
        // Persist the encoded binding (not the provider-reported
        // `result.model`, which can be a dated snapshot id that findChatOption
        // can't resolve) so "Create subtasks" re-resolves the same model from
        // NodeInspector even if the user later changes the Settings default.
        model: roadmapModelId,
      });
      const nodeInputs: RoadmapNodeInput[] = result.response.nodes.map((n) => ({
        tempId: n.id,
        parentId: null,
        depth: 0 as const,
        ...resolvePair(n.id, n.title, n.description),
      }));
      await replaceRoadmapGraph(
        rmp.id,
        nodeInputs,
        result.response.edges.map((e) => ({
          fromTempId: e.from,
          toTempId: e.to,
        })),
      );
      if (translatePartial) {
        toast({
          variant: "info",
          title: pick("Kısmi çeviri", "Partial translation"),
          description: pick(
            "Bazı düğümler çevrilemedi; kaynak dilinde bırakıldı.",
            "Some nodes couldn't be translated and kept the source language.",
          ),
        });
      }
      toast({
        variant: "success",
        title: pick("Roadmap hazır", "Roadmap ready"),
        description: titlePair.title,
      });
      onCreated(rmp.id);
    } catch (err) {
      const msg =
        err instanceof RoadmapGenError
          ? aiErrorMessage(err, pick)
          : err instanceof Error
            ? err.message
            : String(err);
      setError(msg);
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  function next(): void {
    if (step < 3) setStep(((step + 1) as Step));
  }
  function back(): void {
    if (step > 1) setStep(((step - 1) as Step));
  }

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      size="lg"
      title={pick("Yeni roadmap", "New roadmap")}
      description={pick(
        `Adım ${step} / 3`,
        `Step ${step} of 3`,
      )}
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={step === 1 ? onClose : back}
            disabled={busy}
          >
            {step === 1
              ? pick("İptal", "Cancel")
              : pick("Geri", "Back")}
          </Button>
          {step < 3 ? (
            <Button
              variant="primary"
              size="sm"
              onClick={next}
              disabled={!canAdvance || busy}
            >
              {pick("İleri", "Next")}
            </Button>
          ) : (
            <Button
              variant="primary"
              size="sm"
              onClick={handleCreate}
              disabled={busy}
            >
              {busy ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  {pick("Oluşturuluyor…", "Creating…")}
                </>
              ) : (
                <>
                  <Sparkles className="h-3.5 w-3.5" aria-hidden />
                  {pick("Roadmap oluştur", "Create roadmap")}
                </>
              )}
            </Button>
          )}
        </div>
      }
    >
      {step === 1 ? (
        <StepOne
          topic={topic}
          onTopicChange={setTopic}
          groundInSources={groundInSources}
          onUseSourcesChange={handleToggleSources}
          hasSources={hasSources}
          sources={readySources}
          selectedSourceIds={selectedSourceIds}
          onToggleSource={handleToggleSource}
          onSelectAllSources={handleSelectAllSources}
          pick={pick}
        />
      ) : null}
      {step === 2 ? (
        <StepTwo
          timeframe={timeframe}
          onTimeframeChange={setTimeframe}
          pick={pick}
        />
      ) : null}
      {step === 3 ? (
        <StepThree
          level={level}
          onLevelChange={setLevel}
          langMode={langMode}
          onLangModeChange={setLangMode}
          goal={goal}
          onGoalChange={setGoal}
          modelLabel={modelLabel}
          pick={pick}
        />
      ) : null}
      {error ? (
        <div className="mt-4 rounded-[10px] border border-err/30 bg-err/10 px-3 py-2 text-[12.5px] text-err">
          {error}
        </div>
      ) : null}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Step bodies (factored out so each step stays under 60 lines)
// ---------------------------------------------------------------------------

type PickFn = (tr: string, en: string) => string;

function StepOne(props: {
  topic: string;
  onTopicChange: (v: string) => void;
  groundInSources: boolean;
  onUseSourcesChange: (v: boolean) => void;
  hasSources: boolean;
  sources: SourceRecord[];
  selectedSourceIds: string[];
  onToggleSource: (id: string) => void;
  onSelectAllSources: (all: boolean) => void;
  pick: PickFn;
}) {
  const {
    topic,
    onTopicChange,
    groundInSources,
    onUseSourcesChange,
    hasSources,
    sources,
    selectedSourceIds,
    onToggleSource,
    onSelectAllSources,
    pick,
  } = props;
  return (
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium text-ink">
          {pick("Konu", "Topic")}
        </span>
        <textarea
          value={topic}
          onChange={(e) => onTopicChange(e.target.value)}
          rows={4}
          placeholder={pick(
            "Örneğin: \"NLP'de transformer mimarisi\"",
            "Example: \"Transformer architecture in NLP\"",
          )}
          className="rounded-[10px] border border-rule-strong bg-paper px-3 py-2.5 text-[13px] text-ink resize-none focus:outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30"
        />
        <span className="text-[11.5px] text-ink-4">
          {pick(
            "En az birkaç kelime. Açıklayıcı bir konu daha iyi grafik üretir.",
            "A few words minimum. A descriptive topic produces a better graph.",
          )}
        </span>
      </label>
      <div className="flex items-start justify-between gap-3 rounded-[10px] border border-rule-soft bg-paper-2 px-3 py-2.5">
        <div className="min-w-0">
          <div className="text-[13px] font-medium text-ink">
            {pick("Workspace kaynaklarını kullan", "Use workspace sources")}
          </div>
          <div className="mt-0.5 text-[11.5px] text-ink-4">
            {pick(
              "AI roadmap'i seçili dokümanların ilgili bölümlerine bağlar.",
              "AI grounds the roadmap in relevant excerpts from the selected docs.",
            )}
          </div>
          {!hasSources ? (
            <div className="mt-1 text-[11px] text-warn">
              {pick(
                "Henüz işlenmiş kaynak yok — bu seçenek devre dışı.",
                "No processed sources yet — this option is disabled.",
              )}
            </div>
          ) : null}
        </div>
        <Switch
          checked={groundInSources && hasSources}
          onCheckedChange={onUseSourcesChange}
          disabled={!hasSources}
          size="sm"
          ariaLabel={pick(
            "Workspace kaynaklarını kullan",
            "Use workspace sources",
          )}
        />
      </div>
      {groundInSources && hasSources ? (
        <div className="flex flex-col gap-2 rounded-[10px] border border-rule-soft bg-paper-2 px-3 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[12.5px] font-medium text-ink">
              {pick("Kullanılacak dokümanlar", "Documents to use")}
            </span>
            <div className="flex items-center gap-2 text-[11.5px]">
              <button
                type="button"
                onClick={() => onSelectAllSources(true)}
                className="text-accent hover:underline"
              >
                {pick("Tümü", "All")}
              </button>
              <span className="text-ink-4">·</span>
              <button
                type="button"
                onClick={() => onSelectAllSources(false)}
                className="text-accent hover:underline"
              >
                {pick("Hiçbiri", "None")}
              </button>
            </div>
          </div>
          <ul className="flex max-h-40 flex-col gap-1 overflow-auto">
            {sources.map((s) => (
              <li key={s.id}>
                <label className="flex cursor-pointer items-center gap-2 text-[12.5px] text-ink-2">
                  <input
                    type="checkbox"
                    checked={selectedSourceIds.includes(s.id)}
                    onChange={() => onToggleSource(s.id)}
                    className="h-3.5 w-3.5 shrink-0"
                  />
                  <span className="truncate">
                    {pick(s.title, s.titleEn ?? s.title)}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <span className="text-[11px] text-ink-4">
            {pick(
              "Seçili dokümanlardan yalnızca konuyla en alakalı bölümler kullanılır — tam metin gönderilmez (düşük maliyet).",
              "Only the excerpts most relevant to the topic are used — never full text (keeps cost low).",
            )}
          </span>
        </div>
      ) : null}
    </div>
  );
}

function StepTwo(props: {
  timeframe: RoadmapTimeframe;
  onTimeframeChange: (v: RoadmapTimeframe) => void;
  pick: PickFn;
}) {
  const { timeframe, onTimeframeChange, pick } = props;
  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="text-[13px] font-medium text-ink">
          {pick("Zaman dilimi", "Timeframe")}
        </div>
        <div className="mt-0.5 text-[11.5px] text-ink-4">
          {pick(
            "AI kaç node üreteceğini buradan belirler.",
            "Determines how many nodes the AI produces.",
          )}
        </div>
      </div>
      <SegmentedControl<RoadmapTimeframe>
        value={timeframe}
        onChange={onTimeframeChange}
        size="md"
        options={[
          {
            value: "daily",
            label: (
              <span className="flex flex-col items-center">
                <span>{pick("Günlük", "Daily")}</span>
                <span className="text-[10.5px] opacity-70">4-6</span>
              </span>
            ),
          },
          {
            value: "weekly",
            label: (
              <span className="flex flex-col items-center">
                <span>{pick("Haftalık", "Weekly")}</span>
                <span className="text-[10.5px] opacity-70">8-12</span>
              </span>
            ),
          },
          {
            value: "monthly",
            label: (
              <span className="flex flex-col items-center">
                <span>{pick("Aylık", "Monthly")}</span>
                <span className="text-[10.5px] opacity-70">16-24</span>
              </span>
            ),
          },
        ]}
      />
    </div>
  );
}

function StepThree(props: {
  level: RoadmapLevel;
  onLevelChange: (v: RoadmapLevel) => void;
  langMode: RoadmapLangMode;
  onLangModeChange: (v: RoadmapLangMode) => void;
  goal: string;
  onGoalChange: (v: string) => void;
  modelLabel: string;
  pick: PickFn;
}) {
  const {
    level,
    onLevelChange,
    langMode,
    onLangModeChange,
    goal,
    onGoalChange,
    modelLabel,
    pick,
  } = props;
  const langHint =
    langMode === "both"
      ? pick(
          "İçerik hem Türkçe hem İngilizce üretilir; roadmap görünümünde tek tıkla geçiş yapabilirsin. (~2× üretim maliyeti.)",
          "Content is produced in both Turkish and English; switch with one click in the roadmap view. (~2× generation cost.)",
        )
      : langMode === "en_terms_tr"
        ? pick(
            "Açıklamalar Türkçe, teknik terimler İngilizce orijinal haliyle kalır.",
            "Explanations in Turkish, technical terms kept in their original English form.",
          )
        : pick(
            "Tüm içerik seçilen dilde üretilir.",
            "All content is produced in the selected language.",
          );
  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="text-[13px] font-medium text-ink">
          {pick("Seviye", "Level")}
        </div>
        <SegmentedControl<RoadmapLevel>
          className="mt-2"
          value={level}
          onChange={onLevelChange}
          size="md"
          options={[
            { value: "beginner", label: pick("Başlangıç", "Beginner") },
            { value: "intermediate", label: pick("Orta", "Intermediate") },
            { value: "advanced", label: pick("İleri", "Advanced") },
          ]}
        />
      </div>
      <div>
        <div className="text-[13px] font-medium text-ink">
          {pick("İçerik dili", "Content language")}
        </div>
        <SegmentedControl<RoadmapLangMode>
          className="mt-2"
          value={langMode}
          onChange={onLangModeChange}
          size="md"
          options={[
            { value: "tr", label: pick("Türkçe", "Turkish") },
            { value: "en", label: pick("İngilizce", "English") },
            { value: "en_terms_tr", label: pick("EN terim·TR", "EN terms·TR") },
            { value: "both", label: pick("İkisi", "Both") },
          ]}
        />
        <div className="mt-1.5 text-[11.5px] text-ink-4">{langHint}</div>
      </div>
      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium text-ink">
          {pick("Hedef", "Goal")}
          <span className="ml-1 text-[11.5px] font-normal text-ink-4">
            {pick("(opsiyonel)", "(optional)")}
          </span>
        </span>
        <input
          type="text"
          value={goal}
          onChange={(e) => onGoalChange(e.target.value)}
          placeholder={pick(
            "Roadmap sonunda ne yapabilmek istersin?",
            "What do you want to be able to do?",
          )}
          className="rounded-[10px] border border-rule-strong bg-paper px-3 py-2 text-[13px] text-ink focus:outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30"
        />
      </label>
      <div className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium text-ink">
          {pick("Model", "Model")}
        </span>
        <div className="flex items-center rounded-[10px] border border-rule-soft bg-paper-2 px-3 py-2 text-[13px] text-ink-2">
          <span className="truncate">{modelLabel}</span>
        </div>
        <span className="text-[11.5px] text-ink-4">
          {pick(
            "Ayarlar → Varsayılan modeller → Roadmap üretimi'nden değiştir.",
            "Change it under Settings → Default models → Roadmap generation.",
          )}
        </span>
      </div>
    </div>
  );
}

function aiErrorMessage(err: RoadmapGenError, pick: PickFn): string {
  switch (err.code) {
    case "unknown_model":
      return pick(
        "Seçilen model kayıt defterinde yok.",
        "The selected model isn't in the registry.",
      );
    case "stream_error":
      return pick(
        `Sağlayıcı hatası: ${err.message}`,
        `Provider error: ${err.message}`,
      );
    case "aborted":
      return pick("İşlem iptal edildi.", "Operation aborted.");
    case "empty_response":
      return pick(
        "Model boş yanıt döndü. Tekrar deneyin veya farklı bir model seçin.",
        "Model returned no content. Retry or pick a different model.",
      );
    case "content_filter":
      return pick(
        "Model kendi çıktısını engelledi (güvenlik/RECITATION filtresi — Gemini'de müfredat/ders metinlerinde sık görülür). Farklı bir model deneyin (ör. Claude veya OpenAI) ya da konuyu yeniden ifade edin.",
        "The model blocked its own output (safety / recitation filter — common on Gemini for curriculum-style text). Try a different model (e.g. Claude or OpenAI) or rephrase.",
      );
    case "parse_error":
      return pick(
        `Model geçerli JSON döndürmedi (${err.message}). Tekrar deneyin ya da daha güvenilir bir model seçin (ör. Claude).`,
        `The model didn't return valid JSON (${err.message}). Retry or pick a more reliable model (e.g. Claude).`,
      );
    default:
      return err.message;
  }
}
