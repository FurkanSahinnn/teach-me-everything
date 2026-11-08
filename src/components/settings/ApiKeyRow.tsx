"use client";

import { Check, Lock, ShieldCheck, Trash2 } from "@/components/icons";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { useLocalePick } from "@/i18n/IntlProvider";
import { testApiKey } from "@/lib/ai/upstream/test-key";
import { isKeychainAvailable } from "@/lib/crypto/keychain";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Input } from "@/components/ui/Input";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Switch } from "@/components/ui/Switch";
import { SettingsRow } from "@/components/settings/layout/SettingsPrimitives";
import { useApiKeyManager } from "@/hooks/useApiKeyManager";
import { type Provider } from "@/lib/db/schema";
import { cn } from "@/lib/utils/cn";
import { usePrefs } from "@/stores/prefs";

export type ApiKeyManager = ReturnType<typeof useApiKeyManager>;

// Wizard's 4 + the 5 quick-start providerIds (deduped). Without the wider
// list, useApiKeyManager would silently drop drafts for gemini / groq /
// openrouter / ollama coming from the QuickStart row in the Models page.
export const SETTINGS_PROVIDERS: Provider[] = [
  "anthropic",
  "claude-code-oauth",
  "openai",
  "firecrawl",
  "diffbot",
  "brightdata",
  "brave",
  "google-gemini",
  "groq",
  "openrouter",
  "ollama",
];

export function AnthropicPreferenceRow() {
  const pick = useLocalePick();
  const value = usePrefs((s) => s.preferredAnthropicAuth);
  const setValue = usePrefs((s) => s.setPreferredAnthropicAuth);
  const strict = usePrefs((s) => s.strictAnthropicAuth);
  const setStrict = usePrefs((s) => s.setStrictAnthropicAuth);
  return (
    <>
      <SettingsRow
        title={pick("Anthropic önceliği", "Anthropic preference")}
        description={
          strict
            ? pick(
                "Yalnız seçili olan kullanılır — boş ya da hatalıysa istek başarısız olur.",
                "Only the selected one is used — request fails if it's empty or invalid.",
              )
            : pick(
                "Seçili olan denenir; boş ya da hatalıysa diğerine düşülür.",
                "The selected one is tried first; falls back to the other if empty or invalid.",
              )
        }
        control={
          <SegmentedControl
            value={value}
            onChange={setValue}
            ariaLabel={pick("Anthropic önceliği", "Anthropic preference")}
            options={[
              { value: "oauth", label: pick("Önce OAuth", "Prefer OAuth") },
              { value: "api-key", label: pick("Önce API key", "Prefer API key") },
            ]}
          />
        }
      />
      <SettingsRow
        title={pick("Yalnız bunu kullan", "Use only this one")}
        description={pick(
          "Yedeğe düşmeyi kapatır — diğer credential kayıtlı kalır ama AI çağrılarında kullanılmaz.",
          "Disables fallback — the other credential stays saved but is never used in AI calls.",
        )}
        control={
          <Switch
            checked={strict}
            onCheckedChange={setStrict}
            ariaLabel={pick("Yalnız bunu kullan", "Use only this one")}
          />
        }
      />
    </>
  );
}

export function VaultBanner() {
  const pick = useLocalePick();
  const keychainBacked = isKeychainAvailable();
  // Phase 9 — Two flavours, both read-only:
  //   • Tauri  → "Keys stored in OS keychain" (existing 8.D pill).
  //   • Web    → "Dev mode: keys are stored unencrypted in local storage."
  //     The web build is not distributed (Tauri binary via GitHub Releases is
  //     the only release channel), so this is just a transparency banner for
  //     `npm run dev` users.
  if (keychainBacked) {
    return (
      <div
        className={cn(
          "flex items-center justify-between gap-3 rounded-lg border px-4 py-2.5",
          "border-[color:color-mix(in_srgb,var(--moss)_30%,transparent)] bg-[color:color-mix(in_srgb,var(--moss)_8%,transparent)]",
        )}
      >
        <div className="flex items-center gap-2">
          <ShieldCheck
            className="h-4 w-4 text-[color:var(--moss)]"
            aria-hidden
          />
          <span className="text-[13px] text-ink-2">
            {pick(
              "Anahtarlar OS keychain'de saklanıyor",
              "Keys stored in OS keychain",
            )}
          </span>
        </div>
      </div>
    );
  }
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 rounded-lg border px-4 py-2.5",
        "border-rule-soft bg-paper-2",
      )}
    >
      <div className="flex items-center gap-2">
        <Lock className="h-4 w-4 text-ink-3" aria-hidden />
        <span className="text-[13px] text-ink-2">
          {pick(
            "Dev modu — anahtarlar yerel veritabanında düz metin olarak tutulur.",
            "Dev mode — keys are stored in plaintext in the local database.",
          )}
        </span>
      </div>
    </div>
  );
}

type TestState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; model: string | null; latencyMs: number }
  | { kind: "fail"; error: string; status?: number }
  | { kind: "skip"; reason: string };

