"use client";

import { Loader2, Sparkles, WandSparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { useLocalePick } from "@/i18n/IntlProvider";
import { resolveChatCredentialForPreset } from "@/lib/ai/anthropic-credential";
import {
  CURRICULUM_CHUNK_DETAIL_MAX,
  CURRICULUM_CHUNK_DETAIL_MIN,
  DEFAULT_CURRICULUM_CHUNK_DETAIL,
  getCurriculumPromptBudget,
} from "@/lib/ai/curriculum-budget";
import {
  CurriculumGenError,
  estimateCurriculumCost,
  generateCurriculum,
} from "@/lib/ai/curriculum-generation";
import { findChatOption } from "@/lib/ai/model-options";
import { isLocalUrl } from "@/lib/ai/providers/local-bypass";
import { getPreset } from "@/lib/ai/providers/presets";
import { listChunksBySource } from "@/lib/db/chunks";
import { useSources } from "@/lib/db/hooks";
import { createDraftCurriculumForWorkspace } from "@/lib/db/study";
import { findCustomEndpoint, usePrefs } from "@/stores/prefs";
import { useVault } from "@/stores/vault";

type Props = {
  open: boolean;
  onClose: () => void;
  workspaceId: string;
  workspace: { name: string; goal?: string | undefined };
};

// Output token cap matches the runner's maxTokens floor; lets the cost
// preview bound the worst case rather than under-quoting it.
const ESTIMATED_OUTPUT_TOKENS = 2000;

export function GenerateCurriculumModal({
  open,
  onClose,
  workspaceId,
  workspace,
}: Props) {
  const pick = useLocalePick();
  const { toast } = useToast();
  const sources = useSources(workspaceId);
  const masterKey = useVault((s) => s.masterKey);
  const modelId = usePrefs((s) => s.modelBindings.summary);
  const locale = usePrefs((s) => s.locale);
  const chunkDetailLevel = usePrefs(
    (s) => s.curriculumGeneration.chunkDetailLevel,
  );
  const setCurriculumChunkDetail = usePrefs((s) => s.setCurriculumChunkDetail);
  const customEndpoint = findCustomEndpoint(modelId.split("::")[0] ?? "");

  const [running, setRunning] = useState(false);
  const [chunkRowsBySource, setChunkRowsBySource] = useState<
    Map<string, Awaited<ReturnType<typeof listChunksBySource>>>
  >(new Map());
  const [selectedSourceIds, setSelectedSourceIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [, setUnlockOpen] = useState(false);
  const cancelRef = useRef<AbortController | null>(null);

  const readySources = useMemo(
    () => (sources ?? []).filter((s) => s.ingestStatus === "ready"),
    [sources],
  );
  const selectedReadySources = useMemo(
    () => readySources.filter((s) => selectedSourceIds.has(s.id)),
    [readySources, selectedSourceIds],
  );

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) {
        setSelectedSourceIds(new Set(readySources.map((source) => source.id)));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [open, readySources]);

  // Pre-flight chunk + token totals for cost preview. Re-runs on open
  // because chunks may have been added between modal opens.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      const map = new Map<string, Awaited<ReturnType<typeof listChunksBySource>>>();
      for (const src of readySources) {
        const chunks = await listChunksBySource(src.id);
        if (cancelled) return;
        map.set(src.id, chunks);
      }
      if (!cancelled) {
        setChunkRowsBySource(map);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, readySources]);

  const chatOption = findChatOption(modelId);
  const preset = chatOption ? getPreset(chatOption.presetId) : undefined;
  const baseUrl = customEndpoint?.baseUrl ?? preset?.baseUrl;
  const isLocal = Boolean(baseUrl && isLocalUrl(baseUrl));
  const isVaultLocked = !masterKey;
  const promptBudget = useMemo(
    () => getCurriculumPromptBudget(chunkDetailLevel),
    [chunkDetailLevel],
  );
  const selectedEstimateTokens = useMemo(() => {
    let tokens = 0;
    for (const source of selectedReadySources) {
      const chunks = chunkRowsBySource.get(source.id) ?? [];
      for (const chunk of chunks) tokens += chunk.tokenCount ?? 0;
    }
    return tokens;
  }, [chunkRowsBySource, selectedReadySources]);
  const estimatedInputTokens = Math.min(
    selectedEstimateTokens,
    Math.ceil(promptBudget.sourceTextBudgetChars / 4),
  );

  const estimatedCost = useMemo(() => {
    return estimateCurriculumCost(chatOption?.modelId ?? modelId, {
      input_tokens: estimatedInputTokens,
      output_tokens: ESTIMATED_OUTPUT_TOKENS,
    });
  }, [chatOption?.modelId, estimatedInputTokens, modelId]);

  const canRunAi =
    !running &&
    Boolean(chatOption) &&
    selectedReadySources.length > 0 &&
    (isLocal || !isVaultLocked);
  const canRunHeuristic = !running && selectedReadySources.length > 0;

  function handleClose(): void {
    if (running) return;
    onClose();
  }

  async function handleRunAi(): Promise<void> {
    if (!canRunAi || !chatOption) return;
    setRunning(true);
    const ctl = new AbortController();
    cancelRef.current = ctl;
    try {
      let apiKey = "";
      let authKind: "oauth" | "api-key" | undefined;
      if (!isLocal) {
        if (!masterKey) {
          throw new Error(
            pick(
              "Vault kilitli. Önce master parolayı gir.",
              "Vault is locked. Unlock first.",
            ),
          );
        }
        const cred = await resolveChatCredentialForPreset(chatOption.presetId);
        if (!cred) {
          throw new Error(
            pick(
              `${chatOption.label} için anahtar yok. Settings → Anahtarlar üzerinden ekle.`,
              `No API key stored for ${chatOption.label}. Add one in Settings → Keys.`,
            ),
          );
        }
        apiKey = cred.apiKey;
        if (cred.authKind) authKind = cred.authKind;
      }
      const sourcesArg = selectedReadySources.map((s) => ({
        id: s.id,
        title: s.title,
        ...(s.titleEn !== undefined ? { titleEn: s.titleEn } : {}),
        type: s.type,
        ...(s.author !== undefined ? { author: s.author } : {}),
        chunks: (chunkRowsBySource.get(s.id) ?? []).map((c) => {
          const out: {
            id: string;
            index: number;
            text: string;
            section?: string;
            headings?: string[];
            page?: number;
          } = {
            id: c.id,
            index: c.index,
            text: c.text,
          };
          if (c.section !== undefined) out.section = c.section;
          if (c.headings !== undefined) out.headings = c.headings;
          if (c.page !== undefined) out.page = c.page;
          return out;
        }),
      }));
      const result = await generateCurriculum({
        workspaceId,
        workspace,
        sources: sourcesArg,
        modelId,
        apiKey,
        ...(authKind ? { authKind } : {}),
        locale,
        sourceTextBudgetChars: promptBudget.sourceTextBudgetChars,
        maxChunkTextChars: promptBudget.maxChunkTextChars,
        signal: ctl.signal,
      });
      toast({
        variant: result.fallbackReason ? "warn" : "success",
        title:
          result.refineStatus === "refined"
            ? pick("AI ile iyileştirildi", "Refined with AI")
            : pick(
                "Kaynak temelli roadmap oluşturuldu",
                "Source-based roadmap created",
              ),
        description:
          result.refineStatus === "refined"
            ? `${result.items.length} ${pick("adım", "steps")} · AI refine ~$${result.estimatedCostUsd.toFixed(4)}`
            : `${result.items.length} ${pick("adım", "steps")} · ${pick("AI yanıtı geçersizdi; hızlı roadmap kaydedildi", "AI response was invalid; quick roadmap was saved")}`,
      });
      onClose();
    } catch (err) {
      const message =
        err instanceof CurriculumGenError
          ? `${err.code}: ${err.message}`
          : err instanceof Error
            ? err.message
            : String(err);
      toast({
        variant: "error",
        title: pick("AI roadmap başarısız", "AI roadmap failed"),
        description: message,
      });
    } finally {
      setRunning(false);
      cancelRef.current = null;
    }
  }

  async function handleRunHeuristic(): Promise<void> {
    if (!canRunHeuristic) return;
    setRunning(true);
    try {
      const result = await createDraftCurriculumForWorkspace(workspaceId, {
        sourceIds: selectedReadySources.map((source) => source.id),
      });
      toast({
        variant: "info",
        title: pick("Roadmap oluşturuldu", "Roadmap created"),
        description: `${result.items.length} ${pick("adım (AI'sız)", "steps (no AI)")}`,
      });
      onClose();
    } catch (err) {
      toast({
        variant: "error",
        title: pick("Roadmap başarısız", "Roadmap failed"),
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setRunning(false);
    }
  }

  function handleCancel(): void {
    cancelRef.current?.abort();
  }

  function setSourceSelected(sourceId: string, selected: boolean): void {
    setSelectedSourceIds((current) => {
      const next = new Set(current);
      if (selected) next.add(sourceId);
      else next.delete(sourceId);
      return next;
    });
  }

  function selectAllSources(): void {
    setSelectedSourceIds(new Set(readySources.map((source) => source.id)));
  }

  function clearSourceSelection(): void {
    setSelectedSourceIds(new Set());
  }

  return (
    <>
      <Modal
        open={open}
        onClose={handleClose}
        size="lg"
        title={
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-accent" aria-hidden />
            {pick("Roadmap oluştur", "Generate roadmap")}
          </div>
        }
        description={pick(
          "Hazır kaynaklardan adım adım çalışılacak bir roadmap çıkar. AI yolu konuları sıralar, hedefleri yazar ve kaynaklara dayandırır; hızlı yol kaynak başlıklarından anında bir roadmap çıkarır.",
          "Build a step-by-step learning roadmap from ready sources. AI orders the topics, writes goals, and grounds them in sources; the quick path creates an instant roadmap from source headings.",
        )}
        footer={
          <div className="flex items-center justify-between gap-3">
            <span className="font-mono text-[11px] text-ink-3">
              {estimatedCost <= 0
                ? pick(
                    "Hızlı roadmap: ücretsiz · AI refine: ücretsiz",
                    "Quick roadmap: free · AI refine: free",
                  )
                : `${pick("Hızlı roadmap", "Quick roadmap")}: ${pick("ücretsiz", "free")} · AI refine: ~$${estimatedCost.toFixed(3)}`}
            </span>
            <div className="flex items-center gap-2">
              {running ? (
                <Button size="sm" onClick={handleCancel}>
                  {pick("İptal", "Cancel")}
                </Button>
              ) : (
                <Button size="sm" onClick={onClose}>
                  {pick("Kapat", "Close")}
                </Button>
              )}
              <Button
                size="sm"
                onClick={() => void handleRunHeuristic()}
                disabled={!canRunHeuristic}
              >
                <WandSparkles className="h-3.5 w-3.5" aria-hidden />
                {pick("Hızlı roadmap", "Quick roadmap")}
              </Button>
              <Button
                size="sm"
                variant="accent"
                onClick={() => void handleRunAi()}
                disabled={!canRunAi}
              >
                {running ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <Sparkles className="h-3.5 w-3.5" aria-hidden />
                )}
                {running
                  ? pick("Üretiliyor…", "Generating…")
                  : pick("AI ile oluştur", "Generate with AI")}
              </Button>
            </div>
          </div>
        }
      >
        <div className="space-y-4">
          {readySources.length === 0 ? (
            <div className="rounded border border-dashed border-rule bg-paper-2 p-4 text-center text-[13px] text-ink-3">
              {pick(
                "Bu workspace'de hazır kaynak yok. Önce bir PDF/DOCX yükle.",
                "No ready sources in this workspace. Upload a PDF/DOCX first.",
              )}
            </div>
          ) : (
            <div className="space-y-2 rounded-[10px] border border-rule bg-paper-2 p-3 text-[12.5px] leading-5">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-3">
                  {pick("Kaynaklar", "Sources")}
                </span>
                <span className="font-mono text-[11px] text-ink-3">
                  {selectedReadySources.length}/{readySources.length} · ~{Math.round(estimatedInputTokens / 1000)}k {pick("token", "tokens")}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={selectAllSources}
                  className="rounded-md border border-rule bg-paper px-2 py-1 font-mono text-[10.5px] uppercase tracking-[0.06em] text-ink-2 transition-[background,border-color,color] hover:border-accent hover:bg-paper-3 hover:text-ink"
                >
                  {pick("Tümünü seç", "Select all")}
                </button>
                <button
                  type="button"
                  onClick={clearSourceSelection}
                  className="rounded-md border border-rule bg-paper px-2 py-1 font-mono text-[10.5px] uppercase tracking-[0.06em] text-ink-3 transition-[background,border-color,color] hover:border-rule-strong hover:bg-paper-3 hover:text-ink"
                >
                  {pick("Temizle", "Clear")}
                </button>
              </div>
              <ul className="max-h-44 space-y-1 overflow-auto pr-1 text-ink-2">
                {readySources.map((s) => {
                  const checked = selectedSourceIds.has(s.id);
                  const label = pick(s.title, s.titleEn ?? s.title);
                  return (
                    <li key={s.id}>
                      <label className="flex cursor-pointer items-start gap-2 rounded-md px-1 py-1 hover:bg-paper-3">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(event) =>
                            setSourceSelected(s.id, event.currentTarget.checked)
                          }
                          className="mt-0.5 h-3.5 w-3.5 accent-[var(--accent)]"
                          aria-label={label}
                        />
                        <span className="min-w-0 flex-1 truncate">
                          {label}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
              {selectedReadySources.length === 0 ? (
                <div className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-[12px] leading-5 text-warn">
                  {pick(
                    "Roadmap oluşturmak için en az bir kaynak seç.",
                    "Select at least one source to generate a roadmap.",
                  )}
                </div>
              ) : null}
            </div>
          )}

          <div className="space-y-3 rounded-[10px] border border-rule p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-3">
                  {pick("Chunk detayı", "Chunk detail")}
                </div>
                <p className="mt-1 text-[12.5px] leading-5 text-ink-3">
                  {pick(
                    "AI roadmap için kaynaklardan ne kadar metin gönderileceğini ayarlar.",
                    "Controls how much source text is sent for AI roadmap generation.",
                  )}
                </p>
              </div>
              <span className="rounded border border-rule bg-paper-2 px-2 py-1 font-mono text-[11px] text-ink-2">
                {chunkDetailLevel}/5
              </span>
            </div>
            <input
              type="range"
              min={CURRICULUM_CHUNK_DETAIL_MIN}
              max={CURRICULUM_CHUNK_DETAIL_MAX}
              step={1}
              value={chunkDetailLevel}
              onChange={(event) =>
                setCurriculumChunkDetail(Number(event.currentTarget.value))
              }
              aria-label={pick("Chunk detayı", "Chunk detail")}
              className="w-full accent-[var(--accent)]"
            />
            <div className="flex justify-between font-mono text-[10.5px] uppercase tracking-[0.06em] text-ink-4">
              <span>{pick("Kısa", "Compact")}</span>
              <span>{pick("Dengeli", "Balanced")}</span>
              <span>{pick("Maksimum", "Maximum")}</span>
            </div>
            {chunkDetailLevel > DEFAULT_CURRICULUM_CHUNK_DETAIL ? (
              <div className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-[12px] leading-5 text-warn">
                {pick(
                  "Dengeli seviyenin üstü daha fazla bağlam ve maliyet kullanır; çok büyük workspace'lerde model limitine yaklaşabilir.",
                  "Above balanced uses more context and cost; very large workspaces may get close to the model limit.",
                )}
              </div>
            ) : null}
            {chunkDetailLevel < DEFAULT_CURRICULUM_CHUNK_DETAIL ? (
              <div className="rounded-md border border-rule bg-paper-2 px-3 py-2 text-[12px] leading-5 text-ink-3">
                {pick(
                  "Dengeli seviyenin altı daha hızlı ve ucuzdur, ancak kaynak ayrıntıları kırpıldığı için bilgi kaybı artabilir.",
                  "Below balanced is faster and cheaper, but source details are trimmed more heavily and information loss can increase.",
                )}
              </div>
            ) : null}
          </div>

          <div className="space-y-2 rounded-[10px] border border-rule p-3 text-[12.5px] leading-5">
            <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-3">
              {pick("Model", "Model")}
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="truncate">
                {chatOption?.label ?? modelId}
                {isLocal ? (
                  <span className="ml-2 rounded bg-paper-3 px-1.5 py-0.5 font-mono text-[10px] text-ink-3">
                    🏠 local
                  </span>
                ) : null}
              </span>
              {isVaultLocked && !isLocal ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setUnlockOpen(true)}
                >
                  {pick("Vault'u aç", "Unlock vault")}
                </Button>
              ) : null}
            </div>
            {!chatOption ? (
              <div className="text-[11.5px] text-warn">
                {pick(
                  "Settings → Models üzerinden geçerli bir chat modeli seç.",
                  "Pick a valid chat model in Settings → Models.",
                )}
              </div>
            ) : null}
          </div>
        </div>
      </Modal>
      
    </>
  );
}
