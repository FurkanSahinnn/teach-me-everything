"use client";

import { Sparkles } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Switch } from "@/components/ui/Switch";
import { useToast } from "@/components/ui/Toast";
import { seedDevData } from "@/lib/db/seed";

type Props = {
  onContinue: () => void;
  onSkip: () => void;
};

export function ExamplesStep({ onContinue, onSkip }: Props) {
  const t = useTranslations("setup");
  const ts = useTranslations("setup.examples");
  const { toast } = useToast();
  const [includeExamples, setIncludeExamples] = useState(true);
  const [busy, setBusy] = useState(false);

  async function handleContinue() {
    if (!includeExamples) {
      onContinue();
      return;
    }
    setBusy(true);
    try {
      // Idempotent: seedDevData no-ops if already seeded.
      await seedDevData();
      onContinue();
    } catch (err) {
      toast({
        variant: "error",
        title: ts("title"),
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-3">
        {t("34_tercihler")}
      </div>
      <h1 className="mt-2 font-serif text-[40px] font-normal leading-[1.1] tracking-[-0.02em]">
        {ts("title")}
      </h1>
      <p className="mt-3 max-w-[62ch] text-[15px] leading-[1.6] text-ink-3">
        {ts("description")}
      </p>

      <Card padding="lg" className="mt-6">
        <label className="flex items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <Sparkles
              className="mt-0.5 h-5 w-5 text-accent-ink"
              aria-hidden
            />
            <div>
              <div className="text-[15px] font-semibold">
                {ts("toggle_label")}
              </div>
              <p className="mt-0.5 text-[12.5px] text-ink-3">
                {ts("description")}
              </p>
            </div>
          </div>
          <Switch
            checked={includeExamples}
            onCheckedChange={setIncludeExamples}
            disabled={busy}
            ariaLabel={ts("toggle_label")}
          />
        </label>
      </Card>

      <div className="mt-6 flex items-center justify-end gap-2">
        <Button size="md" variant="ghost" onClick={onSkip} disabled={busy}>
          {ts("skip")}
        </Button>
        <Button
          size="md"
          variant="primary"
          onClick={() => void handleContinue()}
          loading={busy}
        >
          {ts("continue")}
        </Button>
      </div>
    </section>
  );
}
