import { PRICING, type ModelPricing } from "@/lib/ai/pricing";

const PER_MILLION = 1_000_000;

/**
 * Per-model lookup that never warns (`computeCostUsd` console.warns once per
 * unknown model, which would spam for every unpriced CLI model). Falls back to
 * the model id without a trailing `-YYYYMMDD` snapshot suffix.
 */
export function lookupPricing(model: string): ModelPricing | null {
  const exact = PRICING[model];
  if (exact) return exact;
  const undated = model.replace(/-\d{8}$/, "");
  return undated !== model ? (PRICING[undated] ?? null) : null;
}

export type TokenCounts = {
  uncachedInput: number;
  cachedInput: number;
  cacheWrite: number;
  output: number;
};

export type CostBreakdown = {
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
  total: number;
  /** cachedInput x (inputRate - cacheReadRate). */
  cacheSavings: number;
};

export const ZERO_COST: CostBreakdown = {
  input: 0,
  cacheRead: 0,
  cacheWrite: 0,
  output: 0,
  total: 0,
  cacheSavings: 0,
};

export function costFor(pricing: ModelPricing | null, t: TokenCounts): CostBreakdown {
  if (!pricing) return ZERO_COST;
  const input = (t.uncachedInput * pricing.input) / PER_MILLION;
  const cacheRead = (t.cachedInput * pricing.cacheRead) / PER_MILLION;
  const cacheWrite = (t.cacheWrite * pricing.cacheCreation) / PER_MILLION;
  const output = (t.output * pricing.output) / PER_MILLION;
  return {
    input,
    cacheRead,
    cacheWrite,
    output,
    total: input + cacheRead + cacheWrite + output,
    cacheSavings: (t.cachedInput * (pricing.input - pricing.cacheRead)) / PER_MILLION,
  };
}
