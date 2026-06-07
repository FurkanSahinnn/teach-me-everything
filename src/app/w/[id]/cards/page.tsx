"use client";

import { ArrowLeft, Layers, MoreHorizontal, Pencil, Plus, RotateCcw, Sparkles, Trash2, Undo2 } from "lucide-react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useLocalePick } from "@/i18n/IntlProvider";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { EmptyState } from "@/components/ui/EmptyState";
import { Kbd } from "@/components/ui/Kbd";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { cn } from "@/lib/utils/cn";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { FlashcardEditModal } from "@/components/flashcards/FlashcardEditModal";
import { GenerateBatchModal } from "@/components/flashcards/GenerateBatchModal";
import { IntervalHistogram } from "@/components/srs/IntervalHistogram";
import {
  useDecks,
  useDueFlashcardCount,
  useFlashcardsByDeck,
  useFlashcardsByWorkspace,
} from "@/lib/db/hooks";
import { applyReview, revertReview, type ReviewSnapshot } from "@/lib/db/flashcards";
import type {
  DeckRecord,
  FlashcardRecord,
  Rating,
} from "@/lib/db/types";
import { computeSm2, formatNextDue, isLeech } from "@/lib/srs/sm2";
import { buildSession } from "@/lib/srs/session";
import { LeechBadge } from "@/components/cards/LeechBadge";
import { usePrefs } from "@/stores/prefs";
import { useCurrentTime } from "@/hooks/useCurrentTime";

// Cap on the in-memory undo stack. 3 deep matches the spec; deeper history
// would let users unwind the dueAt of cards that have since drifted out of
// the current session window, which gets confusing fast.
const UNDO_DEPTH = 3;
type UndoEntry = {
  cardId: string;
  rating: Rating;
  logId: string;
  snapshot: ReviewSnapshot;
  prevIndex: number;
};

type RatingMeta = {
  tr: string;
  en: string;
  shortcut: string;
  color: string;
  labelTr: string;
  labelEn: string;
};

const RATING_META: Record<Rating, RatingMeta> = {
  again: {
    tr: "< 10 dk",
    en: "< 10 min",
    shortcut: "1",
    color: "#B14A4A",
    labelTr: "Yeniden",
    labelEn: "Again",
  },
  hard: {
    tr: "~1 gün",
    en: "~1 day",
    shortcut: "2",
    color: "#B8601C",
    labelTr: "Zor",
    labelEn: "Hard",
  },
  good: {
    tr: "~4 gün",
    en: "~4 days",
    shortcut: "3",
    color: "#4E5E3E",
    labelTr: "İyi",
    labelEn: "Good",
  },
  easy: {
    tr: "~11 gün",
    en: "~11 days",
    shortcut: "4",
    color: "#3C4A58",
    labelTr: "Kolay",
    labelEn: "Easy",
  },
};

const RATING_KEYS: Rating[] = ["again", "hard", "good", "easy"];

// Match Tailwind's md breakpoint (768px). Used to gate keyboard shortcuts so
// they never fire on mobile (where they'd be useless and could conflict with
// IME/virtual keyboards).
function useIsMdUp(): boolean {
  const [isMd, setIsMd] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia("(min-width: 768px)");
    const update = () => setIsMd(mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, []);
  return isMd;
}

