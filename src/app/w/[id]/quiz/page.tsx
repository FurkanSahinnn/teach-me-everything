"use client";

import {
  ArrowRight,
  Check,
  FileText,
  Loader2,
  RotateCcw,
  Sparkles,
  X,
} from "lucide-react";
import { notFound } from "next/navigation";
import { useRouteParams } from "@/lib/utils/route-params";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { AppShell } from "@/components/shell/AppShell";
import { GenerateBatchModal } from "@/components/flashcards/GenerateBatchModal";
import { SessionReportModal } from "@/components/quiz/SessionReportModal";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { useToast } from "@/components/ui/Toast";
import { useLocalePick } from "@/i18n/IntlProvider";
import {
  defaultContentLangMode,
  deriveGenLocale,
  resolveBilingualPair,
  type ContentLangMode,
} from "@/lib/ai/content-language";
import { findChatOption } from "@/lib/ai/model-options";
import type { QuizMode } from "@/lib/ai/prompts/quiz-gen";
import { runQuizGen, QuizGenError } from "@/lib/ai/quiz-gen";
import { runQuizEval, QuizEvalError } from "@/lib/ai/quiz-eval";
import { runTranslate, type TranslateItem } from "@/lib/ai/translate";
import { listChunksBySource } from "@/lib/db/chunks";
import { useSources, useWorkspace } from "@/lib/db/hooks";
import {
  createQuizSession,
  finishQuizSession,
  getQuizSession,
  listQuizSessionsByWorkspace,
  patchQuizAnswers,
} from "@/lib/db/quiz-sessions";
import {
  answerForIndex,
  applyOpenEval,
  computeScore,
  finishSession,
  isSessionFinished,
  nextItem,
  submitAnswer,
  type SessionState,
} from "@/lib/quiz/session";
import type {
  QuizItem,
  QuizMcqAnswer,
  QuizMcqItem,
  QuizOpenAnswer,
  QuizOpenItem,
} from "@/lib/quiz/types";
import { resolveChatCredentialForPreset } from "@/lib/ai/anthropic-credential";
import { useVault } from "@/stores/vault";
import { findCustomEndpoint, usePrefs } from "@/stores/prefs";
import { isLocalUrl } from "@/lib/ai/providers/local-bypass";
import { getPreset } from "@/lib/ai/providers/presets";
import { cn } from "@/lib/utils/cn";
import { formatRelativeDay } from "@/lib/utils/intl";

type View =
  | { kind: "setup" }
  | { kind: "session"; sessionId: string }
  | { kind: "summary"; sessionId: string };

const COUNT_OPTIONS = [5, 10, 15, 20];

// Local content-view language. Distinct from the global app locale — flipping
// it only changes which fields (base vs `*En`) a single quiz view renders, and
// never touches the global `locale`.
type ViewLocale = "tr" | "en";

// Small TR/EN button group shown only on "both"-language sessions. Drives the
// per-view content language; static UI chrome still uses the global locale.
function ContentLangToggle({
  value,
  onChange,
  pick,
}: {
  value: ViewLocale;
  onChange: (v: ViewLocale) => void;
  pick: (tr: string, en: string) => string;
}) {
  return (
    <div
      role="group"
      aria-label={pick("İçerik dili", "Content language")}
      className="inline-flex overflow-hidden rounded-lg border border-rule"
    >
      {(["tr", "en"] as ViewLocale[]).map((loc) => (
        <button
          key={loc}
          type="button"
          onClick={() => onChange(loc)}
          aria-pressed={value === loc}
          className={cn(
            "px-2.5 py-1 font-mono text-[10.5px] uppercase tracking-[0.1em] transition-colors",
            value === loc
              ? "bg-accent-soft text-accent-ink"
              : "bg-paper text-ink-4 hover:text-ink-2",
          )}
        >
          {loc === "tr" ? "TR" : "EN"}
        </button>
      ))}
    </div>
  );
}

// Resolve an MCQ item to the fields for the requested view language. EN falls
// back to the base field when an English sibling is absent (partial translate).
function mcqForView(
  item: QuizMcqItem,
  view: ViewLocale,
): { q: string; choices: string[]; explanation: string | undefined } {
  if (view === "en") {
    return {
      q: item.qEn ?? item.q,
      choices: item.choices.map((c, k) => item.choicesEn?.[k] ?? c),
      explanation: item.explanationEn ?? item.explanation,
    };
  }
  return { q: item.q, choices: item.choices, explanation: item.explanation };
}

