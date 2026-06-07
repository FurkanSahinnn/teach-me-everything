"use client";

import { useEffect, useRef, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { useLocalePick } from "@/i18n/IntlProvider";
import { useVault } from "@/stores/vault";
import { getApiKey } from "@/lib/db/api-keys-repo";
import {
  EMBED_PRESETS,
  type EmbedPresetId,
} from "@/lib/ai/providers/embed-presets";
import {
  planReembed,
  presetToProviderId,
  runReembed,
  type ReembedHandle,
  type ReembedPlan,
} from "@/lib/ingest/reembed";
import type { Provider } from "@/lib/db/schema";

const ALL_PRESET_IDS = Object.keys(EMBED_PRESETS) as EmbedPresetId[];

function formatUsd(n: number): string {
  if (n === 0) return "$0.00";
  if (n < 0.0001) return "<$0.0001";
  if (n < 0.1) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

function presetDimLabel(id: EmbedPresetId): string {
  const dim = EMBED_PRESETS[id].dim;
  return Array.isArray(dim) ? dim.join("/") : String(dim);
}

type Status =
  | { kind: "idle" }
  | { kind: "running"; done: number; total: number }
  | { kind: "done"; written: number; total: number }
  | { kind: "error"; message: string };

export function ReembedModal({
  open,
  onClose,
  workspaceId,
}: {
  open: boolean;
  onClose: () => void;
  workspaceId: string;
}) {
  const pick = useLocalePick();
  const { toast } = useToast();
  const isUnlocked = useVault((s) => s.isUnlocked);
  const masterKey = useVault((s) => s.masterKey);

  const [presetId, setPresetId] = useState<EmbedPresetId>("openai-3-small");
  const [plan, setPlan] = useState<ReembedPlan | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const handleRef = useRef<ReembedHandle | null>(null);

  // Debounced plan recompute. The 300ms window keeps us from re-scanning
  // every chunk while the user is still scrolling through preset choices.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const p = await planReembed(
          { kind: "workspace", workspaceId },
          presetId,
        );
        if (!cancelled) setPlan(p);
      } catch {
        if (!cancelled) setPlan(null);
      }
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, presetId, workspaceId]);

  // Reset transient state when modal reopens.
  useEffect(() => {
    if (!open) {
      queueMicrotask(() => setStatus({ kind: "idle" }));
      handleRef.current = null;
    }
  }, [open]);

  const preset = EMBED_PRESETS[presetId];

  async function start(): Promise<void> {
    if (!isUnlocked || !masterKey) {
      toast({
        variant: "warn",
        title: pick("Vault kilitli", "Vault locked"),
        description: pick(
          "Önce master parolayı gir.",
          "Unlock the vault first.",
        ),
      });
      return;
    }

    const providerId = presetToProviderId(presetId);
    let apiKey: string | null = null;
    if (preset.isLocal === true) {
      apiKey = "";
    } else {
      try {
        apiKey = await getApiKey(providerId as Provider);
      } catch {
        apiKey = null;
      }
    }
    if (apiKey == null) {
      toast({
        variant: "warn",
        title: pick("Anahtar eksik", "Key missing"),
        description: pick(
          `${preset.label} için ayarlardan anahtar ekle.`,
          `Add an API key for ${preset.label} in Settings.`,
        ),
      });
      return;
    }

    setStatus({ kind: "running", done: 0, total: plan?.toReembed ?? 0 });
    const handle = runReembed({
      scope: { kind: "workspace", workspaceId },
      apiKey,
      presetId,
      onProgress: (p) => {
        setStatus({ kind: "running", done: p.done, total: p.total });
      },
    });
    handleRef.current = handle;

    try {
      const r = await handle.promise;
      setStatus({ kind: "done", written: r.done, total: r.total });
      toast({
        variant: "success",
        title: pick("Reembed tamamlandı", "Reembed complete"),
        description: `${r.done}/${r.total}`,
      });
    } catch (err) {
      setStatus({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      handleRef.current = null;
    }
  }

  function cancel(): void {
    handleRef.current?.cancel();
    handleRef.current = null;
    setStatus({ kind: "idle" });
  }

  const startDisabled =
    !plan ||
    plan.toReembed === 0 ||
    status.kind === "running" ||
    !isUnlocked;

  return (
    <Modal
      open={open}
      onClose={status.kind === "running" ? () => {} : onClose}
      title={pick("Yeniden göm", "Reembed")}
      description={pick(
        "Workspace'teki uyumsuz boyutlu chunks'ı seçilen modele göm.",
        "Reembed dim-mismatched chunks in this workspace.",
      )}
      size="md"
      footer={
        status.kind === "running" ? (
          <Button variant="default" onClick={cancel}>
            {pick("İptal", "Cancel")}
          </Button>
        ) : (
          <>
            <Button variant="default" onClick={onClose}>
              {pick("Kapat", "Close")}
            </Button>
            <Button variant="accent" onClick={start} disabled={startDisabled}>
              {pick("Başlat", "Start")}
            </Button>
          </>
        )
      }
    >
      <div className="space-y-3">
        <div>
          <label className="mb-1 block font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-3">
            {pick("Hedef model", "Target model")}
          </label>
          <select
            className="w-full rounded-md border border-rule bg-paper px-2 py-1.5 text-[13px] text-ink"
            value={presetId}
            onChange={(e) => setPresetId(e.target.value as EmbedPresetId)}
            disabled={status.kind === "running"}
          >
            {ALL_PRESET_IDS.map((id) => (
              <option key={id} value={id}>
                {EMBED_PRESETS[id].label} · {presetDimLabel(id)}d
              </option>
            ))}
          </select>
        </div>

        {plan ? (
          <div className="rounded-md border border-rule-soft bg-paper-2 px-3 py-2 text-[13px] text-ink-2">
            <Row
              label={pick("Toplam chunk", "Total chunks")}
              value={String(plan.totalChunks)}
            />
            <Row
              label={pick("Yeniden gömülecek", "To reembed")}
              value={String(plan.toReembed)}
              emphasis
            />
            <Row
              label={pick("Tahmini token", "Estimated tokens")}
              value={plan.estTokens.toLocaleString()}
            />
            <Row
              label={pick("Tahmini maliyet", "Estimated cost")}
              value={formatUsd(plan.estCostUsd)}
            />
          </div>
        ) : null}

        {status.kind === "running" ? (
          <div>
            <div className="mb-1 flex justify-between text-[12px] text-ink-3">
              <span>{pick("İşleniyor", "Running")}</span>
              <span className="font-mono">
                {status.done}/{status.total}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-paper-3">
              <div
                className="h-full bg-accent transition-[width] duration-200"
                style={{
                  width: `${
                    status.total === 0
                      ? 0
                      : Math.floor((status.done / status.total) * 100)
                  }%`,
                }}
              />
            </div>
          </div>
        ) : null}

        {status.kind === "done" ? (
          <p className="text-[13px] text-ok">
            {pick("Tamamlandı.", "Done.")} {status.written}/{status.total}
          </p>
        ) : null}

        {status.kind === "error" ? (
          <p className="text-[13px] text-err">{status.message}</p>
        ) : null}
      </div>
    </Modal>
  );
}

function Row({
  label,
  value,
  emphasis = false,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div className="flex justify-between py-0.5">
      <span>{label}</span>
      <span className={emphasis ? "font-mono font-medium text-ink" : "font-mono"}>
        {value}
      </span>
    </div>
  );
}
