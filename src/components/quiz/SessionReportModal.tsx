"use client";

import { Check, Sparkles, X } from "lucide-react";
import { useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useLocalePick } from "@/i18n/IntlProvider";
import { getQuizSession } from "@/lib/db/quiz-sessions";
import {
  computeScore,
  isSessionFinished,
} from "@/lib/quiz/session";
import type { QuizAnswer, QuizItem } from "@/lib/quiz/types";
import { cn } from "@/lib/utils/cn";

export type WeakChunk = {
  chunkId: string;
  count: number;
  itemIndices: number[];
  sectionLabel?: string;
};

/**
 * Pure aggregator. Walks the items + answers and returns:
 *  - score (0..1)
 *  - per-item correctness flags
 *  - weak chunks: items the user got wrong (or pending open eval) grouped by
 *    `sourceChunkId` so the caller can pre-select chunks for flashcard gen.
 *
 * Exported so the test suite can pin behaviour without rendering the modal.
 */
export function aggregateReport(
  items: QuizItem[],
  answers: QuizAnswer[],
): {
  score: number;
  correctCount: number;
  perItem: Array<{ correct: boolean | null; answer: QuizAnswer | undefined }>;
  weakChunks: WeakChunk[];
} {
  const ansByIdx = new Map(answers.map((a) => [a.itemIndex, a]));
  const perItem: Array<{
    correct: boolean | null;
    answer: QuizAnswer | undefined;
  }> = items.map((_, idx) => {
    const a = ansByIdx.get(idx);
    let correct: boolean | null = null;
    if (a?.kind === "mcq") correct = a.correct;
    else if (a?.kind === "open") correct = a.correct;
    return { correct, answer: a };
  });

  let correctCount = 0;
  for (const row of perItem) if (row.correct === true) correctCount += 1;
  const score = items.length === 0 ? 0 : correctCount / items.length;

  // First pass: pick a sectionLabel for every chunkId that appears anywhere
  // in the items. Even if the wrong-answer item lacks a section, a correct
  // sibling on the same chunk may carry one — surface it so the report shows
  // a human-friendly label instead of just the raw chunk id.
  const sectionByChunk = new Map<string, string>();
  for (const item of items) {
    if (item.sourceChunkId && item.sourceSection && !sectionByChunk.has(item.sourceChunkId)) {
      sectionByChunk.set(item.sourceChunkId, item.sourceSection);
    }
  }
  // Weak: wrong (false) or pending (null with answer present). Skipped items
  // (no answer at all) don't count as weak — they're just unfinished.
  const weakMap = new Map<string, WeakChunk>();
  items.forEach((item, idx) => {
    const row = perItem[idx];
    if (!row || !row.answer) return;
    if (row.correct === true) return;
    const chunkId = item.sourceChunkId;
    if (!chunkId) return;
    const existing = weakMap.get(chunkId);
    if (existing) {
      existing.count += 1;
      existing.itemIndices.push(idx);
    } else {
      const next: WeakChunk = {
        chunkId,
        count: 1,
        itemIndices: [idx],
      };
      const section = sectionByChunk.get(chunkId);
      if (section) next.sectionLabel = section;
      weakMap.set(chunkId, next);
    }
  });
  const weakChunks = Array.from(weakMap.values()).sort(
    (a, b) => b.count - a.count,
  );

  return { score, correctCount, perItem, weakChunks };
}

type Props = {
  open: boolean;
  sessionId: string;
  onClose: () => void;
  onGenerateCards?: (chunkIds: string[]) => void;
};

export function SessionReportModal({
  open,
  sessionId,
  onClose,
  onGenerateCards,
}: Props) {
  const pick = useLocalePick();
  const session = useLiveQuery(
    () => getQuizSession(sessionId),
    [sessionId],
  );

  const aggregate = useMemo(() => {
    if (!session) return null;
    const score = isSessionFinished(session)
      ? (session.score ?? computeScore(session))
      : computeScore(session);
    const agg = aggregateReport(session.items, session.answers);
    return { ...agg, score };
  }, [session]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title={pick("Quiz raporu", "Quiz report")}
      description={
        aggregate
          ? `${aggregate.correctCount} / ${session?.items.length ?? 0} ${pick(
              "doğru",
              "correct",
            )} · ${Math.round(aggregate.score * 100)}%`
          : pick("Yükleniyor…", "Loading…")
      }
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          <Button size="sm" onClick={onClose}>
            {pick("Kapat", "Close")}
          </Button>
          {aggregate && aggregate.weakChunks.length > 0 && onGenerateCards ? (
            <Button
              size="md"
              variant="primary"
              onClick={() =>
                onGenerateCards(aggregate.weakChunks.map((w) => w.chunkId))
              }
            >
              <Sparkles className="h-3.5 w-3.5" aria-hidden />
              {pick(
                "Zayıflıklar için kart üret",
                "Generate cards for weak spots",
              )}
            </Button>
          ) : null}
        </div>
      }
    >
      {!session || !aggregate ? null : (
        <div className="space-y-5">
          {aggregate.weakChunks.length > 0 ? (
            <section>
              <div className="mb-2 font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-3">
                {pick("Zayıf alanlar", "Weak spots")}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {aggregate.weakChunks.map((w) => (
                  <span
                    key={w.chunkId}
                    className="inline-flex items-center gap-1.5 rounded-md border border-rule bg-paper-2 px-2 py-1 text-[12px] text-ink-2"
                  >
                    {w.sectionLabel ?? w.chunkId}
                    <span className="font-mono text-[10.5px] text-ink-4">
                      ×{w.count}
                    </span>
                  </span>
                ))}
              </div>
            </section>
          ) : null}

          <section className="space-y-2">
            <div className="mb-1 font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-3">
              {pick("Soru bazında", "Per question")}
            </div>
            {session.items.map((item, idx) => {
              const row = aggregate.perItem[idx];
              const correct = row?.correct ?? null;
              return (
                <div
                  key={idx}
                  className="flex items-start gap-3 rounded-lg border border-rule-soft bg-paper px-3 py-2"
                >
                  <span
                    className={cn(
                      "mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border font-mono text-[10px]",
                      correct === true &&
                        "border-[color:var(--moss)] text-[color:var(--moss)]",
                      correct === false &&
                        "border-[color:var(--err)] text-[color:var(--err)]",
                      correct === null && "border-rule text-ink-4",
                    )}
                  >
                    {correct === true ? (
                      <Check className="h-3 w-3" aria-hidden />
                    ) : correct === false ? (
                      <X className="h-3 w-3" aria-hidden />
                    ) : (
                      String(idx + 1)
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-4">
                      {item.kind === "mcq" ? "MCQ" : pick("Açık", "Open")}
                      {item.sourceSection ? ` · ${item.sourceSection}` : ""}
                    </div>
                    <div className="mt-0.5 line-clamp-2 text-[13px] text-ink">
                      {item.q}
                    </div>
                  </div>
                </div>
              );
            })}
          </section>
        </div>
      )}
    </Modal>
  );
}
