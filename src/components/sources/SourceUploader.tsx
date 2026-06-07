"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  AlertCircle,
  Check,
  FileText,
  RotateCcw,
  Upload,
  X,
} from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import {
  createSource,
  setEmbeddingStatus,
  setIngestStatus,
  updateSource,
} from "@/lib/db/sources";
import { bulkAddChunks, setChunkEmbedding } from "@/lib/db/chunks";
import { saveSourceBlob } from "@/lib/db/source-blobs";
import { getApiKey, hasApiKey } from "@/lib/db/api-keys-repo";
import {
  parsePdf,
  parsePlainText,
  type ParseHandle,
  type ParsePhase,
} from "@/lib/ingest/pdf";
import {
  parseDocx,
  type DocxParseHandle,
  type DocxParsePhase,
} from "@/lib/ingest/docx";
import {
  embedSourceChunks,
  type EmbedJobHandle,
} from "@/lib/ingest/embed";
import {
  EMBED_PRESETS,
  type EmbedPreset,
  type EmbedPresetId,
} from "@/lib/ai/providers/embed-presets";
import { isLocalUrl } from "@/lib/ai/providers/local-bypass";
import { presetToProviderId } from "@/lib/ingest/reembed";
import { useVault } from "@/stores/vault";
import { usePrefs } from "@/stores/prefs";
import { useLocalePick } from "@/i18n/IntlProvider";
import { cn } from "@/lib/utils/cn";
import type { SourceType } from "@/lib/db/types";
import type { Provider } from "@/lib/db/schema";

type QueueStatus = "queued" | "uploading" | "ready" | "error";

type QueueItem = {
  id: string;
  file: File;
  status: QueueStatus;
  progress: number;
  error?: string | undefined;
};

const ACCEPT =
  ".pdf,.docx,.md,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/markdown,text/plain";
const MAX_PARALLEL = 3;
const MAX_BYTES_DEFAULT = 50 * 1024 * 1024; // PDF / TXT / MD
const MAX_BYTES_DOCX = 80 * 1024 * 1024; // DOCX is page-less so larger files are common

function maxBytesFor(file: File): number {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (
    ext === "docx" ||
    file.type ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return MAX_BYTES_DOCX;
  }
  return MAX_BYTES_DEFAULT;
}

function detectSourceType(file: File): SourceType | null {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "pdf" || file.type === "application/pdf") return "pdf";
  if (ext === "docx") return "docx";
  if (ext === "md" || ext === "markdown") return "md";
  if (ext === "txt" || file.type === "text/plain") return "txt";
  return null;
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

let queueIdCounter = 0;
function nextQueueId(): string {
  queueIdCounter += 1;
  return `q_${Date.now().toString(36)}_${queueIdCounter}`;
}

type SourceUploadApi = {
  openPicker: () => void;
  enqueue: (files: FileList | File[]) => void;
};

const SourceUploadCtx = createContext<SourceUploadApi | null>(null);

export function useSourceUpload(): SourceUploadApi {
  const ctx = useContext(SourceUploadCtx);
  if (!ctx) {
    throw new Error("useSourceUpload must be used inside <SourceUploadProvider>");
  }
  return ctx;
}

