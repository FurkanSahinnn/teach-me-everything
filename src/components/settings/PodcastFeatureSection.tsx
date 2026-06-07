"use client";

// Phase 11.C — Master toggle for the podcast / audio feature surface.
//
// Flipping this off hides the audio entries in the sidebar and gates the
// `GenerateScriptModal`. Users who don't want any TTS at all can erase the
// feature from their workspace without having to ignore the entry point.

import { Mic2 } from "lucide-react";
import { Switch } from "@/components/ui/Switch";
import { useLocalePick } from "@/i18n/IntlProvider";
import { usePrefs } from "@/stores/prefs";

export function PodcastFeatureSection(): React.ReactElement {
  const pick = useLocalePick();
  const enabled = usePrefs((s) => s.podcastFeatureEnabled);
  const setEnabled = usePrefs((s) => s.setPodcastFeatureEnabled);
  return (
    <section
      className="rounded-2xl border border-line bg-paper-soft p-5 shadow-sm"
      data-testid="podcast-feature-section"
    >
      <header className="flex items-start gap-3">
        <span
          className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent-wash text-accent-ink"
          aria-hidden
        >
          <Mic2 size={18} strokeWidth={1.6} />
        </span>
        <div className="flex-1">
          <h2 className="text-sm font-semibold text-ink">
            {pick(
              "Podcast / sesli özet özellikleri",
              "Podcast / audio summary features",
            )}
          </h2>
          <p className="mt-1 text-xs text-ink-soft">
            {pick(
              "Çalışma alanı kenar çubuğundaki ses girişlerini ve oluşturma modallarını göster veya gizle. Model yönetimi etkilenmez.",
              "Show or hide the audio entries in the workspace sidebar and the podcast generation modal. Model management is unaffected.",
            )}
          </p>
        </div>
      </header>
      <div className="mt-4 flex items-center justify-between gap-4 rounded-xl border border-line/60 bg-paper px-4 py-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink">
            {pick("Bu özelliği göster", "Show this feature")}
          </p>
          <p className="mt-0.5 text-xs text-ink-soft">
            {enabled
              ? pick("Açık · sesli özet üretebilirsin", "On · you can generate audio summaries")
              : pick("Kapalı · ses arayüzleri gizli", "Off · audio surfaces hidden")}
          </p>
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={(next) => setEnabled(next)}
          ariaLabel={pick(
            "Podcast özelliği aç/kapa",
            "Toggle podcast feature",
          )}
        />
      </div>
    </section>
  );
}
