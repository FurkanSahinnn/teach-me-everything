"use client";

import { Headphones, Loader2, Mic, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { useToast } from "@/components/ui/Toast";
import { useLocalePick } from "@/i18n/IntlProvider";
import { resolveChatCredentialForPreset } from "@/lib/ai/anthropic-credential";
import { findChatOption } from "@/lib/ai/model-options";
import {
  estimatePodcastScriptCost,
  generatePodcastScript,
  PodcastGenError,
  type PodcastGenSource,
} from "@/lib/ai/podcast-generation";
import { listChunksBySource } from "@/lib/db/chunks";
import { useSources } from "@/lib/db/hooks";
import { getAdapter, type TtsReadinessState } from "@/lib/podcast/adapter";
import {
  buildVoicesFromPicks,
  getDefaultVoicePicks,
  listVoicesForSpeaker,
} from "@/lib/podcast/voices";
import { listInstalledVoices } from "@/lib/podcast/install";
import { synthesizePodcastAudio } from "@/lib/podcast/synthesize";
import { InstallModelModal } from "@/components/podcast/InstallModelModal";
import { usePrefs } from "@/stores/prefs";
import { cn } from "@/lib/utils/cn";

type Props = {
  open: boolean;
  onClose: () => void;
  workspaceId: string;
  workspace: { name: string; goal?: string | undefined };
};

const DURATION_OPTIONS: Array<{ value: 10 | 15 | 20 | 30; label: string }> = [
  { value: 10, label: "10 dk" },
  { value: 15, label: "15 dk" },
  { value: 20, label: "20 dk" },
  { value: 30, label: "30 dk" },
];

// Conservative output-token estimate per minute of finished podcast.
// Tracks the runner's `targetTurns` (~11 turns/min) × ~28 tokens/turn.
// Capped by the runner's `maxTokens` (8000) at the cost step below.
const OUTPUT_TOKENS_PER_MIN = 11 * 28;

// Rough chars-to-tokens ratio for Anthropic models (1 token ≈ 4 chars
// for English/Turkish mixed prose).
const CHARS_PER_TOKEN = 4;

type Phase =
  | "idle"
  | "checking-readiness"
  | "install-required"
  | "scripting"
  | "repairing-script"
  | "synthesizing"
  | "error";

export function GenerateScriptModal({
  open,
  onClose,
  workspaceId,
  workspace,
}: Props) {
  const pick = useLocalePick();
  const t = useTranslations("podcast_modal");
  const router = useRouter();
  const { toast } = useToast();
  const sourceRows = useSources(workspaceId);
  const ttsProvider = usePrefs((s) => s.ttsProvider);
  // The script runner uses the user's heaviest chat tier — `chat` is
  // the deepest binding ModelBindings exposes today (no explicit
  // `deep` field), and defaults to Sonnet (Opus optional).
  const modelId = usePrefs((s) => s.modelBindings.chat);
  const locale = usePrefs((s) => s.locale);
  const chatOption = useMemo(() => findChatOption(modelId), [modelId]);

  const readySources = useMemo(
    () => (sourceRows ?? []).filter((s) => s.ingestStatus === "ready"),
    [sourceRows],
  );

  const defaultPicks = useMemo(
    () => getDefaultVoicePicks(ttsProvider),
    [ttsProvider],
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [duration, setDuration] = useState<10 | 15 | 20 | 30>(15);
  const [alevPick, setAlevPick] = useState<string>(defaultPicks.alev);
  const [denizPick, setDenizPick] = useState<string>(defaultPicks.deniz);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState<{ idx: number; total: number } | null>(
    null,
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [readiness, setReadiness] = useState<TtsReadinessState | null>(null);
  const cancelRef = useRef<AbortController | null>(null);

  // Phase 11.C — Restrict the voice picker to voices actually on disk so
  // the user never picks a name that will fail at synthesis time. Web Speech
  // is exempt because it uses the browser's built-in voice catalog.
  const [installedSet, setInstalledSet] = useState<Set<string>>(new Set());
  const [installedLoaded, setInstalledLoaded] = useState(false);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setInstalledLoaded(false);
    });
    void (async () => {
      try {
        const all = await listInstalledVoices();
        if (cancelled) return;
        const next = new Set(
          all.filter((v) => v.provider === ttsProvider).map((v) => v.voiceId),
        );
        setInstalledSet(next);
      } catch {
        if (!cancelled) setInstalledSet(new Set());
      } finally {
        if (!cancelled) setInstalledLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, ttsProvider]);

  const alevPresets = useMemo(() => {
    const all = listVoicesForSpeaker(ttsProvider, "alev");
    if (ttsProvider === "web-speech") return all;
    return all.filter((v) => installedSet.has(v.voiceId));
  }, [ttsProvider, installedSet]);
  const denizPresets = useMemo(() => {
    const all = listVoicesForSpeaker(ttsProvider, "deniz");
    if (ttsProvider === "web-speech") return all;
    return all.filter((v) => installedSet.has(v.voiceId));
  }, [ttsProvider, installedSet]);

  // Refresh the voice picks whenever the active provider changes or
  // installed list arrives — a voiceId picked for one provider would be a
  // dead string for another, and the catalog default may not be on disk.
  useEffect(() => {
    if (!installedLoaded && ttsProvider !== "web-speech") return;
    // Prefer the catalog default if it's installed (or web-speech); else
    // fall back to the first installed voice for that speaker.
    const alevFallback = alevPresets[0]?.voiceId ?? "";
    const denizFallback = denizPresets[0]?.voiceId ?? "";
    const useAlevDefault =
      ttsProvider === "web-speech" || installedSet.has(defaultPicks.alev);
    const useDenizDefault =
      ttsProvider === "web-speech" || installedSet.has(defaultPicks.deniz);
    queueMicrotask(() => {
      setAlevPick(useAlevDefault ? defaultPicks.alev : alevFallback);
      setDenizPick(useDenizDefault ? defaultPicks.deniz : denizFallback);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultPicks.alev, defaultPicks.deniz, installedLoaded, ttsProvider, installedSet]);

  // Preselect every ready source on open. Keeps the most common case
  // (whole-workspace podcast) one click away.
  useEffect(() => {
    if (!open) return;
    queueMicrotask(() => {
      setSelectedIds(new Set(readySources.map((s) => s.id)));
      setPhase("idle");
      setProgress(null);
      setErrorMessage(null);
    });
  }, [open, readySources]);

  const [sourceCharsBySource, setSourceCharsBySource] = useState<
    Map<string, number>
  >(new Map());
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      const result = new Map<string, number>();
      for (const src of readySources) {
        const chunks = await listChunksBySource(src.id);
        let chars = 0;
        for (const c of chunks) chars += c.text.length;
        result.set(src.id, chars);
      }
      if (!cancelled) setSourceCharsBySource(result);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, readySources]);

  const totalSelectedChars = useMemo(() => {
    let total = 0;
    for (const id of selectedIds) total += sourceCharsBySource.get(id) ?? 0;
    return total;
  }, [selectedIds, sourceCharsBySource]);

  const estimatedScriptUsd = useMemo(() => {
    const inputTokens = Math.ceil(totalSelectedChars / CHARS_PER_TOKEN);
    const outputTokens = Math.min(8000, OUTPUT_TOKENS_PER_MIN * duration);
    return estimatePodcastScriptCost(chatOption?.modelId ?? modelId, {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
    });
  }, [totalSelectedChars, duration, chatOption, modelId]);

  const canGenerate =
    phase === "idle" &&
    selectedIds.size > 0 &&
    !!chatOption &&
    alevPresets.some((p) => p.voiceId === alevPick) &&
    denizPresets.some((p) => p.voiceId === denizPick);

  function toggleSource(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function buildGenSources(): Promise<PodcastGenSource[]> {
    const result: PodcastGenSource[] = [];
    for (const src of readySources) {
      if (!selectedIds.has(src.id)) continue;
      const chunks = await listChunksBySource(src.id);
      result.push({
        id: src.id,
        title: src.title,
        ...(src.titleEn !== undefined ? { titleEn: src.titleEn } : {}),
        type: src.type,
        ...(src.author !== undefined ? { author: src.author } : {}),
        chunks: chunks.map((c) => ({
          id: c.id,
          index: c.index,
          ...(c.section !== undefined ? { section: c.section } : {}),
          ...(c.headings !== undefined ? { headings: c.headings } : {}),
          text: c.text,
          ...(c.page !== undefined ? { page: c.page } : {}),
        })),
      });
    }
    return result;
  }

  async function runPipeline(): Promise<void> {
    if (!chatOption) return;
    setPhase("checking-readiness");
    setReadiness(null);
    let adapterReadiness: TtsReadinessState;
    try {
      const adapter = getAdapter(ttsProvider);
      adapterReadiness = await adapter.checkReadiness();
    } catch (err) {
      setPhase("error");
      setErrorMessage(err instanceof Error ? err.message : String(err));
      return;
    }
    if (adapterReadiness.kind !== "ready") {
      setReadiness(adapterReadiness);
      setPhase("install-required");
      return;
    }

    const chatCred = await resolveChatCredentialForPreset(chatOption.presetId);
    if (!chatCred) {
      setPhase("idle");
      toast({
        variant: "error",
        description: pick(
          "Sohbet sağlayıcı anahtarı bulunamadı.",
          "Chat provider key missing.",
        ),
      });
      return;
    }

    const ctrl = new AbortController();
    cancelRef.current = ctrl;
    setErrorMessage(null);
    setPhase("scripting");
    setProgress(null);

    try {
      const genSources = await buildGenSources();
      if (genSources.length === 0) {
        throw new Error(
          pick(
            "Seçili kaynaklarda chunk bulunamadı.",
            "Selected sources have no chunks.",
          ),
        );
      }

      const voices = buildVoicesFromPicks({
        providerId: ttsProvider,
        picks: { alev: alevPick, deniz: denizPick },
      });

      const scriptResult = await generatePodcastScript({
        workspaceId,
        workspace,
        sources: genSources,
        modelId,
        apiKey: chatCred.apiKey,
        ...(chatCred.authKind ? { authKind: chatCred.authKind } : {}),
        locale,
        voices,
        durationMin: duration,
        signal: ctrl.signal,
        onRepairAttempt: () => {
          if (!ctrl.signal.aborted) setPhase("repairing-script");
        },
      });

      if (ctrl.signal.aborted) return;

      setPhase("synthesizing");
      setProgress({ idx: 0, total: scriptResult.podcast.segments.length });
      await synthesizePodcastAudio({
        podcastId: scriptResult.podcast.id,
        providerId: ttsProvider,
        signal: ctrl.signal,
        onSegment: ({ index, total }) => {
          setProgress({ idx: index + 1, total });
        },
      });

      if (ctrl.signal.aborted) return;

      toast({
        variant: "success",
        description: pick("Podcast hazır.", "Podcast is ready."),
      });
      onClose();
      router.push(`/w/${workspaceId}/audio/${scriptResult.podcast.id}`);
    } catch (err) {
      if (ctrl.signal.aborted) {
        setPhase("idle");
        return;
      }
      const message = formatGenerationError(err);
      setErrorMessage(message);
      setPhase("error");
      toast({ variant: "error", description: message });
    } finally {
      cancelRef.current = null;
    }
  }

  function handleCancel() {
    cancelRef.current?.abort();
    cancelRef.current = null;
    setPhase("idle");
    setProgress(null);
  }

  function handleClose() {
    if (
      phase === "scripting" ||
      phase === "repairing-script" ||
      phase === "synthesizing"
    ) {
      return;
    }
    onClose();
  }

  function formatGenerationError(err: unknown): string {
    if (err instanceof PodcastGenError && err.code === "parse_error") {
      return pick(
        `Podcast senaryosu geçerli JSON olarak üretilemedi. Bir kez otomatik onarım denendi. Ayrıntı: ${err.message}`,
        `The podcast script could not be generated as valid JSON. An automatic repair was tried once. Detail: ${err.message}`,
      );
    }
    if (err instanceof PodcastGenError) {
      return `${err.code}: ${err.message}`;
    }
    return err instanceof Error ? err.message : String(err);
  }

  return (
    <>
      <Modal
        open={open}
        onClose={handleClose}
        size="lg"
        title={
          <span className="inline-flex items-center gap-2">
            <Headphones className="h-4 w-4" aria-hidden />
            {t("title")}
          </span>
        }
        description={t("description")}
        closeOnBackdrop={phase === "idle" || phase === "error"}
      >
        <div className="space-y-5">
          {/* Source selector */}
          <section>
            <h3 className="mb-2 font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-3">
              {t("sources_heading")}
            </h3>
            {readySources.length === 0 ? (
              <p className="rounded-[8px] border border-rule-soft bg-paper-2 px-3 py-2 text-[12.5px] text-ink-3">
                {t("no_ready_sources")}
              </p>
            ) : (
              <ul className="max-h-[160px] space-y-1 overflow-auto rounded-[8px] border border-rule-soft bg-paper-2 p-2">
                {readySources.map((src) => {
                  const checked = selectedIds.has(src.id);
                  return (
                    <li key={src.id}>
                      <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-[12.5px] hover:bg-paper">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleSource(src.id)}
                          disabled={phase !== "idle" && phase !== "error"}
                        />
                        <span className="flex-1 truncate text-ink-2">
                          {pick(src.title, src.titleEn ?? src.title)}
                        </span>
                        <span className="font-mono text-[10px] uppercase text-ink-4">
                          {src.type}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* Duration */}
          <section>
            <h3 className="mb-2 font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-3">
              {t("duration_heading")}
            </h3>
            <SegmentedControl<string>
              value={String(duration)}
              onChange={(v) => setDuration(Number(v) as 10 | 15 | 20 | 30)}
              options={DURATION_OPTIONS.map((o) => ({
                value: String(o.value),
                label: o.label,
              }))}
              size="sm"
            />
          </section>

          {/* Voices */}
          <section className="space-y-3">
            <h3 className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-3">
              {t("voices_heading")}
            </h3>
            {!installedLoaded && ttsProvider !== "web-speech" ? (
              <p className="rounded-[8px] border border-rule-soft bg-paper-2 px-3 py-2 text-[12.5px] text-ink-3">
                {pick(
                  "Kurulu sesler yükleniyor…",
                  "Loading installed voices…",
                )}
              </p>
            ) : alevPresets.length === 0 && denizPresets.length === 0 ? (
              <p className="rounded-[8px] border border-rule-soft bg-paper-2 px-3 py-2 text-[12.5px] text-ink-3">
                {pick(
                  "Bu sağlayıcı için kurulu ses yok. ",
                  "No installed voices for this provider. ",
                )}
                <a
                  href="/settings#models"
                  className="font-medium text-accent-ink underline"
                >
                  {pick(
                    "Ayarlar → Modeller'den bir ses kur.",
                    "Install a voice from Settings → Models.",
                  )}
                </a>
              </p>
            ) : null}
            {alevPresets.length > 0 ? (
              <div>
                <div className="mb-1 text-[12px] text-ink-3">
                  {t("alev_voice")}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {alevPresets.map((p) => (
                    <VoiceChipButton
                      key={p.voiceId}
                      selected={p.voiceId === alevPick}
                      disabled={phase !== "idle" && phase !== "error"}
                      onClick={() => setAlevPick(p.voiceId)}
                      name={p.name}
                    />
                  ))}
                </div>
              </div>
            ) : null}
            {denizPresets.length > 0 ? (
              <div>
                <div className="mb-1 text-[12px] text-ink-3">
                  {t("deniz_voice")}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {denizPresets.map((p) => (
                    <VoiceChipButton
                      key={p.voiceId}
                      selected={p.voiceId === denizPick}
                      disabled={phase !== "idle" && phase !== "error"}
                      onClick={() => setDenizPick(p.voiceId)}
                      name={p.name}
                    />
                  ))}
                </div>
              </div>
            ) : null}
          </section>

          {/* Cost preview — script only; TTS is local + free in Phase 11. */}
          <section className="rounded-[8px] border border-rule-soft bg-paper-2 px-3 py-2.5 text-[12px] text-ink-2">
            <div className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-3">
              {t("cost_heading")}
            </div>
            <div className="mt-1 flex items-center justify-between">
              <span>{t("cost_script")}</span>
              <span className="font-mono">
                ≈ ${estimatedScriptUsd.toFixed(2)}
              </span>
            </div>
            <div className="mt-0.5 flex items-center justify-between">
              <span>
                {pick("Seslendirme (yerel)", "Synthesis (local)")}
              </span>
              <span className="font-mono">{pick("ücretsiz", "free")}</span>
            </div>
          </section>

          {/* Phase / progress */}
          {phase === "checking-readiness" ? (
            <div className="flex items-center gap-2 rounded-[8px] border border-rule-soft bg-paper-2 px-3 py-2 text-[12.5px] text-ink-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              {pick("Ses modeli kontrol ediliyor…", "Checking voice model…")}
            </div>
          ) : null}
          {phase === "scripting" ? (
            <div className="flex items-center gap-2 rounded-[8px] border border-rule-soft bg-paper-2 px-3 py-2 text-[12.5px] text-ink-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              {t("phase_scripting")}
            </div>
          ) : null}
          {phase === "repairing-script" ? (
            <div className="flex items-center gap-2 rounded-[8px] border border-rule-soft bg-paper-2 px-3 py-2 text-[12.5px] text-ink-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              {pick(
                "Model yanıtı JSON'a dönüştürülüyor…",
                "Repairing model response into JSON…",
              )}
            </div>
          ) : null}
          {phase === "synthesizing" && progress ? (
            <div className="space-y-1.5 rounded-[8px] border border-rule-soft bg-paper-2 px-3 py-2 text-[12.5px] text-ink-2">
              <div className="flex items-center gap-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                {t("phase_synthesizing", {
                  done: progress.idx,
                  total: progress.total,
                })}
              </div>
              <div className="h-1 overflow-hidden rounded bg-ink-5/40">
                <div
                  className="h-full bg-accent transition-[width]"
                  style={{
                    width: `${progress.total === 0 ? 0 : (progress.idx / progress.total) * 100}%`,
                  }}
                />
              </div>
            </div>
          ) : null}
          {phase === "error" && errorMessage ? (
            <div className="rounded-[8px] border border-rule bg-paper-2 px-3 py-2 text-[12.5px] text-red-600">
              {errorMessage}
            </div>
          ) : null}

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-1">
            {phase === "scripting" ||
            phase === "repairing-script" ||
            phase === "synthesizing" ? (
              <Button variant="ghost" onClick={handleCancel}>
                {t("cancel")}
              </Button>
            ) : (
              <Button variant="ghost" onClick={handleClose}>
                {t("close")}
              </Button>
            )}
            <Button
              variant="primary"
              disabled={!canGenerate}
              onClick={() => void runPipeline()}
            >
              <Sparkles className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              {phase === "error" ? t("retry") : t("generate")}
            </Button>
          </div>
        </div>
      </Modal>

      <InstallModelModal
        open={phase === "install-required"}
        providerId={ttsProvider}
        readiness={readiness}
        onClose={() => setPhase("idle")}
        onInstalled={() => {
          setPhase("idle");
          void runPipeline();
        }}
      />
    </>
  );
}

function VoiceChipButton(props: {
  selected: boolean;
  disabled: boolean;
  onClick: () => void;
  name: string;
}) {
  const { selected, disabled, onClick, name } = props;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      className={cn(
        "inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-[12px] transition-colors",
        selected
          ? "border-accent bg-accent-wash text-accent-ink"
          : "border-rule bg-paper-2 text-ink-2 hover:bg-paper-3",
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
      )}
    >
      <Mic className="h-3 w-3" aria-hidden />
      {name}
    </button>
  );
}
