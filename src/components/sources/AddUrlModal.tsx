"use client";

import { Globe, Link2, Loader2, Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { useLocalePick } from "@/i18n/IntlProvider";
import { listResearchOptions } from "@/lib/ai/model-options";
import {
  researchKeyProvider,
  researchProviderRequiresKey,
  resolveResearchCredential,
} from "@/lib/research/credential";
import { ingestResearchUrl } from "@/lib/research/ingest";
import { hasApiKey } from "@/lib/db/api-keys-repo";
import { ResearchError } from "@/lib/research/providers/types";
import { classifyUrl, type ClassifiedUrl } from "@/lib/research/url-classifier";
import type { ResearchProviderId } from "@/lib/research/providers/types";
import { usePrefs } from "@/stores/prefs";
import { useVault } from "@/stores/vault";

type Props = {
  open: boolean;
  onClose: () => void;
  workspaceId: string;
  onIngested?: (sourceId: string) => void;
};

export function AddUrlModal({
  open,
  onClose,
  workspaceId,
  onIngested,
}: Props) {
  const pick = useLocalePick();
  const { toast } = useToast();
  const masterKey = useVault((s) => s.masterKey);
  const defaultProvider = usePrefs(
    (s) => s.modelBindings.researchProvider,
  ) as ResearchProviderId;
  const setModelBinding = usePrefs((s) => s.setModelBinding);

  const [input, setInput] = useState("");
  const [provider, setProvider] = useState<ResearchProviderId>(defaultProvider);
  const [running, setRunning] = useState(false);
  const [unlockOpen, setUnlockOpen] = useState(false);
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const cancelRef = useRef<AbortController | null>(null);

  // Reset transient state every time the modal re-opens.
  useEffect(() => {
    if (!open) return;
    setInput("");
    setProvider(defaultProvider);
  }, [open, defaultProvider]);

  // Track whether the selected provider already has a stored key. We don't
  // need the actual key here — just whether the vault entry exists — so the
  // CTA can stay informative even when the vault is locked.
  useEffect(() => {
    let cancelled = false;
    const keyProvider = researchKeyProvider(provider);
    if (!keyProvider) {
      setHasKey(null);
      return;
    }
    void (async () => {
      const present = await hasApiKey(keyProvider);
      if (!cancelled) setHasKey(present);
    })();
    return () => {
      cancelled = true;
    };
  }, [provider]);

  const classified: ClassifiedUrl = useMemo(
    () => classifyUrl(input),
    [input],
  );
  const isWeb = classified.kind === "web";
  const isInvalid = classified.kind === "invalid";

  const requiresKey = researchProviderRequiresKey(provider);
  const isVaultLocked = !masterKey;
  // For DOI / YouTube / arXiv we ignore the chosen web provider entirely —
  // those channels are keyless. The provider selector still surfaces but is
  // disabled so the user understands why the choice doesn't matter.
  const providerMatters = isWeb;
  const blockedByKey =
    providerMatters && requiresKey && (isVaultLocked || hasKey === false);

  const canSubmit =
    !running && !isInvalid && input.trim().length > 0 && !blockedByKey;

  function handleClose(): void {
    if (running) return;
    onClose();
  }

  async function handleSubmit(): Promise<void> {
    if (!canSubmit) return;
    setRunning(true);
    const ctl = new AbortController();
    cancelRef.current = ctl;
    try {
      let apiKey: string | undefined;
      if (providerMatters && requiresKey) {
        const key = await resolveResearchCredential(provider);
        if (!key) {
          throw new ResearchError(
            401,
            "missing_key",
            pick(
              `${provider} için anahtar gerekli. Settings → Anahtarlar üzerinden ekle.`,
              `No API key stored for ${provider}. Add one in Settings → Keys.`,
            ),
          );
        }
        apiKey = key;
      }

      const ingestInput: Parameters<typeof ingestResearchUrl>[0] = {
        workspaceId,
        rawInput: input.trim(),
        signal: ctl.signal,
      };
      if (providerMatters) ingestInput.webProvider = provider;
      if (apiKey !== undefined) ingestInput.apiKey = apiKey;

      const out = await ingestResearchUrl(ingestInput);
      toast({
        variant: "success",
        title: pick("Kaynak eklendi", "Source added"),
        description: `${out.source.title} · ${out.chunkCount} ${pick("chunk", "chunks")}`,
      });
      // Persist the user's provider choice if they overrode the default in
      // this run — keeps the next session friction-free.
      if (provider !== defaultProvider) {
        setModelBinding("researchProvider", provider);
      }
      if (onIngested) onIngested(out.source.id);
      onClose();
    } catch (err) {
      const message =
        err instanceof ResearchError
          ? `${err.code}: ${err.message}`
          : err instanceof Error
            ? err.message
            : String(err);
      toast({
        variant: "error",
        title: pick("Eklenemedi", "Failed to add"),
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
            <Link2 className="h-4 w-4 text-accent" aria-hidden />
            {pick("URL / DOI ekle", "Add URL / DOI")}
          </div>
        }
        description={pick(
          "URL, DOI veya arXiv ID yapıştır. İçerik tek bir kaynağa indirilir, parçalanır ve chat'te kullanılır.",
          "Paste a URL, DOI, or arXiv id. Content is fetched into a single source, chunked, and made available in chat.",
        )}
        footer={
          <div className="flex items-center justify-between gap-3">
            <span className="font-mono text-[11px] text-ink-3">
              {classifiedLabel(classified, pick)}
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
                onClick={() => void handleSubmit()}
                disabled={!canSubmit}
              >
                {running ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <Sparkles className="h-3.5 w-3.5" aria-hidden />
                )}
                {running
                  ? pick("İndiriliyor…", "Fetching…")
                  : pick("Kaynak olarak ekle", "Add as source")}
              </Button>
            </div>
          </div>
        }
      >
        <div className="space-y-4">
          <label className="block space-y-2">
            <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-3">
              {pick("URL veya DOI", "URL or DOI")}
            </span>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="https://… · 10.xxxx/… · arxiv.org/abs/… · youtu.be/…"
              autoFocus
              className="w-full rounded-[8px] border border-rule bg-paper-2 px-3 py-2 text-[13px] outline-none focus:border-accent"
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
            />
          </label>

          <div className="space-y-2 rounded-[10px] border border-rule p-3 text-[12.5px] leading-5">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-3">
                {pick("Web sağlayıcı", "Web provider")}
              </span>
              {!providerMatters ? (
                <span className="font-mono text-[10.5px] text-ink-3">
                  {pick(
                    "Bu kaynak tipi için kullanılmıyor",
                    "Not used for this source type",
                  )}
                </span>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              {listResearchOptions().map((opt) => {
                const isSelected = provider === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setProvider(opt.id)}
                    disabled={!providerMatters}
                    className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-[12px] transition-colors ${
                      isSelected
                        ? "border-accent bg-accent/10 text-accent"
                        : "border-rule bg-paper-2 text-ink-2 hover:bg-paper-3"
                    } disabled:opacity-50`}
                  >
                    <Globe className="h-3 w-3" aria-hidden />
                    {opt.label}
                    {opt.badges.map((b) => (
                      <span
                        key={b.kind}
                        className="font-mono text-[10px] text-ink-3"
                      >
                        {b.label}
                      </span>
                    ))}
                  </button>
                );
              })}
            </div>
            {blockedByKey ? (
              <div className="flex items-center justify-between gap-2 text-[11.5px] text-warn">
                <span>
                  {isVaultLocked
                    ? pick(
                        "Bu sağlayıcı için anahtar gerek; önce vault'u aç.",
                        "This provider needs a key; unlock the vault first.",
                      )
                    : pick(
                        "Bu sağlayıcı için anahtar yok. Settings → Anahtarlar üzerinden ekle.",
                        "No API key stored for this provider. Add one in Settings → Keys.",
                      )}
                </span>
                {isVaultLocked ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setUnlockOpen(true)}
                  >
                    {pick("Vault'u aç", "Unlock vault")}
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </Modal>
      
    </>
  );
}

function classifiedLabel(
  c: ClassifiedUrl,
  pick: (tr: string, en: string) => string,
): string {
  switch (c.kind) {
    case "doi":
      return pick(`DOI tespit edildi: ${c.doi}`, `Detected DOI: ${c.doi}`);
    case "youtube":
      return pick(
        `YouTube videosu: ${c.videoId}`,
        `YouTube video: ${c.videoId}`,
      );
    case "arxiv":
      return pick(`arXiv: ${c.arxivId}`, `arXiv: ${c.arxivId}`);
    case "web":
      return pick("Web sayfası", "Web page");
    case "invalid":
      return c.reason === "empty"
        ? pick("URL gir", "Enter a URL")
        : pick("Geçersiz URL", "Invalid URL");
  }
}
