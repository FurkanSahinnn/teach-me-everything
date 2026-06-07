"use client";

import { Check, Plus, Server, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { useApiKeyManager } from "@/hooks/useApiKeyManager";
import { isLocalUrl } from "@/lib/ai/providers/local-bypass";
import { usePrefs, type CustomEndpoint } from "@/stores/prefs";
import {
  CustomEndpointModal,
  type CustomEndpointPrefill,
} from "./CustomEndpointModal";

const QUICK_STARTS: CustomEndpointPrefill[] = [
  { label: "Ollama", baseUrl: "http://localhost:11434/v1", family: "openai-compat" },
  { label: "LM Studio", baseUrl: "http://localhost:1234/v1", family: "openai-compat" },
  { label: "llama.cpp", baseUrl: "http://localhost:8080/v1", family: "openai-compat" },
];

type Props = {
  pick: (tr: string, en: string) => string;
};

export function CustomEndpointSection({ pick }: Props): React.ReactElement {
  const endpoints = usePrefs((s) => s.customEndpoints);
  const removeCustomEndpoint = usePrefs((s) => s.removeCustomEndpoint);
  const keys = useApiKeyManager();

  const [modalOpen, setModalOpen] = useState(false);
  const [prefill, setPrefill] = useState<CustomEndpointPrefill | undefined>(undefined);

  function openBlank(): void {
    setPrefill(undefined);
    setModalOpen(true);
  }

  function openWithPrefill(p: CustomEndpointPrefill): void {
    setPrefill(p);
    setModalOpen(true);
  }

  async function handleRemove(ep: CustomEndpoint): Promise<void> {
    const ok = window.confirm(
      pick(
        `"${ep.label}" sağlayıcısını silmek istediğine emin misin?`,
        `Remove "${ep.label}"?`,
      ),
    );
    if (!ok) return;
    if (ep.hasKey) {
      // Best-effort: clear the vault entry. If the vault is locked the
      // remove call will surface its own error; we still drop the endpoint
      // so it does not linger in the picker.
      await keys.remove(`custom:${ep.id}`);
    }
    removeCustomEndpoint(ep.id);
  }

  return (
    <>
      <Card padding="md">
        <div className="flex items-start gap-3">
          <span
            className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border border-rule bg-paper-2 text-accent"
            aria-hidden
          >
            <Server className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-[15px] font-semibold leading-tight text-ink">
              {pick("Özel sağlayıcılar", "Custom providers")}
            </h3>
            <p className="mt-1 max-w-[60ch] text-[13px] leading-6 text-ink-3">
              {pick(
                "Kendi OpenAI-uyumlu sunucularını ekle. Yerel adresler (localhost / LAN) doğrudan çağrılır — istekler proxy'den geçmez.",
                "Add your own OpenAI-compatible servers. Local addresses (localhost / LAN) are called directly — requests skip our proxy.",
              )}
            </p>

            {endpoints.length === 0 ? (
              <p className="mt-3 rounded-md border border-rule-soft bg-paper-2 px-3 py-2 text-[12.5px] text-ink-3">
                {pick(
                  "Henüz özel sağlayıcı yok. Aşağıdaki hızlı başlangıçlardan birini seç ya da boş bir form aç.",
                  "No custom providers yet. Pick a quick-start below or start with a blank form.",
                )}
              </p>
            ) : (
              <ul className="mt-3 space-y-2">
                {endpoints.map((ep) => (
                  <li key={ep.id}>
                    <EndpointRow ep={ep} onRemove={() => void handleRemove(ep)} pick={pick} />
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button size="sm" variant="primary" onClick={openBlank}>
                <Plus className="h-3.5 w-3.5" aria-hidden />
                {pick("Özel sağlayıcı ekle", "Add custom provider")}
              </Button>
              <span className="rounded-[8px] border border-rule-soft bg-paper-2 px-2 py-1 font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-3">
                {pick("Hızlı başlangıç", "Quick start")}
              </span>
              {QUICK_STARTS.map((qs) => (
                <Button
                  key={qs.label}
                  size="sm"
                  variant="default"
                  onClick={() => openWithPrefill(qs)}
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden />
                  {qs.label}
                </Button>
              ))}
            </div>
          </div>
        </div>
      </Card>

      <CustomEndpointModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        prefill={prefill}
        pick={pick}
      />
    </>
  );
}

function EndpointRow({
  ep,
  onRemove,
  pick,
}: {
  ep: CustomEndpoint;
  onRemove: () => void;
  pick: (tr: string, en: string) => string;
}): React.ReactElement {
  const local = isLocalUrl(ep.baseUrl);
  return (
    <Card padding="sm" variant="sunken">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[14px] font-medium text-ink">{ep.label}</span>
            <Chip>{ep.family}</Chip>
            {local ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-[color:color-mix(in_srgb,var(--moss)_14%,transparent)] px-2 py-0.5 font-mono text-[10.5px] text-[color:var(--moss)]">
                {pick("yerel", "local")}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full border border-rule-soft px-2 py-0.5 font-mono text-[10.5px] text-ink-3">
                {pick("cloud", "cloud")}
              </span>
            )}
            {ep.hasKey ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 font-mono text-[10.5px] text-accent-ink">
                <Check className="h-3 w-3" aria-hidden />
                {pick("anahtar", "key")}
              </span>
            ) : null}
          </div>
          <div className="mt-0.5 truncate font-mono text-[11.5px] text-ink-3">
            {ep.baseUrl}
          </div>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={onRemove}
          aria-label={pick("Sil", "Remove")}
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden />
        </Button>
      </div>
    </Card>
  );
}
