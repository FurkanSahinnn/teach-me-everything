"use client";

import { Loader2, Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { useLocalePick } from "@/i18n/IntlProvider";
import { resolveChatCredentialForPreset } from "@/lib/ai/anthropic-credential";
import {
  estimateLessonNoteCost,
  generateLessonNote,
  LessonNoteGenError,
  type LessonNoteGenSource,
} from "@/lib/ai/lesson-note-generation";
import { findChatOption } from "@/lib/ai/model-options";
import { isLocalUrl } from "@/lib/ai/providers/local-bypass";
import { getPreset } from "@/lib/ai/providers/presets";
import { db } from "@/lib/db/schema";
import type {
  CurriculumItemRecord,
  LessonNoteRecord,
} from "@/lib/study/types";
import { findCustomEndpoint, usePrefs } from "@/stores/prefs";
import { useVault } from "@/stores/vault";

type Props = {
  open: boolean;
  onClose: () => void;
  workspaceId: string;
  workspace: { name: string; goal?: string | undefined };
  note: LessonNoteRecord;
  item: CurriculumItemRecord;
};

// Mirrors GenerateCurriculumModal.ESTIMATED_OUTPUT_TOKENS so the cost
// preview is bounded by the runner's `maxTokens` floor of 4000.
const ESTIMATED_OUTPUT_TOKENS = 2000;

export function RegenerateLessonModal({
  open,
  onClose,
  workspaceId,
  workspace,
  note,
  item,
}: Props) {
  const pick = useLocalePick();
  const { toast } = useToast();
  const masterKey = useVault((s) => s.masterKey);
  const modelId = usePrefs((s) => s.modelBindings.summary);
  const locale = usePrefs((s) => s.locale);
  const customEndpoint = findCustomEndpoint(modelId.split("::")[0] ?? "");

  const [running, setRunning] = useState(false);
  const [unlockOpen, setUnlockOpen] = useState(false);
  const [estimateTokens, setEstimateTokens] = useState(0);
  const [resolvedSources, setResolvedSources] = useState<
    LessonNoteGenSource[] | null
  >(null);
  const cancelRef = useRef<AbortController | null>(null);

  // Re-resolve sources + chunks each time the modal opens so a freshly
  // re-embedded source is reflected without remounting the page.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      const sourceIds = Array.from(
        new Set(note.sourceRefs.map((ref) => ref.sourceId)),
      );
      const chunkIds = Array.from(
        new Set(note.sourceRefs.flatMap((ref) => ref.chunkIds ?? [])),
      );
      const [srcRows, chunkRows] = await Promise.all([
        db.sources.bulkGet(sourceIds),
        chunkIds.length > 0 ? db.chunks.bulkGet(chunkIds) : Promise.resolve([]),
      ]);
      if (cancelled) return;
      const sources = srcRows.flatMap((s) => (s ? [s] : []));
      const chunks = chunkRows.flatMap((c) => (c ? [c] : []));
      const chunksBySource = new Map<string, typeof chunks>();
      for (const ch of chunks) {
        const bucket = chunksBySource.get(ch.sourceId) ?? [];
        bucket.push(ch);
        chunksBySource.set(ch.sourceId, bucket);
      }
      const built: LessonNoteGenSource[] = sources.map((s) => ({
        id: s.id,
        title: s.title,
        ...(s.titleEn !== undefined ? { titleEn: s.titleEn } : {}),
        type: s.type,
        ...(s.author !== undefined ? { author: s.author } : {}),
        chunks: (chunksBySource.get(s.id) ?? []).map((c) => {
          const out: LessonNoteGenSource["chunks"][number] = {
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
      const tokens = chunks.reduce((acc, c) => acc + (c.tokenCount ?? 0), 0);
      if (!cancelled) {
        setResolvedSources(built);
        setEstimateTokens(tokens);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, note.sourceRefs]);

  const chatOption = findChatOption(modelId);
  const preset = chatOption ? getPreset(chatOption.presetId) : undefined;
  const baseUrl = customEndpoint?.baseUrl ?? preset?.baseUrl;
  const isLocal = Boolean(baseUrl && isLocalUrl(baseUrl));
  const isVaultLocked = !masterKey;

  const estimatedCost = useMemo(() => {
    return estimateLessonNoteCost(chatOption?.modelId ?? modelId, {
      input_tokens: estimateTokens,
      output_tokens: ESTIMATED_OUTPUT_TOKENS,
    });
  }, [chatOption?.modelId, modelId, estimateTokens]);

  const totalChunks =
    resolvedSources?.reduce((acc, s) => acc + s.chunks.length, 0) ?? 0;
  const canRunAi =
    !running &&
    Boolean(chatOption) &&
    resolvedSources !== null &&
    resolvedSources.length > 0 &&
    totalChunks > 0 &&
    (isLocal || !isVaultLocked);

  function handleClose(): void {
    if (running) return;
    onClose();
  }

  async function handleRunAi(): Promise<void> {
    if (!canRunAi || !chatOption || !resolvedSources) return;
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
      await generateLessonNote({
        workspaceId,
        curriculumItemId: item.id,
        existingNoteId: note.id,
        workspace,
        item: {
          title: item.title,
          objective: item.objective,
          sourceRefs: item.sourceRefs,
        },
        sources: resolvedSources,
        modelId,
        apiKey,
        ...(authKind ? { authKind } : {}),
        locale,
        signal: ctl.signal,
      });
      toast({
        variant: "success",
        title: pick("Ders notu yenilendi", "Lesson note regenerated"),
        description:
          estimatedCost <= 0
            ? pick("Ücretsiz model", "Free model")
            : `~$${estimatedCost.toFixed(4)}`,
      });
      onClose();
    } catch (err) {
      const message =
        err instanceof LessonNoteGenError
          ? `${err.code}: ${err.message}`
          : err instanceof Error
            ? err.message
            : String(err);
      toast({
        variant: "error",
        title: pick("Yenileme başarısız", "Regenerate failed"),
        description: message,
      });
    } finally {
      setRunning(false);
      cancelRef.current = null;
    }
  }

  function handleCancel(): void {
    cancelRef.current?.abort();
  }

  return (
    <>
      <Modal
        open={open}
        onClose={handleClose}
        size="md"
        title={
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-accent" aria-hidden />
            {pick("AI ile yeniden üret", "Regenerate with AI")}
          </div>
        }
        description={pick(
          "Mevcut ders notunu aynı kaynaklardan yeniden yaz. Manuel düzenlemelerin kaybolur; sourceRefs ve lesson ID değişmez.",
          "Rewrite the current lesson note from the same sources. Manual edits are lost; sourceRefs and lesson ID stay stable.",
        )}
        footer={
          <div className="flex items-center justify-between gap-3">
            <span className="font-mono text-[11px] text-ink-3">
              {estimatedCost <= 0
                ? pick("Tahmini maliyet: ücretsiz", "Estimated cost: free")
                : `${pick("Tahmini maliyet", "Estimated cost")}: ~$${estimatedCost.toFixed(3)}`}
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
                  : pick("Yeniden üret", "Regenerate")}
              </Button>
            </div>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="space-y-2 rounded-[10px] border border-rule bg-paper-2 p-3 text-[12.5px] leading-5">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-3">
                {pick("Konu", "Topic")}
              </span>
            </div>
            <div className="text-ink-2">{item.title}</div>
            <div className="text-ink-3">{item.objective}</div>
          </div>

          {resolvedSources === null ? (
            <div className="rounded border border-dashed border-rule bg-paper-2 p-3 text-center text-[12.5px] text-ink-3">
              {pick("Kaynaklar yükleniyor…", "Loading sources…")}
            </div>
          ) : resolvedSources.length === 0 || totalChunks === 0 ? (
            <div className="rounded border border-dashed border-rule bg-paper-2 p-3 text-center text-[12.5px] text-ink-3">
              {pick(
                "Bu konu için kaynak chunk'ı bulunamadı.",
                "No source chunks found for this topic.",
              )}
            </div>
          ) : (
            <div className="space-y-2 rounded-[10px] border border-rule bg-paper-2 p-3 text-[12.5px] leading-5">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-3">
                  {pick("Kaynaklar", "Sources")}
                </span>
                <span className="font-mono text-[11px] text-ink-3">
                  {resolvedSources.length} · ~{Math.round(estimateTokens / 1000)}k {pick("token", "tokens")}
                </span>
              </div>
              <ul className="space-y-1 text-ink-2">
                {resolvedSources.slice(0, 6).map((s) => (
                  <li key={s.id} className="truncate">
                    · {pick(s.title, s.titleEn ?? s.title)}{" "}
                    <span className="text-ink-3">
                      ({s.chunks.length} {pick("chunk", "chunks")})
                    </span>
                  </li>
                ))}
                {resolvedSources.length > 6 ? (
                  <li className="text-ink-3">
                    · +{resolvedSources.length - 6} {pick("daha", "more")}
                  </li>
                ) : null}
              </ul>
            </div>
          )}

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
