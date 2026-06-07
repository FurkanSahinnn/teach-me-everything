"use client";

import { Loader2, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { useToast } from "@/components/ui/Toast";
import { useLocalePick } from "@/i18n/IntlProvider";
import { FlashcardProposalModal } from "./FlashcardProposalModal";
import {
  estimateCost,
  FlashcardGenError,
  runFlashcardGen,
  type RunFlashcardGenResult,
} from "@/lib/ai/flashcard-gen";
import {
  defaultContentLangMode,
  deriveGenLocale,
  resolveBilingualPair,
  type ContentLangMode,
} from "@/lib/ai/content-language";
import { runTranslate, type TranslateItem } from "@/lib/ai/translate";
import { findChatOption } from "@/lib/ai/model-options";
import { resolveChatCredentialForPreset } from "@/lib/ai/anthropic-credential";
import { listChunksBySource } from "@/lib/db/chunks";
import { useSources } from "@/lib/db/hooks";
import type { ChunkRecord, SourceRecord } from "@/lib/db/types";
import { isLocalUrl } from "@/lib/ai/providers/local-bypass";
import { getPreset } from "@/lib/ai/providers/presets";
import { findCustomEndpoint } from "@/stores/prefs";
import { usePrefs } from "@/stores/prefs";
import { useVault } from "@/stores/vault";

const COUNT_CHOICES = [5, 10, 20] as const;
type CountChoice = (typeof COUNT_CHOICES)[number];

// Rough token estimate: 1 token ≈ 4 chars for the source payload, +250
// tokens for system prompt overhead, +220 tokens of expected output per
// requested card. Wrong by ±30% but enough to flag a $1 generation before
// it runs.
function estimateInputTokensForChunks(chunks: ChunkRecord[]): number {
  let chars = 0;
  for (const c of chunks) chars += c.text.length;
  return Math.ceil(chars / 4) + 250;
}

export type GenerateBatchModalProps = {
  open: boolean;
  onClose: () => void;
  workspaceId: string;
  /** Optional: when launched from inside a source reader, pre-pick that
   *  source so the user doesn't have to scroll to find it. */
  initialSourceId?: string;
  /** Generation mode. `"batch"` (default) spans the whole source. `"single"`
   *  anchors the prompt to a specific chat exchange via `chatContext` so the
   *  proposed cards focus on what the user just discussed. */
  mode?: "single" | "batch";
  /** Free-text snippet (typically `User: ... \n Assistant: ...`) that's
   *  prepended to the prompt when `mode === "single"`. Ignored otherwise. */
  chatContext?: string;
  /** Thread id propagated to `generatedFrom.threadId` so chat-originated
   *  cards trace back to the conversation that produced them. */
  threadId?: string;
  /** Optional chunk-id allowlist. When set, the gen call sees only these
   *  chunks (4.D weak-spot flow) and provenance.chunkIds is the same set. */
  chunkIds?: string[];
};

export function GenerateBatchModal({
  open,
  onClose,
  workspaceId,
  initialSourceId,
  mode = "batch",
  chatContext,
  threadId,
  chunkIds,
}: GenerateBatchModalProps) {
  const pick = useLocalePick();
  const { toast } = useToast();
  const sources = useSources(workspaceId) ?? [];
  const masterKey = useVault((s) => s.masterKey);
  const modelId = usePrefs((s) => s.modelBindings.flashcardGen);
  const locale = usePrefs((s) => s.locale);
  const aiResponseLocale = usePrefs((s) => s.aiResponseLocale);

  const [sourceId, setSourceId] = useState<string | undefined>(initialSourceId);
  // Single-mode defaults to fewer cards (3) — the chat context is narrow
  // enough that asking for 10 cards forces the model to hallucinate breadth.
  const [count, setCount] = useState<CountChoice>(mode === "single" ? 5 : 10);
  // Content-language mode for the batch. Default follows the user's existing
  // output-locale settings (an explicit tr/en AI-response locale wins, else the
  // UI locale). "both" generates in one language + translates into the other.
  const [langMode, setLangMode] = useState<ContentLangMode>(() =>
    defaultContentLangMode(aiResponseLocale, locale),
  );
  const [running, setRunning] = useState(false);
  const [proposal, setProposal] = useState<RunFlashcardGenResult | null>(null);
  // The langMode the current proposal was generated under — drives whether the
  // deck/cards land as bilingual.
  const [proposalLangMode, setProposalLangMode] =
    useState<ContentLangMode>("tr");

  // When sources list resolves and no source is selected yet, pre-pick the
  // first ready one so the cost preview can render immediately.
  useEffect(() => {
    if (!open) return;
    if (sourceId) return;
    const first = sources.find((s) => s.ingestStatus === "ready") ?? sources[0];
    if (first) {
      const id = first.id;
      queueMicrotask(() => setSourceId(id));
    }
  }, [open, sourceId, sources]);

  // Re-seed the language mode from current prefs each time the modal opens so a
  // settings change between sessions is reflected.
  useEffect(() => {
    if (!open) return;
    const next = defaultContentLangMode(aiResponseLocale, locale);
    queueMicrotask(() => setLangMode(next));
  }, [open, aiResponseLocale, locale]);

  const chatOption = useMemo(() => findChatOption(modelId), [modelId]);
  const selectedSource = useMemo(
    () => sources.find((s) => s.id === sourceId),
    [sources, sourceId],
  );

  const [estimateTokens, setEstimateTokens] = useState(0);
  // Recompute token estimate when source, chunk allowlist, or count changes.
  // Loaded once per selection — chunks are read straight from Dexie because
  // the upper bound (50 chunks @ ~1k tokens) keeps the call cheap.
  useEffect(() => {
    if (!sourceId) {
      queueMicrotask(() => setEstimateTokens(0));
      return;
    }
    let cancelled = false;
    void (async () => {
      const all = await listChunksBySource(sourceId);
      if (cancelled) return;
      const allow = chunkIds && chunkIds.length > 0 ? new Set(chunkIds) : null;
      const filtered = allow
        ? all.filter((c) => allow.has(c.id) || allow.has(`#${c.index}`))
        : all;
      setEstimateTokens(estimateInputTokensForChunks(filtered));
    })();
    return () => {
      cancelled = true;
    };
  }, [sourceId, chunkIds]);

  const estimatedCost = useMemo(() => {
    return estimateCost(chatOption?.modelId ?? modelId, {
      input_tokens: estimateTokens,
      output_tokens: count * 220,
    });
  }, [chatOption?.modelId, modelId, estimateTokens, count]);

  const isVaultLocked = !masterKey;
  const presetId = chatOption?.presetId;
  const preset = presetId ? getPreset(presetId) : undefined;
  const isLocal =
    preset?.id === "ollama" ||
    preset?.id === "lm-studio" ||
    preset?.id === "llama-cpp" ||
    (preset && isLocalUrl(preset.baseUrl)) ||
    (presetId && String(presetId).startsWith("custom:") &&
      (() => {
        const epId = String(presetId).slice("custom:".length);
        const ep = findCustomEndpoint(epId);
        return ep ? isLocalUrl(ep.baseUrl) : false;
      })());

  const canRun =
    !running && Boolean(selectedSource) && Boolean(chatOption) && (isLocal || !isVaultLocked);

  async function handleRun(): Promise<void> {
    if (!canRun || !selectedSource || !chatOption) return;
    setRunning(true);
    try {
      const all = await listChunksBySource(selectedSource.id);
      const allow =
        chunkIds && chunkIds.length > 0 ? new Set(chunkIds) : null;
      const chunks = allow
        ? all.filter((c) => allow.has(c.id) || allow.has(`#${c.index}`))
        : all;
      if (chunks.length === 0) {
        throw new Error(
          allow
            ? pick(
                "Seçilen chunk'lar bu kaynakta bulunamadı.",
                "Selected chunks not found in this source.",
              )
            : pick("Bu kaynakta chunk yok.", "Source has no chunks."),
        );
      }
      let apiKey = "";
      let authKind: "oauth" | "api-key" | undefined;
      if (!isLocal) {
        if (!masterKey) {
          throw new Error(
            pick(
              "Vault kilitli. Önce Settings → Anahtarlar üzerinden master parolayı gir.",
              "Vault is locked. Unlock via Settings → Keys first.",
            ),
          );
        }
        const cred = await resolveChatCredentialForPreset(chatOption.presetId);
        if (!cred) {
          throw new Error(
            pick(
              `${chatOption.label} için anahtar yok.`,
              `No API key stored for ${chatOption.label}.`,
            ),
          );
        }
        apiKey = cred.apiKey;
        if (cred.authKind) authKind = cred.authKind;
      }
      const { primary, keepEnglishTerms, translateTo } = deriveGenLocale(
        langMode,
        locale,
      );
      // One canonical generation produces the cards in `primary`.
      const result = await runFlashcardGen({
        modelId,
        apiKey,
        ...(authKind ? { authKind } : {}),
        source: selectedSource,
        chunks,
        locale: primary,
        keepEnglishTerms,
        count,
        mode,
        ...(mode === "single" && chatContext ? { chatContext } : {}),
      });

      // "both": translate the generated cards into the other language with a
      // parallel batched pass, then fold the result back into parallel `*En`
      // fields. The base question/answer always hold Turkish, `*En` English.
      if (translateTo) {
        const items: TranslateItem[] = result.cards.map((c, i) => ({
          id: String(i),
          fields: { question: c.question, answer: c.answer },
        }));
        const translated = await runTranslate({
          target: translateTo,
          items,
          modelId,
          apiKey,
          ...(authKind ? { authKind } : {}),
          domainHint: pick("bir flashcard destesi", "a flashcard deck"),
        });
        result.cards = result.cards.map((c, i) => {
          const tr = translated.byId.get(String(i));
          const q = resolveBilingualPair(
            primary,
            translateTo,
            c.question,
            tr?.question,
          );
          const a = resolveBilingualPair(
            primary,
            translateTo,
            c.answer,
            tr?.answer,
          );
          return {
            ...c,
            question: q.base,
            answer: a.base,
            ...(q.en !== undefined ? { questionEn: q.en } : {}),
            ...(a.en !== undefined ? { answerEn: a.en } : {}),
          };
        });
        if (translated.partial) {
          toast({
            variant: "info",
            title: pick("Çeviri kısmen tamamlandı", "Translation partial"),
            description: pick(
              "Bazı kartlar için çeviri alınamadı; kaynak dil korundu.",
              "Some cards couldn't be translated; source text was kept.",
            ),
          });
        }
      }

      setProposalLangMode(langMode);
      setProposal(result);
    } catch (err) {
      const message =
        err instanceof FlashcardGenError
          ? `${err.code}: ${err.message}`
          : err instanceof Error
            ? err.message
            : String(err);
      toast({
        variant: "error",
        title: pick("Üretim başarısız", "Generation failed"),
        description: message,
      });
    } finally {
      setRunning(false);
    }
  }

  const proposalChunkIds = useMemo(
    () => (chunkIds && chunkIds.length > 0 ? chunkIds : undefined),
    [chunkIds],
  );

  return (
    <>
      <Modal
        open={open && !proposal}
        onClose={onClose}
        size="lg"
        title={
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-accent" aria-hidden />
            {mode === "single"
              ? pick("Sohbetten kart üret", "Generate cards from this exchange")
              : pick("AI'dan kart üret", "Generate cards with AI")}
          </div>
        }
        description={
          mode === "single"
            ? pick(
                "Az önceki yanıta odaklı kartlar üretilecek; modeli yine sen seçtin.",
                "Cards will focus on the recent exchange; the model is your default.",
              )
            : pick(
                "Bir kaynak seç, kaç kart istediğini söyle ve önerileri tek tek onayla.",
                "Pick a source, choose how many cards you want, then approve each proposal.",
              )
        }
        footer={
          <div className="flex items-center justify-between gap-3">
            <span className="font-mono text-[11px] text-ink-3">
              {estimatedCost <= 0
                ? pick("Tahmini maliyet: ücretsiz", "Estimated cost: free")
                : pick(
                    `Tahmini maliyet: ~$${estimatedCost.toFixed(3)}`,
                    `Estimated cost: ~$${estimatedCost.toFixed(3)}`,
                  )}
            </span>
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={onClose} disabled={running}>
                {pick("İptal", "Cancel")}
              </Button>
              <Button
                size="sm"
                variant="accent"
                onClick={() => void handleRun()}
                disabled={!canRun}
              >
                {running ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <Sparkles className="h-3.5 w-3.5" aria-hidden />
                )}
                {running
                  ? pick("Üretiliyor…", "Generating…")
                  : pick(`${count} kart üret`, `Generate ${count} cards`)}
              </Button>
            </div>
          </div>
        }
      >
        <div className="space-y-4">
          {mode === "single" && chatContext ? (
            <div className="rounded border border-rule bg-paper-2 p-3 text-[12px] leading-[1.55] text-ink-2">
              <div className="mb-1 font-mono text-[10.5px] uppercase tracking-[0.06em] text-ink-3">
                {pick("Sohbet bağlamı", "Chat context")}
              </div>
              <p className="line-clamp-4 whitespace-pre-wrap">{chatContext}</p>
            </div>
          ) : null}
          {sources.length === 0 ? (
            <div className="rounded border border-dashed border-rule bg-paper-2 p-4 text-center text-[13px] text-ink-3">
              {pick(
                "Önce bu çalışma alanına bir kaynak yükle.",
                "Add a source to this workspace first.",
              )}
            </div>
          ) : (
            <div>
              <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.06em] text-ink-3">
                {pick("Kaynak", "Source")}
              </div>
              <select
                value={sourceId ?? ""}
                onChange={(e) => setSourceId(e.target.value || undefined)}
                className="w-full rounded-md border border-rule bg-paper px-3 py-2 text-[13.5px] text-ink focus:border-ink-5 focus:outline-none"
              >
                {sources.map((s: SourceRecord) => (
                  <option key={s.id} value={s.id} disabled={s.ingestStatus !== "ready"}>
                    {pick(s.title, s.titleEn ?? s.title)}
                    {s.ingestStatus !== "ready" ? ` · ${s.ingestStatus}` : ""}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.06em] text-ink-3">
              {pick("Kart sayısı", "Card count")}
            </div>
            <SegmentedControl
              value={String(count)}
              onChange={(v) => {
                const n = Number(v) as CountChoice;
                if (COUNT_CHOICES.includes(n)) setCount(n);
              }}
              options={COUNT_CHOICES.map((n) => ({
                value: String(n),
                label: String(n),
              }))}
            />
          </div>

          <div>
            <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.06em] text-ink-3">
              {pick("İçerik dili", "Content language")}
            </div>
            <SegmentedControl<ContentLangMode>
              value={langMode}
              onChange={setLangMode}
              options={[
                { value: "tr", label: pick("Türkçe", "Turkish") },
                { value: "en", label: pick("İngilizce", "English") },
                { value: "en_terms_tr", label: pick("EN terim·TR", "EN terms·TR") },
                { value: "both", label: pick("İkisi", "Both") },
              ]}
            />
            <p className="mt-1.5 text-[11.5px] text-ink-4">
              {langMode === "both"
                ? pick(
                    "Kartlar hem Türkçe hem İngilizce üretilir; kart görünümünde tek tıkla geçiş yapabilirsin. (~2× üretim maliyeti.)",
                    "Cards are produced in both Turkish and English; switch with one click in the cards view. (~2× generation cost.)",
                  )
                : langMode === "en_terms_tr"
                  ? pick(
                      "Açıklamalar Türkçe, teknik terimler İngilizce orijinal haliyle kalır.",
                      "Explanations in Turkish, technical terms kept in their original English form.",
                    )
                  : pick(
                      "Tüm içerik seçilen dilde üretilir.",
                      "All content is produced in the selected language.",
                    )}
            </p>
          </div>

          <div className="rounded border border-rule bg-paper-2 p-3 text-[12px] text-ink-3">
            <div className="flex items-center justify-between gap-3">
              <span>
                {pick("Model", "Model")}:{" "}
                <code className="font-mono text-[11px] text-ink">
                  {chatOption?.label ?? modelId}
                </code>
              </span>
              <span className="font-mono text-[11px]">
                ~{estimateTokens.toLocaleString()} {pick("girdi tokenı", "input tokens")}
              </span>
            </div>
            {!isLocal && isVaultLocked ? (
              <p className="mt-2 text-err">
                {pick(
                  "Vault kilitli. Settings → Anahtarlar üzerinden parolayı gir, sonra dön.",
                  "Vault is locked. Unlock via Settings → Keys, then return.",
                )}
              </p>
            ) : null}
          </div>
        </div>
      </Modal>

      {proposal && selectedSource ? (
        <FlashcardProposalModal
          open
          onClose={() => {
            setProposal(null);
            onClose();
          }}
          workspaceId={workspaceId}
          sourceId={selectedSource.id}
          cards={proposal.cards}
          langMode={proposalLangMode}
          estimatedCostUsd={proposal.estimatedCostUsd}
          provenance={{
            kind: mode === "single" ? "chat" : "batch",
            ...(proposalChunkIds ? { chunkIds: proposalChunkIds } : {}),
            ...(threadId ? { threadId } : {}),
            model: proposal.model,
          }}
        />
      ) : null}
    </>
  );
}
