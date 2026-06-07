"use client";

import { Check, Loader2, AlertCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { useApiKeyManager } from "@/hooks/useApiKeyManager";
import { isLocalUrl } from "@/lib/ai/providers/local-bypass";
import { usePrefs, type CustomEndpoint, type CustomEndpointFamily } from "@/stores/prefs";

type TestState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; latencyMs: number; modelCount?: number }
  | { kind: "fail"; message: string }
  | { kind: "skip"; reason: string };

export type CustomEndpointPrefill = {
  label: string;
  baseUrl: string;
  family: CustomEndpointFamily;
};

type Props = {
  open: boolean;
  onClose: () => void;
  prefill?: CustomEndpointPrefill | undefined;
  pick: (tr: string, en: string) => string;
};

function makeEndpointId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID().slice(0, 10);
  }
  return Math.random().toString(36).slice(2, 12);
}

function joinModelsUrl(baseUrl: string): string {
  const trimmed = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  return `${trimmed}/models`;
}

export function CustomEndpointModal({ open, onClose, prefill, pick }: Props): React.ReactElement {
  const addCustomEndpoint = usePrefs((s) => s.addCustomEndpoint);
  const keys = useApiKeyManager();

  const [label, setLabel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [family, setFamily] = useState<CustomEndpointFamily>("openai-compat");
  const [apiKey, setApiKey] = useState("");
  const [test, setTest] = useState<TestState>({ kind: "idle" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset / hydrate every time the modal opens so each create flow starts
  // with a clean form (or the requested quick-start prefill).
  useEffect(() => {
    if (!open) return;
    const nextLabel = prefill?.label ?? "";
    const nextBaseUrl = prefill?.baseUrl ?? "";
    const nextFamily = prefill?.family ?? "openai-compat";
    queueMicrotask(() => {
      setLabel(nextLabel);
      setBaseUrl(nextBaseUrl);
      setFamily(nextFamily);
      setApiKey("");
      setTest({ kind: "idle" });
      setError(null);
      setBusy(false);
    });
  }, [open, prefill]);

  const trimmedUrl = baseUrl.trim();
  const trimmedLabel = label.trim();
  const urlIsValid = useMemo(() => {
    if (!trimmedUrl) return false;
    try {
      const u = new URL(trimmedUrl);
      return u.protocol === "http:" || u.protocol === "https:";
    } catch {
      return false;
    }
  }, [trimmedUrl]);
  const isLocal = urlIsValid && isLocalUrl(trimmedUrl);
  const canSave = trimmedLabel.length > 0 && urlIsValid && !busy;

  async function runTest(): Promise<void> {
    if (!urlIsValid) return;
    if (!isLocal) {
      setTest({
        kind: "skip",
        reason: pick(
          "Cloud endpoint testi için anahtarı kaydedip sohbette dene.",
          "For cloud endpoints, save the key and test in chat.",
        ),
      });
      return;
    }
    setTest({ kind: "loading" });
    const start = performance.now();
    try {
      const headers: Record<string, string> = { accept: "application/json" };
      if (apiKey) headers.authorization = `Bearer ${apiKey}`;
      const res = await fetch(joinModelsUrl(trimmedUrl), {
        method: "GET",
        headers,
      });
      const latencyMs = Math.round(performance.now() - start);
      if (!res.ok) {
        setTest({ kind: "fail", message: `HTTP ${res.status}` });
        return;
      }
      let modelCount: number | undefined;
      try {
        const data = (await res.json()) as { data?: unknown[] };
        if (Array.isArray(data.data)) modelCount = data.data.length;
      } catch {
        /* server returned non-JSON; still treat 200 as success */
      }
      setTest(
        modelCount !== undefined
          ? { kind: "ok", latencyMs, modelCount }
          : { kind: "ok", latencyMs },
      );
    } catch (err) {
      setTest({
        kind: "fail",
        message: err instanceof Error ? err.message : pick("Ağ hatası", "Network error"),
      });
    }
  }

  async function handleSave(): Promise<void> {
    if (!canSave) return;
    setBusy(true);
    setError(null);
    try {
      const trimmedKey = apiKey.trim();
      const hasKey = trimmedKey.length > 0;

      // (Post-Phase-9: the master-password vault is gone — `keys.isUnlocked`
      // is a const-true stub, so the old "vault locked" guard here was dead
      // code and has been removed. Keys persist directly via keys.save below.)
      const id = makeEndpointId();
      const provider = `custom:${id}` as const;

      if (hasKey) {
        keys.setDraft(provider, trimmedKey);
        await keys.save(provider);
      }

      const endpoint: CustomEndpoint = {
        id,
        label: trimmedLabel,
        baseUrl: trimmedUrl,
        family,
        hasKey,
        createdAt: Date.now(),
      };
      addCustomEndpoint(endpoint);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : pick("Kaydetme hatası", "Save failed"));
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title={pick("Özel sağlayıcı ekle", "Add custom provider")}
      description={pick(
        "Kendi OpenAI-uyumlu sunucunu (Ollama, LM Studio, llama.cpp veya self-hosted) bağla.",
        "Connect your own OpenAI-compatible server (Ollama, LM Studio, llama.cpp, or self-hosted).",
      )}
      footer={
        <>
          <Button variant="default" onClick={onClose} disabled={busy}>
            {pick("İptal", "Cancel")}
          </Button>
          <Button variant="primary" onClick={() => void handleSave()} disabled={!canSave}>
            {busy ? pick("Kaydediliyor…", "Saving…") : pick("Kaydet", "Save")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field
          label={pick("Etiket", "Label")}
          hint={pick("Liste ve seçimde gösterilen ad.", "Shown in lists and pickers.")}
        >
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={pick("Ev sunucum", "My home server")}
          />
        </Field>

        <Field
          label={pick("Base URL", "Base URL")}
          hint={pick(
            "OpenAI uyumlu kök URL — örn. http://localhost:11434/v1",
            "OpenAI-compatible root URL — e.g. http://localhost:11434/v1",
          )}
        >
          <Input
            variant="mono"
            value={baseUrl}
            onChange={(e) => {
              setBaseUrl(e.target.value);
              if (test.kind !== "idle") setTest({ kind: "idle" });
            }}
            placeholder="http://localhost:11434/v1"
          />
          {trimmedUrl && !urlIsValid ? (
            <p className="mt-1 text-[12px] text-[color:var(--err)]">
              {pick("Geçerli bir http(s) URL gerekli.", "A valid http(s) URL is required.")}
            </p>
          ) : null}
          {urlIsValid ? (
            <p className="mt-1 font-mono text-[11px] text-ink-3">
              {isLocal
                ? pick(
                    "✓ Yerel adres — istek doğrudan makineye gider, proxy atlanır.",
                    "✓ Local address — request goes direct, proxy bypassed.",
                  )
                : pick(
                    "Cloud adres — istek /api/ai/chat proxy'sinden geçer.",
                    "Cloud address — request routes through /api/ai/chat proxy.",
                  )}
            </p>
          ) : null}
        </Field>

        <Field
          label={pick("Aile", "Family")}
          hint={pick(
            "Çoğu yerel sunucu OpenAI-uyumlu. Gemini ailesi yalnız resmi Google API için.",
            "Most local servers are OpenAI-compatible. Gemini family is for the official Google API only.",
          )}
        >
          <SegmentedControl<CustomEndpointFamily>
            size="sm"
            value={family}
            onChange={setFamily}
            ariaLabel="Family"
            options={[
              { value: "openai-compat", label: "OpenAI-compat" },
              { value: "gemini", label: "Gemini" },
            ]}
          />
        </Field>

        <Field
          label={pick("API anahtarı (opsiyonel)", "API key (optional)")}
          hint={pick(
            "Sunucun anahtar gerektirmiyorsa boş bırak (Ollama default).",
            "Leave empty if your server is keyless (Ollama default).",
          )}
        >
          <Input
            type="password"
            variant="mono"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-..."
          />
        </Field>

        <div className="flex items-center gap-2 pt-1">
          <Button
            variant="default"
            size="sm"
            onClick={() => void runTest()}
            disabled={!urlIsValid || test.kind === "loading"}
          >
            {test.kind === "loading" ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                {pick("Test ediliyor…", "Testing…")}
              </>
            ) : (
              pick("Bağlantıyı test et", "Test connection")
            )}
          </Button>
          <TestResult test={test} pick={pick} />
        </div>

        {error ? (
          <div className="rounded-md border border-[color:color-mix(in_srgb,var(--err)_40%,transparent)] bg-[color:color-mix(in_srgb,var(--err)_10%,transparent)] px-3 py-2 text-[12.5px] text-[color:var(--err)]">
            <AlertCircle className="mr-1.5 inline h-3.5 w-3.5" aria-hidden />
            {error}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div>
      <label className="mb-1 block text-[13px] font-medium text-ink">{label}</label>
      {children}
      {hint ? <p className="mt-1 text-[11.5px] text-ink-3">{hint}</p> : null}
    </div>
  );
}

function TestResult({
  test,
  pick,
}: {
  test: TestState;
  pick: (tr: string, en: string) => string;
}): React.ReactElement | null {
  if (test.kind === "ok") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[12px] text-[color:var(--moss)]">
        <Check className="h-3.5 w-3.5" aria-hidden />
        <span>{pick("Bağlantı başarılı", "Connected")}</span>
        <span className="font-mono text-[11px] text-ink-3">
          · {test.latencyMs}ms
          {test.modelCount !== undefined
            ? ` · ${test.modelCount} ${pick("model", "models")}`
            : ""}
        </span>
      </span>
    );
  }
  if (test.kind === "fail") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[12px] text-[color:var(--err)]">
        <AlertCircle className="h-3.5 w-3.5" aria-hidden />
        <span className="font-mono text-[11.5px]">{test.message}</span>
      </span>
    );
  }
  if (test.kind === "skip") {
    return <span className="text-[11.5px] text-ink-3">{test.reason}</span>;
  }
  return null;
}
