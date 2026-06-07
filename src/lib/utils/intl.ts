import type { Locale } from "@/stores/prefs";

const DAY_MS = 86_400_000;

function bcp47(locale: Locale | string): string {
  if (locale === "tr") return "tr-TR";
  if (locale === "en") return "en-US";
  return locale;
}

/**
 * Format a relative day distance from now using `Intl.RelativeTimeFormat`.
 * Negative day deltas read as "X days ago", positive as "in X days", with
 * "today" / "yesterday" / "tomorrow" produced automatically by `numeric: 'auto'`.
 */
export function formatRelativeDay(
  timestamp: number,
  locale: Locale | string,
  now: number = Date.now(),
): string {
  const delta = timestamp - now;
  const days = Math.round(delta / DAY_MS);
  const rtf = new Intl.RelativeTimeFormat(bcp47(locale), { numeric: "auto" });
  return rtf.format(days, "day");
}

/**
 * Format an absolute date (weekday, day, month, year) using `Intl.DateTimeFormat`.
 */
export function formatFullDate(
  timestamp: number,
  locale: Locale | string,
): string {
  return new Intl.DateTimeFormat(bcp47(locale), {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(timestamp));
}
