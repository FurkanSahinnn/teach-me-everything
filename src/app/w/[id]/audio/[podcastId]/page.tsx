"use client";

import {
  Download,
  Headphones,
  Loader2,
  Pause,
  Play,
  RefreshCw,
} from "lucide-react";
import { notFound } from "next/navigation";
import { useRouteParams } from "@/lib/utils/route-params";
import { useTranslations } from "next-intl";
import { useLocalePick } from "@/i18n/IntlProvider";
import { useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { useToast } from "@/components/ui/Toast";
import {
  usePodcast,
  usePodcastBlob,
  useWorkspace,
} from "@/lib/db/hooks";
import type {
  PodcastChapter,
  PodcastRecord,
  PodcastSegment,
} from "@/lib/podcast/types";
import { synthesizePodcastAudio } from "@/lib/podcast/synthesize";
import { usePrefs } from "@/stores/prefs";
import { cn } from "@/lib/utils/cn";

type Speed = 0.75 | 1 | 1.25 | 1.5;

const SPEED_OPTIONS: Speed[] = [0.75, 1, 1.25, 1.5];

export default function PodcastPage() {
  const params = useRouteParams<{ id: string; podcastId: string }>();
  const workspaceId = params.id;
  const podcastId = params.podcastId;
  const t = useTranslations("audio");
  const tMobile = useTranslations("mobile");
  const pick = useLocalePick();

  const ws = useWorkspace(workspaceId);
  const podcast = usePodcast(podcastId);
  const blobRecord = usePodcastBlob(podcastId);

  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [currentMs, setCurrentMs] = useState(0);
  const [speed, setSpeed] = useState<Speed>(1);
  const audioRef = useRef<HTMLAudioElement>(null);

  // Hold the ObjectURL behind a stable ref so unmount/re-blob can revoke
  // the previous one without leaking. `useEffect` cleanup handles both
  // transitions (new blob arrives, component unmounts).
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blobRecord) {
      queueMicrotask(() => setAudioUrl(null));
      return;
    }
    const url = URL.createObjectURL(blobRecord.blob);
    queueMicrotask(() => setAudioUrl(url));
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [blobRecord]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    el.playbackRate = speed;
  }, [speed]);

  // Split per-variable so TS narrows ws and podcast independently;
  // a combined `||` check leaves the union still `T | null | undefined`
  // because either short-circuit could fire.
  if (ws === undefined || podcast === undefined) {
    return (
      <AppShell workspaceId={workspaceId} breadcrumb={[t("dashboard")]}>
        <div className="mx-auto max-w-[1240px] px-4 pb-20 pt-10 md:px-8">
          <div className="flex items-center gap-2 text-ink-3">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            {t("podcast_loading")}
          </div>
        </div>
      </AppShell>
    );
  }
  if (ws === null || podcast === null) {
    notFound();
  }
  // `notFound()` is typed `never` so control flow never reaches here
  // when either is null, but TS's narrowing of `let`-bound hook
  // values across nested closures is brittle — capture both into
  // typed locals so `pod` / `workspace` stay non-null inside
  // speakerLabel and friends.
  const pod: PodcastRecord = podcast;
  const workspace = ws;

  const totalMs = pod.totalMs ?? 0;
  const isReady = pod.status === "ready" && audioUrl !== null;

  const activeSegmentIdx = findActiveSegment(pod.segments, currentMs);
  const activeChapterIdx = findActiveChapter(pod.chapters, currentMs);
  const activeChapter = pod.chapters[activeChapterIdx];

  function jumpTo(ms: number) {
    const el = audioRef.current;
    if (!el) {
      setCurrentMs(ms);
      return;
    }
    el.currentTime = ms / 1000;
    setCurrentMs(ms);
  }

  function togglePlay() {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) {
      void el.play();
    } else {
      el.pause();
    }
  }

  function speakerLabel(segment: PodcastSegment): string {
    const voice = pod.voices.find((v) => v.speaker === segment.speaker);
    return voice?.name ?? (segment.speaker === "alev" ? "Alev" : "Deniz");
  }

  function speakerAccent(speaker: PodcastSegment["speaker"]): string {
    return speaker === "alev" ? "var(--accent)" : "var(--slate)";
  }

  return (
    <AppShell
      workspaceId={workspaceId}
      breadcrumb={[
        t("dashboard"),
        pick(workspace.name, workspace.nameEn ?? workspace.name),
        t("ses_ozeti"),
      ]}
    >
      <div className="mx-auto max-w-[1240px] px-4 pb-[calc(160px+env(safe-area-inset-bottom))] pt-6 md:px-8 md:pb-20">
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[280px_1fr]">
          {/* Sidebar: chapters + voices */}
          <aside className="hidden space-y-6 lg:block">
            <Card padding="md">
              <h3 className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-3">
                {t("bu_bolumde")}
              </h3>
              {pod.chapters.length === 0 ? (
                <p className="mt-3 text-[12.5px] text-ink-3">
                  {t("no_chapters")}
                </p>
              ) : (
                <div className="mt-3 space-y-1">
                  {pod.chapters.map((c, i) => (
                    <button
                      key={i}
                      onClick={() => jumpTo(c.startMs)}
                      disabled={!isReady}
                      className={cn(
                        "flex w-full items-center gap-3 rounded px-2 py-1.5 text-left text-[12.5px] transition-colors",
                        i === activeChapterIdx
                          ? "bg-accent-soft text-accent-ink"
                          : "text-ink-3 hover:bg-paper-2 hover:text-ink",
                        !isReady && "cursor-not-allowed opacity-60",
                      )}
                    >
                      <span className="w-[44px] shrink-0 font-mono text-[11px]">
                        {formatTimeMs(c.startMs)}
                      </span>
                      <span className="flex-1 truncate">{c.title}</span>
                    </button>
                  ))}
                </div>
              )}
            </Card>

            <Card padding="md">
              <h3 className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-3">
                {t("voices_heading")}
              </h3>
              <div className="mt-3 space-y-1.5">
                {pod.voices.map((v) => (
                  <div
                    key={v.speaker}
                    className="flex items-center justify-between text-[12.5px]"
                  >
                    <span className="truncate text-ink-2">{v.name}</span>
                    <span className="font-mono text-[10px] uppercase text-ink-4">
                      {v.speaker}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          </aside>

          {/* Main column: header + player + transcript */}
          <div>
            <PodcastHeader
              podcast={pod}
              workspaceName={pick(workspace.name, workspace.nameEn ?? workspace.name)}
              totalMs={totalMs}
            />

            <StatusBanner
              podcast={pod}
              podcastId={podcastId}
            />

            {/* Desktop player */}
            <div className="mb-6 hidden rounded-[14px] border border-rule bg-[#1C1A17] p-5 text-paper shadow-[0_18px_42px_-20px_rgba(0,0,0,0.35)] md:block">
              <div className="flex items-center gap-5">
                <button
                  onClick={togglePlay}
                  disabled={!isReady}
                  className={cn(
                    "grid h-14 w-14 shrink-0 place-items-center rounded-full bg-paper text-ink transition-transform hover:scale-105",
                    !isReady && "cursor-not-allowed opacity-50",
                  )}
                  aria-label={playing ? t("duraklat") : t("oynat")}
                >
                  {playing ? (
                    <Pause className="h-5 w-5" aria-hidden />
                  ) : (
                    <Play className="h-5 w-5 translate-x-0.5" aria-hidden />
                  )}
                </button>
                <div className="flex-1">
                  <div className="flex items-center justify-between font-mono text-[11px] text-paper-3">
                    <span>{formatTimeMs(currentMs)}</span>
                    <span className="text-ink-5">
                      {formatTimeMs(totalMs)}
                    </span>
                  </div>
                  <div className="mt-1 flex h-[30px] items-end gap-[2px]">
                    {Array.from({ length: 110 }).map((_, i) => {
                      const pct = i / 110;
                      const played =
                        totalMs > 0 && pct <= currentMs / totalMs;
                      const h = 4 + Math.abs(Math.sin(i * 0.27)) * 18;
                      return (
                        <span
                          key={i}
                          className={cn(
                            "flex-1 rounded-[1px] transition-colors",
                            played ? "bg-accent" : "bg-ink-5/60",
                          )}
                          style={{ height: `${h}px` }}
                        />
                      );
                    })}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1.5">
                  <SegmentedControl<string>
                    value={String(speed)}
                    onChange={(v) => setSpeed(Number(v) as Speed)}
                    tone="inverted"
                    size="sm"
                    mono
                    ariaLabel="Playback speed"
                    options={SPEED_OPTIONS.map((s) => ({
                      value: String(s),
                      label: `${s}×`,
                    }))}
                  />
                  <div className="flex gap-1.5 text-[11px] text-paper-3">
                    <a
                      href={audioUrl ?? undefined}
                      download={`${safeSlug(podcast.title)}.wav`}
                      aria-disabled={!audioUrl}
                      className={cn(
                        "inline-flex items-center gap-1 rounded border border-ink-5 px-2 py-0.5 hover:text-paper",
                        !audioUrl && "pointer-events-none opacity-50",
                      )}
                    >
                      <Download className="h-3 w-3" aria-hidden />
                      {t("indir")}
                    </a>
                  </div>
                </div>
              </div>
            </div>

            {/* Desktop transcript */}
            <Card padding="md" className="hidden md:block">
              <div className="flex items-center justify-between border-b border-rule-soft pb-3">
                <div>
                  <div className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-3">
                    {t("canli_transkript_tr")}
                  </div>
                  <div className="mt-0.5 font-serif text-[17px] font-medium">
                    {activeChapter
                      ? `${t("bolum")} ${activeChapterIdx + 1} · ${activeChapter.title}`
                      : t("no_chapters")}
                  </div>
                </div>
                <Chip>
                  <Headphones className="mr-1 h-3 w-3" aria-hidden />
                  {pod.locale.toUpperCase()}
                </Chip>
              </div>
              <div className="mt-4 space-y-4">
                {pod.segments.length === 0 ? (
                  <p className="text-[13px] text-ink-3">
                    {t("no_transcript")}
                  </p>
                ) : (
                  pod.segments.map((s, i) => (
                    <button
                      key={i}
                      onClick={() => jumpTo(s.startMs ?? 0)}
                      disabled={!isReady}
                      className={cn(
                        "flex w-full gap-4 border-l-2 py-1 pl-4 text-left transition-colors",
                        i === activeSegmentIdx
                          ? "bg-accent-wash/60"
                          : "hover:bg-paper-2",
                        !isReady && "cursor-default",
                      )}
                      style={{ borderColor: speakerAccent(s.speaker) }}
                    >
                      <div className="w-[54px] shrink-0">
                        <div className="font-serif text-[13.5px] font-medium">
                          {speakerLabel(s)}
                        </div>
                        <div className="font-mono text-[10.5px] text-ink-4">
                          {formatTimeMs(s.startMs ?? 0)}
                        </div>
                      </div>
                      <p className="flex-1 text-[14.5px] leading-[1.65] text-ink-2">
                        {s.text}
                      </p>
                    </button>
                  ))
                )}
              </div>
            </Card>
          </div>
        </div>
      </div>

      {/* Mobile sticky bottom player */}
      <div
        className="fixed bottom-0 left-0 right-0 z-30 border-t border-rule bg-bg-elev-1 px-3 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] shadow-[0_-12px_28px_-12px_rgba(0,0,0,0.25)] md:hidden"
        style={{ background: "var(--bg-elev-1, var(--paper-2, #1C1A17))" }}
      >
        <div className="flex items-center gap-3">
          <button
            onClick={togglePlay}
            disabled={!isReady}
            className={cn(
              "grid h-11 w-11 shrink-0 place-items-center rounded-full bg-paper text-ink transition-transform hover:scale-105",
              !isReady && "cursor-not-allowed opacity-50",
            )}
            aria-label={playing ? t("duraklat") : t("oynat")}
          >
            {playing ? (
              <Pause className="h-4 w-4" aria-hidden />
            ) : (
              <Play className="h-4 w-4 translate-x-0.5" aria-hidden />
            )}
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between font-mono text-[10.5px] text-paper-3">
              <span>{formatTimeMs(currentMs)}</span>
              <span className="text-ink-5">{formatTimeMs(totalMs)}</span>
            </div>
            <div className="mt-1 h-1 overflow-hidden rounded bg-ink-5/40">
              <div
                className="h-full bg-accent transition-[width]"
                style={{
                  width: `${totalMs === 0 ? 0 : (currentMs / totalMs) * 100}%`,
                }}
              />
            </div>
          </div>
          <button
            type="button"
            onClick={() => setTranscriptOpen(true)}
            className="shrink-0 rounded-[8px] border border-rule bg-paper px-2.5 py-1.5 text-[11.5px] font-medium text-ink"
            aria-expanded={transcriptOpen}
          >
            {tMobile("podcast_show_transcript")}
          </button>
        </div>
      </div>

      {transcriptOpen ? (
        <div
          className="fixed inset-0 z-40 md:hidden"
          role="dialog"
          aria-modal="true"
        >
          <button
            type="button"
            aria-label={tMobile("podcast_hide_transcript")}
            className="absolute inset-0 bg-ink/50"
            onClick={() => setTranscriptOpen(false)}
          />
          <div className="absolute bottom-0 left-0 right-0 max-h-[80vh] overflow-auto rounded-t-[16px] border-t border-rule bg-paper px-4 pt-3 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-[0_-18px_42px_-20px_rgba(0,0,0,0.45)]">
            <div className="sticky top-0 -mx-4 mb-3 flex items-center justify-between border-b border-rule-soft bg-paper px-4 pb-2 pt-1">
              <div>
                <div className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-3">
                  {t("canli_transkript_tr")}
                </div>
                <div className="mt-0.5 font-serif text-[15px] font-medium">
                  {activeChapter
                    ? `${t("bolum")} ${activeChapterIdx + 1} · ${activeChapter.title}`
                    : t("no_chapters")}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setTranscriptOpen(false)}
                className="rounded-[8px] border border-rule bg-paper-2 px-2.5 py-1 text-[11.5px] text-ink-2"
              >
                {tMobile("podcast_hide_transcript")}
              </button>
            </div>
            <div className="space-y-4 pb-4">
              {pod.segments.map((s, i) => (
                <button
                  key={i}
                  onClick={() => {
                    jumpTo(s.startMs ?? 0);
                    setTranscriptOpen(false);
                  }}
                  disabled={!isReady}
                  className={cn(
                    "flex w-full gap-3 border-l-2 py-1 pl-3 text-left",
                    i === activeSegmentIdx ? "bg-accent-wash/60" : "",
                  )}
                  style={{ borderColor: speakerAccent(s.speaker) }}
                >
                  <div className="w-[48px] shrink-0">
                    <div className="font-serif text-[12.5px] font-medium">
                      {speakerLabel(s)}
                    </div>
                    <div className="font-mono text-[10px] text-ink-4">
                      {formatTimeMs(s.startMs ?? 0)}
                    </div>
                  </div>
                  <p className="flex-1 text-[13.5px] leading-[1.6] text-ink-2">
                    {s.text}
                  </p>
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {audioUrl ? (
        <audio
          ref={audioRef}
          src={audioUrl}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          onTimeUpdate={(e) =>
            setCurrentMs(Math.round(e.currentTarget.currentTime * 1000))
          }
          onLoadedMetadata={(e) => {
            e.currentTarget.playbackRate = speed;
          }}
          preload="metadata"
          className="hidden"
        />
      ) : null}
    </AppShell>
  );
}

function ttsProviderLabel(
  provider: PodcastRecord["ttsProvider"],
): string | null {
  switch (provider) {
    case "piper":
      return "Piper";
    case "web-speech":
      return "Web Speech";
    case "kokoro":
      return "Kokoro";
    case "xtts":
      return "XTTS-v2";
    case "vibevoice":
      return "VibeVoice";
    case "elevenlabs":
      // Legacy rows from pre-Phase-11 podcasts that synthesized via
      // ElevenLabs. Surfaced so the user understands why an old podcast
      // can't be re-synthesized without re-running the generator.
      return "ElevenLabs (legacy)";
    default:
      return null;
  }
}

function PodcastHeader(props: {
  podcast: PodcastRecord;
  workspaceName: string;
  totalMs: number;
}) {
  const t = useTranslations("audio");
  const pick = useLocalePick();
  const { podcast, workspaceName, totalMs } = props;
  const ttsLabel = ttsProviderLabel(podcast.ttsProvider);
  const minutes = Math.max(1, Math.round(totalMs / 60_000));
  const subtitleParts: string[] = [
    podcast.voices.map((v) => v.name).join(" & "),
    pick(`${minutes} dakika`, `${minutes} min`),
    new Date(podcast.createdAt).toLocaleDateString(
      pick("tr-TR", "en-US"),
      { day: "2-digit", month: "long", year: "numeric" },
    ),
    ...(ttsLabel ? [ttsLabel] : []),
  ];
  const disclosure = podcast.audioDisclosure;
  return (
    <header className="mb-6">
      <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-3">
        {workspaceName} · {t("iki_sunuculu_podcast")}
      </div>
      <h1 className="mt-1.5 font-serif text-[34px] font-normal leading-tight tracking-[-0.015em]">
        {pick(podcast.title, podcast.titleEn ?? podcast.title)}
      </h1>
      <p className="mt-2 text-[14px] text-ink-3">
        {subtitleParts.join(" · ")}
      </p>
      {disclosure ? (
        <div className="mt-3">
          <Chip size="sm" variant="warn">
            {pick("AI ile oluşturulmuş ses", disclosure.label)}
          </Chip>
        </div>
      ) : null}
      {podcast.description ? (
        <p className="mt-3 max-w-[640px] text-[13.5px] leading-[1.6] text-ink-2">
          {podcast.description}
        </p>
      ) : null}
    </header>
  );
}

function StatusBanner(props: {
  podcast: PodcastRecord;
  podcastId: string;
}) {
  const { podcast, podcastId } = props;
  const t = useTranslations("audio");
  const pick = useLocalePick();
  const { toast } = useToast();
  const ttsProvider = usePrefs((s) => s.ttsProvider);
  const [retrying, setRetrying] = useState(false);

  if (podcast.status === "ready") return null;

  async function retry() {
    setRetrying(true);
    try {
      await synthesizePodcastAudio({ podcastId, providerId: ttsProvider });
      toast({
        variant: "success",
        description: pick("Podcast hazır.", "Podcast ready."),
      });
    } catch (err) {
      toast({
        variant: "error",
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setRetrying(false);
    }
  }

  const isWorking =
    podcast.status === "scripting" ||
    podcast.status === "synthesizing" ||
    retrying;

  let label: string;
  switch (podcast.status) {
    case "scripting":
      label = t("status_scripting");
      break;
    case "scripted":
      label = t("status_scripted");
      break;
    case "synthesizing":
      label = t("status_synthesizing");
      break;
    case "error":
      label =
        podcast.errorMessage ??
        pick("Bilinmeyen hata.", "Unknown error.");
      break;
    case "draft":
    default:
      label = t("status_draft");
  }

  return (
    <div className="mb-6 flex items-center gap-3 rounded-[10px] border border-rule bg-paper-2 px-4 py-3 text-[13px]">
      {isWorking ? (
        <Loader2 className="h-4 w-4 animate-spin text-ink-3" aria-hidden />
      ) : (
        <Headphones className="h-4 w-4 text-ink-3" aria-hidden />
      )}
      <span className="flex-1 text-ink-2">{label}</span>
      {podcast.status === "scripted" || podcast.status === "error" ? (
        <button
          type="button"
          onClick={() => void retry()}
          disabled={retrying}
          className="inline-flex items-center gap-1.5 rounded border border-rule px-2.5 py-1 text-[12px] text-ink-2 hover:bg-paper-3"
        >
          <RefreshCw className="h-3 w-3" aria-hidden />
          {podcast.status === "error" ? t("retry") : t("synthesize")}
        </button>
      ) : null}
    </div>
  );
}

function findActiveChapter(
  chapters: PodcastChapter[],
  currentMs: number,
): number {
  let idx = 0;
  for (let i = 0; i < chapters.length; i += 1) {
    if (currentMs >= (chapters[i]?.startMs ?? 0)) idx = i;
  }
  return idx;
}

function findActiveSegment(
  segments: PodcastSegment[],
  currentMs: number,
): number {
  let idx = 0;
  for (let i = 0; i < segments.length; i += 1) {
    const start = segments[i]?.startMs;
    if (typeof start !== "number") continue;
    if (currentMs >= start) idx = i;
  }
  return idx;
}

function formatTimeMs(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

function safeSlug(title: string): string {
  return (
    title
      .normalize("NFKD")
      .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "podcast"
  );
}