export function SourceUploadProvider({
  workspaceId,
  children,
}: {
  workspaceId: string;
  children: ReactNode;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [open, setOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [vaultModalOpen, setVaultModalOpen] = useState(false);
  // Single shared deferred — every queue item that hits "vault locked but
  // key stored" awaits it. The modal resolves it once on close (true if
  // unlock succeeded, false otherwise), so multiple in-flight uploads all
  // continue together with the now-available master key. Cleared back to
  // null after resolution so the next vault-locked event creates a fresh
  // promise.
  const vaultDeferredRef = useRef<{
    promise: Promise<boolean>;
    resolve: (unlocked: boolean) => void;
  } | null>(null);
  const dragCounterRef = useRef(0);
  // Mirrors the latest queue so the processing effect's cleanup can tell
  // "user dismissed this item" (item gone) from "ingest pushed a progress
  // update" (item still present). Without this, every progress setQueue
  // would re-run the effect, fire its cleanup, set `cancelled = true` in
  // the running IIFE's closure, and abort the parse before pdfjs ever
  // started. Setting `.current` in render is safe because we read it only
  // from cleanup, which fires after the new render commits.
  const queueRef = useRef(queue);
  useLayoutEffect(() => {
    queueRef.current = queue;
  }, [queue]);
  const { toast } = useToast();
  const pick = useLocalePick();

  const requestVaultUnlock = useCallback((): Promise<boolean> => {
    if (!vaultDeferredRef.current) {
      let resolveFn: (unlocked: boolean) => void = () => {};
      const promise = new Promise<boolean>((res) => {
        resolveFn = res;
      });
      vaultDeferredRef.current = { promise, resolve: resolveFn };
    }
    setVaultModalOpen(true);
    return vaultDeferredRef.current.promise;
  }, []);

  const enqueue = useCallback(
    (files: FileList | File[]): void => {
      const arr = Array.from(files);
      const items: QueueItem[] = [];
      let rejected = 0;
      let rejectReason: "size" | "type" | "mixed" | null = null;
      for (const f of arr) {
        if (f.size > maxBytesFor(f)) {
          rejected += 1;
          rejectReason = rejectReason === "type" ? "mixed" : "size";
          continue;
        }
        const type = detectSourceType(f);
        if (!type) {
          rejected += 1;
          rejectReason = rejectReason === "size" ? "mixed" : "type";
          continue;
        }
        items.push({
          id: nextQueueId(),
          file: f,
          status: "queued",
          progress: 0,
        });
      }
      if (items.length > 0) {
        // Block the upload behind the vault prompt — if the embedding step
        // will need a master password to fetch the saved key, ask for it
        // FIRST, then enqueue. Otherwise the user can refresh / navigate
        // away mid-parse and end up with a half-ingested source whose
        // embedding never ran. Local embed presets (Ollama/LM Studio) and
        // an already-unlocked vault both skip straight to enqueue.
        void (async () => {
          let needsVault = false;
          try {
            const { embedPresetId } = usePrefs.getState().modelBindings;
            const preset =
              EMBED_PRESETS[embedPresetId as EmbedPresetId] ??
              EMBED_PRESETS["openai-3-small"];
            const isLocal =
              preset.isLocal === true || isLocalUrl(preset.baseUrl);
            const { isUnlocked } = useVault.getState();
            if (!isLocal && !isUnlocked) {
              const providerId = presetToProviderId(preset.id);
              const stored = await hasApiKey(providerId as Provider).catch(
                () => false,
              );
              if (stored) needsVault = true;
            }
          } catch {
            // Probe failure is non-fatal — fall through to a normal upload.
          }

          if (needsVault) {
            const unlocked = await requestVaultUnlock();
            if (!unlocked) {
              // User dismissed the vault prompt — abort the entire upload
              // so they don't end up with a parsed-but-never-embedded
              // source they didn't realise they were creating.
              toast({
                variant: "warn",
                title: pick(
                  "Yükleme iptal edildi",
                  "Upload cancelled",
                ),
                description: pick(
                  "Embedding için master parola gerekiyor. Yeniden denemek için kaynağı tekrar ekle.",
                  "The master password is needed for embedding. Re-add the source to try again.",
                ),
              });
              return;
            }
          }

          setQueue((q) => [...q, ...items]);
          setOpen(true);
        })();
      }
      if (rejected > 0) {
        const desc =
          rejectReason === "size"
            ? pick(
                "Bazı dosyalar boyut sınırını aştı (PDF/TXT/MD 50 MB · DOCX 80 MB).",
                "Some files exceeded the size limit (PDF/TXT/MD 50 MB · DOCX 80 MB).",
              )
            : rejectReason === "type"
              ? pick(
                  "Yalnız PDF, DOCX, MD, TXT desteklenir.",
                  "Only PDF, DOCX, MD, TXT are supported.",
                )
              : pick(
                  "Bazıları büyük, bazıları desteklenmeyen tip.",
                  "Some too large, others unsupported type.",
                );
        toast({
          variant: "warn",
          title: pick(
            `${rejected} dosya atlandı`,
            `${rejected} files skipped`,
          ),
          description: desc,
        });
      }
    },
    [pick, toast, requestVaultUnlock],
  );

  const openPicker = useCallback((): void => {
    inputRef.current?.click();
  }, []);

  const handleVaultClose = useCallback((): void => {
    setVaultModalOpen(false);
    if (vaultDeferredRef.current) {
      vaultDeferredRef.current.resolve(false);
      vaultDeferredRef.current = null;
    }
  }, []);

  const handleVaultSuccess = useCallback((): void => {
    if (vaultDeferredRef.current) {
      vaultDeferredRef.current.resolve(true);
      vaultDeferredRef.current = null;
    }
  }, []);

  // Make sure pending awaiters don't leak if the provider unmounts before
  // the user closes the modal.
  useEffect(() => {
    return () => {
      if (vaultDeferredRef.current) {
        vaultDeferredRef.current.resolve(false);
        vaultDeferredRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    function isFileDrag(e: DragEvent): boolean {
      const types = e.dataTransfer?.types;
      if (!types) return false;
      for (let i = 0; i < types.length; i += 1) {
        if (types[i] === "Files") return true;
      }
      return false;
    }

    function onDragEnter(e: DragEvent): void {
      if (!isFileDrag(e)) return;
      dragCounterRef.current += 1;
      if (dragCounterRef.current === 1) setDragOver(true);
    }
    function onDragLeave(e: DragEvent): void {
      if (!isFileDrag(e)) return;
      dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
      if (dragCounterRef.current === 0) setDragOver(false);
    }
    function onDragOver(e: DragEvent): void {
      if (!isFileDrag(e)) return;
      e.preventDefault();
    }
    function onDrop(e: DragEvent): void {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      dragCounterRef.current = 0;
      setDragOver(false);
      const dt = e.dataTransfer;
      if (dt && dt.files.length > 0) enqueue(dt.files);
    }
    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
    };
  }, [enqueue]);

  useEffect(() => {
    const inFlight = queue.filter((q) => q.status === "uploading").length;
    if (inFlight >= MAX_PARALLEL) return;
    const next = queue.find((q) => q.status === "queued");
    if (!next) return;

    let cancelled = false;
    let parseHandle: ParseHandle | null = null;
    let docxHandle: DocxParseHandle | null = null;
    let embedHandle: EmbedJobHandle | null = null;
    const targetId = next.id;
    const targetFile = next.file;

    queueMicrotask(() => {
      if (cancelled) return;
      setQueue((q) =>
        q.map((it) =>
          it.id === targetId
            ? { ...it, status: "uploading" as QueueStatus, progress: 4 }
            : it,
        ),
      );
    });

    function setItemError(id: string, err: unknown): void {
      const msg = err instanceof Error ? err.message : String(err);
      setQueue((q) =>
        q.map((it) =>
          it.id === id
            ? { ...it, status: "error" as QueueStatus, error: msg }
            : it,
        ),
      );
    }

    (async () => {
      const type = detectSourceType(targetFile);
      if (!type) {
        if (!cancelled) setItemError(targetId, new Error("unsupported_type"));
        return;
      }

      let sourceId: string | null = null;
      try {
        const source = await createSource({
          workspaceId,
          type,
          title: targetFile.name.replace(/\.[^.]+$/, ""),
          byteSize: targetFile.size,
          ingestStatus: "parsing",
        });
        sourceId = source.id;
      } catch (err) {
        if (!cancelled) setItemError(targetId, err);
        return;
      }
      if (cancelled) return;

      try {
        let parsed;
        if (type === "pdf") {
          let lastPhase: ParsePhase | null = null;
          parseHandle = parsePdf(targetFile, {
            onProgress: (p) => {
              if (cancelled) return;
              const ui = Math.min(80, 4 + Math.floor((p.pct / 100) * 76));
              setQueue((q) =>
                q.map((it) =>
                  it.id === targetId ? { ...it, progress: ui } : it,
                ),
              );
              if (p.phase !== lastPhase && sourceId) {
                lastPhase = p.phase;
                void setIngestStatus(sourceId, p.phase);
              }
            },
          });
          parsed = await parseHandle.promise;
        } else if (type === "docx") {
          let lastPhase: DocxParsePhase | null = null;
          docxHandle = parseDocx(targetFile, {
            onProgress: (p) => {
              if (cancelled) return;
              const ui = Math.min(80, 4 + Math.floor((p.pct / 100) * 76));
              setQueue((q) =>
                q.map((it) =>
                  it.id === targetId ? { ...it, progress: ui } : it,
                ),
              );
              if (p.phase !== lastPhase && sourceId) {
                lastPhase = p.phase;
                void setIngestStatus(sourceId, p.phase);
              }
            },
          });
          parsed = await docxHandle.promise;
        } else if (type === "txt" || type === "md") {
          parsed = await parsePlainText(targetFile);
        } else {
          throw new Error("unsupported_type");
        }

        if (cancelled) return;

        const sid = sourceId;
        if (!sid) throw new Error("source_id_missing");

        let storedChunks: Array<{ id: string; text: string }> = [];
        if (parsed.chunks.length > 0) {
          const records = await bulkAddChunks(
            parsed.chunks.map((c) => ({
              sourceId: sid,
              workspaceId,
              index: c.index,
              text: c.text,
              tokenCount: c.tokenCount,
              page: c.page,
              section: c.section,
              headings: c.headings,
            })),
          );
          storedChunks = records.map((r) => ({ id: r.id, text: r.text }));
        }

        await updateSource(sid, {
          pageCount: parsed.meta.pageCount,
          contentHash: parsed.meta.contentHash,
          byteSize: parsed.meta.byteSize,
        });

        // Persist the original binary so the reader can render the source
        // visually (e.g. PDF canvas + textLayer) instead of only the chunked
        // plain text. Stored only for formats whose viewer benefits from
        // visual fidelity — txt/md ship as plain text already.
        if (type === "pdf" || type === "docx") {
          try {
            await saveSourceBlob(sid, targetFile);
          } catch {
            // Storing the blob is best-effort; the chunked reader still works
            // without it. A failed save (quota / private mode) just means the
            // "Original PDF" toggle will surface the missing-blob banner.
          }
        }

        await setIngestStatus(sid, "ready");

        // Embedding phase. The default preset comes from prefs.modelBindings
        // — local presets skip the vault entirely; cloud presets read the key
        // matching the preset's owning ProviderId. Missing key = skip with a
        // toast; chunks remain queryable, retrieval just won't kick in until
        // the user adds a key.
        if (storedChunks.length > 0) {
          const { embedPresetId } = usePrefs.getState().modelBindings;
          const preset: EmbedPreset =
            EMBED_PRESETS[embedPresetId as EmbedPresetId] ??
            EMBED_PRESETS["openai-3-small"];
          const providerId = presetToProviderId(preset.id);
          const isLocal =
            preset.isLocal === true || isLocalUrl(preset.baseUrl);

          const { isUnlocked, masterKey } = useVault.getState();
          let apiKey: string | null = null;
          let lockedButStored = false;
          if (isLocal) {
            apiKey = "";
          } else if (isUnlocked && masterKey) {
            try {
              apiKey = await getApiKey(providerId as Provider);
            } catch {
              apiKey = null;
            }
          } else {
            // Vault locked — check whether the user already saved a key so we
            // can prompt for the master password instead of skipping with the
            // misleading "key missing" toast (which sent users to Settings to
            // re-enter a key they already had).
            lockedButStored = await hasApiKey(providerId as Provider).catch(
              () => false,
            );
            if (lockedButStored && !cancelled) {
              const unlocked = await requestVaultUnlock();
              if (cancelled) return;
              if (unlocked) {
                const fresh = useVault.getState();
                if (fresh.isUnlocked && fresh.masterKey) {
                  try {
                    apiKey = await getApiKey(providerId as Provider);
                  } catch {
                    apiKey = null;
                  }
                }
              }
            }
          }

          if (apiKey == null) {
            await setEmbeddingStatus(sid, "skipped", {
              provider: String(providerId),
              model: preset.model,
              errorMessage: lockedButStored ? "vault_locked" : "missing_key",
            });
            toast({
              variant: "warn",
              title: lockedButStored
                ? pick("Vault kilitli", "Vault locked")
                : pick(
                    `${preset.label} anahtarı yok`,
                    `${preset.label} key missing`,
                  ),
              description: lockedButStored
                ? pick(
                    `${preset.label} anahtarın kayıtlı ama vault kilitli. Master parolayı girince embedding otomatik çalışacak.`,
                    `${preset.label} key is saved but the vault is locked. Unlock with your master password to enable embedding.`,
                  )
                : pick(
                    "Embedding atlandı. Ayarlardan ekleyince retrieval'a hazır.",
                    "Embedding skipped. Add it in Settings to enable retrieval.",
                  ),
            });
          } else {
            await setEmbeddingStatus(sid, "embedding", {
              provider: String(providerId),
              model: preset.model,
            });
            try {
              embedHandle = embedSourceChunks({
                apiKey,
                providerId,
                model: preset.model,
                chunks: storedChunks,
                onProgress: ({ done, total }) => {
                  if (cancelled) return;
                  const ui = 80 + Math.floor((done / Math.max(1, total)) * 18);
                  setQueue((q) =>
                    q.map((it) =>
                      it.id === targetId ? { ...it, progress: ui } : it,
                    ),
                  );
                },
              });
              const embedResult = await embedHandle.promise;
              if (cancelled) return;
              for (const e of embedResult.embeddings) {
                await setChunkEmbedding(e.id, e.vector, embedResult.model, {
                  dim: embedResult.dim,
                  provider: embedResult.providerId,
                });
              }
              await setEmbeddingStatus(sid, "ready", {
                provider: String(embedResult.providerId),
                model: embedResult.model,
              });
            } catch (err) {
              await setEmbeddingStatus(sid, "error", {
                provider: String(providerId),
                model: preset.model,
                errorMessage: err instanceof Error ? err.message : String(err),
              });
              toast({
                variant: "warn",
                title: pick("Embedding tamamlanamadı", "Embedding failed"),
                description: pick(
                  "Kaynak okunabilir kaldı. Ayarlar > Embedding bölümünden tekrar deneyebilirsin.",
                  "The source remains readable. Retry from Settings > Embedding.",
                ),
              });
            }
          }
        } else {
          await setEmbeddingStatus(sid, "missing");
        }

        if (cancelled) return;
        setQueue((q) =>
          q.map((it) =>
            it.id === targetId
              ? { ...it, status: "ready" as QueueStatus, progress: 100 }
              : it,
          ),
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (sourceId) {
          try {
            await setIngestStatus(sourceId, "error", msg);
          } catch {
            // best-effort; keep UI error visible regardless
          }
        }
        if (!cancelled) setItemError(targetId, err);
      }
    })();

    return () => {
      // The IIFE drives setQueue several times per upload (status flip,
      // progress ticks, status flip again). Each one re-runs this effect
      // and would otherwise cancel our own in-flight job. Only cancel if
      // the item has actually left the queue (user dismissed it) — when
      // it's still there, leave the handles alone so the IIFE can finish.
      if (queueRef.current.some((it) => it.id === targetId)) return;
      cancelled = true;
      parseHandle?.cancel();
      docxHandle?.cancel();
      embedHandle?.cancel();
    };
  }, [queue, workspaceId, pick, toast]);

  function retry(id: string): void {
    setQueue((q) =>
      q.map((it) =>
        it.id === id
          ? { ...it, status: "queued", progress: 0, error: undefined }
          : it,
      ),
    );
  }

  function dismiss(id: string): void {
    setQueue((q) => q.filter((it) => it.id !== id));
  }

  function clearDone(): void {
    setQueue((q) => q.filter((it) => it.status !== "ready"));
  }

  function retryAllFailed(): void {
    setQueue((q) =>
      q.map((it) =>
        it.status === "error"
          ? { ...it, status: "queued", progress: 0, error: undefined }
          : it,
      ),
    );
  }

  const allDone = queue.length > 0 && queue.every((q) => q.status === "ready");
  const hasFailed = queue.some((q) => q.status === "error");

  return (
    <SourceUploadCtx.Provider value={{ openPicker, enqueue }}>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) {
            enqueue(e.target.files);
            e.target.value = "";
          }
        }}
      />

      <div
        aria-hidden={!dragOver}
        className={cn(
          "pointer-events-none fixed inset-0 z-[90] grid place-items-center transition-opacity duration-[160ms]",
          dragOver ? "opacity-100" : "opacity-0",
        )}
      >
        <div className="absolute inset-0 bg-accent/15 backdrop-blur-[1px]" />
        <div className="relative rounded-[var(--radius-lg)] border-2 border-dashed border-accent bg-paper p-8 shadow-[var(--shadow-deep)]">
          <Upload className="mx-auto h-7 w-7 text-accent" aria-hidden />
          <p className="mt-3 text-center font-serif text-[18px] text-ink">
            {pick("Bırak yüklenmeye başlasın", "Drop to upload")}
          </p>
          <p className="mt-1 text-center text-[12.5px] text-ink-3">
            PDF, DOCX, MD, TXT · PDF/MD/TXT 50 MB · DOCX 80 MB
          </p>
        </div>
      </div>

      {children}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={pick("Yükleme kuyruğu", "Upload queue")}
        description={pick(
          "PDF/MD/TXT lokal olarak parse ediliyor; metin Dexie'ye chunk'lanıp kaydediliyor.",
          "PDF/MD/TXT parsed locally; text is chunked and stored in Dexie.",
        )}
        size="lg"
        footer={
          <>
            {hasFailed ? (
              <Button variant="default" onClick={retryAllFailed}>
                <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                {pick("Hataları yeniden dene", "Retry failed")}
              </Button>
            ) : null}
            {allDone ? (
              <Button variant="default" onClick={clearDone}>
                {pick("Listeyi temizle", "Clear list")}
              </Button>
            ) : null}
            <Button variant="accent" onClick={() => setOpen(false)}>
              {pick("Kapat", "Close")}
            </Button>
          </>
        }
      >
        {queue.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-ink-3">
            {pick("Kuyruk boş.", "Queue is empty.")}
          </p>
        ) : (
          <ul className="m-0 divide-y divide-rule-soft">
            {queue.map((q) => (
              <UploadRow
                key={q.id}
                item={q}
                onRetry={retry}
                onDismiss={dismiss}
              />
            ))}
          </ul>
        )}
      </Modal>

      
    </SourceUploadCtx.Provider>
  );
}

