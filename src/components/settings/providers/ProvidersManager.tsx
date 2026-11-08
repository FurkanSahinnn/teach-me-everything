"use client";

import { useEffect, useMemo, useState } from "react";

import { Plus, RefreshCw } from "@/components/icons";
import { CustomEndpointModal } from "@/components/settings/CustomEndpointModal";
import { Button } from "@/components/ui/Button";
import { useApiKeyManager } from "@/hooks/useApiKeyManager";
import { useLocalePick } from "@/i18n/IntlProvider";
import { useAgentStatus } from "@/lib/ai/agent-status/store";
import { buildProviderCatalog } from "@/lib/ai/provider-catalog";
import type { Provider } from "@/lib/db/schema";
import { usePrefs } from "@/stores/prefs";

import { ApiProviderDetail } from "./ApiProviderDetail";
import { CliProviderDetail } from "./CliProviderDetail";
import { ProviderList } from "./ProviderList";

/** Every key slot a chat provider on this page can use. */
const KEY_PROVIDERS: Provider[] = [
  "anthropic",
  "claude-code-oauth",
  "openai",
  "google-gemini",
  "openrouter",
  "groq",
  "deepseek",
  "glm",
  "xai",
  "mistral",
  "together",
  "cerebras",
  "perplexity",
  "ollama",
  "lm-studio",
  "llama-cpp",
];

export function ProvidersManager() {
  const pick = useLocalePick();
  const keys = useApiKeyManager(KEY_PROVIDERS);
  const statuses = useAgentStatus((s) => s.statuses);
  const loading = useAgentStatus((s) => s.loading);
  const refresh = useAgentStatus((s) => s.refresh);
  const customEndpoints = usePrefs((s) => s.customEndpoints);
  const disabledProviders = usePrefs((s) => s.disabledProviders);
  const setProviderEnabled = usePrefs((s) => s.setProviderEnabled);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const storedKeySignature = KEY_PROVIDERS.filter((p) => keys.isStored(p)).join(",");
  const entries = useMemo(
    () =>
      buildProviderCatalog({
        storedKeys: new Set(storedKeySignature ? storedKeySignature.split(",") : []),
        agentStatuses: statuses,
        customEndpoints,
        disabledProviders: new Set(disabledProviders),
      }),
    [storedKeySignature, statuses, customEndpoints, disabledProviders],
  );

  const selected = entries.find((e) => e.id === selectedId) ?? entries[0] ?? null;
  const lastChecked = Math.max(0, ...Object.values(statuses).map((s) => s?.checkedAt ?? 0));

  return (
    <>
      <div className="mb-3 flex items-center justify-end gap-2 text-[12px] text-ink-3">
        <span aria-live="polite">
          {loading
            ? pick("Yerel CLI'lar kontrol ediliyor…", "Checking local CLIs…")
            : lastChecked > 0
              ? pick(`Son kontrol ${new Date(lastChecked).toLocaleTimeString("tr-TR")}`, `Checked at ${new Date(lastChecked).toLocaleTimeString("en-US")}`)
              : null}
        </span>
        <Button size="sm" variant="ghost" onClick={() => void refresh(undefined, { force: true })} disabled={loading}>
          <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          {pick("Yeniden kontrol et", "Check again")}
        </Button>
      </div>

      <div className="grid overflow-hidden rounded-[var(--radius-lg)] border border-rule bg-paper-2 lg:grid-cols-[290px_minmax(0,1fr)]">
        <div className="border-b border-rule lg:border-b-0 lg:border-r">
          <ProviderList entries={entries} selectedId={selected?.id ?? null} onSelect={setSelectedId} onToggle={setProviderEnabled} />
          <div className="border-t border-rule p-1.5">
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              className="flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-2 py-2 text-left text-[13px] text-ink-2 hover:bg-paper-3 hover:text-ink"
            >
              <Plus className="h-4 w-4" aria-hidden />
              {pick("Sağlayıcı ekle", "Add provider")}
            </button>
          </div>
        </div>
        <div className="min-w-0 bg-paper p-5">
          {selected?.cli ? (
            <CliProviderDetail key={selected.id} cli={selected.cli} label={selected.label} />
          ) : selected ? (
            <ApiProviderDetail key={selected.id} entry={selected} keys={keys} />
          ) : null}
        </div>
      </div>

      <CustomEndpointModal open={addOpen} onClose={() => setAddOpen(false)} pick={pick} />
    </>
  );
}
