"use client";

// Phase 5.5.C.A — Settings → Models tab: user-tunable defaults for the chat
// reader's native web-search feature. Writes through to `usePrefs.webSearchPrefs`
// via the clamping setter, so a hand-edited textarea entry can't push the
// state past the published range (slider can't break the chat handler).
//
// This section is intentionally read-only of the adapter registry: it does
// NOT enumerate per-provider capability differences here. The reader UI in
// 5.5.C.B is responsible for greying out individual knobs per active model
// (e.g. Gemini ignores maxUses, Perplexity supports recencyDays). The defaults
// stored here apply across providers; each adapter passes only the supported
// subset to the upstream tool block.

import { Globe2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { Card } from "@/components/ui/Card";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Switch } from "@/components/ui/Switch";
import { usePrefs, type WebSearchPrefs } from "@/stores/prefs";

const RECENCY_PRESETS: Array<{ label: string; days: number; key: keyof RecencyLabels }> = [
  { label: "all", days: 0, key: "recency_all" },
  { label: "year", days: 365, key: "recency_year" },
  { label: "month", days: 30, key: "recency_month" },
  { label: "week", days: 7, key: "recency_week" },
  { label: "day", days: 1, key: "recency_day" },
];

type RecencyLabels = {
  recency_all: string;
  recency_year: string;
  recency_month: string;
  recency_week: string;
  recency_day: string;
};

function parseDomainCsv(value: string): string[] {
  return value
    .split(/[,\n]/)
    .map((d) => d.trim())
    .filter((d) => d.length > 0);
}

function formatDomainCsv(list: string[]): string {
  return list.join(", ");
}

export function WebSearchSection(): React.ReactElement {
  const t = useTranslations("web_search");
  const prefs = usePrefs((s) => s.webSearchPrefs);
  const setPrefs = usePrefs((s) => s.setWebSearchPrefs);

  // Match the user's selected days exactly to a preset chip; if none match,
  // the "all" chip is the safest default so the segmented control always has
  // a highlighted option. Non-preset durations (e.g. 14 days) still persist
  // via setPrefs — they round-trip but don't get a dedicated chip.
  const activeRecencyLabel = useMemo<RecencyLabels[keyof RecencyLabels] | string>(() => {
    const match = RECENCY_PRESETS.find((p) => p.days === prefs.recencyDays);
    return match ? match.label : "all";
  }, [prefs.recencyDays]);

  return (
    <Card padding="md" variant="default">
      <div className="flex items-start gap-3">
        <span
          className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border border-rule bg-paper-2 text-accent"
          aria-hidden
        >
          <Globe2 className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] font-semibold leading-tight text-ink">
            {t("section_title")}
          </h3>
          <p className="mt-1 max-w-[60ch] text-[13px] leading-6 text-ink-3">
            {t("section_description")}
          </p>

          <div className="mt-4 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[13.5px] font-medium text-ink">
                {t("enabled_label")}
              </div>
              <div className="mt-0.5 text-[12px] leading-5 text-ink-3">
                {t("enabled_hint")}
              </div>
            </div>
            <Switch
              checked={prefs.enabled}
              onCheckedChange={(enabled) => setPrefs({ enabled })}
              ariaLabel={t("enabled_label")}
            />
          </div>

          <div className="mt-5">
            <label
              className="block text-[13.5px] font-medium text-ink"
              htmlFor="ws-max-uses"
            >
              {t("max_uses_label")}
              <span className="ml-2 font-mono text-[12.5px] text-ink-3">
                {prefs.maxUses}
              </span>
            </label>
            <input
              id="ws-max-uses"
              type="range"
              min={1}
              max={10}
              step={1}
              value={prefs.maxUses}
              onChange={(e) => setPrefs({ maxUses: Number(e.currentTarget.value) })}
              className="mt-2 w-full accent-[var(--color-accent)]"
              aria-valuemin={1}
              aria-valuemax={10}
              aria-valuenow={prefs.maxUses}
            />
            <p className="mt-1 text-[12px] leading-5 text-ink-3">
              {t("max_uses_hint")}
            </p>
          </div>

          <div className="mt-5">
            <div className="text-[13.5px] font-medium text-ink">
              {t("search_mode_label")}
            </div>
            <div className="mt-2">
              <SegmentedControl<WebSearchPrefs["searchMode"]>
                size="sm"
                value={prefs.searchMode}
                onChange={(searchMode) => setPrefs({ searchMode })}
                options={[
                  { value: "default", label: t("search_mode_default") },
                  { value: "deep", label: t("search_mode_deep") },
                ]}
                ariaLabel={t("search_mode_label")}
              />
            </div>
            <p className="mt-1 text-[12px] leading-5 text-ink-3">
              {t("search_mode_hint")}
            </p>
          </div>

          <div className="mt-5">
            <div className="text-[13.5px] font-medium text-ink">
              {t("recency_label")}
            </div>
            <div className="mt-2">
              <SegmentedControl<string>
                size="sm"
                value={activeRecencyLabel}
                onChange={(label) => {
                  const target = RECENCY_PRESETS.find((p) => p.label === label);
                  if (target) setPrefs({ recencyDays: target.days });
                }}
                options={RECENCY_PRESETS.map((p) => ({
                  value: p.label,
                  label: t(p.key),
                }))}
                ariaLabel={t("recency_label")}
              />
            </div>
            <p className="mt-1 text-[12px] leading-5 text-ink-3">
              {t("recency_hint")}
            </p>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <div>
              <label
                className="block text-[13.5px] font-medium text-ink"
                htmlFor="ws-allowed"
              >
                {t("allowed_label")}
              </label>
              <textarea
                id="ws-allowed"
                value={formatDomainCsv(prefs.allowedDomains)}
                onChange={(e) =>
                  setPrefs({ allowedDomains: parseDomainCsv(e.currentTarget.value) })
                }
                placeholder={t("allowed_placeholder")}
                rows={2}
                className="mt-2 w-full resize-none rounded-[6px] border border-rule bg-paper px-2.5 py-1.5 font-mono text-[12.5px] text-ink placeholder:text-ink-4 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30"
              />
              <p className="mt-1 text-[12px] leading-5 text-ink-3">
                {t("allowed_hint")}
              </p>
            </div>
            <div>
              <label
                className="block text-[13.5px] font-medium text-ink"
                htmlFor="ws-blocked"
              >
                {t("blocked_label")}
              </label>
              <textarea
                id="ws-blocked"
                value={formatDomainCsv(prefs.blockedDomains)}
                onChange={(e) =>
                  setPrefs({ blockedDomains: parseDomainCsv(e.currentTarget.value) })
                }
                placeholder={t("blocked_placeholder")}
                rows={2}
                className="mt-2 w-full resize-none rounded-[6px] border border-rule bg-paper px-2.5 py-1.5 font-mono text-[12.5px] text-ink placeholder:text-ink-4 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30"
              />
              <p className="mt-1 text-[12px] leading-5 text-ink-3">
                {t("blocked_hint")}
              </p>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}
