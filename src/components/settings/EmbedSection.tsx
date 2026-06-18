"use client";

import { useCallback, useEffect, useState } from "react";
import { Layers, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { useLocalePick } from "@/i18n/IntlProvider";
import { useWorkspaces } from "@/lib/db/hooks";
import { deriveEmbedStatus, planReembed } from "@/lib/ingest/reembed";
import { pruneEmbeddings } from "@/lib/storage/quota";
import type { EmbedPresetId } from "@/lib/ai/providers/embed-presets";
import { ReembedModal } from "./ReembedModal";

const DEFAULT_PROBE_PRESET: EmbedPresetId = "openai-3-small";

// Probe snapshot per workspace. `embedded` is preset-independent (any chunk
// carrying embedding metadata), so it stays accurate even though `toReembed`
// is computed against the default probe preset.
type Probe = { total: number; embedded: number; toReembed: number };

export function EmbedSection() {
  const pick = useLocalePick();
  const { toast } = useToast();
  const workspaces = useWorkspaces(false);
  const list = workspaces ?? [];

  // workspaceId → probe against the default preset (1536-d). The probe only
  // tells the user "you have a mismatch / nothing embedded"; the Reembed modal
  // recomputes per chosen target.
  const [probes, setProbes] = useState<Record<string, Probe>>({});
  const [openWorkspaceId, setOpenWorkspaceId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const probeWorkspace = useCallback(async (id: string): Promise<Probe> => {
    try {
      const p = await planReembed(
        { kind: "workspace", workspaceId: id },
        DEFAULT_PROBE_PRESET,
      );
      return {
        total: p.totalChunks,
        embedded: p.embeddedCount,
        toReembed: p.toReembed,
      };
    } catch {
      return { total: 0, embedded: 0, toReembed: 0 };
    }
  }, []);

  useEffect(() => {
    if (list.length === 0) return;
    let cancelled = false;
    void (async () => {
      const next: Record<string, Probe> = {};
      for (const w of list) {
        next[w.id] = await probeWorkspace(w.id);
      }
      if (!cancelled) setProbes(next);
    })();
    return () => {
      cancelled = true;
    };
    // Re-probe when workspace set changes (count or ids).
  }, [list.length, list.map((w) => w.id).join(","), probeWorkspace]);

  async function handleDelete(id: string): Promise<void> {
    setDeleting(true);
    try {
      const { cleared } = await pruneEmbeddings(id);
      const fresh = await probeWorkspace(id);
      setProbes((prev) => ({ ...prev, [id]: fresh }));
      toast({
        variant: "success",
        title: pick("Embedding silindi", "Embeddings deleted"),
        description: pick(
          `${cleared} chunk vektörü temizlendi.`,
          `Cleared vectors from ${cleared} chunk(s).`,
        ),
      });
      setConfirmId(null);
    } catch (err) {
      toast({
        variant: "error",
        title: pick("Silme başarısız", "Delete failed"),
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setDeleting(false);
    }
  }

  const confirmWs = confirmId
    ? list.find((w) => w.id === confirmId) ?? null
    : null;
  const confirmEmbedded = confirmId ? probes[confirmId]?.embedded ?? 0 : 0;

  return (
    <Card padding="md" id="embed">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-ink-3" aria-hidden />
            <h3 className="font-serif text-[15px] font-medium">
              {pick("Embedding tutarlılığı", "Embedding consistency")}
            </h3>
          </div>
          <p className="mt-1 text-[12.5px] text-ink-3">
            {pick(
              "Aynı workspace içinde farklı modellerle gömülmüş chunks retrieval'da atlanır. Tek modele yeniden göm veya embedding'leri tamamen sil.",
              "Chunks embedded with different models are skipped during retrieval. Reembed to a single model, or delete embeddings entirely.",
            )}
          </p>
        </div>
      </div>

      <div className="mt-4 space-y-2">
        {list.length === 0 ? (
          <p className="text-[12.5px] text-ink-3">
            {pick("Henüz workspace yok.", "No workspaces yet.")}
          </p>
        ) : (
          list.map((w) => {
            const probe = probes[w.id];
            const total = probe?.total ?? 0;
            const embedded = probe?.embedded ?? 0;
            const toReembed = probe?.toReembed ?? 0;

            const status = deriveEmbedStatus(total, embedded, toReembed);
            const statusLabel =
              status === "not-embedded"
                ? pick(
                    `Gömülü değil · ${total} chunk gömme bekliyor`,
                    `Not embedded · ${total} chunks awaiting embedding`,
                  )
                : status === "mismatch"
                  ? pick(
                      `${toReembed} chunk farklı model · uyumsuz`,
                      `${toReembed} chunks on a different model · mismatch`,
                    )
                  : pick("Tutarlı.", "Consistent.");

            return (
              <div
                key={w.id}
                className="flex items-center justify-between gap-3 rounded-md border border-rule-soft bg-paper-2 px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="truncate text-[13.5px] font-medium text-ink">
                    {w.name}
                  </div>
                  <div className="font-mono text-[11px] text-ink-3">
                    {statusLabel}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button size="sm" onClick={() => setOpenWorkspaceId(w.id)}>
                    {pick("Yeniden göm…", "Reembed…")}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setConfirmId(w.id)}
                    disabled={embedded === 0}
                    aria-label={pick("Embedding'i sil", "Delete embeddings")}
                    title={pick("Embedding'i sil", "Delete embeddings")}
                    className="text-err hover:text-err disabled:text-ink-3"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {openWorkspaceId ? (
        <ReembedModal
          open={true}
          onClose={() => setOpenWorkspaceId(null)}
          workspaceId={openWorkspaceId}
        />
      ) : null}

      <Modal
        open={confirmId !== null}
        onClose={deleting ? () => {} : () => setConfirmId(null)}
        title={pick("Embedding'i sil?", "Delete embeddings?")}
        description={pick(
          confirmWs
            ? `"${confirmWs.name}" workspace'indeki tüm chunk vektörleri silinecek. Metin ve kartlar kalır; arama tekrar çalışmadan önce yeniden gömme gerekir.`
            : "Tüm chunk vektörleri silinecek.",
          confirmWs
            ? `All chunk vectors in "${confirmWs.name}" will be deleted. Text and cards stay; retrieval needs a reembed before it works again.`
            : "All chunk vectors will be deleted.",
        )}
        size="sm"
        closeOnBackdrop={!deleting}
        closeOnEsc={!deleting}
        footer={
          <>
            <Button
              variant="default"
              onClick={() => setConfirmId(null)}
              disabled={deleting}
            >
              {pick("Vazgeç", "Cancel")}
            </Button>
            <Button
              variant="danger"
              onClick={() => confirmId && void handleDelete(confirmId)}
              loading={deleting}
              disabled={confirmEmbedded === 0}
            >
              {pick("Evet, sil", "Yes, delete")}
            </Button>
          </>
        }
      />
    </Card>
  );
}