export default function FlashcardsPage() {
  const params = useParams<{ id: string }>();
  const workspaceId = params.id;
  const t = useTranslations("cards");
  const pick = useLocalePick();
  const decks = useDecks(workspaceId) ?? [];
  const dueTotal = useDueFlashcardCount(workspaceId) ?? 0;
  const allCards = useFlashcardsByWorkspace(workspaceId) ?? [];

  const [activeDeckId, setActiveDeckId] = useState<string | null>(null);
  const [reviewMode, setReviewMode] = useState<"due" | "deck" | null>(null);
  const [genOpen, setGenOpen] = useState(false);

  if (decks === undefined) {
    return (
      <AppShell
        workspaceId={workspaceId}
        breadcrumb={[t("dashboard"), t("kartlar")]}
      >
        <div className="page-container">
          <DeckListSkeleton />
        </div>
      </AppShell>
    );
  }

  if (reviewMode) {
    return (
      <ReviewSession
        workspaceId={workspaceId}
        deckId={reviewMode === "deck" ? activeDeckId : null}
        onExit={() => {
          setReviewMode(null);
          setActiveDeckId(null);
        }}
      />
    );
  }

  return (
    <AppShell
      workspaceId={workspaceId}
      breadcrumb={[t("dashboard"), t("kartlar")]}
      topbarActions={
        <div className="flex items-center gap-2">
          <Button size="sm" variant="accent" onClick={() => setGenOpen(true)}>
            <Sparkles className="h-3.5 w-3.5" aria-hidden />
            {pick("AI'dan üret", "Generate with AI")}
          </Button>
          <Button size="sm" variant="primary" disabled title={pick("Manuel oluşturma — yakında", "Manual create — coming soon")}>
            <Plus className="h-3.5 w-3.5" aria-hidden />
            {t("kart_olustur")}
          </Button>
        </div>
      }
    >
      <div className="page-container">
        <header className="mb-7 rounded-[var(--radius-lg)] border border-rule bg-paper-2 p-4 shadow-[var(--shadow-soft)] sm:p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="eyebrow">{t("kartlar")}</div>
              <h1 className="mt-1 text-[28px] font-semibold leading-tight tracking-[-0.025em] sm:text-[32px]">
                {pick("Aralıklı tekrar", "Spaced repetition")}
              </h1>
              <p className="mt-2 max-w-[60ch] text-[13.5px] leading-6 text-ink-3">
                {pick(
                  `Bu çalışma alanında ${dueTotal} kart bugün tekrara hazır.`,
                  `${dueTotal} cards are due in this workspace today.`,
                )}
              </p>
            </div>
            <Button
              size="md"
              variant="accent"
              disabled={dueTotal === 0}
              onClick={() => {
                setActiveDeckId(null);
                setReviewMode("due");
              }}
            >
              <Layers className="h-4 w-4" aria-hidden />
              {pick(
                `Bugünün oturumunu başlat (${dueTotal})`,
                `Start today's session (${dueTotal})`,
              )}
            </Button>
          </div>
        </header>

        {decks.length === 0 ? (
          <CardsEmptyState workspaceId={workspaceId} />
        ) : (
          <section>
            <h2 className="mb-3 text-[18px] font-semibold tracking-[-0.01em]">
              {t("destelerin")}
            </h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {decks.map((d) => (
                <DeckCard
                  key={d.id}
                  workspaceId={workspaceId}
                  deck={d}
                  pick={pick}
                  onStart={() => {
                    setActiveDeckId(d.id);
                    setReviewMode("deck");
                  }}
                />
              ))}
            </div>
          </section>
        )}

        {allCards.length > 0 ? (
          <section className="mt-7 rounded-[var(--radius-lg)] border border-rule bg-paper-2 p-4 shadow-[var(--shadow-soft)] sm:p-5">
            <IntervalHistogram cards={allCards} />
          </section>
        ) : null}
      </div>
      <GenerateBatchModal
        open={genOpen}
        onClose={() => setGenOpen(false)}
        workspaceId={workspaceId}
      />
    </AppShell>
  );
}

function CardsEmptyState({ workspaceId }: { workspaceId: string }) {
  const tEmpty = useTranslations("empty_state");
  return (
    <Card variant="sunken" className="min-h-[260px]">
      <EmptyState
        icon={<Sparkles />}
        title={tEmpty("cards_no_cards_title")}
        description={tEmpty("cards_no_cards_desc")}
        action={{
          label: tEmpty("cards_no_cards_action"),
          href: `/w/${workspaceId}`,
        }}
      />
    </Card>
  );
}