export default function QuizPage() {
  const params = useRouteParams<{ id: string }>();
  const workspaceId = params.id;
  const ws = useWorkspace(workspaceId);
  const sources = useSources(workspaceId);
  const t = useTranslations("quiz");
  const pick = useLocalePick();

  const [view, setView] = useState<View>({ kind: "setup" });

  if (ws === undefined) {
    return null;
  }
  if (ws === null) {
    notFound();
  }

  return (
    <AppShell
      workspaceId={workspaceId}
      breadcrumb={[
        t("dashboard"),
        pick(ws.name, ws.nameEn ?? ws.name),
        t("quiz"),
      ]}
    >
      <div className="mx-auto max-w-[980px] px-6 pb-20 pt-7 md:px-8">
        {view.kind === "setup" ? (
          <SetupView
            workspaceId={workspaceId}
            sources={sources ?? []}
            onStart={(sessionId) => setView({ kind: "session", sessionId })}
            onResume={(sessionId, finished) =>
              setView(
                finished
                  ? { kind: "summary", sessionId }
                  : { kind: "session", sessionId },
              )
            }
          />
        ) : null}

        {view.kind === "session" ? (
          <SessionView
            sessionId={view.sessionId}
            onFinish={() =>
              setView({ kind: "summary", sessionId: view.sessionId })
            }
            onAbort={() => setView({ kind: "setup" })}
          />
        ) : null}

        {view.kind === "summary" ? (
          <SummaryView
            workspaceId={workspaceId}
            sessionId={view.sessionId}
            onRestart={() => setView({ kind: "setup" })}
          />
        ) : null}
      </div>
    </AppShell>
  );
}

