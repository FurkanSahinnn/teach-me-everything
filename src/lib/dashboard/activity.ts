import type {
  ChatMessageRecord,
  FlashcardRecord,
  HighlightRecord,
  ReviewLogRecord,
  SourceRecord,
} from "@/lib/db/types";
import type { QuizSessionRecord } from "@/lib/quiz/types";

export type TodayItemKind =
  | "due"
  | "review"
  | "source"
  | "highlight"
  | "quiz";

export type TodayItem = {
  id: TodayItemKind;
  kind: TodayItemKind;
  title: string;
  titleEn: string;
  note: string;
  noteEn: string;
  time: string;
  count: number;
};

export type ActivityItemKind =
  | "source"
  | "review"
  | "highlight"
  | "chat"
  | "quiz";

export type ActivityItem = {
  id: string;
  kind: ActivityItemKind;
  title: string;
  titleEn: string;
  meta: string;
  metaEn: string;
  at: number;
};

export type DashboardActivityInput = {
  flashcards: FlashcardRecord[];
  reviewLogs: ReviewLogRecord[];
  sources: SourceRecord[];
  highlights: HighlightRecord[];
  chatMessages: ChatMessageRecord[];
  quizSessions: QuizSessionRecord[];
};

export type DashboardActivity = {
  today: TodayItem[];
  recent: ActivityItem[];
};

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfLocalDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function isWithinToday(ts: number | undefined, now: number): boolean {
  if (typeof ts !== "number") return false;
  const start = startOfLocalDay(now);
  return ts >= start && ts < start + DAY_MS;
}

function timeLabel(ts: number, now: number): string {
  const diff = Math.max(0, now - ts);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function countLabel(count: number, trSingular: string, trPlural: string): string {
  return `${count} ${count === 1 ? trSingular : trPlural}`;
}

function countLabelEn(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function buildDashboardActivity(
  input: DashboardActivityInput,
  now: number,
  limit = 8,
): DashboardActivity {
  const dueFlashcards = input.flashcards.filter((card) => card.dueAt <= now);
  const reviewsToday = input.reviewLogs.filter((log) =>
    isWithinToday(log.reviewedAt, now),
  );
  const sourcesToday = input.sources.filter((source) =>
    isWithinToday(source.createdAt, now),
  );
  const highlightsToday = input.highlights.filter((highlight) =>
    isWithinToday(highlight.createdAt, now),
  );
  const quizzesToday = input.quizSessions.filter((session) =>
    isWithinToday(session.finishedAt ?? session.startedAt, now),
  );

  const today: TodayItem[] = [];
  if (dueFlashcards.length > 0) {
    today.push({
      id: "due",
      kind: "due",
      title: countLabel(dueFlashcards.length, "kart tekrar", "kart tekrar"),
      titleEn: countLabelEn(dueFlashcards.length, "card due", "cards due"),
      note: "Tekrar kuyruğu güncel",
      noteEn: "Review queue is current",
      time: "now",
      count: dueFlashcards.length,
    });
  }
  if (reviewsToday.length > 0) {
    today.push({
      id: "review",
      kind: "review",
      title: countLabel(reviewsToday.length, "tekrar tamamlandı", "tekrar tamamlandı"),
      titleEn: countLabelEn(reviewsToday.length, "review completed", "reviews completed"),
      note: "Bugünkü çalışma",
      noteEn: "Today's study",
      time: timeLabel(Math.max(...reviewsToday.map((r) => r.reviewedAt)), now),
      count: reviewsToday.length,
    });
  }
  if (sourcesToday.length > 0) {
    today.push({
      id: "source",
      kind: "source",
      title: countLabel(sourcesToday.length, "kaynak eklendi", "kaynak eklendi"),
      titleEn: countLabelEn(sourcesToday.length, "source added", "sources added"),
      note: sourcesToday[0]?.title ?? "Yeni kaynak",
      noteEn: sourcesToday[0]?.titleEn ?? sourcesToday[0]?.title ?? "New source",
      time: timeLabel(Math.max(...sourcesToday.map((s) => s.createdAt)), now),
      count: sourcesToday.length,
    });
  }
  if (highlightsToday.length > 0) {
    today.push({
      id: "highlight",
      kind: "highlight",
      title: countLabel(highlightsToday.length, "highlight", "highlight"),
      titleEn: countLabelEn(highlightsToday.length, "highlight", "highlights"),
      note: "Bugün işaretlenen pasajlar",
      noteEn: "Passages marked today",
      time: timeLabel(Math.max(...highlightsToday.map((h) => h.createdAt)), now),
      count: highlightsToday.length,
    });
  }
  if (quizzesToday.length > 0) {
    today.push({
      id: "quiz",
      kind: "quiz",
      title: countLabel(quizzesToday.length, "quiz oturumu", "quiz oturumu"),
      titleEn: countLabelEn(quizzesToday.length, "quiz session", "quiz sessions"),
      note: "Quiz aktivitesi",
      noteEn: "Quiz activity",
      time: timeLabel(
        Math.max(...quizzesToday.map((q) => q.finishedAt ?? q.startedAt)),
        now,
      ),
      count: quizzesToday.length,
    });
  }

  const recent: ActivityItem[] = [
    ...input.sources.map((source) => ({
      id: `source:${source.id}`,
      kind: "source" as const,
      title: `${source.title} eklendi`,
      titleEn: `${source.titleEn ?? source.title} added`,
      meta: `${timeLabel(source.createdAt, now)} önce`,
      metaEn: `${timeLabel(source.createdAt, now)} ago`,
      at: source.createdAt,
    })),
    ...input.reviewLogs.map((log) => ({
      id: `review:${log.id}`,
      kind: "review" as const,
      title: "Kart tekrarlandı",
      titleEn: "Card reviewed",
      meta: `${log.rating} · ${timeLabel(log.reviewedAt, now)} önce`,
      metaEn: `${log.rating} · ${timeLabel(log.reviewedAt, now)} ago`,
      at: log.reviewedAt,
    })),
    ...input.highlights.map((highlight) => ({
      id: `highlight:${highlight.id}`,
      kind: "highlight" as const,
      title: "Highlight eklendi",
      titleEn: "Highlight added",
      meta: `${highlight.text.slice(0, 64)}${highlight.text.length > 64 ? "..." : ""}`,
      metaEn: `${timeLabel(highlight.createdAt, now)} ago`,
      at: highlight.createdAt,
    })),
    ...input.chatMessages
      .filter((message) => message.role === "assistant" && message.content.trim())
      .map((message) => ({
        id: `chat:${message.id}`,
        kind: "chat" as const,
        title: "Sohbet cevabı geldi",
        titleEn: "Chat answer received",
        meta: `${message.content.slice(0, 64)}${message.content.length > 64 ? "..." : ""}`,
        metaEn: `${timeLabel(message.createdAt, now)} ago`,
        at: message.createdAt,
      })),
    ...input.quizSessions.map((session) => {
      const at = session.finishedAt ?? session.startedAt;
      const pct =
        typeof session.score === "number" ? ` · ${Math.round(session.score * 100)}%` : "";
      return {
        id: `quiz:${session.id}`,
        kind: "quiz" as const,
        title: "Quiz oturumu",
        titleEn: "Quiz session",
        meta: `${session.items.length} soru${pct}`,
        metaEn: `${session.items.length} questions${pct}`,
        at,
      };
    }),
  ]
    .sort((a, b) => b.at - a.at)
    .slice(0, limit);

  return { today, recent };
}
