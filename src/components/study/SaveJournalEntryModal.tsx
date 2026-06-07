"use client";

import { BookmarkPlus, Loader2, Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { useLocalePick } from "@/i18n/IntlProvider";
import { resolveChatCredentialForPreset } from "@/lib/ai/anthropic-credential";
import { findChatOption } from "@/lib/ai/model-options";
import { isLocalUrl } from "@/lib/ai/providers/local-bypass";
import { getPreset } from "@/lib/ai/providers/presets";
import {
  estimateStudyJournalCost,
  generateStudyJournalMeta,
  StudyJournalGenError,
} from "@/lib/ai/study-journal-generation";
import {
  createStudyJournalEntry,
  type CreateStudyJournalEntryInput,
} from "@/lib/db/study";
import type { StudySourceRef } from "@/lib/study/types";
import { findCustomEndpoint, usePrefs } from "@/stores/prefs";
import { useVault } from "@/stores/vault";

export type SaveJournalEntryDraft = {
  workspaceId: string;
  workspace: { name: string; goal?: string | undefined };
  source?:
    | {
        id: string;
        title?: string | undefined;
        titleEn?: string | undefined;
        author?: string | undefined;
      }
    | undefined;
  lessonNoteId?: string | undefined;
  question: string;
  answerMarkdown: string;
  sourceRefs: StudySourceRef[];
  citedSections?: string[] | undefined;
};

type Props = {
  open: boolean;
  onClose: () => void;
  draft: SaveJournalEntryDraft | null;
};

// Token estimate the modal feeds the cost preview before the model has
// produced anything. Worst-case: full 4k context Q&A. Output side stays
// small (title + tags + 1-2 sentence summary).
const ESTIMATED_INPUT_TOKENS = 600;
const ESTIMATED_OUTPUT_TOKENS = 150;

function tagsToString(tags: string[]): string {
  return tags.join(", ");
}

function parseTagsInput(value: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of value.split(/[,\n]/)) {
    const trimmed = raw.trim().toLowerCase();
    if (!trimmed) continue;
    const cleaned = trimmed
      .replace(/\s+/g, "-")
      .replace(/-{2,}/g, "-")
      .slice(0, 40);
    if (!cleaned || seen.has(cleaned)) continue;
    seen.add(cleaned);
    out.push(cleaned);
    if (out.length >= 8) break;
  }
  return out;
}

function defaultTitleFrom(question: string): string {
  const trimmed = question.trim();
  if (!trimmed) return "";
  const firstLine = trimmed.split(/\n+/)[0] ?? trimmed;
  if (firstLine.length <= 80) return firstLine;
  return `${firstLine.slice(0, 77)}…`;
}

function defaultTagsFrom(source?: SaveJournalEntryDraft["source"]): string[] {
  if (!source) return [];
  const title = source.titleEn ?? source.title;
  if (!title) return [];
  const cleaned = title
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9çğıöşü\-]/gi, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return cleaned ? [cleaned] : [];
}