export function ApiKeyRow({
  title,
  desc,
  placeholder,
  provider,
  keys,
  optional,
}: {
  title: string;
  desc: string;
  placeholder: string;
  provider: Provider;
  keys: ApiKeyManager;
  optional?: boolean;
}) {
  const pick = useLocalePick();
  const t = useTranslations("settings");
  const vaultT = useTranslations("vault");
  const value = keys.drafts[provider] ?? "";
  const dirty = keys.isDirty(provider);
  const stored = keys.isStored(provider);
  const storedLoaded = keys.storedLoaded;
  const storedLocked = stored && !value;
  const testable =
    provider === "anthropic" ||
    provider === "claude-code-oauth" ||
    provider === "google-gemini" ||
    provider === "openai" ||
    provider === "openrouter" ||
    provider === "firecrawl";

  const [test, setTest] = useState<TestState>({ kind: "idle" });

  async function runTest(): Promise<void> {
    if (!testable || !value) return;
    setTest({ kind: "loading" });
    try {
      const data = await testApiKey({ provider, key: value });
      if (data.skipped) {
        setTest({
          kind: "skip",
          reason:
            data.skipReason ??
            pick(
              "Bu sağlayıcı doğrudan test edilemez. Kaydet, sohbette dene.",
              "This provider can't be tested directly. Save and try in chat.",
            ),
        });
      } else if (data.ok) {
        setTest({
          kind: "ok",
          model: data.model ?? null,
          latencyMs: data.latencyMs ?? 0,
        });
      } else {
        setTest({
          kind: "fail",
          error: data.error ?? pick("Bilinmeyen hata", "Unknown error"),
          ...(data.status !== undefined ? { status: data.status } : {}),
        });
      }
    } catch (err) {
      setTest({
        kind: "fail",
        error: err instanceof Error ? err.message : pick("Ağ hatası", "Network error"),
      });
    }
  }
  return (
    <SettingsRow
      title={
        <span className="flex flex-wrap items-center gap-2">
          {title}
          {optional ? <Chip>{t("opsiyonel")}</Chip> : null}
          {!storedLoaded ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-rule-soft px-2 py-0.5 font-mono text-[10.5px] text-ink-3">
              {pick("Kontrol", "Checking")}
            </span>
          ) : stored ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-[color:color-mix(in_srgb,var(--color-ok)_50%,transparent)] bg-[color:color-mix(in_srgb,var(--color-ok)_22%,transparent)] px-2 py-0.5 font-mono text-[10.5px] text-[color:var(--color-ok)]">
              <Check className="h-3 w-3" aria-hidden />
              {pick("Kayıtlı", "Saved")}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full border border-rule-soft px-2 py-0.5 font-mono text-[10.5px] text-ink-3">
              {t("bos")}
            </span>
          )}
          {dirty ? (
            <span
              className="inline-flex h-2 w-2 rounded-full bg-accent"
              aria-label={pick("Kaydedilmedi", "Unsaved")}
            />
          ) : null}
        </span>
      }
      description={desc}
    >
      <div className="grid gap-2 md:grid-cols-[minmax(220px,1fr)_auto_auto_auto] md:items-center">
        <Input
          type="password"
          variant="mono"
          value={value}
          onChange={(e) => {
            keys.setDraft(provider, e.target.value);
            if (test.kind !== "idle") setTest({ kind: "idle" });
          }}
          placeholder={
            storedLocked
              ? pick(
                  "Kayıtlı anahtar gizli - görmek/test etmek için kilidi aç veya yenisini yapıştır",
                  "Saved key hidden - unlock to reveal/test, or paste a replacement",
                )
              : placeholder
          }
          className="min-w-0"
        />
        <Button
          size="md"
          variant={dirty ? "primary" : "default"}
          onClick={() => void keys.save(provider)}
          disabled={!dirty}
          className="w-full md:min-w-[104px]"
        >
          {vaultT("kaydet")}
        </Button>
        {testable ? (
          <Button
            size="md"
            variant="default"
            onClick={() => void runTest()}
            disabled={!value || test.kind === "loading"}
            className="w-full md:min-w-[170px]"
          >
            {test.kind === "loading"
              ? pick("Test ediliyor…", "Testing…")
              : pick("Bağlantıyı test et", "Test connection")}
          </Button>
        ) : null}
        {stored ? (
          <Button
            size="md"
            variant="ghost"
            onClick={() => void keys.remove(provider)}
            aria-label={vaultT("sil")}
            className="w-full md:w-11 md:px-0"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
          </Button>
        ) : null}
      </div>
      {test.kind === "ok" ? (
        <div className="mt-2 flex items-center gap-2 rounded-md border border-[color:color-mix(in_srgb,var(--moss)_30%,transparent)] bg-[color:color-mix(in_srgb,var(--moss)_8%,transparent)] px-3 py-2 text-[12.5px] text-[color:var(--moss)]">
          <Check className="h-3.5 w-3.5" aria-hidden />
          <span className="font-medium">
            {pick("Bağlantı başarılı", "Connection successful")}
          </span>
          <span className="font-mono text-[11px] text-ink-3">
            · {test.model ?? "—"} · {test.latencyMs}ms
          </span>
        </div>
      ) : null}
      {test.kind === "fail" ? (
        <div className="mt-2 rounded-md border border-[color:color-mix(in_srgb,var(--err)_40%,transparent)] bg-[color:color-mix(in_srgb,var(--err)_10%,transparent)] px-3 py-2 text-[12.5px] text-[color:var(--err)]">
          <span className="font-medium">
            {pick("Hata", "Error")}
            {test.status ? ` · ${test.status}` : ""}:
          </span>{" "}
          <span className="font-mono text-[11.5px]">{test.error}</span>
        </div>
      ) : null}
      {test.kind === "skip" ? (
        <div className="mt-2 rounded-md border border-[color:var(--border)] bg-[color:var(--surface-2)] px-3 py-2 text-[12.5px] text-ink-2">
          {test.reason}
        </div>
      ) : null}
    </SettingsRow>
  );
}
