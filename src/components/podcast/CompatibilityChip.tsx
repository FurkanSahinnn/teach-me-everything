"use client";

// Phase 11.B — Traffic-light chip rendering the output of
// `evaluateCompatibility()` for a TTS provider on the user's system.
//
// Two modes:
//   - compact (default): emoji-style dot + level label
//   - detail: dot + level + reason copy (used in cards / lists where
//     a one-line reason fits)
//
// Copy is inline TR/EN via `useLocalePick` — the existing podcast
// modals (`GenerateScriptModal`, `InstallModelModal`) use the same
// inline pattern, so we stay consistent rather than introducing a new
// JSON-key surface for a v1 chip.

import { Chip } from "@/components/ui/Chip";
import { useLocalePick } from "@/i18n/IntlProvider";
import type {
  CompatibilityReasonKey,
  CompatibilityVerdict,
} from "@/lib/podcast/compatibility";

type Props = {
  verdict: CompatibilityVerdict;
  /** Render the reason text alongside the level label (default false). */
  showReason?: boolean;
  size?: "sm" | "md";
};

export function CompatibilityChip({
  verdict,
  showReason = false,
  size = "md",
}: Props) {
  const pick = useLocalePick();
  const level = pickLevelLabel(pick, verdict.level);
  const variant =
    verdict.level === "green"
      ? "ok"
      : verdict.level === "yellow"
        ? "warn"
        : "err";
  const reason = pickReason(pick, verdict.reasonKey, verdict.reasonArgs);
  const titleAttr = showReason ? undefined : reason;
  return (
    <Chip
      variant={variant}
      size={size}
      dot
      title={titleAttr}
      aria-label={`${level} — ${reason}`}
    >
      <span>{level}</span>
      {showReason ? (
        <span className="text-ink-3 font-normal">· {reason}</span>
      ) : null}
    </Chip>
  );
}

function pickLevelLabel(
  pick: (tr: string, en: string) => string,
  level: CompatibilityVerdict["level"],
): string {
  switch (level) {
    case "green":
      return pick("Uyumlu", "Compatible");
    case "yellow":
      return pick("Sınırda", "Tight fit");
    case "red":
      return pick("Uyumsuz", "Incompatible");
  }
}

function pickReason(
  pick: (tr: string, en: string) => string,
  reasonKey: CompatibilityReasonKey,
  args: Record<string, number>,
): string {
  switch (reasonKey) {
    case "ok":
      return pick(
        "Sisteminizde sorunsuz çalışmalı.",
        "Should run smoothly on your system.",
      );
    case "tight_ram":
      return pick(
        `RAM sınırda — ${args.currentGb ?? 0}GB sistem / ≥ ${args.requiredGb ?? 0}GB önerilen.`,
        `Tight RAM — ${args.currentGb ?? 0}GB system / ≥ ${args.requiredGb ?? 0}GB recommended.`,
      );
    case "insufficient_ram":
      return pick(
        `Yetersiz RAM — ${args.currentGb ?? 0}GB var, ≥ ${args.requiredGb ?? 0}GB gerekli.`,
        `Insufficient RAM — ${args.currentGb ?? 0}GB available, ≥ ${args.requiredGb ?? 0}GB required.`,
      );
    case "insufficient_disk":
      return pick(
        `Yetersiz disk — ${args.currentMb ?? 0}MB boş, ${args.requiredMb ?? 0}MB gerekli.`,
        `Insufficient disk — ${args.currentMb ?? 0}MB free, ${args.requiredMb ?? 0}MB required.`,
      );
    case "no_gpu_recommended":
      return pick(
        "GPU önerilir — sentezleme yavaş olabilir.",
        "GPU recommended — synthesis may be slow.",
      );
    case "no_gpu_required":
      return pick(
        "GPU şart — bu sağlayıcı GPU olmadan çalışmaz.",
        "GPU required — this provider cannot run without one.",
      );
    case "unknown_system":
      return pick(
        "Sistem bilgisi alınamadı.",
        "System info unavailable.",
      );
    case "web_unsupported":
      return pick(
        "Yalnızca masaüstü uygulamasında.",
        "Desktop app only.",
      );
  }
}
