const COMPACT_UNITS: readonly [number, string][] = [
  [1e9, "B"],
  [1e6, "M"],
  [1e3, "K"],
];

/** 5.98B, 122M, 25.8M, 1.5K, 980 — three significant digits at most. */
export function formatCompactNumber(n: number): string {
  for (const [size, unit] of COMPACT_UNITS) {
    if (Math.abs(n) >= size) {
      const scaled = n / size;
      const digits = Math.abs(scaled) >= 100 ? 0 : Math.abs(scaled) >= 10 ? 1 : 2;
      return `${Number(scaled.toFixed(digits))}${unit}`;
    }
  }
  return String(Math.round(n));
}

const CENT = 0.01;

export function formatUsd(n: number): string {
  if (n > 0 && n < CENT) return `$${n.toPrecision(2)}`;
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

const NICE_STEPS = [1, 2, 2.5, 5, 10] as const;

/** Round axis ticks from 0 that cover `max` with roughly `target` intervals. */
export function niceTicks(max: number, target: number): number[] {
  if (!(max > 0)) return [0, 1];
  const raw = max / target;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = (NICE_STEPS.find((s) => s * magnitude >= raw) ?? 10) * magnitude;
  const ticks: number[] = [];
  for (let v = 0; v < max + step; v += step) ticks.push(Number(v.toPrecision(12)));
  return ticks;
}
