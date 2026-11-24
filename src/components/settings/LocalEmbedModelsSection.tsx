"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, Layers, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { CompatibilityChip } from "@/components/podcast/CompatibilityChip";
import { useSystemCheck } from "@/hooks/useSystemCheck";
import { useLocalePick } from "@/i18n/IntlProvider";
import { getEmbedProvider } from "@/lib/ai/providers/registry";
import { LOCAL_EMBED_MODELS, type LocalEmbedModelId } from "@/lib/embed-local/catalog";
import {
  deleteEmbedModel,
  installEmbedModel,
  listInstalledEmbedModels,
  type EmbedInstallProgress,
} from "@/lib/embed-local/install";
import { evaluateCompatibility } from "@/lib/podcast/compatibility";
import { isTauriEnvWithOverride } from "@/lib/tauri/env";
import { usePrefs } from "@/stores/prefs";

const CORE_MODELS: LocalEmbedModelId[] = [
  "local-qwen3-0.6b",
  "local-embeddinggemma-2",
  "local-embeddinggemma-300m",
  "local-minilm-multilingual",
  "local-minilm-l6",
];

function sizeLabel(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

export function LocalEmbedModelsSection() {
  const pick = useLocalePick();
  const { toast } = useToast();
  const system = useSystemCheck();
  const boundPresetId = usePrefs((state) => state.modelBindings.embedPresetId);
  const desktop = isTauriEnvWithOverride();
  const [installed, setInstalled] = useState<Set<string>>(() => new Set());
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<LocalEmbedModelId | null>(null);
  const [progress, setProgress] = useState<EmbedInstallProgress | null>(null);
  const [deleteId, setDeleteId] = useState<LocalEmbedModelId | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const models = await listInstalledEmbedModels();
      setInstalled(new Set(models.map((model) => model.modelId)));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => { if (active) void refresh().catch(() => {}); });
    return () => { active = false; };
  }, [refresh]);

  async function install(id: LocalEmbedModelId) {
    setBusyId(id);
    setProgress({ modelId: id, downloadedBytes: 0, totalBytes: LOCAL_EMBED_MODELS[id].sizeBytes });
    try {
      await installEmbedModel({ modelId: id, onProgress: setProgress });
      await refresh();
      toast({ variant: "success", title: pick("Model kuruldu", "Model installed") });
    } catch (error) {
      toast({
        variant: "error",
        title: pick("Model indirilemedi", "Model download failed"),
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusyId(null);
      setProgress(null);
    }
  }

  async function test(id: LocalEmbedModelId) {
    setBusyId(id);
    try {
      const result = await getEmbedProvider("local-embed").embed({
        apiKey: "",
        model: id,
        inputs: ["What is photosynthesis?"],
        inputType: "query",
      });
      if (result.vectors[0]?.length !== LOCAL_EMBED_MODELS[id].dim) {
        throw new Error("Embedding dimension did not match the model catalog");
      }
      toast({ variant: "success", title: pick("Model çalışıyor", "Model works") });
    } catch (error) {
      toast({
        variant: "error",
        title: pick("Model testi başarısız", "Model test failed"),
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusyId(null);
    }
  }

  async function remove() {
    if (!deleteId) return;
    const id = deleteId;
    if (boundPresetId === id) return;
    setBusyId(id);
    try {
      await deleteEmbedModel({ modelId: id });
      setDeleteId(null);
      await refresh();
      toast({ variant: "success", title: pick("Model silindi", "Model deleted") });
    } catch (error) {
      toast({
        variant: "error",
        title: pick("Model silinemedi", "Could not delete model"),
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card padding="md" id="local-embed-models">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-ink-3" aria-hidden />
            <h3 className="font-serif text-[15px] font-medium">
              {pick("Yerel embedding modelleri", "Local embedding models")}
            </h3>
          </div>
          <p className="mt-1 text-[12.5px] text-ink-3">
            {pick(
              "Modeller yalnızca İndir'e bastığında uygulama veri klasörüne kurulur. Kurulan modeli varsayılan model veya Yeniden göm ekranında seçebilirsin.",
              "Models install into app data only when you select Download. Installed models become available as the default or reembedding target.",
            )}
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={() => void refresh().catch((error) => toast({ variant: "error", title: pick("Model listesi okunamadı", "Could not read model list"), description: String(error) }))} disabled={loading || busyId !== null} aria-label={pick("Modelleri yenile", "Refresh models")}>
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
      </div>

      {!desktop ? (
        <p className="mt-4 text-[12.5px] text-ink-3">
          {pick("Uygulama içi model kurulumu masaüstü sürümünde kullanılabilir.", "In-app model installation is available in the desktop app.")}
        </p>
      ) : null}

      <ul className="mt-4 space-y-2">
        {CORE_MODELS.map((id) => {
          const spec = LOCAL_EMBED_MODELS[id];
          const isInstalled = installed.has(id);
          const isBusy = busyId === id;
          const verdict = evaluateCompatibility(
            { ...spec.requirements, diskBytes: isInstalled ? 0 : spec.requirements.diskBytes },
            system.system, system.gpu,
          );
          const pct = isBusy && progress?.modelId === id && progress.totalBytes > 0
            ? Math.min(100, Math.round(progress.downloadedBytes / progress.totalBytes * 100))
            : 0;
          return (
            <li key={id} className="rounded-md border border-rule-soft bg-paper-2 px-3 py-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13.5px] font-medium text-ink">{spec.name}</span>
                    <span className="font-mono text-[10.5px] text-ink-3">{sizeLabel(spec.sizeBytes)} · {spec.dim}d · {spec.languages}</span>
                    {desktop && system.state === "ready" ? <CompatibilityChip verdict={verdict} size="sm" /> : null}
                  </div>
                  <p className="mt-1 text-[12px] text-ink-3">{pick(spec.description.tr, spec.description.en)}</p>
                  {isInstalled ? <p className="mt-1 font-mono text-[11px] text-ok">{pick("Kurulu · Yerel · Ücretsiz", "Installed · Local · Free")}{boundPresetId === id ? ` · ${pick("Varsayılan", "Default")}` : ""}</p> : null}
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {isInstalled ? (
                    <>
                      <Button size="sm" variant="ghost" onClick={() => void test(id)} disabled={!desktop || busyId !== null || loading}>
                        {pick("Test et", "Test")}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setDeleteId(id)} disabled={!desktop || busyId !== null || loading || boundPresetId === id} title={boundPresetId === id ? pick("Silmeden önce varsayılan modeli değiştir", "Change the default model before deleting") : undefined} aria-label={pick(`${spec.name} modelini sil`, `Delete ${spec.name}`)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </>
                  ) : (
                    <Button size="sm" onClick={() => void install(id)} disabled={!desktop || busyId !== null || loading || verdict.level === "red"}>
                      <Download className="mr-1 h-3.5 w-3.5" />{isBusy ? pick("İndiriliyor", "Downloading") : pick("İndir", "Download")}
                    </Button>
                  )}
                </div>
              </div>
              {isBusy && progress?.modelId === id ? (
                <div className="mt-2" role="progressbar" aria-label={pick(`${spec.name} indirme ilerlemesi`, `${spec.name} download progress`)} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                  <div className="h-1.5 overflow-hidden rounded-full bg-paper-3">
                    <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="font-mono text-[10.5px] text-ink-3">{pct}%</span>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      <Modal
        open={deleteId !== null}
        onClose={() => setDeleteId(null)}
        title={pick("Yerel modeli sil?", "Delete local model?")}
        description={deleteId === boundPresetId
          ? pick("Bu model şu anda varsayılan. Sildikten sonra Ayarlar → Modeller'den başka bir embedding modeli seçmen gerekir.", "This is the current default. After deleting it, choose another embedding model in Settings → Models.")
          : pick("Model dosyaları uygulama veri klasöründen silinecek. Mevcut chunk vektörleri kalır.", "Model files will be removed from app data. Existing chunk vectors remain.")}
        size="sm"
        footer={<>
          <Button variant="default" onClick={() => setDeleteId(null)}>{pick("Vazgeç", "Cancel")}</Button>
          <Button variant="danger" onClick={() => void remove()} loading={busyId === deleteId}>{pick("Modeli sil", "Delete model")}</Button>
        </>}
      />
    </Card>
  );
}