function DeckCard({
  workspaceId: _workspaceId,
  deck,
  pick,
  onStart,
}: {
  workspaceId: string;
  deck: DeckRecord;
  pick: (tr: string, en: string) => string;
  onStart: () => void;
}) {
  const cards = useFlashcardsByDeck(deck.id) ?? [];
  const total = cards.length;
  const now = useCurrentTime();
  const dueInDeck = cards.filter((c) => c.dueAt <= now).length;
  return (
    <Card padding="md" variant="default" className="flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <span
          className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: deck.color }}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-semibold text-ink">
            {pick(deck.name, deck.nameEn ?? deck.name)}
          </div>
          <div className="mt-1 font-mono text-[11px] uppercase tracking-[0.06em] text-ink-3">
            {pick(`${total} kart · ${dueInDeck} bugün`, `${total} cards · ${dueInDeck} due`)}
          </div>
        </div>
      </div>
      <div className="mt-auto flex items-center justify-between gap-2 pt-2">
        <Chip>{dueInDeck > 0 ? pick("Tekrara hazır", "Ready") : pick("Tümü güncel", "All caught up")}</Chip>
        <Button size="sm" variant="primary" disabled={total === 0} onClick={onStart}>
          {pick("Başlat", "Start")}
        </Button>
      </div>
    </Card>
  );
}