function UploadRow({
  item,
  onRetry,
  onDismiss,
}: {
  item: QueueItem;
  onRetry: (id: string) => void;
  onDismiss: (id: string) => void;
}) {
  const pick = useLocalePick();
  const Icon =
    item.status === "error"
      ? AlertCircle
      : item.status === "ready"
        ? Check
        : FileText;
  const tone =
    item.status === "error"
      ? "text-err"
      : item.status === "ready"
        ? "text-ok"
        : "text-ink-3";
  return (
    <li className="flex items-center gap-3 py-2.5">
      <Icon className={cn("h-4 w-4 shrink-0", tone)} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-[13.5px] font-medium text-ink">
            {item.file.name}
          </span>
          <span className="font-mono text-[11px] text-ink-4">
            {fmtBytes(item.file.size)}
          </span>
        </div>
        <div className="mt-1 h-1 overflow-hidden rounded-full bg-paper-3">
          <div
            className={cn(
              "h-full rounded-full transition-[width] duration-[200ms]",
              item.status === "error"
                ? "bg-err"
                : item.status === "ready"
                  ? "bg-ok"
                  : "bg-accent",
            )}
            style={{ width: `${item.progress}%` }}
          />
        </div>
        {item.error ? (
          <p className="mt-1 text-[12px] text-err">{item.error}</p>
        ) : null}
      </div>
      {item.status === "error" ? (
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={() => onRetry(item.id)}
          aria-label={pick("Yeniden dene", "Retry")}
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden />
        </Button>
      ) : null}
      <Button
        size="icon-sm"
        variant="ghost"
        onClick={() => onDismiss(item.id)}
        aria-label={pick("Kaldır", "Dismiss")}
      >
        <X className="h-3.5 w-3.5" aria-hidden />
      </Button>
    </li>
  );
}