export function SaveJournalEntryModal({ open, onClose, draft }: Props) {
  const pick = useLocalePick();
  const { toast } = useToast();
  const masterKey = useVault((s) => s.masterKey);
  const modelId = usePrefs((s) => s.modelBindings.quick);
  const locale = usePrefs((s) => s.locale);
  const customEndpoint = findCustomEndpoint(modelId.split("::")[0] ?? "");

  const [title, setTitle] = useState("");
  const [tagsText, setTagsText] = useState("");
  const [summary, setSummary] = useState("");
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [unlockOpen, setUnlockOpen] = useState(false);
  const [aiAttempted, setAiAttempted] = useState(false);
  const cancelRef = useRef<AbortController | null>(null);

  // Reset form when a new draft arrives.
  useEffect(() => {
    if (!open || !draft) return;
    setTitle(defaultTitleFrom(draft.question));
    setTagsText(tagsToString(defaultTagsFrom(draft.source)));
    setSummary("");
    setAiAttempted(false);
  }, [open, draft]);

  const chatOption = findChatOption(modelId);
  const preset = chatOption ? getPreset(chatOption.presetId) : undefined;
  const baseUrl = customEndpoint?.baseUrl ?? preset?.baseUrl;
  const isLocal = Boolean(baseUrl && isLocalUrl(baseUrl));
  const isVaultLocked = !masterKey;

  const estimatedCost = useMemo(() => {
    return estimateStudyJournalCost(chatOption?.modelId ?? modelId, {
      input_tokens: ESTIMATED_INPUT_TOKENS,
      output_tokens: ESTIMATED_OUTPUT_TOKENS,
    });
  }, [chatOption?.modelId, modelId]);

  const canRunAi =
    !running &&
    !saving &&
    Boolean(draft) &&
    Boolean(chatOption) &&
    (isLocal || !isVaultLocked);

  const canSave =
    !running &&
    !saving &&
    Boolean(draft) &&
    title.trim().length > 0;

  function handleClose(): void {
    if (running || saving) return;
    cancelRef.current?.abort();
    onClose();
  }

  async function handleRunAi(): Promise<void> {
    if (!canRunAi || !draft || !chatOption) return;
    setRunning(true);
    setAiAttempted(true);
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
      const result = await generateStudyJournalMeta({
        workspace: draft.workspace,
        ...(draft.source ? { source: draft.source } : {}),
        question: draft.question,
        answerMarkdown: draft.answerMarkdown,
        ...(draft.citedSections ? { citedSections: draft.citedSections } : {}),
        modelId,
        apiKey,
        ...(authKind ? { authKind } : {}),
        locale,
        signal: ctl.signal,
      });
      setTitle(result.parsed.title);
      setTagsText(tagsToString(result.parsed.tags));
      if (result.parsed.summaryMarkdown) {
        setSummary(result.parsed.summaryMarkdown);
      }
      toast({
        variant: "success",
        title: pick("Başlık ve etiketler önerildi", "Title and tags suggested"),
        description:
          result.estimatedCostUsd <= 0
            ? pick("Ücretsiz model", "Free model")
            : `~$${result.estimatedCostUsd.toFixed(4)}`,
      });
    } catch (err) {
      const message =
        err instanceof StudyJournalGenError
          ? `${err.code}: ${err.message}`
          : err instanceof Error
            ? err.message
            : String(err);
      toast({
        variant: "error",
        title: pick("AI önerisi başarısız", "AI suggestion failed"),
        description: message,
      });
    } finally {
      setRunning(false);
      cancelRef.current = null;
    }
  }

  async function handleSave(): Promise<void> {
    if (!canSave || !draft) return;
    setSaving(true);
    try {
      const cleanedTitle = title.trim();
      const cleanedTags = parseTagsInput(tagsText);
      const cleanedSummary = summary.trim();
      // Prepend the AI-suggested summary as a quoted block so the saved
      // answer still carries it without losing the original Markdown body.
      const combinedAnswer = cleanedSummary
        ? `> ${cleanedSummary.replace(/\n+/g, "\n> ")}\n\n${draft.answerMarkdown}`
        : draft.answerMarkdown;
      const input: CreateStudyJournalEntryInput = {
        workspaceId: draft.workspaceId,
        question: cleanedTitle,
        answerMarkdown: combinedAnswer,
        sourceRefs: draft.sourceRefs,
        tags: cleanedTags,
      };
      if (draft.lessonNoteId) input.lessonNoteId = draft.lessonNoteId;
      if (draft.source?.id) input.sourceId = draft.source.id;
      await createStudyJournalEntry(input);
      toast({
        variant: "success",
        title: pick("Çalışma günlüğüne kaydedildi", "Saved to study journal"),
        description: pick(
          "Tüm girdiler için Çalışma → Günlük sayfasını aç.",
          "Open Study → Journal to view all entries.",
        ),
      });
      onClose();
    } catch (err) {
      toast({
        variant: "error",
        title: pick("Kaydedilemedi", "Save failed"),
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSaving(false);
    }
  }

  function handleCancelAi(): void {
    cancelRef.current?.abort();
  }

  const draftPreviewQuestion = draft?.question ?? "";
  const draftPreviewAnswer = draft?.answerMarkdown ?? "";

  return (
    <>
      <Modal
        open={open}
        onClose={handleClose}
        size="md"
        title={
          <div className="flex items-center gap-2">
            <BookmarkPlus className="h-4 w-4 text-accent" aria-hidden />
            {pick("Çalışma günlüğüne kaydet", "Save to study journal")}
          </div>
        }
        description={pick(
          "Bu Q&A turunu günlüğüne ekle. AI ile başlık + etiket önerisi alabilirsin ya da elle düzenleyebilirsin.",
          "Add this Q&A turn to your journal. Get an AI-suggested title + tags or edit manually.",
        )}
        footer={
          <div className="flex items-center justify-between gap-3">
            <span className="font-mono text-[11px] text-ink-3">
              {chatOption
                ? estimatedCost <= 0
                  ? pick("AI önerisi: ücretsiz", "AI suggestion: free")
                  : `${pick("AI önerisi", "AI suggestion")}: ~$${estimatedCost.toFixed(4)}`
                : pick(
                    "AI modeli seçili değil",
                    "No AI model selected",
                  )}
            </span>
            <div className="flex items-center gap-2">
              {running ? (
                <Button size="sm" onClick={handleCancelAi}>
                  {pick("İptal", "Cancel")}
                </Button>
              ) : (
                <Button size="sm" onClick={handleClose} disabled={saving}>
                  {pick("Kapat", "Close")}
                </Button>
              )}
              <Button
                size="sm"
                onClick={() => void handleRunAi()}
                disabled={!canRunAi}
                title={
                  isVaultLocked && !isLocal
                    ? pick(
                        "Önce vault'u aç",
                        "Unlock vault first",
                      )
                    : undefined
                }
              >
                {running ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <Sparkles className="h-3.5 w-3.5" aria-hidden />
                )}
                {running
                  ? pick("Öneriliyor…", "Suggesting…")
                  : aiAttempted
                    ? pick("Tekrar öner", "Suggest again")
                    : pick("AI'dan öner", "Suggest with AI")}
              </Button>
              <Button
                size="sm"
                variant="accent"
                onClick={() => void handleSave()}
                disabled={!canSave}
              >
                {saving ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <BookmarkPlus className="h-3.5 w-3.5" aria-hidden />
                )}
                {saving ? pick("Kaydediliyor…", "Saving…") : pick("Kaydet", "Save")}
              </Button>
            </div>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="space-y-2 rounded-[10px] border border-rule bg-paper-2 p-3 text-[12.5px] leading-5">
            <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-3">
              {pick("Soru", "Question")}
            </div>
            <div className="line-clamp-3 text-ink-2">{draftPreviewQuestion}</div>
          </div>

          <div className="space-y-2 rounded-[10px] border border-rule bg-paper-2 p-3 text-[12.5px] leading-5">
            <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-3">
              {pick("Cevap", "Answer")}
            </div>
            <div className="line-clamp-4 whitespace-pre-wrap text-ink-2">
              {draftPreviewAnswer}
            </div>
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="journal-title-input"
              className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-3"
            >
              {pick("Başlık", "Title")}
            </label>
            <Input
              id="journal-title-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={pick(
                "Örn. Dalga fonksiyonları nasıl normalize edilir",
                "e.g. How wave functions are normalised",
              )}
              maxLength={120}
              data-testid="journal-title-input"
            />
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="journal-tags-input"
              className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-3"
            >
              {pick("Etiketler", "Tags")}
            </label>
            <Input
              id="journal-tags-input"
              value={tagsText}
              onChange={(e) => setTagsText(e.target.value)}
              placeholder={pick(
                "virgülle ayır: kuantum, dalga-fonksiyonu",
                "comma-separated: quantum, wave-functions",
              )}
              data-testid="journal-tags-input"
            />
            {tagsText.trim().length > 0 ? (
              <div className="flex flex-wrap gap-1 pt-1">
                {parseTagsInput(tagsText).map((tag) => (
                  <Chip key={tag} size="sm">
                    {tag}
                  </Chip>
                ))}
              </div>
            ) : null}
          </div>

          {summary ? (
            <div className="space-y-1.5">
              <label
                htmlFor="journal-summary-input"
                className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-3"
              >
                {pick("AI özeti (kaydedildiğinde alıntı olarak eklenir)", "AI summary (saved as a quote)")}
              </label>
              <textarea
                id="journal-summary-input"
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                rows={3}
                className="w-full rounded-[10px] border border-rule bg-paper-1 p-2 text-[12.5px] leading-5 text-ink-1 outline-none focus:border-accent"
                data-testid="journal-summary-input"
              />
            </div>
          ) : null}

          {!chatOption ? (
            <div className="rounded border border-dashed border-warn/40 bg-paper-2 p-3 text-[11.5px] text-warn">
              {pick(
                "AI önerisi için Settings → Models'tan bir hızlı model seç.",
                "Pick a quick model in Settings → Models for AI suggestions.",
              )}
            </div>
          ) : isVaultLocked && !isLocal ? (
            <div className="flex items-center justify-between gap-3 rounded border border-dashed border-rule bg-paper-2 p-3 text-[11.5px] text-ink-3">
              <span>
                {pick(
                  "AI önerisi için vault'u aç.",
                  "Unlock the vault for AI suggestions.",
                )}
              </span>
              <Button size="sm" variant="ghost" onClick={() => setUnlockOpen(true)}>
                {pick("Vault'u aç", "Unlock vault")}
              </Button>
            </div>
          ) : null}
        </div>
      </Modal>
      
    </>
  );
}
