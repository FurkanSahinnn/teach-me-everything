// ISO 8601 weeks start on Monday. All helpers here are pure and timezone-aware
// via the host Date object (no UTC normalization), so the resulting week always
// matches what the user sees on their wall clock.

const DAY_MS = 86_400_000;

export function startOfDay(d: Date | number): Date {
  const dt = new Date(d);
  dt.setHours(0, 0, 0, 0);
  return dt;
}

export function startOfWeek(d: Date | number): Date {
  const dt = startOfDay(d);
  const day = dt.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const diffToMon = day === 0 ? -6 : 1 - day;
  dt.setDate(dt.getDate() + diffToMon);
  return dt;
}

export function addDays(d: Date | number, n: number): Date {
  const dt = new Date(d);
  dt.setDate(dt.getDate() + n);
  return dt;
}

export function endOfWeek(weekStart: Date | number): Date {
  return addDays(weekStart, 7); // exclusive upper bound
}

export function endOfDay(d: Date | number): Date {
  return addDays(startOfDay(d), 1); // exclusive upper bound
}

export function daysBetween(a: Date | number, b: Date | number): number {
  return Math.round((Number(a) - Number(b)) / DAY_MS);
}

// Day index 0..6 of a timestamp inside the given week (Mon=0..Sun=6).
// Returns -1 if the timestamp falls outside the week.
export function dayIndexInWeek(weekStart: Date | number, ts: number): number {
  const start = startOfWeek(weekStart).getTime();
  const idx = Math.floor((ts - start) / DAY_MS);
  return idx >= 0 && idx < 7 ? idx : -1;
}

// Fractional hour-of-day (0..24) for use in calendar grid placement.
export function hourOfDay(ts: number): number {
  const dt = new Date(ts);
  return dt.getHours() + dt.getMinutes() / 60 + dt.getSeconds() / 3600;
}

// Format like "11 - 17 May 2026" or, when straddling months, "29 Apr - 5 May 2026".
// Locale-aware via Intl.DateTimeFormat for month names.
export function formatWeekRange(
  weekStart: Date,
  locale: "tr" | "en" = "tr",
): string {
  const last = addDays(weekStart, 6);
  const bcp = locale === "tr" ? "tr-TR" : "en-US";
  const sameMonth = weekStart.getMonth() === last.getMonth();
  const sameYear = weekStart.getFullYear() === last.getFullYear();

  const monthFmt = new Intl.DateTimeFormat(bcp, { month: "short" });
  const yearFmt = new Intl.DateTimeFormat(bcp, { year: "numeric" });
  const startMonth = monthFmt.format(weekStart);
  const endMonth = monthFmt.format(last);
  const endYear = yearFmt.format(last);

  if (sameMonth) {
    return `${weekStart.getDate()} – ${last.getDate()} ${startMonth} ${endYear}`;
  }
  if (sameYear) {
    return `${weekStart.getDate()} ${startMonth} – ${last.getDate()} ${endMonth} ${endYear}`;
  }
  const startYear = yearFmt.format(weekStart);
  return `${weekStart.getDate()} ${startMonth} ${startYear} – ${last.getDate()} ${endMonth} ${endYear}`;
}
