"use client";

// Phase 11.C — Master toggle for the podcast / audio feature surface.
//
// Flipping this off hides the audio entries in the sidebar and gates the
// `GenerateScriptModal`. Users who don't want any TTS at all can erase the
// feature from their workspace without having to ignore the entry point.

import { SettingsGroup, SettingsRow } from "@/components/settings/layout/SettingsPrimitives";
import { Switch } from "@/components/ui/Switch";
import { useLocalePick } from "@/i18n/IntlProvider";
import { usePrefs } from "@/stores/prefs";

export function PodcastFeatureSection(): React.ReactElement {
  const pick = useLocalePick();
  const enabled = usePrefs((s) => s.podcastFeatureEnabled);
  const setEnabled = usePrefs((s) => s.setPodcastFeatureEnabled);
  return (
    <SettingsGroup>
      <SettingsRow
        title={pick(
          "Podcast / sesli özet özellikleri",
          "Podcast / audio summary features",
        )}
        description={
          <>
            {pick(
              "Çalışma alanı kenar çubuğundaki ses girişlerini ve oluşturma modallarını göster veya gizle. Model yönetimi etkilenmez.",
              "Show or hide the audio entries in the workspace sidebar and the podcast generation modal. Model management is unaffected.",
            )}{" "}
            {enabled
              ? pick("Açık · sesli özet üretebilirsin", "On · you can generate audio summaries")
              : pick("Kapalı · ses arayüzleri gizli", "Off · audio surfaces hidden")}
          </>
        }
        control={
          <Switch
            checked={enabled}
            onCheckedChange={(next) => setEnabled(next)}
            ariaLabel={pick("Podcast özelliği aç/kapa", "Toggle podcast feature")}
          />
        }
      />
    </SettingsGroup>
  );
}