function ReviewSession({
  workspaceId,
  deckId,
  onExit,
}: {
  workspaceId: string;
  deckId: string | null;
  onExit: () => void;
}) {
  const t = useTranslations("cards");
  const pick = useLocalePick();
  const toast = useToast();
  const srsPrefs = usePrefs((s) => s.srs);

  // For the workspace-wide path we need the full card pool (due + new)
  // so `buildSession` can interleave them. Deck mode keeps the legacy
  // flat queue — decks are usually small and pre-curated by the user.
  const workspaceCards = useFlashcardsByWorkspace(deckId ? undefined : workspaceId) ?? [];
  const deckCards = useFlashcardsByDeck(deckId ?? undefined) ?? [];
  // `sourceCards` is the lookup pool, not the play order. For deck mode it
  // also doubles as the order (legacy behavior). For workspace mode the
  // order is computed by `buildSession` below.
  const sourceCards = deckId ? deckCards : workspaceCards;

  const [queue, setQueue] = useState<string[] | null>(null);

  useEffect(() => {
    if (queue !== null) return;
    if (sourceCards.length === 0) return;
    let cancelled = false;
    if (deckId) {
      // Deck mode: replay the deck's flat list (sorted by createdAt). The
      // session builder is workspace-scoped — applying it inside a deck
      // would silently drop the user's curated ordering.
      queueMicrotask(() => {
        if (!cancelled) setQueue(sourceCards.map((c) => c.id));
      });
      return () => {
        cancelled = true;
      };
    }
    const plan = buildSession({
      cards: sourceCards,
      dueLimit: srsPrefs.dailyReview,
      newLimit: srsPrefs.dailyNew,
    });
    queueMicrotask(() => {
      if (!cancelled) setQueue(plan.order);
    });
    return () => {
      cancelled = true;
    };
  }, [sourceCards, queue, deckId, srsPrefs.dailyReview, srsPrefs.dailyNew]);

  const cardsById = useMemo<Map<string, FlashcardRecord>>(() => {
    const map = new Map<string, FlashcardRecord>();
    for (const c of sourceCards) map.set(c.id, c);
    return map;
  }, [sourceCards]);

  // Local content-language view toggle for bilingual ("both"-mode) cards. It
  // flips which field set (base TR vs `*En`) the card renders — purely a view
  // concern, never touching the global app locale. Defaults to the global
  // locale so the first card matches the user's chrome language.
  const globalLocale = usePrefs((s) => s.locale);
  const [viewLocale, setViewLocale] = useState<"tr" | "en">(globalLocale);
  // The deck/session is bilingual when any loaded card carries an English
  // translation. Cheap derived check — no extra Dexie read needed.
  const hasBilingual = useMemo(
    () => sourceCards.some((c) => c.questionEn !== undefined),
    [sourceCards],
  );

  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [history, setHistory] = useState<{ cardId: string; rating: Rating }[]>([]);
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([]);
  const [pending, setPending] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editingCard, setEditingCard] = useState<FlashcardRecord | null>(null);
  const isMd = useIsMdUp();

  // Wall-clock timestamp when the answer was revealed; reset on every card
  // change. Used to compute durationMs at rate time. A ref (not state) so
  // toggling reveal doesn't trigger a re-render or stale-closure bug.
  const revealedAtRef = useRef<number | null>(null);
  useEffect(() => {
    revealedAtRef.current = revealed ? Date.now() : null;
  }, [revealed, index]);

  const card = queue && queue[index] ? (cardsById.get(queue[index]) ?? null) : null;
  const total = queue?.length ?? 0;

  const handleRate = useCallback(
    async (rating: Rating) => {
      if (!card || pending) return;
      setPending(true);
      try {
        const next = computeSm2(
          {
            ease: card.ease,
            interval: card.interval,
            repetitions: card.repetitions,
          },
          rating,
        );
        const startedAt = revealedAtRef.current;
        const durationMs = startedAt !== null ? Date.now() - startedAt : undefined;
        const result = await applyReview(card.id, rating, next, durationMs !== undefined ? { durationMs } : undefined);
        setHistory((h) => [...h, { cardId: card.id, rating }]);
        setUndoStack((stack) => {
          const entry: UndoEntry = {
            cardId: card.id,
            rating,
            logId: result.logId,
            snapshot: result.snapshot,
            prevIndex: index,
          };
          const trimmed = stack.length >= UNDO_DEPTH ? stack.slice(stack.length - UNDO_DEPTH + 1) : stack;
          return [...trimmed, entry];
        });
        toast.toast({
          variant: rating === "again" ? "warn" : "success",
          description: pick(
            `${RATING_META[rating].labelTr} → ${formatNextDue(rating, next, pick)}`,
            `${RATING_META[rating].labelEn} → ${formatNextDue(rating, next, pick)}`,
          ),
          duration: 1800,
        });
        setRevealed(false);
        setIndex((i) => i + 1);
      } catch (err) {
        toast.toast({
          variant: "error",
          description: pick(
            `Kayıt başarısız: ${(err as Error).message}`,
            `Save failed: ${(err as Error).message}`,
          ),
        });
      } finally {
        setPending(false);
      }
    },
    [card, pending, toast, pick, index],
  );

  const handleUndo = useCallback(async () => {
    if (pending) return;
    if (undoStack.length === 0) return;
    const last = undoStack[undoStack.length - 1]!;
    setPending(true);
    try {
      await revertReview(last.cardId, last.logId, last.snapshot);
      setUndoStack((stack) => stack.slice(0, -1));
      setHistory((h) => h.slice(0, -1));
      setRevealed(true);
      setIndex(last.prevIndex);
      toast.toast({
        variant: "info",
        description: pick("Son değerlendirme geri alındı.", "Last rating undone."),
        duration: 1500,
      });
    } catch (err) {
      toast.toast({
        variant: "error",
        description: pick(
          `Geri alma başarısız: ${(err as Error).message}`,
          `Undo failed: ${(err as Error).message}`,
        ),
      });
    } finally {
      setPending(false);
    }
  }, [pending, undoStack, toast, pick]);

  useEffect(() => {
    // Keyboard shortcuts are desktop-only (md+). On mobile they'd be useless
    // and could conflict with the on-screen keyboard while typing elsewhere.
    if (!isMd) return;
    function handler(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      // Cmd/Ctrl+Z undo runs even when answer isn't revealed — the user may
      // have rated a card and then realised the next card was already onscreen.
      if ((e.metaKey || e.ctrlKey) && (e.key === "z" || e.key === "Z") && !e.shiftKey) {
        if (editOpen) return;
        e.preventDefault();
        void handleUndo();
        return;
      }
      // 'e' opens edit modal for the active card. Skip when modal already open
      // so the modal's own input fields can receive 'e' freely.
      if (e.key === "e" && card && !editOpen) {
        e.preventDefault();
        setEditingCard(card);
        setEditOpen(true);
        return;
      }
      if (editOpen) return;
      if (e.key === " ") {
        e.preventDefault();
        setRevealed((r) => !r);
        return;
      }
      if (!revealed || !card || pending) return;
      const keyMap: Record<string, Rating> = { "1": "again", "2": "hard", "3": "good", "4": "easy" };
      const rating = keyMap[e.key];
      if (rating) {
        e.preventDefault();
        void handleRate(rating);
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [revealed, card, pending, handleRate, handleUndo, isMd, editOpen]);

  if (queue === null) {
    return (
      <AppShell workspaceId={workspaceId} breadcrumb={[t("dashboard"), t("kartlar")]}>
        <div className="page-container">
          <Skeleton variant="rect" height={280} />
        </div>
      </AppShell>
    );
  }

  if (queue.length === 0) {
    return (
      <AppShell workspaceId={workspaceId} breadcrumb={[t("dashboard"), t("kartlar")]}>
        <div className="page-container grid place-items-center py-20 text-center">
          <div>
            <h2 className="text-[20px] font-semibold">{pick("Kart yok", "No cards")}</h2>
            <p className="mt-2 text-[13px] text-ink-3">
              {pick("Tekrar için bekleyen kart bulunamadı.", "No cards waiting for review.")}
            </p>
            <Button className="mt-4" size="sm" onClick={onExit}>
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> {pick("Listeye dön", "Back to list")}
            </Button>
          </div>
        </div>
      </AppShell>
    );
  }

  if (!card) {
    return <SessionSummary workspaceId={workspaceId} history={history} total={total} onExit={onExit} />;
  }

  const completed = history.length;
  const progressPct = total > 0 ? Math.round((completed / total) * 100) : 0;
  const successRate =
    completed > 0
      ? Math.round((history.filter((h) => h.rating !== "again").length / completed) * 100)
      : 0;

  return (
    <AppShell
      workspaceId={workspaceId}
      breadcrumb={[t("dashboard"), t("kartlar"), pick("Oturum", "Session")]}
      topbarActions={
        <div className="flex items-center gap-2">
          {hasBilingual ? (
            <SegmentedControl<"tr" | "en">
              size="sm"
              ariaLabel={pick("İçerik dili görünümü", "Content language view")}
              value={viewLocale}
              onChange={setViewLocale}
              options={[
                { value: "tr", label: "TR" },
                { value: "en", label: "EN" },
              ]}
            />
          ) : null}
          <Button
            size="sm"
            onClick={() => void handleUndo()}
            disabled={undoStack.length === 0 || pending}
            title={pick("Son değerlendirmeyi geri al (Ctrl/⌘+Z)", "Undo last rating (Ctrl/⌘+Z)")}
          >
            <Undo2 className="h-3.5 w-3.5" aria-hidden />
            {pick("Geri al", "Undo")}
          </Button>
          <Button size="sm" onClick={onExit}>
            <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            {t("oturumu_bitir")}
          </Button>
        </div>
      }
    >
      <div className="page-container">
        <header className="mb-6">
          <div className="flex flex-wrap items-center gap-3 text-[13px] text-ink-3">
            <span>
              <b className="font-medium text-ink">{completed}</b> / {total} {t("tekrar")}
            </span>
            <span>·</span>
            <span>
              <b className="font-medium text-ink">%{successRate}</b> {t("hatirlama_orani")}
            </span>
            <span>·</span>
            <span>{t("sm-2_algoritmasi")}</span>
          </div>
          <div className="mt-2.5 h-1 w-full max-w-[420px] overflow-hidden rounded-full bg-paper-3">
            <div className="h-full bg-accent transition-[width]" style={{ width: `${progressPct}%` }} />
          </div>
        </header>

        <div className="grid grid-cols-1 gap-8 pb-[calc(env(safe-area-inset-bottom)+148px)] md:pb-0 lg:grid-cols-[1fr_300px]">
          <div>
            <CardStage
              card={card}
              revealed={revealed}
              index={index}
              total={total}
              pick={pick}
              viewLocale={viewLocale}
              onEdit={() => {
                setEditingCard(card);
                setEditOpen(true);
              }}
            />
            <div className="mt-6 hidden md:block">
              {!revealed ? (
                <button
                  onClick={() => setRevealed(true)}
                  className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-rule bg-paper-2 py-4 text-[13.5px] text-ink-3 transition-colors hover:border-ink-5 hover:text-ink"
                >
                  {pick("Cevabı görmek için boşluk tuşuna bas", "Press space to reveal the answer")}
                  <Kbd>{t("bosluk")}</Kbd>
                </button>
              ) : (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {RATING_KEYS.map((key) => (
                    <RatingButton
                      key={key}
                      rating={key}
                      disabled={pending}
                      onRate={handleRate}
                      pick={pick}
                      isMobile={false}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>

          <aside className="hidden md:block">
            <SessionDistribution history={history} pick={pick} />
          </aside>
        </div>

        {/* Mobile-only sticky bottom CTA / rating bar. Sits above the BottomBar
            (which is 68px tall + safe-area inset). md+ keeps the inline layout
            above untouched. */}
        <div
          className={cn(
            "fixed inset-x-0 z-20 md:hidden",
            "border-t border-rule bg-paper-2/95 backdrop-blur-md",
            "px-3 pt-3",
            "pb-[calc(env(safe-area-inset-bottom)+76px)]",
          )}
          style={{ bottom: 0 }}
        >
          {!revealed ? (
            <button
              onClick={() => setRevealed(true)}
              className="flex h-14 w-full items-center justify-center gap-2 rounded-lg border border-dashed border-rule bg-paper text-[14px] font-medium text-ink-2 transition-colors active:bg-paper-3"
            >
              {pick("Cevabı göster", "Reveal answer")}
            </button>
          ) : (
            <div className="grid grid-cols-4 gap-2">
              {RATING_KEYS.map((key) => (
                <RatingButton
                  key={key}
                  rating={key}
                  disabled={pending}
                  onRate={handleRate}
                  pick={pick}
                  isMobile
                />
              ))}
            </div>
          )}
        </div>
      </div>
      <FlashcardEditModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        card={editingCard}
      />
    </AppShell>
  );
}

function CardStage({
  card,
  revealed,
  index,
  total,
  pick,
  viewLocale,
  onEdit,
}: {
  card: FlashcardRecord;
  revealed: boolean;
  index: number;
  total: number;
  pick: (tr: string, en: string) => string;
  /** Local content-language view: "en" renders the `*En` fields (falling back
   *  to the base when a translation is missing); "tr" renders the base. This
   *  is the per-view toggle state, independent of the global app locale. */
  viewLocale: "tr" | "en";
  onEdit?: () => void;
}) {
  const t = useTranslations("cards");
  const questionText =
    viewLocale === "en" ? (card.questionEn ?? card.question) : card.question;
  const answerText =
    viewLocale === "en" ? (card.answerEn ?? card.answer) : card.answer;
  return (
    <div className="relative">
      <div
        aria-hidden
        className="absolute left-1.5 right-1.5 top-2 h-full rounded-[14px] border border-rule bg-paper-2"
      />
      <div
        aria-hidden
        className="absolute left-3 right-3 top-4 h-full rounded-[14px] border border-rule bg-paper-3 opacity-60"
      />
      <div className="relative w-full rounded-[14px] border border-rule bg-paper p-8 text-left shadow-[0_20px_40px_-24px_rgba(0,0,0,0.25)]">
        <div className="flex items-start justify-between gap-4">
          <div className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-4">
            {t("soru")} · {t("kart")} {index + 1} / {total}
          </div>
          <div className="flex items-start gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              {isLeech(card) ? <LeechBadge /> : null}
              {card.tags.slice(0, 3).map((tag) => (
                <Chip key={tag}>{tag}</Chip>
              ))}
            </div>
            {onEdit ? (
              <CardActionsMenu onEdit={onEdit} pick={pick} />
            ) : null}
          </div>
        </div>

        <div className="mt-5 font-serif text-[22px] leading-[1.35] tracking-[-0.005em] text-ink">
          {questionText}
        </div>

        {revealed ? (
          <div className="mt-6 border-t border-rule-soft pt-5">
            <div className="mb-2 font-mono text-[10.5px] uppercase tracking-[0.12em] text-accent-ink">
              {t("cevap")}
            </div>
            <p className="text-[15px] leading-[1.65] text-ink-2">
              {answerText}
            </p>
            {card.citations && card.citations.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {card.citations.map((c, i) => (
                  <span
                    key={i}
                    className="rounded-md border border-rule bg-paper-2 px-2 py-0.5 text-[11px] text-ink-3"
                  >
                    {c.section ? (
                      <span className="font-mono text-[10px] text-accent-ink">{c.section}</span>
                    ) : null}
                    {c.section && c.quote ? <span className="mx-1.5 text-ink-4">·</span> : null}
                    {c.quote ? <span>{c.quote}</span> : null}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="mt-6 flex items-center justify-between border-t border-rule-soft pt-3 font-mono text-[11px] text-ink-4">
          <span>
            {pick("Tekrar", "Reviewed")}: {card.reviewCount}
          </span>
          <span>
            {pick("Kolaylık", "Ease")}: {card.ease.toFixed(2)} · {pick("Aralık", "Interval")}: {card.interval}d
          </span>
        </div>
      </div>
    </div>
  );
}

function RatingButton({
  rating,
  disabled,
  onRate,
  pick,
  isMobile = false,
}: {
  rating: Rating;
  disabled: boolean;
  onRate: (r: Rating) => void;
  pick: (tr: string, en: string) => string;
  isMobile?: boolean;
}) {
  const meta = RATING_META[rating];
  if (isMobile) {
    // Mobile: compact touch-target (≥48px tall), no Kbd, no full hover lift.
    return (
      <button
        onClick={() => onRate(rating)}
        disabled={disabled}
        className="flex h-14 flex-col items-center justify-center gap-0.5 overflow-hidden rounded-lg border border-rule bg-paper text-base transition-colors active:bg-paper-3 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <div className="h-1 w-8 rounded" style={{ backgroundColor: meta.color }} aria-hidden />
        <span className="font-serif text-[15px] font-medium leading-none text-ink">
          {pick(meta.labelTr, meta.labelEn)}
        </span>
        <span className="font-mono text-[10.5px] leading-none text-ink-3">
          {pick(meta.tr, meta.en)}
        </span>
      </button>
    );
  }
  return (
    <button
      onClick={() => onRate(rating)}
      disabled={disabled}
      className="group flex flex-col items-stretch overflow-hidden rounded-lg border border-rule bg-paper transition-all hover:-translate-y-0.5 hover:border-ink-5 hover:shadow-sm disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0"
    >
      <div className="h-1" style={{ backgroundColor: meta.color }} aria-hidden />
      <div className="flex flex-col items-start gap-1 px-3.5 py-2.5">
        <div className="flex w-full items-center justify-between">
          <span className="font-serif text-[15px] font-medium text-ink">
            {pick(meta.labelTr, meta.labelEn)}
          </span>
          <Kbd>{meta.shortcut}</Kbd>
        </div>
        <div className="font-mono text-[11px] text-ink-3">{pick(meta.tr, meta.en)}</div>
      </div>
    </button>
  );
}

function CardActionsMenu({
  onEdit,
  pick,
}: {
  onEdit: () => void;
  pick: (tr: string, en: string) => string;
}) {
  const t = useTranslations("flashcard_edit");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent): void {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={pick("Kart eylemleri", "Card actions")}
        aria-expanded={open}
        className="grid h-7 w-7 place-items-center rounded text-ink-3 transition-colors hover:bg-paper-2 hover:text-ink"
      >
        <MoreHorizontal className="h-3.5 w-3.5" aria-hidden />
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-20 mt-1 w-[160px] overflow-hidden rounded-[8px] border border-rule bg-paper py-1 text-[12.5px] shadow-[var(--shadow-medium)]"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onEdit();
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-ink-2 hover:bg-paper-2 hover:text-ink"
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden />
            {pick("Düzenle", "Edit")}
            <Kbd className="ml-auto">E</Kbd>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onEdit();
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-err hover:bg-err/10"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
            {t("delete")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function SessionDistribution({
  history,
  pick,
}: {
  history: { cardId: string; rating: Rating }[];
  pick: (tr: string, en: string) => string;
}) {
  const t = useTranslations("cards");
  const dist: Record<Rating, number> = { again: 0, hard: 0, good: 0, easy: 0 };
  history.forEach((h) => {
    dist[h.rating] += 1;
  });
  const max = Math.max(1, dist.again, dist.hard, dist.good, dist.easy);

  return (
    <Card padding="md">
      <h3 className="font-serif text-[15px] font-medium">{t("bu_oturumun_dagilimi")}</h3>
      <div className="mt-4 grid grid-cols-4 gap-3">
        {RATING_KEYS.map((k) => (
          <div key={k} className="flex flex-col items-center gap-2">
            <div className="flex h-[70px] w-full items-end overflow-hidden rounded bg-paper-2" aria-hidden>
              <div
                className="w-full transition-[height]"
                style={{
                  height: `${(dist[k] / max) * 100}%`,
                  backgroundColor: RATING_META[k].color,
                }}
              />
            </div>
            <div className="font-mono text-[10.5px] uppercase text-ink-3">{dist[k]}</div>
            <div className="font-mono text-[10px] text-ink-4">
              {pick(RATING_META[k].labelTr, RATING_META[k].labelEn)}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function SessionSummary({
  workspaceId,
  history,
  total,
  onExit,
}: {
  workspaceId: string;
  history: { cardId: string; rating: Rating }[];
  total: number;
  onExit: () => void;
}) {
  const t = useTranslations("cards");
  const pick = useLocalePick();
  const reviewed = history.length;
  const success = history.filter((h) => h.rating !== "again").length;
  const successRate = reviewed > 0 ? Math.round((success / reviewed) * 100) : 0;
  return (
    <AppShell
      workspaceId={workspaceId}
      breadcrumb={[t("dashboard"), t("kartlar"), pick("Oturum", "Session")]}
    >
      <div className="page-container">
        <Card padding="lg" variant="default" className="mx-auto max-w-[560px] text-center">
          <h2 className="text-[22px] font-semibold tracking-[-0.01em]">
            {pick("Oturum tamamlandı", "Session complete")}
          </h2>
          <p className="mt-2 text-[13.5px] text-ink-3">
            {pick(
              `${reviewed} / ${total} kart tekrar edildi.`,
              `${reviewed} of ${total} cards reviewed.`,
            )}
          </p>
          <div className="mt-5 grid grid-cols-3 gap-3 text-[12.5px]">
            <Stat value={`${reviewed}`} label={pick("Tekrar", "Reviewed")} />
            <Stat value={`%${successRate}`} label={pick("Başarı", "Success")} />
            <Stat
              value={`${history.filter((h) => h.rating === "again").length}`}
              label={pick("Yeniden", "Again")}
            />
          </div>
          <div className="mt-6 flex justify-center gap-2">
            <Button size="sm" onClick={onExit}>
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
              {pick("Destelere dön", "Back to decks")}
            </Button>
          </div>
        </Card>
      </div>
    </AppShell>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-[12px] border border-rule bg-paper-2 px-3 py-3">
      <div className="font-mono text-[18px] font-semibold text-ink">{value}</div>
      <div className="mt-1 text-[11.5px] text-ink-4">{label}</div>
    </div>
  );
}

function DeckListSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton variant="rect" height={120} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Card key={i} padding="md">
            <Skeleton variant="rect" width="60%" height={16} />
            <div className="mt-2">
              <Skeleton variant="rect" width="40%" height={12} />
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
