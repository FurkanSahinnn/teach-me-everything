import type { LimitWindow } from "@/lib/ai/agent-status/types";

type LocalePick = (tr: string, en: string) => string;

const MINUTE_MS = 60_000;
const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 1440;

/** "5d 11h", "4h 59m", "42m" (TR: "5g 11sa", "4sa 59dk", "42dk"); null when not in the future. */
export function formatDurationShort(ms: number, pick: LocalePick): string | null {
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const totalMinutes = Math.max(1, Math.round(ms / MINUTE_MS));
  const days = Math.floor(totalMinutes / MINUTES_PER_DAY);
  const hours = Math.floor((totalMinutes % MINUTES_PER_DAY) / MINUTES_PER_HOUR);
  const minutes = totalMinutes % MINUTES_PER_HOUR;
  const d = pick("g", "d");
  const h = pick("sa", "h");
  const m = pick("dk", "m");
  if (days > 0) return `${days}${d} ${hours}${h}`;
  if (hours > 0) return `${hours}${h} ${minutes}${m}`;
  return `${minutes}${m}`;
}

export function percentLeft(usedPercent: number): number {
  return Math.min(100, Math.max(0, Math.round(100 - usedPercent)));
}

export function limitLabel(window: Pick<LimitWindow, "kind" | "modelName">, pick: LocalePick): string {
  switch (window.kind) {
    case "session":
      return pick("Oturum", "Session");
    case "weekly":
      return pick("Haftalık", "Weekly");
    case "weekly_model":
      return `${pick("Haftalık", "Weekly")} · ${window.modelName ?? ""}`.trim();
    case "monthly":
      return pick("Aylık kredi", "Monthly credit");
  }
}