function SetupView({
  workspaceId,
  sources,
  onStart,
  onResume,
}: {
  workspaceId: string;
  sources: ReturnType<typeof useSources> extends infer T
    ? T extends undefined
      ? never
      : NonNullable<T>
    : never;
  onStart: (sessionId: string) => void;
  onResume: (sessionId: string, finished: boolean) => void;
}) {
  const pick = useLocalePick();
  const { toast } = useToast();
  const masterKey = useVault((s) => s.masterKey);
  const aiResponseLocale = usePrefs((s) => s.aiResponseLocale);
  const globalLocale = usePrefs((s) => s.locale);
  const recentSessions = useLiveQuery(
    () => listQuizSessionsByWorkspace(workspaceId, 6),
    [workspaceId],
    [],
  );

  const readySources = useMemo(
    () => sources.filter((s) => s.ingestStatus === "ready"),
    [sources],
  );

  const [sourceId, setSourceId] = useState<string | undefined>(undefined);
  const [count, setCount] = useState<number>(10);
  const [mode, setMode] = useState<QuizMode>("mcq");
  // Content language follows the user's existing output-locale settings by
  // default; "both" generates one language + translates into the other so the
  // session view can flip TR⇄EN locally.
  const [langMode, setLangMode] = useState<ContentLangMode>(() =>
    defaultContentLangMode(aiResponseLocale, globalLocale),
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (sourceId === undefined && readySources[0]) {
      const id = readySources[0].id;
      queueMicrotask(() => setSourceId(id));
    }
  }, [readySources, sourceId]);

  const selectedSource = readySources.find((s) => s.id === sourceId);

  async function handleGenerate() {
    if (!selectedSource) return;
    if (!masterKey) {
      setErr(
        pick(
          "Önce kasayı aç (Topbar → kilit ikonu).",
          "Unlock the vault first (Topbar → lock icon).",
        ),
      );
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const chunks = await listChunksBySource(selectedSource.id);
      if (chunks.length === 0) {
        setErr(
          pick(
            "Bu kaynak henüz hazırlanmamış. Lütfen kaynağı aç ve indekslenmesini bekle.",
            "This source isn't indexed yet. Open the source and let it finish indexing.",
          ),
        );
        return;
      }
      const modelId = usePrefs.getState().modelBindings.chat;
      const option = findChatOption(modelId);
      if (!option) {
        setErr(
          pick(
            `Model bulunamadı: ${modelId}`,
            `Model not found: ${modelId}`,
          ),
        );
        return;
      }
      const presetId = option.presetId;
      const preset = getPreset(presetId);
      const customEndpoint =
        typeof presetId === "string" && presetId.startsWith("custom:")
          ? findCustomEndpoint(presetId.slice("custom:".length))
          : undefined;
      const baseUrl = customEndpoint?.baseUrl ?? preset?.baseUrl;
      const isLocal = Boolean(baseUrl && isLocalUrl(baseUrl));
      let apiKey = "";
      let authKind: "oauth" | "api-key" | undefined;
      if (!isLocal) {
        const cred = await resolveChatCredentialForPreset(presetId);
        if (!cred) {
          setErr(
            pick(
              "Bu sağlayıcı için API anahtarı bulunamadı.",
              "No API key stored for this provider.",
            ),
          );
          return;
        }
        apiKey = cred.apiKey;
        if (cred.authKind) authKind = cred.authKind;
      }

      const locale = (usePrefs.getState().locale ?? "tr") as "tr" | "en";
      const { primary, keepEnglishTerms, translateTo } = deriveGenLocale(
        langMode,
        locale,
      );
      // One canonical generation produces the items + text in `primary`.
      const result = await runQuizGen({
        modelId,
        apiKey,
        ...(authKind ? { authKind } : {}),
        source: {
          title: selectedSource.title,
          ...(selectedSource.titleEn !== undefined
            ? { titleEn: selectedSource.titleEn }
            : {}),
          ...(selectedSource.author !== undefined
            ? { author: selectedSource.author }
            : {}),
          type: selectedSource.type,
        },
        chunks: chunks.map((c) => ({
          index: c.index,
          ...(c.section !== undefined ? { section: c.section } : {}),
          ...(c.headings !== undefined ? { headings: c.headings } : {}),
          text: c.text,
          ...(c.page !== undefined ? { page: c.page } : {}),
        })),
        locale: primary,
        count,
        mode,
        keepEnglishTerms,
      });

      // "both": translate the canonical items into the other language with a
      // parallel batched pass. Choices are flattened to indexed keys
      // (`choice_0`…) so the reassembly preserves index alignment with
      // `correctIndex` (which is shared, never duplicated).
      let items = result.items;
      let translatePartial = false;
      if (translateTo) {
        const tItems: TranslateItem[] = result.items.map((it, idx) => {
          const fields: Record<string, string> = { q: it.q };
          if (it.kind === "mcq") {
            if (it.explanation) fields.explanation = it.explanation;
            it.choices.forEach((c, k) => {
              fields[`choice_${k}`] = c;
            });
          } else {
            fields.rubric = it.rubric;
          }
          return { id: String(idx), fields };
        });
        const translated = await runTranslate({
          target: translateTo,
          items: tItems,
          modelId,
          apiKey,
          ...(authKind ? { authKind } : {}),
          domainHint: pick("bir quiz", "a quiz"),
        });
        translatePartial = translated.partial;
        items = result.items.map((it, idx): QuizItem => {
          const tr = translated.byId.get(String(idx));
          const qPair = resolveBilingualPair(primary, translateTo, it.q, tr?.q);
          if (it.kind === "mcq") {
            const choicesBase: string[] = [];
            const choicesEn: string[] = [];
            it.choices.forEach((c, k) => {
              const pair = resolveBilingualPair(
                primary,
                translateTo,
                c,
                tr?.[`choice_${k}`],
              );
              choicesBase.push(pair.base);
              choicesEn.push(pair.en ?? pair.base);
            });
            const explPair = it.explanation
              ? resolveBilingualPair(
                  primary,
                  translateTo,
                  it.explanation,
                  tr?.explanation,
                )
              : undefined;
            return {
              ...it,
              q: qPair.base,
              choices: choicesBase,
              correctIndex: it.correctIndex,
              ...(explPair ? { explanation: explPair.base } : {}),
              ...(qPair.en !== undefined ? { qEn: qPair.en } : {}),
              choicesEn,
              ...(explPair?.en !== undefined
                ? { explanationEn: explPair.en }
                : {}),
            };
          }
          const rubricPair = resolveBilingualPair(
            primary,
            translateTo,
            it.rubric,
            tr?.rubric,
          );
          return {
            ...it,
            q: qPair.base,
            rubric: rubricPair.base,
            ...(qPair.en !== undefined ? { qEn: qPair.en } : {}),
            ...(rubricPair.en !== undefined
              ? { rubricEn: rubricPair.en }
              : {}),
          };
        });
      }

      const session = await createQuizSession({
        workspaceId,
        sourceId: selectedSource.id,
        items,
        model: result.model,
        langMode,
      });
      if (translatePartial) {
        toast({
          variant: "info",
          title: pick("Kısmi çeviri", "Partial translation"),
          description: pick(
            "Bazı sorular çevrilemedi; kaynak dilinde bırakıldı.",
            "Some questions couldn't be translated and kept the source language.",
          ),
        });
      }
      onStart(session.id);
    } catch (e) {
      const msg =
        e instanceof QuizGenError
          ? e.message
          : e instanceof Error
            ? e.message
            : String(e);
      setErr(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-8">
      <header>
        <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-3">
          {pick("Aktif öğrenme", "Active recall")}
        </div>
        <h1 className="mt-1.5 font-serif text-[30px] font-normal leading-tight tracking-[-0.015em]">
          {pick("Yeni quiz oluştur", "New quiz")}
        </h1>
        <p className="mt-2 text-[14px] leading-[1.6] text-ink-2">
          {pick(
            "Bir kaynak seç ve modelden çoktan seçmeli sorular üret. Cevapların ve skor cihazına yerel olarak kaydedilir.",
            "Pick a source and have the model generate multiple-choice questions. Your answers and score are stored locally.",
          )}
        </p>
      </header>

      <Card padding="lg">
        <div className="space-y-5">
          <div>
            <label className="mb-2 block font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-3">
              {pick("Kaynak", "Source")}
            </label>
            {readySources.length === 0 ? (
              <div className="rounded-lg border border-rule-soft bg-paper-2 p-4 text-[13px] text-ink-3">
                {pick(
                  "Bu çalışma alanında hazır kaynak yok. Önce bir PDF veya DOCX yükle.",
                  "No ready sources in this workspace. Upload a PDF or DOCX first.",
                )}
              </div>
            ) : (
              <select
                value={sourceId ?? ""}
                onChange={(e) => setSourceId(e.target.value)}
                className="w-full rounded-lg border border-rule bg-paper px-3 py-2 text-[14px] text-ink outline-none focus:border-ink-5"
              >
                {readySources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {pick(s.title, s.titleEn ?? s.title)}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div>
            <label className="mb-2 block font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-3">
              {pick("Mod", "Mode")}
            </label>
            <SegmentedControl
              value={mode}
              onChange={(v) => setMode(v as QuizMode)}
              options={[
                { value: "mcq", label: pick("Çoktan seçmeli", "MCQ") },
                { value: "open", label: pick("Açık uçlu", "Open") },
                { value: "mixed", label: pick("Karışık", "Mixed") },
              ]}
            />
          </div>

          <div>
            <label className="mb-2 block font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-3">
              {pick("İçerik dili", "Content language")}
            </label>
            <SegmentedControl
              value={langMode}
              onChange={(v) => setLangMode(v as ContentLangMode)}
              options={[
                { value: "tr", label: pick("Türkçe", "Turkish") },
                { value: "en", label: pick("İngilizce", "English") },
                {
                  value: "en_terms_tr",
                  label: pick("EN terim·TR", "EN terms·TR"),
                },
                { value: "both", label: pick("İkisi", "Both") },
              ]}
            />
            <p className="mt-1.5 text-[11.5px] leading-[1.5] text-ink-4">
              {langMode === "both"
                ? pick(
                    "İçerik hem Türkçe hem İngilizce üretilir; quiz görünümünde tek tıkla geçiş yapabilirsin. (~2× üretim maliyeti.)",
                    "Content is produced in both Turkish and English; switch with one click in the quiz view. (~2× generation cost.)",
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

          <div>
            <label className="mb-2 block font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-3">
              {pick("Soru sayısı", "Question count")}
            </label>
            <SegmentedControl
              value={String(count)}
              onChange={(v) => setCount(Number(v))}
              options={COUNT_OPTIONS.map((n) => ({
                value: String(n),
                label: String(n),
              }))}
            />
          </div>

          {err ? (
            <div className="rounded-lg border border-[color:var(--err)] bg-[color:color-mix(in_srgb,var(--err)_10%,var(--paper))] p-3 text-[13px] text-ink-2">
              {err}
            </div>
          ) : null}

          <div className="flex items-center justify-end gap-2">
            <Button
              size="md"
              variant="primary"
              onClick={handleGenerate}
              disabled={busy || readySources.length === 0}
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <Sparkles className="h-3.5 w-3.5" aria-hidden />
              )}
              {pick("Quiz üret", "Generate quiz")}
            </Button>
          </div>
        </div>
      </Card>

      {recentSessions && recentSessions.length > 0 ? (
        <section>
          <div className="mb-3 font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-3">
            {pick("Son oturumlar", "Recent sessions")}
          </div>
          <div className="space-y-2">
            {recentSessions.map((s) => {
              const finished = typeof s.finishedAt === "number";
              const score =
                typeof s.score === "number"
                  ? Math.round(s.score * 100)
                  : null;
              return (
                <button
                  key={s.id}
                  onClick={() => onResume(s.id, finished)}
                  className="group flex w-full items-center gap-3 rounded-lg border border-rule bg-paper px-4 py-3 text-left transition-[transform,box-shadow,border-color,background-color] duration-[180ms] ease-[cubic-bezier(0.2,0.6,0.2,1)] hover:-translate-y-[2px] hover:border-accent/60 hover:bg-paper-2 hover:shadow-[var(--shadow-medium)] active:scale-[0.99] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-[13.5px] text-ink">
                      {s.items.length}{" "}
                      {pick("soru", "questions")}
                      {finished && score !== null
                        ? ` · ${score}%`
                        : ` · ${pick("devam ediyor", "in progress")}`}
                    </div>
                    <div className="font-mono text-[11px] text-ink-3">
                      {formatRelativeDay(s.startedAt, pick("tr", "en"))}
                    </div>
                  </div>
                  <ArrowRight className="h-4 w-4 text-ink-4 transition-transform duration-[180ms] group-hover:translate-x-0.5 group-hover:text-accent" aria-hidden />
                </button>
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function SessionView({
  sessionId,
  onFinish,
  onAbort,
}: {
  sessionId: string;
  onFinish: () => void;
  onAbort: () => void;
}) {
  const pick = useLocalePick();
  const globalLocale = usePrefs((s) => s.locale);
  const session = useLiveQuery(
    () => getQuizSession(sessionId),
    [sessionId],
  );
  const [activeIndex, setActiveIndex] = useState(0);
  // Local content-view language, defaulting to the global locale. Only
  // surfaced for "both" sessions; flipping it never changes the app locale.
  const [viewLocale, setViewLocale] = useState<ViewLocale>(
    globalLocale === "en" ? "en" : "tr",
  );

  useEffect(() => {
    if (!session) return;
    const next = nextItem(session, 0);
    if (next !== null) {
      queueMicrotask(() => setActiveIndex(next));
    }
  }, [session]);

  if (session === undefined) {
    return (
      <div className="grid place-items-center py-20 text-ink-3">
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
      </div>
    );
  }
  if (!session) {
    return (
      <div className="grid place-items-center py-20 text-ink-3">
        {pick("Oturum bulunamadı.", "Session not found.")}
      </div>
    );
  }

  const item = session.items[activeIndex];
  if (!item) {
    return null;
  }

  const answer = answerForIndex(session, activeIndex);
  const total = session.items.length;
  const answeredCount = session.answers.length;
  const canAdvance =
    answer !== undefined &&
    (item.kind !== "open" ||
      (answer.kind === "open" && answer.correct !== null));

  async function handleSelect(selectedIndex: number) {
    if (!session) return;
    const cur = session.items[activeIndex];
    if (!cur || cur.kind !== "mcq") return;
    const next = submitAnswer(session, activeIndex, {
      kind: "mcq",
      selectedIndex,
    });
    await patchQuizAnswers(sessionId, next.answers);
  }

  async function handleNext() {
    if (!session) return;
    const target = nextItem(session, activeIndex + 1);
    if (target === null || answeredCount >= total) {
      const finished = finishSession(session);
      await finishQuizSession(sessionId, {
        finishedAt: finished.finishedAt!,
        score: finished.score!,
        answers: finished.answers,
      });
      onFinish();
      return;
    }
    setActiveIndex(target);
  }

  return (
    <section className="space-y-6">
      <header className="flex items-center justify-between gap-3">
        <div>
          <div className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-ink-3">
            {pick("Soru", "Question")} {activeIndex + 1} / {total}
          </div>
          <div className="mt-1 font-mono text-[11px] text-ink-4">
            {answeredCount} / {total} {pick("yanıtlandı", "answered")}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {session.langMode === "both" ? (
            <ContentLangToggle
              value={viewLocale}
              onChange={setViewLocale}
              pick={pick}
            />
          ) : null}
          <Button size="sm" onClick={onAbort}>
            {pick("Kapat", "Close")}
          </Button>
        </div>
      </header>

      <ProgressStrip
        items={session.items.length}
        answers={session.answers}
        activeIndex={activeIndex}
        onJump={setActiveIndex}
      />

      {item.kind === "mcq" ? (
        <McqCard
          item={item}
          view={viewLocale}
          answer={
            answer && answer.kind === "mcq" ? answer : undefined
          }
          onSelect={handleSelect}
        />
      ) : (
        <OpenCard
          item={item}
          view={viewLocale}
          answer={
            answer && answer.kind === "open" ? answer : undefined
          }
          sessionId={sessionId}
          onSubmitted={(state) => {
            void state;
          }}
        />
      )}

      <div className="flex items-center justify-end">
        <Button
          size="md"
          variant="primary"
          onClick={handleNext}
          disabled={!canAdvance}
        >
          {answeredCount + (answer ? 0 : 1) >= total
            ? pick("Bitir", "Finish")
            : pick("Sonraki", "Next")}
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Button>
      </div>
    </section>
  );
}

function ProgressStrip({
  items,
  answers,
  activeIndex,
  onJump,
}: {
  items: number;
  answers: SessionState["answers"];
  activeIndex: number;
  onJump: (i: number) => void;
}) {
  const map = new Map(answers.map((a) => [a.itemIndex, a]));
  return (
    <div className="flex gap-1">
      {Array.from({ length: items }).map((_, i) => {
        const a = map.get(i);
        const correct =
          a?.kind === "mcq"
            ? a.correct
            : a?.kind === "open"
              ? a.correct === true
              : null;
        return (
          <button
            key={i}
            onClick={() => onJump(i)}
            aria-label={`Soru ${i + 1}`}
            className={cn(
              "h-1.5 flex-1 rounded transition-colors",
              i === activeIndex && "ring-2 ring-accent",
              !a && "bg-paper-3",
              a && correct === true && "bg-[color:var(--moss)]",
              a && correct === false && "bg-[color:var(--err)]",
              a && correct === null && "bg-accent-soft",
            )}
          />
        );
      })}
    </div>
  );
}

function McqCard({
  item,
  view,
  answer,
  onSelect,
}: {
  item: QuizMcqItem;
  view: ViewLocale;
  answer: QuizMcqAnswer | undefined;
  onSelect: (idx: number) => void;
}) {
  const pick = useLocalePick();
  const revealed = answer !== undefined;
  // `correctIndex` is shared across languages — only the displayed strings flip.
  const v = mcqForView(item, view);
  return (
    <Card padding="lg">
      {item.sourceSection ? (
        <div className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-ink-4">
          {item.sourceSection}
        </div>
      ) : null}
      <h2 className="mt-2 font-serif text-[22px] font-normal leading-[1.4] tracking-[-0.005em]">
        {v.q}
      </h2>

      <div
        role="radiogroup"
        aria-label={v.q}
        className="mt-6 space-y-2.5"
      >
        {v.choices.map((choice, idx) => {
          const isSelected = answer?.selectedIndex === idx;
          const isCorrect = idx === item.correctIndex;
          const showCorrect = revealed && isCorrect;
          const showWrong = revealed && isSelected && !isCorrect;
          return (
            <button
              key={idx}
              role="radio"
              aria-checked={isSelected}
              onClick={() => !revealed && onSelect(idx)}
              disabled={revealed}
              className={cn(
                "flex w-full items-start gap-3.5 rounded-lg border px-4 py-3 text-left transition-colors",
                !revealed &&
                  "border-rule bg-paper hover:border-ink-5 hover:bg-paper-2",
                revealed &&
                  !isSelected &&
                  !isCorrect &&
                  "border-rule-soft bg-paper opacity-60",
                showCorrect &&
                  "border-[color:var(--moss)] bg-[color:color-mix(in_srgb,var(--moss)_12%,var(--paper))]",
                showWrong &&
                  "border-[color:var(--err)] bg-[color:color-mix(in_srgb,var(--err)_12%,var(--paper))]",
              )}
            >
              <span
                className={cn(
                  "grid h-6 w-6 shrink-0 place-items-center rounded-full border font-mono text-[11px]",
                  showCorrect &&
                    "border-[color:var(--moss)] text-[color:var(--moss)]",
                  showWrong &&
                    "border-[color:var(--err)] text-[color:var(--err)]",
                  !revealed && "border-rule bg-paper-2 text-ink-3",
                  revealed &&
                    !isSelected &&
                    !isCorrect &&
                    "border-rule text-ink-4",
                )}
              >
                {String.fromCharCode(65 + idx)}
              </span>
              <span className="flex-1 text-[14px] leading-[1.55] text-ink">
                {choice}
              </span>
              {showCorrect ? (
                <Check
                  className="h-4 w-4 text-[color:var(--moss)]"
                  aria-hidden
                />
              ) : null}
              {showWrong ? (
                <X
                  className="h-4 w-4 text-[color:var(--err)]"
                  aria-hidden
                />
              ) : null}
            </button>
          );
        })}
      </div>

      {revealed ? (
        <div className="mt-5 rounded-lg border border-rule-soft bg-paper-2 p-4">
          <div className="flex items-center justify-between">
            <div className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-accent-ink">
              {pick("Açıklama", "Explanation")}
            </div>
            <div
              className={cn(
                "font-mono text-[10.5px] uppercase tracking-[0.08em]",
                answer?.correct
                  ? "text-[color:var(--moss)]"
                  : "text-[color:var(--err)]",
              )}
            >
              {answer?.correct
                ? pick("Doğru", "Correct")
                : pick("Yanlış", "Wrong")}
            </div>
          </div>
          {v.explanation ? (
            <p className="mt-2 text-[13.5px] leading-[1.6] text-ink-2">
              {v.explanation}
            </p>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

function OpenCard({
  item,
  view,
  answer,
  sessionId,
  onSubmitted,
}: {
  item: QuizOpenItem;
  view: ViewLocale;
  answer: QuizOpenAnswer | undefined;
  sessionId: string;
  onSubmitted: (state: SessionState) => void;
}) {
  const pick = useLocalePick();
  const masterKey = useVault((s) => s.masterKey);
  const [text, setText] = useState(answer?.text ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // View-resolved question/rubric: EN falls back to base when no English
  // sibling exists (single-language session or partial translate).
  const vq = view === "en" ? (item.qEn ?? item.q) : item.q;
  const vRubric = view === "en" ? (item.rubricEn ?? item.rubric) : item.rubric;

  useEffect(() => {
    const nextText = answer?.text ?? "";
    queueMicrotask(() => {
      setText(nextText);
      setErr(null);
    });
  }, [item.q, answer?.text]);

  const submitted = answer !== undefined;
  const evaluated = submitted && answer?.correct !== null;

  async function handleSubmit() {
    if (!text.trim()) return;
    if (!masterKey) {
      setErr(
        pick(
          "Önce kasayı aç (Topbar → kilit ikonu).",
          "Unlock the vault first (Topbar → lock icon).",
        ),
      );
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const session = await getQuizSession(sessionId);
      if (!session) {
        setErr(pick("Oturum bulunamadı.", "Session not found."));
        return;
      }
      const itemIndex = session.items.findIndex(
        (it) => it === item || (it.kind === "open" && it.q === item.q),
      );
      if (itemIndex === -1) {
        setErr(pick("Item eşleşmedi.", "Item not matched."));
        return;
      }
      const evalModelId =
        usePrefs.getState().modelBindings.summary ??
        usePrefs.getState().modelBindings.chat;
      const option = findChatOption(evalModelId);
      if (!option) {
        setErr(
          pick(
            `Model bulunamadı: ${evalModelId}`,
            `Model not found: ${evalModelId}`,
          ),
        );
        return;
      }
      const presetId = option.presetId;
      const preset = getPreset(presetId);
      const customEndpoint =
        typeof presetId === "string" && presetId.startsWith("custom:")
          ? findCustomEndpoint(presetId.slice("custom:".length))
          : undefined;
      const baseUrl = customEndpoint?.baseUrl ?? preset?.baseUrl;
      const isLocal = Boolean(baseUrl && isLocalUrl(baseUrl));
      let apiKey = "";
      let authKind: "oauth" | "api-key" | undefined;
      if (!isLocal) {
        const cred = await resolveChatCredentialForPreset(presetId);
        if (!cred) {
          setErr(
            pick(
              "Bu sağlayıcı için API anahtarı bulunamadı.",
              "No API key stored for this provider.",
            ),
          );
          return;
        }
        apiKey = cred.apiKey;
        if (cred.authKind) authKind = cred.authKind;
      }

      // Evaluate against the language the user is reading so the question,
      // rubric, and feedback all stay consistent for "both" sessions.
      const evalLocale: "tr" | "en" =
        view === "en"
          ? "en"
          : ((usePrefs.getState().locale ?? "tr") as "tr" | "en");
      const result = await runQuizEval({
        modelId: evalModelId,
        apiKey,
        ...(authKind ? { authKind } : {}),
        question: vq,
        rubric: vRubric,
        userAnswer: text.trim(),
        locale: evalLocale,
      });
      // Re-read the session before merging — the user may have answered
      // another item while the eval was in flight, and we'd otherwise
      // overwrite their submission with the snapshot we held in memory.
      const latest = await getQuizSession(sessionId);
      const afterSubmit = submitAnswer(
        latest ?? session,
        itemIndex,
        { kind: "open", text: text.trim() },
        Date.now(),
      );
      const afterEval = applyOpenEval(afterSubmit, itemIndex, {
        correct: result.correct,
        feedback: result.feedback,
      });
      await patchQuizAnswers(sessionId, afterEval.answers);
      onSubmitted(afterEval);
    } catch (e) {
      const msg =
        e instanceof QuizEvalError || e instanceof QuizGenError
          ? e.message
          : e instanceof Error
            ? e.message
            : String(e);
      setErr(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card padding="lg">
      {item.sourceSection ? (
        <div className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-ink-4">
          {item.sourceSection}
        </div>
      ) : null}
      <h2 className="mt-2 font-serif text-[22px] font-normal leading-[1.4] tracking-[-0.005em]">
        {vq}
      </h2>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={pick(
          "Cevabını kendi kelimelerinle yaz…",
          "Write your answer in your own words…",
        )}
        rows={6}
        disabled={submitted || busy}
        className="mt-5 w-full resize-y rounded-lg border border-rule bg-paper-2 p-4 text-[14px] leading-[1.6] outline-none transition-colors focus:border-ink-5 disabled:opacity-60"
      />

      {err ? (
        <div className="mt-3 rounded-lg border border-[color:var(--err)] bg-[color:color-mix(in_srgb,var(--err)_10%,var(--paper))] p-3 text-[13px] text-ink-2">
          {err}
        </div>
      ) : null}

      {evaluated && answer ? (
        <div className="mt-5 rounded-lg border border-rule-soft bg-paper-2 p-4">
          <div className="flex items-center justify-between">
            <div className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-accent-ink">
              {pick("Geri bildirim", "Feedback")}
            </div>
            <div
              className={cn(
                "font-mono text-[10.5px] uppercase tracking-[0.08em]",
                answer.correct
                  ? "text-[color:var(--moss)]"
                  : "text-[color:var(--err)]",
              )}
            >
              {answer.correct
                ? pick("Doğru", "Correct")
                : pick("Geliştir", "Needs work")}
            </div>
          </div>
          {answer.feedback ? (
            <p className="mt-2 text-[13.5px] leading-[1.6] text-ink-2">
              {answer.feedback}
            </p>
          ) : null}
          <details className="mt-3">
            <summary className="cursor-pointer font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-3">
              {pick("Rubric", "Rubric")}
            </summary>
            <p className="mt-2 text-[12.5px] leading-[1.55] text-ink-3">
              {vRubric}
            </p>
          </details>
        </div>
      ) : null}

      {!evaluated ? (
        <div className="mt-4 flex items-center justify-end">
          <Button
            size="md"
            variant="primary"
            onClick={handleSubmit}
            disabled={!text.trim() || busy}
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <Sparkles className="h-3.5 w-3.5" aria-hidden />
            )}
            {submitted
              ? pick("Tekrar değerlendir", "Retry evaluation")
              : pick("Değerlendir", "Evaluate")}
          </Button>
        </div>
      ) : null}
    </Card>
  );
}

function SummaryView({
  workspaceId,
  sessionId,
  onRestart,
}: {
  workspaceId: string;
  sessionId: string;
  onRestart: () => void;
}) {
  const pick = useLocalePick();
  const globalLocale = usePrefs((s) => s.locale);
  const session = useLiveQuery(
    () => getQuizSession(sessionId),
    [sessionId],
  );
  const [reportOpen, setReportOpen] = useState(false);
  // Local content-view language for the summary; only surfaced for "both".
  const [viewLocale, setViewLocale] = useState<ViewLocale>(
    globalLocale === "en" ? "en" : "tr",
  );
  const [genState, setGenState] = useState<
    | { kind: "closed" }
    | { kind: "open"; sourceId: string; chunkIds: string[] }
  >({ kind: "closed" });

  if (!session) {
    return (
      <div className="grid place-items-center py-20 text-ink-3">
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
      </div>
    );
  }

  const score = isSessionFinished(session)
    ? (session.score ?? computeScore(session))
    : computeScore(session);
  const correctCount = session.answers.filter(
    (a) =>
      (a.kind === "mcq" && a.correct) ||
      (a.kind === "open" && a.correct === true),
  ).length;

  return (
    <div className="space-y-6">
      <header>
        <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-3">
          {pick("Özet", "Summary")}
        </div>
        <div className="mt-1 flex items-end justify-between gap-4">
          <h1 className="font-serif text-[30px] font-normal leading-tight tracking-[-0.015em]">
            {Math.round(score * 100)}%
          </h1>
          <div className="flex items-center gap-3">
            {session.langMode === "both" ? (
              <ContentLangToggle
                value={viewLocale}
                onChange={setViewLocale}
                pick={pick}
              />
            ) : null}
            <div className="font-mono text-[12px] text-ink-3">
              {correctCount} / {session.items.length}{" "}
              {pick("doğru", "correct")}
            </div>
            <Button size="sm" onClick={() => setReportOpen(true)}>
              <FileText className="h-3.5 w-3.5" aria-hidden />
              {pick("Detaylı rapor", "Detailed report")}
            </Button>
          </div>
        </div>
      </header>

      <div className="space-y-3">
        {session.items.map((item, idx) => {
          if (item.kind !== "mcq") return null;
          const a = session.answers.find((x) => x.itemIndex === idx);
          const isCorrect = a?.kind === "mcq" ? a.correct : false;
          // `correctIndex` is shared — only the displayed strings flip.
          const v = mcqForView(item, viewLocale);
          return (
            <Card key={idx} padding="md">
              <div className="flex items-start gap-3">
                <span
                  className={cn(
                    "mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border font-mono text-[11px]",
                    isCorrect
                      ? "border-[color:var(--moss)] text-[color:var(--moss)]"
                      : "border-[color:var(--err)] text-[color:var(--err)]",
                  )}
                >
                  {isCorrect ? (
                    <Check className="h-3 w-3" aria-hidden />
                  ) : (
                    <X className="h-3 w-3" aria-hidden />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-4">
                    {pick("Soru", "Q")} {idx + 1}
                    {item.sourceSection ? ` · ${item.sourceSection}` : ""}
                  </div>
                  <div className="mt-1 text-[14px] leading-[1.55] text-ink">
                    {v.q}
                  </div>
                  <div className="mt-2 text-[13px] leading-[1.55] text-ink-2">
                    <span className="font-mono text-[10.5px] uppercase text-[color:var(--moss)]">
                      {pick("Doğru cevap", "Correct")}:
                    </span>{" "}
                    {v.choices[item.correctIndex]}
                  </div>
                  {a?.kind === "mcq" &&
                  a.selectedIndex !== null &&
                  a.selectedIndex !== item.correctIndex ? (
                    <div className="mt-1 text-[13px] leading-[1.55] text-ink-2">
                      <span className="font-mono text-[10.5px] uppercase text-[color:var(--err)]">
                        {pick("Seçtiğin", "You picked")}:
                      </span>{" "}
                      {v.choices[a.selectedIndex]}
                    </div>
                  ) : null}
                  {v.explanation ? (
                    <p className="mt-2 text-[12.5px] leading-[1.55] text-ink-3">
                      {v.explanation}
                    </p>
                  ) : null}
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      <div className="flex items-center justify-end gap-2">
        <Button size="md" variant="primary" onClick={onRestart}>
          <RotateCcw className="h-3.5 w-3.5" aria-hidden />
          {pick("Yeni quiz", "New quiz")}
        </Button>
      </div>

      <SessionReportModal
        open={reportOpen}
        sessionId={sessionId}
        onClose={() => setReportOpen(false)}
        onGenerateCards={(chunkIds) => {
          if (!session.sourceId || chunkIds.length === 0) return;
          setReportOpen(false);
          setGenState({
            kind: "open",
            sourceId: session.sourceId,
            chunkIds,
          });
        }}
      />

      {genState.kind === "open" ? (
        <GenerateBatchModal
          open
          onClose={() => setGenState({ kind: "closed" })}
          workspaceId={workspaceId}
          initialSourceId={genState.sourceId}
          mode="batch"
          chunkIds={genState.chunkIds}
        />
      ) : null}
    </div>
  );
}
