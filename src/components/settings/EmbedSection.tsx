"use client";

import { useEffect, useState } from "react";
import { Layers } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { useLocalePick } from "@/i18n/IntlProvider";
import { useWorkspaces } from "@/lib/db/hooks";
import { planReembed } from "@/lib/ingest/reembed";
import type { EmbedPresetId } from "@/lib/ai/providers/embed-presets";
import { ReembedModal } from "./ReembedModal";

const DEFAULT_PROBE_PRESET: EmbedPresetId = "openai-3-small";

export function EmbedSection() {
  const pick = useLocalePick();
  const workspaces = useWorkspaces(false);
  const list = workspaces ?? [];

  // workspaceId → toReembed count probed against the default preset (1536-d).
  // The probe only tells the user "you have a mismatch somewhere"; the modal
  // recomputes per chosen target.
  const [skipped, setSkipped] = useState<Record<string, number>>({});
  const [openWorkspaceId, setOpenWorkspaceId] = useState<string | null>(null);

  useEffect(() => {
    if (list.length === 0) return;
    let cancelled = false;
    void (async () => {
      const next: Record<string, number> = {};
      for (const w of list) {
        try {
          const p = await planReembed(
            { kind: "workspace", workspaceId: w.id },
            DEFAULT_PROBE_PRESET,
          );
          next[w.id] = p.toReembed;
        } catch {
          next[w.id] = 0;
        }
      }
      if (!cancelled) setSkipped(next);
    })();
    return () => {
      cancelled = true;
    };
    // Re-probe when workspace set changes (count or ids).
  }, [list.length, list.map((w) => w.id).join(",")]);

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
              "Aynı workspace içinde farklı modellerle gömülmüş chunks retrieval'da atlanır. Tek modele yeniden göm.",
              "Chunks embedded with different models are skipped during retrieval. Reembed to a single model.",
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
            const count = skipped[w.id] ?? 0;
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
                    {count > 0
                      ? pick(
                          `${count} chunk farklı model · uyumsuz`,
                          `${count} chunks on a different model · mismatch`,
                        )
                      : pick("Tutarlı.", "Consistent.")}
                  </div>
                </div>
                <Button size="sm" onClick={() => setOpenWorkspaceId(w.id)}>
                  {pick("Yeniden göm…", "Reembed…")}
                </Button>
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
    </Card>
  );
}
