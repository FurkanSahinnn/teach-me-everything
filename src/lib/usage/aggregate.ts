import { costFor, lookupPricing, type CostBreakdown } from "./pricing";
import { rangeToSinceMs } from "./range";
import type { UsageProvider, UsageRange, UsageScanResult } from "./types";

export type UsageTotals = {
  /** uncached + cached + cacheWrite + output */
  processedTokens: number;
  uncachedInput: number;
  cachedInput: number;
  cacheWrite: number;
  output: number;
  events: number;
  costUsd: number;
  cacheSavingsUsd: number;
};

export type ProviderStat = {
  provider: UsageProvider;
  tokens: number;
  sessions: number;
  /** 0-100 */
  share: number;
  costUsd: number;
};

export type ModelStat = {
  provider: UsageProvider;
  model: string;
  tokens: number;
  /** 0-100, of all processed tokens */
  share: number;
  costUsd: number;
  priced: boolean;
};

export type DayPoint = {
  day: string;
  /** Processed tokens per provider. */
  claude: number;
  codex: number;
  total: number;
  /** Estimated USD per provider; unpriced models count as 0. */
  claudeCost: number;
  codexCost: number;
  totalCost: number;
};

export type UsageSummary = {
  range: UsageRange;
  totals: UsageTotals;
  providers: ProviderStat[];
  models: ModelStat[];
  daily: DayPoint[];
  costByType: { input: number; cacheRead: number; cacheWrite: number; output: number };
  unpricedModels: string[];
  sessions: Record<UsageProvider, number>;
  malformed: number;
  filesScanned: number;
  roots: UsageScanResult["roots"];
};

export type AggregateOptions = {
  range: UsageRange;
  /** Epoch ms; defaults to Date.now(). */
  now?: number | undefined;
  /** Minutes east of UTC; defaults to the runtime's local offset. */
  tzOffsetMinutes?: number | undefined;
};

const DAY_MS = 86_400_000;

function localDay(ms: number, tz: number): string {
  return new Date(ms + tz * 60_000).toISOString().slice(0, 10);
}

/** Every local day from the range start through today, inclusive. */
export function daysInRange(range: UsageRange, now: number, tz: number): string[] {
  const first = localDay(rangeToSinceMs(range, now), tz);
  const last = localDay(now, tz);
  const days: string[] = [];
  const end = Date.parse(`${last}T00:00:00Z`);
  for (let cursor = Date.parse(`${first}T00:00:00Z`); cursor <= end; cursor += DAY_MS) {
    days.push(new Date(cursor).toISOString().slice(0, 10));
  }
  return days;
}

const PROVIDERS: UsageProvider[] = ["claude", "codex"];
const pct = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : 0);

export function aggregateUsage(
  result: UsageScanResult,
  options: AggregateOptions,
): UsageSummary {
  const now = options.now ?? Date.now();
  const tz = options.tzOffsetMinutes ?? -new Date(now).getTimezoneOffset();

  const totals: UsageTotals = {
    processedTokens: 0,
    uncachedInput: 0,
    cachedInput: 0,
    cacheWrite: 0,
    output: 0,
    events: 0,
    costUsd: 0,
    cacheSavingsUsd: 0,
  };
  const costByType = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 };
  const providerTokens: Record<UsageProvider, number> = { claude: 0, codex: 0 };
  const providerCost: Record<UsageProvider, number> = { claude: 0, codex: 0 };
  const models = new Map<string, ModelStat>();
  const daily = new Map<string, DayPoint>(
    daysInRange(options.range, now, tz).map((day) => [
      day,
      { day, claude: 0, codex: 0, total: 0, claudeCost: 0, codexCost: 0, totalCost: 0 },
    ]),
  );
  const unpriced = new Set<string>();

  for (const b of result.buckets) {
    const tokens = b.uncachedInput + b.cachedInput + b.cacheWrite + b.output;
    const pricing = lookupPricing(b.model);
    if (!pricing) unpriced.add(b.model);
    const cost: CostBreakdown = costFor(pricing, b);

    totals.processedTokens += tokens;
    totals.uncachedInput += b.uncachedInput;
    totals.cachedInput += b.cachedInput;
    totals.cacheWrite += b.cacheWrite;
    totals.output += b.output;
    totals.events += b.events;
    totals.costUsd += cost.total;
    totals.cacheSavingsUsd += cost.cacheSavings;
    costByType.input += cost.input;
    costByType.cacheRead += cost.cacheRead;
    costByType.cacheWrite += cost.cacheWrite;
    costByType.output += cost.output;
    providerTokens[b.provider] += tokens;
    providerCost[b.provider] += cost.total;

    const key = `${b.provider}|${b.model}`;
    const m = models.get(key) ?? {
      provider: b.provider,
      model: b.model,
      tokens: 0,
      share: 0,
      costUsd: 0,
      priced: pricing !== null,
    };
    m.tokens += tokens;
    m.costUsd += cost.total;
    models.set(key, m);

    const point = daily.get(b.day);
    if (point) {
      point[b.provider] += tokens;
      point.total += tokens;
      point[b.provider === "claude" ? "claudeCost" : "codexCost"] += cost.total;
      point.totalCost += cost.total;
    }
  }

  const modelList = [...models.values()]
    .map((m) => ({ ...m, share: pct(m.tokens, totals.processedTokens) }))
    .sort((a, b) => b.tokens - a.tokens || a.model.localeCompare(b.model));

  return {
    range: options.range,
    totals,
    providers: PROVIDERS.map((provider) => ({
      provider,
      tokens: providerTokens[provider],
      sessions: result.sessions[provider],
      share: pct(providerTokens[provider], totals.processedTokens),
      costUsd: providerCost[provider],
    })),
    models: modelList,
    daily: [...daily.values()],
    costByType,
    unpricedModels: [...unpriced].sort(),
    sessions: result.sessions,
    malformed: result.malformed,
    filesScanned: result.filesScanned,
    roots: result.roots,
  };
}
