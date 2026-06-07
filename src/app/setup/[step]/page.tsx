"use client";

import {
  ArrowLeft,
  ArrowRight,
  Check,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { notFound, useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useLocalePick } from "@/i18n/IntlProvider";
import { useMemo, useState } from "react";
import { Brand } from "@/components/shell/Brand";
import { DoneStep } from "@/components/setup/DoneStep";
import { ExamplesStep } from "@/components/setup/ExamplesStep";
import { WelcomeStep } from "@/components/setup/WelcomeStep";
import {
  DynamicKeyField,
  PresetChooser,
} from "@/components/setup/PresetChooser";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";
import { useApiKeyManager } from "@/hooks/useApiKeyManager";
import {
  getQuickStartPreset,
  type QuickStartPresetId,
} from "@/lib/ai/quick-start-presets";
import { type Provider } from "@/lib/db/schema";
import { markSetupComplete } from "@/lib/setup-completion";
import { cn } from "@/lib/utils/cn";
import { type ModelBindings, usePrefs } from "@/stores/prefs";

type StepId = 1 | 2 | 3 | 4;

const STEPS: {
  id: StepId;
  titleTr: string;
  titleEn: string;
  subTr: string;
  subEn: string;
}[] = [
  {
    id: 1,
    titleTr: "Hoş geldiniz",
    titleEn: "Welcome",
    subTr: "Başlangıç kontrolleri",
    subEn: "Initial checks",
  },
  {
    id: 2,
    titleTr: "API anahtarları",
    titleEn: "API keys",
    subTr: "Sağlayıcıları yapılandırın",
    subEn: "Configure providers",
  },
  {
    id: 3,
    titleTr: "Örnekler",
    titleEn: "Examples",
    subTr: "İsteğe bağlı seed verisi",
    subEn: "Optional seed data",
  },
  {
    id: 4,
    titleTr: "Hazırsın",
    titleEn: "You're ready",
    subTr: "Sonraki adımlar",
    subEn: "Next steps",
  },
];

export default function SetupWizardPage() {
  const params = useParams<{ step: string }>();
  const router = useRouter();
  const t = useTranslations("setup");
  const pick = useLocalePick();

  const stepNum = Number(params.step);
  if (!Number.isInteger(stepNum) || stepNum < 1 || stepNum > 4) {
    notFound();
  }
  const step = stepNum as StepId;

  function go(to: StepId) {
    router.push(`/setup/${to}`);
  }

  return (
    <div className="min-h-screen bg-paper">
      <header className="border-b border-rule-soft">
        <div className="mx-auto flex max-w-[1240px] items-center justify-between gap-4 px-9 py-4">
          <Brand size="sm" />
          <div className="flex items-center gap-3 text-[12px] text-ink-3">
            <span className="font-mono">
              {t("kurulum")} · {stepNum}/4
            </span>
            <Link
              href="/dashboard"
              onClick={markSetupComplete}
              className="rounded-[9px] border border-rule-strong bg-paper-2 px-3 py-1.5 font-semibold text-ink-2 shadow-[var(--shadow-soft)] transition-[background,border-color,color,transform] duration-[120ms] hover:-translate-y-[1px] hover:border-accent hover:bg-paper-3 hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {t("atla_dashboard")}
            </Link>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1160px] grid-cols-1 gap-8 px-4 py-8 sm:px-6 lg:grid-cols-[260px_1fr] lg:gap-14 lg:px-9 lg:py-14">
        <aside>
          <div className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-3">
            {t("kurulum_adimlari")}
          </div>
          <ol className="mt-3 grid gap-x-3 sm:grid-cols-2 lg:block">
            {STEPS.map((s, i) => {
              const state =
                s.id < step ? "done" : s.id === step ? "active" : "pending";
              return (
                <li
                  key={s.id}
                  className={cn(
                    "relative flex items-start gap-3.5 py-2.5",
                    i < STEPS.length - 1 &&
                      "before:absolute before:bottom-[-6px] before:left-[13px] before:top-[30px] before:border-l before:border-dashed before:border-rule",
                  )}
                >
                  <span
                    className={cn(
                      "relative z-10 grid h-[26px] w-[26px] shrink-0 place-items-center rounded-full border font-mono text-[11px]",
                      state === "done" && "border-ink bg-ink text-paper",
                      state === "active" &&
                        "border-accent bg-paper text-accent-ink ring-[3px] ring-accent-soft",
                      state === "pending" && "border-rule bg-paper text-ink-3",
                    )}
                  >
                    {state === "done" ? (
                      <Check className="h-3 w-3" aria-hidden />
                    ) : (
                      s.id
                    )}
                  </span>
                  <div
                    className={cn(
                      "text-[13.5px]",
                      state === "active" ? "text-ink" : "text-ink-3",
                    )}
                  >
                    <div className="font-medium">
                      {pick(s.titleTr, s.titleEn)}
                    </div>
                    <div className="mt-0.5 text-[12px] text-ink-4">
                      {pick(s.subTr, s.subEn)}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </aside>

        <div>
          {step === 1 ? <WelcomeStep onContinue={() => go(2)} /> : null}
          {step === 2 ? <ApiStep pick={pick} /> : null}
          {step === 3 ? (
            <ExamplesStep
              onContinue={() => go(4)}
              onSkip={() => go(4)}
            />
          ) : null}
          {step === 4 ? <DoneStep /> : null}

          {/*
            Step 1 has its own "Get started" CTA so the footer hides Continue.
            Step 3 has its own footer (Skip + Continue) inside ExamplesStep.
            Step 4 is terminal: only show Back.
          */}
          <div className="mt-7 flex items-center justify-between border-t border-rule-soft pt-5">
            {step > 1 ? (
              <Button size="md" onClick={() => go((step - 1) as StepId)}>
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
                {t("geri")}
              </Button>
            ) : (
              <span />
            )}
            <div className="flex items-center gap-2">
              {step === 2 ? (
                <>
                  <Button
                    size="md"
                    variant="default"
                    onClick={() => go(3)}
                  >
                    {t("bu_adimi_atla")}
                  </Button>
                  <Button
                    size="md"
                    variant="primary"
                    onClick={() => go(3)}
                  >
                    {t("devam")}
                    <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                  </Button>
                </>
              ) : null}
              {step === 4 ? (
                <Link href="/dashboard" onClick={markSetupComplete}>
                  <Button size="md" variant="primary">
                    {t("dashboarda_git")}
                    <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                  </Button>
                </Link>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Union of the wizard's classic 4-provider list and the 5 quick-start
// providerIds. Without this expanded set, useApiKeyManager wouldn't recognize
// drafts written by the QuickStart flow (e.g. groq / google-gemini /
// openrouter / ollama) — saveAll would silently skip them.
const WIZARD_PROVIDERS: Provider[] = [
  "anthropic",
  "claude-code-oauth",
  "openai",
  "firecrawl",
  "google-gemini",
  "groq",
  "openrouter",
  "ollama",
];

function ApiStep({ pick }: { pick: (tr: string, en: string) => string }) {
  const t = useTranslations("setup");
  const vaultT = useTranslations("vault");
  const keys = useApiKeyManager(WIZARD_PROVIDERS);

  return (
    <section>
      <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-3">
        {t("24_saglayicilar")}
      </div>
      <h1 className="mt-2 font-serif text-[40px] font-normal leading-[1.1] tracking-[-0.02em]">
        {t("api_anahtarlarini_ekle")}
      </h1>
      <p className="mt-3 max-w-[62ch] text-[15px] leading-[1.6] text-ink-3">
        {pick("BYOK. Anahtarlar masaüstünde OS keychain'de, web sürümünde yerel veritabanında saklanır.", "BYOK. Keys live in the OS keychain on desktop and in the local database in the web build.",)}
      </p>

      <QuickStartSection keys={keys} pick={pick} />

      <div className="mt-8 border-t border-rule-soft pt-6">
        <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-3">
          {pick("Manuel yapılandırma", "Manual configuration")}
        </div>
        <p className="mt-2 max-w-[62ch] text-[13px] text-ink-3">
          {pick(
            "Birden fazla sağlayıcıyı aynı anda kurmak ya da yardımcı servisleri (OAuth / Firecrawl) eklemek için aşağıdan tek tek yaz.",
            "Wire multiple providers at once or add ancillary services (OAuth / Firecrawl) by filling fields below.",
          )}
        </p>
      </div>

      <div className="mt-5 space-y-3">
        <ProviderRow
          title="Anthropic · API key"
          desc={pick("API anahtarı — kullandıkça faturalanır. Anthropic Console'dan al.",
            "API key — pay-per-use. Get one from the Anthropic Console.",)}
          placeholder="sk-ant-api03-•••••••••••••••••••••••"
          provider="anthropic"
          keys={keys}
        />
        <ProviderRow
          title="Claude Code · OAuth token"
          desc={pick("Claude Code aboneliğini kullan. Terminalde `claude setup-token` çalıştır — kullanım planın üzerinden gider.",
            "Use your Claude Code subscription. Run `claude setup-token` in your terminal — usage goes against your plan.",)}
          placeholder="sk-ant-oat01-•••••••••••••••••••••••"
          provider="claude-code-oauth"
          keys={keys}
        />
        <ProviderRow
          title="OpenAI"
          desc={pick("Embedding ve Whisper transkripti için.", "For embeddings and Whisper transcripts.",)}
          placeholder="sk-proj-•••••••••••••••••••••••"
          provider="openai"
          keys={keys}
        />
        <ProviderRow
          title="Firecrawl"
          desc={pick("Web parse (opsiyonel — yerel pdf.js fallback var).", "Web parsing (optional — local pdf.js fallback exists).",
          )}
          placeholder="fc-•••••••••••••••••••••••"
          provider="firecrawl"
          keys={keys}
        />
      </div>

      <div className="mt-5 flex items-center justify-end gap-3">
        <Button
          size="md"
          variant="primary"
          // Configuring a provider counts as completing setup — otherwise
          // FirstRunGate keeps redirecting back to /setup on every launch
          // (it reads the setup-complete flag, not a Dexie row).
          onClick={() => void keys.saveAll().then(markSetupComplete)}
          disabled={!keys.hasAnyDirty}
        >
          {vaultT("kaydet")}
        </Button>
      </div>
    </section>
  );
}

function ProviderRow({
  title,
  desc,
  placeholder,
  provider,
  keys,
  required,
}: {
  title: string;
  desc: string;
  placeholder: string;
  provider: Provider;
  keys: ReturnType<typeof useApiKeyManager>;
  required?: boolean;
}) {
  const t = useTranslations("setup");
  const value = keys.drafts[provider] ?? "";
  return (
    <Card padding="md">
      <div className="flex items-center gap-2">
        <h3 className="font-serif text-[16px] font-medium">{title}</h3>
        {required ? (
          <span className="rounded-full border border-accent px-2 py-0.5 font-mono text-[10.5px] text-accent-ink">
            {t("gerekli")}
          </span>
        ) : (
          <span className="rounded-full border border-rule-soft px-2 py-0.5 font-mono text-[10.5px] text-ink-3">
            {t("opsiyonel")}
          </span>
        )}
        {keys.isStored(provider) ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-[color:var(--moss)] px-2 py-0.5 font-mono text-[10.5px] text-[color:var(--moss)]">
            <Check className="h-3 w-3" aria-hidden />
          </span>
        ) : null}
      </div>
      <p className="mt-1 text-[12.5px] text-ink-3">{desc}</p>
      <div className="mt-3">
        <Input
          type="password"
          variant="mono"
          value={value}
          onChange={(e) => keys.setDraft(provider, e.target.value)}
          placeholder={placeholder}
        />
      </div>
    </Card>
  );
}

function QuickStartSection({
  keys,
  pick,
}: {
  keys: ReturnType<typeof useApiKeyManager>;
  pick: (tr: string, en: string) => string;
}) {
  const { toast } = useToast();
  const setModelBinding = usePrefs((s) => s.setModelBinding);
  const [selectedId, setSelectedId] = useState<QuickStartPresetId | null>(null);
  const [keyValue, setKeyValue] = useState("");
  const [applying, setApplying] = useState(false);

  const preset = useMemo(
    () => (selectedId ? (getQuickStartPreset(selectedId) ?? null) : null),
    [selectedId],
  );

  const canApply = preset
    ? !preset.requiresKey || keyValue.trim().length > 0
    : false;

  function handleSelect(id: QuickStartPresetId): void {
    setSelectedId(id);
    setKeyValue("");
  }

  async function handleApply(): Promise<void> {
    if (!preset) return;
    setApplying(true);
    try {
      if (preset.requiresKey) {
        keys.setDraft(preset.providerId, keyValue.trim());
      }
      // Bindings update before saveAll so the toast can fire after both
      // operations land. setModelBinding is synchronous (Zustand persist
      // writes to localStorage on the same tick).
      for (const [task, model] of Object.entries(preset.defaultBindings)) {
        if (model) {
          setModelBinding(task as keyof ModelBindings, model);
        }
      }
      await keys.saveAll();
      // Applying a quick-start preset is a complete setup — mark it so
      // FirstRunGate stops redirecting to /setup on the next launch.
      markSetupComplete();
      toast({
        variant: "success",
        title: pick(
          `${preset.label} hızlı başlangıç uygulandı`,
          `${preset.label} quick-start applied`,
        ),
        description: pick(
          "Sohbet, özet ve gömme modelleri güncellendi.",
          "Chat, summary, and embed models updated.",
        ),
      });
      setKeyValue("");
    } finally {
      setApplying(false);
    }
  }

  return (
    <Card padding="lg" className="mt-6 border-rule-strong bg-paper shadow-[var(--shadow-medium)]">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-accent" aria-hidden />
        <h2 className="font-serif text-[20px] font-medium text-ink">
          {pick("Hızlı başlangıç", "Quick start")}
        </h2>
      </div>
      <p className="mt-1.5 max-w-[60ch] text-[13px] text-ink-3">
        {pick(
          "Tek tıkla bir sağlayıcı seç — sohbet / özet / gömme modelleri otomatik bağlanır.",
          "Pick one provider — chat / summary / embed models get wired automatically.",
        )}
      </p>
      <div className="mt-4">
        <PresetChooser selectedId={selectedId} onSelect={handleSelect} />
      </div>
      <div className="mt-4">
        <DynamicKeyField
          preset={preset}
          value={keyValue}
          onChange={setKeyValue}
          inputId="quickstart-key"
        />
      </div>
      <div className="mt-4 flex items-center justify-end">
        <Button
          size="md"
          variant="primary"
          onClick={() => void handleApply()}
          disabled={!canApply || applying}
        >
          {applying
            ? pick("Uygulanıyor…", "Applying…")
            : pick("Uygula", "Apply")}
        </Button>
      </div>
    </Card>
  );
}
