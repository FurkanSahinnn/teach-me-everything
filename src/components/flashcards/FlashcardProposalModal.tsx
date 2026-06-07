"use client";

import { Check, Loader2, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { useLocalePick } from "@/i18n/IntlProvider";
import type { ContentLangMode } from "@/lib/ai/content-language";
import type { FlashcardGenCard } from "@/lib/ai/prompts/flashcard-gen";
import {
  createDeck,
  createFlashcard,
  listDecksByWorkspace,
} from "@/lib/db/flashcards";

type Provenance = {
  kind: "chat" | "batch";
  chunkIds?: string[];
  threadId?: string;
  model: string;
};

export type FlashcardProposalModalProps = {
  open: boolean;
  onClose: () => void;
  workspaceId: string;
  /** Optional sourceId to attach to every saved card; falls back to undefined
   *  when proposals span multiple sources (batch over a workspace). */
  sourceId?: string;
  cards: FlashcardGenCard[];
  /** Content-language mode the batch was generated under. `"both"` means each
   *  card carries parallel `questionEn`/`answerEn` and the deck/cards land as
   *  bilingual so the cards view offers the local TR/EN toggle. */
  langMode?: ContentLangMode;
  estimatedCostUsd: number;
  provenance: Provenance;
  /** Hook for callers that want to know how many cards landed (e.g. to clear
   *  state in the parent flow). */
  onSaved?: (count: number) => void;
};

type Editable = FlashcardGenCard & { id: string; selected: boolean };

const DEFAULT_DECK_NAME_TR = "AI önerileri";
const DEFAULT_DECK_NAME_EN = "AI suggestions";
const DEFAULT_DECK_COLOR = "#B8601C"; // amber-ish, distinct from manual decks

export function FlashcardProposalModal({
  open,
  onClose,
  workspaceId,
  sourceId,
  cards,
  langMode,
  estimatedCostUsd,
  provenance,
  onSaved,
}: FlashcardProposalModalProps) {
  const pick = useLocalePick();
  const { toast } = useToast();
  const [editable, setEditable] = useState<Editable[]>([]);
  const [saving, setSaving] = useState(false);

  // Reset draft state every time the modal opens with a new proposal set.
  useEffect(() => {
    if (!open) return;
    const nextEditable = cards.map((c, i) => ({
      ...c,
      id: `proposal-${i}`,
      selected: true,
    }));
    queueMicrotask(() => setEditable(nextEditable));
  }, [open, cards]);

  const selectedCount = editable.filter((e) => e.selected).length;

  const updateCard = (id: string, patch: Partial<Editable>): void => {
    setEditable((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  };

  const removeCard = (id: string): void => {
    setEditable((prev) => prev.filter((e) => e.id !== id));
  };

  async function handleSave(): Promise<void> {
    if (selectedCount === 0 || saving) return;
    setSaving(true);
    try {
      const isBilingual = langMode === "both";
      const decks = await listDecksByWorkspace(workspaceId);
      let targetDeckId = decks[0]?.id;
      if (!targetDeckId) {
        const deck = await createDeck({
          workspaceId,
          name: DEFAULT_DECK_NAME_TR,
          nameEn: DEFAULT_DECK_NAME_EN,
          color: DEFAULT_DECK_COLOR,
          // Record the deck as bilingual so the cards view surfaces the local
          // TR/EN view toggle. Cards also carry their own langMode below.
          ...(langMode ? { langMode } : {}),
        });
        targetDeckId = deck.id;
      }
      const generatedAt = Date.now();
      let saved = 0;
      for (const card of editable) {
        if (!card.selected) continue;
        const question = card.question.trim();
        const answer = card.answer.trim();
        if (!question || !answer) continue;
        const questionEn = card.questionEn?.trim();
        const answerEn = card.answerEn?.trim();
        await createFlashcard({
          workspaceId,
          deckId: targetDeckId,
          ...(sourceId ? { sourceId } : {}),
          question,
          answer,
          ...(isBilingual && questionEn ? { questionEn } : {}),
          ...(isBilingual && answerEn ? { answerEn } : {}),
          ...(langMode ? { langMode } : {}),
          tags: card.tags ?? [],
          ...(card.sourceSection
            ? { citations: [{ section: card.sourceSection }] }
            : {}),
          generatedFrom: {
            kind: provenance.kind,
            ...(provenance.chunkIds ? { chunkIds: provenance.chunkIds } : {}),
            ...(provenance.threadId ? { threadId: provenance.threadId } : {}),
            model: provenance.model,
            generatedAt,
          },
        });
        saved += 1;
      }
      toast({
        variant: "success",
        title: pick(
          `${saved} kart kaydedildi`,
          `${saved} card${saved === 1 ? "" : "s"} saved`,
        ),
      });
      onSaved?.(saved);
      onClose();
    } catch (err) {
      toast({
        variant: "error",
        title: pick("Kayıt başarısız", "Save failed"),
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSaving(false);
    }
  }

  const costLabel = useMemo(() => {
    if (estimatedCostUsd <= 0) return pick("Ücretsiz", "Free");
    if (estimatedCostUsd < 0.001) return "<$0.001";
    return `~$${estimatedCostUsd.toFixed(3)}`;
  }, [estimatedCostUsd, pick]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="full"
      title={
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-accent" aria-hidden />
          {pick("Önerilen kartlar", "Proposed cards")}
        </div>
      }
      description={pick(
        `${editable.length} kart üretildi · seçileni desteye ekle (${costLabel}).`,
        `${editable.length} cards generated · pick what to keep (${costLabel}).`,
      )}
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="font-mono text-[11px] text-ink-3">
            {pick(
              `${selectedCount} / ${editable.length} seçili`,
              `${selectedCount} / ${editable.length} selected`,
            )}
          </span>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={onClose} disabled={saving}>
              {pick("Vazgeç", "Discard")}
            </Button>
            <Button
              size="sm"
              variant="accent"
              onClick={() => void handleSave()}
              disabled={selectedCount === 0 || saving}
            >
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <Check className="h-3.5 w-3.5" aria-hidden />
              )}
              {pick(`Seçili ${selectedCount} kartı kaydet`, `Save ${selectedCount} card${selectedCount === 1 ? "" : "s"}`)}
            </Button>
          </div>
        </div>
      }
    >
      {editable.length === 0 ? (
        <div className="grid place-items-center py-12 text-center text-[13px] text-ink-3">
          {pick("Hiç kart üretilmedi.", "No cards generated.")}
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {editable.map((card) => (
            <li
              key={card.id}
              className="rounded-[var(--radius-md)] border border-rule bg-paper-2 p-3"
            >
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={card.selected}
                  onChange={(e) => updateCard(card.id, { selected: e.target.checked })}
                  aria-label={pick("Bu kartı kaydet", "Save this card")}
                  className="mt-1 h-4 w-4 cursor-pointer accent-accent"
                />
                <div className="min-w-0 flex-1 space-y-2">
                  <textarea
                    value={card.question}
                    onChange={(e) => updateCard(card.id, { question: e.target.value })}
                    rows={2}
                    placeholder={pick("Soru…", "Question…")}
                    className="w-full resize-y rounded-md border border-rule bg-paper px-2 py-1.5 font-serif text-[14px] text-ink focus:border-ink-5 focus:outline-none"
                  />
                  <textarea
                    value={card.answer}
                    onChange={(e) => updateCard(card.id, { answer: e.target.value })}
                    rows={3}
                    placeholder={pick("Cevap…", "Answer…")}
                    className="w-full resize-y rounded-md border border-rule bg-paper px-2 py-1.5 text-[13.5px] leading-[1.55] text-ink-2 focus:border-ink-5 focus:outline-none"
                  />
                  {card.sourceSection || (card.tags && card.tags.length > 0) ? (
                    <div className="flex flex-wrap items-center gap-1.5 font-mono text-[10.5px] text-ink-4">
                      {card.sourceSection ? (
                        <span className="rounded border border-rule bg-paper px-1.5 py-0.5 text-accent-ink">
                          {card.sourceSection}
                        </span>
                      ) : null}
                      {card.tags?.map((tag) => (
                        <span
                          key={tag}
                          className="rounded border border-rule bg-paper px-1.5 py-0.5"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => removeCard(card.id)}
                  aria-label={pick("Kartı listeden çıkar", "Remove from list")}
                  className="grid h-7 w-7 shrink-0 place-items-center rounded text-ink-3 transition-colors hover:bg-paper-3 hover:text-err"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
