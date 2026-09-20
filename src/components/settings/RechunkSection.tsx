"use client";

// Settings → Source structure. Rebuilds every source's chunks with the current
// chunker so documents ingested before the structure-preserving chunker
// (2026-09) render with their paragraphs, lists and rules intact again.
//
// Sibling of EmbedSection and deliberately shaped like it: one row per
// workspace, a count of what can be rebuilt, one action. Inline TR/EN strings
// via useLocalePick, as the other settings sections do.

import { useCallback, useEffect, useState } from "react";
import { AlignLeft } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { useToast } from "@/components/ui/Toast";
import { useLocalePick } from "@/i18n/IntlProvider";
import { useWorkspaces } from "@/lib/db/hooks";
import { planRechunk, runRechunk, type RechunkPlanItem } from "@/lib/ingest/rechunk";

type Probe = { runnable: number; needsReupload: number; other: number };

function summarise(plan: RechunkPlanItem[]): Probe {
  let runnable = 0;
  let needsReupload = 0;
  let other = 0;
  for (const p of plan) {
    if (p.strategy !== "unsupported") runnable += 1;
    else if (p.reason === "no_blob") needsReupload += 1;
    else other += 1;
  }
  return { runnable, needsReupload, other };
}

export function RechunkSection() {
  const pick = useLocalePick();
  const { toast } = useToast();
  const workspaces = useWorkspaces(false);
  const list = workspaces ?? [];

  const [probes, setProbes] = useState<Record<string, Probe>>({});
  const [failures, setFailures] = useState<string[]>([]);
  const [running, setRunning] = useState<{ id: string; done: number; total: number } | null>(
    null,
  );

  const probeWorkspace = useCallback(async (id: string): Promise<Probe> => {
    try {
      return summarise(await planRechunk(id));
    } catch {
      return { runnable: 0, needsReupload: 0, other: 0 };
    }
  }, []);

  const ids = list.map((w) => w.id).join(",");
  useEffect(() => {
    if (list.length === 0) return;
    let cancelled = false;
    void (async () => {
      const next: Record<string, Probe> = {};
      for (const w of list) next[w.id] = await probeWorkspace(w.id);
      if (!cancelled) setProbes(next);
    })();
    return () => {
      cancelled = true;
    };
    // Re-probe when the workspace set changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids, probeWorkspace]);

  async function handleRun(id: string): Promise<void> {
    setFailures([]);
    setRunning({ id, done: 0, total: 0 });
    try {
      const report = await runRechunk(id, {
        onProgress: (done, total) => setRunning({ id, done, total }),
      });
      const fresh = await probeWorkspace(id);
      setProbes((prev) => ({ ...prev, [id]: fresh }));
      const failed = report.failed.length;
      setFailures(report.failed.map(({ item, message }) => `${item.source.title}: ${message}`));
      toast({
        variant: failed > 0 ? "error" : "success",
        title: pick("Yeniden parçalandı", "Re-chunked"),
        description: pick(
          `${report.done.length} kaynak yenilendi${failed ? `, ${failed} başarısız` : ""}${
            report.skipped.length ? `, ${report.skipped.length} atlandı` : ""
          }. Embedding'ler sıfırlandı; Embedding tutarlılığı bölümünden yeniden göm.`,
          `${report.done.length} source(s) rebuilt${failed ? `, ${failed} failed` : ""}${
            report.skipped.length ? `, ${report.skipped.length} skipped` : ""
          }. Embeddings were reset; reembed from the Embedding consistency section.`,
        ),
      });
    } catch (err) {
      toast({
        variant: "error",
        title: pick("Yeniden parçalama başarısız", "Re-chunk failed"),
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setRunning(null);
    }
  }

  return (
    <Card padding="md" id="rechunk">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <AlignLeft className="h-4 w-4 text-ink-3" aria-hidden />
            <h3 className="font-serif text-[15px] font-medium">
              {pick("Kaynak yapısı", "Source structure")}
            </h3>
          </div>
          <p className="mt-1 text-[12.5px] text-ink-3">
            {pick(
              "Kaynakları güncel parçalayıcıyla yeniden üret. Embedding'ler sıfırlanır. Kart, sohbet, ders, analiz ve vurgulardaki eski parça bağlantıları geçersiz kalabilir; ilgili içerikleri yeniden üretmen gerekebilir.",
              "Rebuild sources with the current chunker. Embeddings are reset. Existing chunk links in cards, chats, lessons, analyses and highlights may stop working; you may need to regenerate the related content.",
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
            const runnable = probe?.runnable ?? 0;
            const needsReupload = probe?.needsReupload ?? 0;
            const isRunning = running?.id === w.id;
            const label = isRunning
              ? pick(
                  `Yeniden parçalanıyor · ${running.done}/${running.total}`,
                  `Re-chunking · ${running.done}/${running.total}`,
                )
              : pick(
                  `${runnable} kaynak yenilenebilir${
                    needsReupload ? ` · ${needsReupload} kaynak yeniden yüklenmeli` : ""
                  }`,
                  `${runnable} source(s) can be rebuilt${
                    needsReupload ? ` · ${needsReupload} need a re-upload` : ""
                  }`,
                );
            return (
              <div
                key={w.id}
                className="flex items-center justify-between gap-3 rounded-md border border-rule-soft bg-paper-2 px-3 py-2"
                data-testid={`rechunk-row-${w.id}`}
              >
                <div className="min-w-0">
                  <div className="truncate text-[13.5px] font-medium text-ink">{w.name}</div>
                  <div className="font-mono text-[11px] text-ink-3">{label}</div>
                </div>
                <Button
                  size="sm"
                  onClick={() => void handleRun(w.id)}
                  disabled={runnable === 0 || running !== null}
                >
                  {pick("Yeniden parçala", "Re-chunk")}
                </Button>
              </div>
            );
          })
        )}
      </div>

      {failures.length > 0 && (
        <ul role="alert" className="mt-3 space-y-1 text-xs text-warn">
          {failures.map((message, index) => <li key={index}>{message}</li>)}
        </ul>
      )}
    </Card>
  );
}
