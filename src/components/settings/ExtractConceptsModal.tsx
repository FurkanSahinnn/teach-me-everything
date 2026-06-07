"use client";

import { Loader2, Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { useToast } from "@/components/ui/Toast";
import { useLocalePick } from "@/i18n/IntlProvider";
import {
  ConceptExtractError,
  estimateConceptExtractCost,
  extractConcepts,
} from "@/lib/ai/concept-extraction";
import {
  defaultContentLangMode,
  deriveGenLocale,
  type ContentLangMode,
} from "@/lib/ai/content-language";
import { findChatOption } from "@/lib/ai/model-options";
import { resolveChatCredentialForPreset } from "@/lib/ai/anthropic-credential";
import { listChunksBySource } from "@/lib/db/chunks";
import { useSources } from "@/lib/db/hooks";
import { isLocalUrl } from "@/lib/ai/providers/local-bypass";
import { getPreset } from "@/lib/ai/providers/presets";
import { findCustomEndpoint, usePrefs } from "@/stores/prefs";
import { useVault } from "@/stores/vault";

const ALL = "__all__";

type Props = {
  open: boolean;
  onClose: () => void;
  workspaceId: string;
};

export function ExtractConceptsModal({ open, onClose, workspaceId }: Props) {
  const pick = useLocalePick();
  const { toast } = useToast();
  const sources = useSources(workspaceId) ?? [];
  const masterKey = useVault((s) => s.masterKey);
  const modelId = usePrefs((s) => s.modelBindings.summary);
  const locale = usePrefs((s) => s.locale);
  const aiResponseLocale = usePrefs((s) => s.aiResponseLocale);

  const [scope, setScope] = useState<string>(ALL);
  // Content language for this extraction. Defaults to the user's output-locale
  // settings (explicit AI-response locale wins, else UI locale).
  const [langMode, setLangMode] = useState<ContentLangMode>(() =>
    defaultContentLangMode(aiResponseLocale, locale),
  );
  const [estimateTokens, setEstimateTokens] = useState(0);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number }>({
    done: 0,
    total: 0,
  });
  const cancelRef = useRef<AbortController | null>(null);

  // Re-seed the language mode from current prefs each time the modal opens, so
  // a stale choice from a previous run doesn't leak in. Render-phase reset
  // (React's documented pattern) rather than an effect.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setLangMode(defaultContentLangMode(aiResponseLocale, locale));
  }

  const readySources = useMemo(
    () => sources.filter((s) => s.ingestStatus === "ready"),
    [sources],
  );

  // Preview token cost for the selected scope. Charged input tokens approximate
  // the chunk text the prompt will see; output is bounded by maxTokens (~2k).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      const targets =
        scope === ALL ? readySources : readySources.filter((s) => s.id === scope);
      let chars = 0;
      for (const s of targets) {
        const chunks = await listChunksBySource(s.id);
        for (const c of chunks) chars += c.text.length;
      }
      if (cancelled) return;
      setEstimateTokens(Math.ceil(chars / 4) + 500);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, scope, readySources]);

  const chatOption = useMemo(() => findChatOption(modelId), [modelId]);
  const presetId = chatOption?.presetId;
  const preset = presetId ? getPreset(presetId) : undefined;
  const customEndpoint =
    typeof presetId === "string" && presetId.startsWith("custom:")
      ? findCustomEndpoint(presetId.slice("custom:".length))
      : undefined;
  const baseUrl = customEndpoint?.baseUrl ?? preset?.baseUrl;
  const isLocal = Boolean(baseUrl && isLocalUrl(baseUrl));
  const isVaultLocked = !masterKey;

  const estimatedCost = useMemo(() => {
    return estimateConceptExtractCost(chatOption?.modelId ?? modelId, {
      input_tokens: estimateTokens,
      // Soft estimate — model rarely hits the cap.
      output_tokens: 1500,
    });
  }, [chatOption?.modelId, modelId, estimateTokens]);

  const canRun =
    !running &&
    Boolean(chatOption) &&
    readySources.length > 0 &&
    (isLocal || !isVaultLocked);

  async function handleRun(): Promise<void> {
    if (!canRun || !chatOption) return;
    setRunning(true);
    setProgress({ done: 0, total: 0 });
    const ctl = new AbortController();
    cancelRef.current = ctl;
    try {
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
      // Map the picker choice to generation params: the single language the
      // canonical extraction runs in, whether to keep English terms, and (for
      // "both") which language to translate the result into afterwards.
      const { primary, keepEnglishTerms, translateTo } = deriveGenLocale(
        langMode,
        locale,
      );
      const args = {
        workspaceId,
        ...(scope !== ALL ? { sourceId: scope } : {}),
        modelId,
        apiKey,
        ...(authKind ? { authKind } : {}),
        locale: primary,
        ...(keepEnglishTerms ? { keepEnglishTerms } : {}),
        ...(translateTo ? { translateTo } : {}),
        sources: readySources.map((s) => ({
          id: s.id,
          title: s.title,
          ...(s.titleEn !== undefined ? { titleEn: s.titleEn } : {}),
          ...(s.author !== undefined ? { author: s.author } : {}),
          type: s.type,
        })),
        signal: ctl.signal,
        onProgress: (done: number, total: number) =>
          setProgress({ done, total }),
      };
      const result = await extractConcepts(args);
      if (result.translatePartial) {
        toast({
          variant: "info",
          title: pick("Kısmi çeviri", "Partial translation"),
          description: pick(
            "Bazı konseptler çevrilemedi; kaynak dilinde bırakıldı.",
            "Some concepts couldn't be translated and kept the source language.",
          ),
        });
      }
      toast({
        variant: "success",
        title: pick("Konseptler çıkarıldı", "Concepts extracted"),
        description: `${result.concepts.length} ${pick(
          "konsept",
          "concepts",
        )} · ${result.edges.length} ${pick("kenar", "edges")} · ~$${result.estimatedCostUsd.toFixed(4)}`,
      });
      onClose();
    } catch (err) {
      const message =
        err instanceof ConceptExtractError
          ? `${err.code}: ${err.message}`
          : err instanceof Error
            ? err.message
            : String(err);
      if (
        err instanceof ConceptExtractError &&
        err.code === "aborted"
      ) {
        toast({
          variant: "info",
          title: pick("İptal edildi", "Cancelled"),
          description: message,
        });
      } else {
        toast({
          variant: "error",
          title: pick("Çıkarma başarısız", "Extraction failed"),
          description: message,
        });
      }
    } finally {
      setRunning(false);
      cancelRef.current = null;
    }
  }

  function handleCancel(): void {
    cancelRef.current?.abort();
  }

  return (
    <Modal
      open={open}
      onClose={running ? () => {} : onClose}
      size="lg"
      title={
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-accent" aria-hidden />
          {pick("Konseptleri çıkar", "Extract concepts")}
        </div>
      }
      description={pick(
        "Mevcut grafik tamamen yenilenir. Eski concepts ve edges silinir.",
        "The existing graph is replaced wholesale. Old concepts and edges are deleted.",
      )}
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
              onClick={() => void handleRun()}
              disabled={!canRun}
            >
              {running ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <Sparkles className="h-3.5 w-3.5" aria-hidden />
              )}
              {running
                ? pick("Çıkarılıyor…", "Extracting…")
                : pick("Çıkar", "Extract")}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        {readySources.length === 0 ? (
          <div className="rounded border border-dashed border-rule bg-paper-2 p-4 text-center text-[13px] text-ink-3">
            {pick(
              "Bu workspace'de hazır kaynak yok.",
              "No ready sources in this workspace.",
            )}
          </div>
        ) : (
          <div>
            <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.06em] text-ink-3">
              {pick("Kapsam", "Scope")}
            </div>
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              className="w-full rounded-md border border-rule bg-paper px-3 py-2 text-[13.5px] text-ink focus:border-ink-5 focus:outline-none"
              disabled={running}
            >
              <option value={ALL}>
                {pick("Tüm kaynaklar (workspace)", "All sources (workspace)")}
              </option>
              {readySources.map((s) => (
                <option key={s.id} value={s.id}>
                  {pick(s.title, s.titleEn ?? s.title)}
                </option>
              ))}
            </select>
          </div>
        )}

        {readySources.length > 0 ? (
          <div>
            <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.06em] text-ink-3">
              {pick("İçerik dili", "Content language")}
            </div>
            <SegmentedControl<ContentLangMode>
              value={langMode}
              onChange={setLangMode}
              size="sm"
              ariaLabel={pick("İçerik dili", "Content language")}
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
            <div className="mt-1.5 text-[11.5px] text-ink-4">
              {langMode === "both"
                ? pick(
                    "Konseptler hem Türkçe hem İngilizce üretilir; haritada tek tıkla geçiş yapabilirsin. (~2× üretim maliyeti.)",
                    "Concepts are produced in both Turkish and English; switch with one click on the map. (~2× generation cost.)",
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
            </div>
          </div>
        ) : null}

        <div className="rounded border border-rule bg-paper-2 p-3 text-[12px] text-ink-3">
          <div className="flex items-center justify-between gap-3">
            <span>
              {pick("Model", "Model")}:{" "}
              <code className="font-mono text-[11px] text-ink">
                {chatOption?.label ?? modelId}
              </code>
            </span>
            <span className="font-mono text-[11px]">
              ~{estimateTokens.toLocaleString()}{" "}
              {pick("girdi tokenı", "input tokens")}
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

        {running && progress.total > 0 ? (
          <div>
            <div className="mb-1 flex items-center justify-between text-[11px] font-mono text-ink-3">
              <span>{pick("İlerleme", "Progress")}</span>
              <span>
                {progress.done} / {progress.total}
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded bg-paper-3">
              <div
                className="h-full bg-accent transition-[width] duration-200"
                style={{
                  width: `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%`,
                }}
              />
            </div>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
