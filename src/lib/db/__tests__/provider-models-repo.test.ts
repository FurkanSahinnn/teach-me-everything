import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  clearAllCachedModels,
  clearCachedModels,
  getCachedModels,
  isCacheStale,
  PROVIDER_MODELS_CACHE_TTL_MS,
  putCachedModels,
} from "../provider-models-repo";
import type { ProviderModelsCacheRecord } from "../schema";
import { db } from "../schema";

const SAMPLE_RECORD: ProviderModelsCacheRecord = {
  presetId: "google-gemini",
  baseUrl: "https://generativelanguage.googleapis.com/v1beta",
  models: [
    {
      id: "gemini-3-pro",
      displayName: "Gemini 3 Pro",
      tier: "flagship",
    },
    {
      id: "gemini-2.5-flash",
      displayName: "Gemini 2.5 Flash",
      tier: "free",
    },
  ],
  fetchedAt: 1_700_000_000_000,
};

beforeEach(async () => {
  await clearAllCachedModels();
});

afterEach(async () => {
  await clearAllCachedModels();
});

describe("provider-models-repo CRUD", () => {
  it("put + get round-trip preserves the record", async () => {
    await putCachedModels(SAMPLE_RECORD);
    const got = await getCachedModels("google-gemini");
    expect(got).toEqual(SAMPLE_RECORD);
  });

  it("get returns undefined when nothing cached", async () => {
    const got = await getCachedModels("anthropic");
    expect(got).toBeUndefined();
  });

  it("put overwrites the previous row for the same presetId", async () => {
    await putCachedModels(SAMPLE_RECORD);
    const newer = { ...SAMPLE_RECORD, fetchedAt: 1_800_000_000_000 };
    await putCachedModels(newer);
    const got = await getCachedModels("google-gemini");
    expect(got?.fetchedAt).toBe(1_800_000_000_000);
    const total = await db.providerModelsCache.count();
    expect(total).toBe(1);
  });

  it("clearCachedModels drops a single preset's row only", async () => {
    await putCachedModels(SAMPLE_RECORD);
    await putCachedModels({
      ...SAMPLE_RECORD,
      presetId: "anthropic",
      baseUrl: "https://api.anthropic.com",
    });
    await clearCachedModels("google-gemini");
    expect(await getCachedModels("google-gemini")).toBeUndefined();
    expect(await getCachedModels("anthropic")).toBeDefined();
  });

  it("clearAllCachedModels empties the table", async () => {
    await putCachedModels(SAMPLE_RECORD);
    await putCachedModels({ ...SAMPLE_RECORD, presetId: "openai" });
    await clearAllCachedModels();
    expect(await db.providerModelsCache.count()).toBe(0);
  });
});

describe("isCacheStale", () => {
  it("returns true when no record exists", () => {
    expect(isCacheStale(undefined)).toBe(true);
  });

  it("returns false for a fresh record under TTL", () => {
    const now = 1_700_000_000_000;
    const record: ProviderModelsCacheRecord = {
      ...SAMPLE_RECORD,
      fetchedAt: now - 60_000, // 1 minute ago
    };
    expect(isCacheStale(record, { now })).toBe(false);
  });

  it("returns true once the record is older than the TTL window", () => {
    const now = 1_700_000_000_000;
    const record: ProviderModelsCacheRecord = {
      ...SAMPLE_RECORD,
      fetchedAt: now - PROVIDER_MODELS_CACHE_TTL_MS - 1,
    };
    expect(isCacheStale(record, { now })).toBe(true);
  });

  it("returns true when baseUrl disagrees (custom endpoint switch)", () => {
    const now = 1_700_000_000_000;
    const record: ProviderModelsCacheRecord = {
      ...SAMPLE_RECORD,
      fetchedAt: now - 60_000,
    };
    expect(
      isCacheStale(record, { now, baseUrl: "https://different.example/v1" }),
    ).toBe(true);
  });

  it("respects custom ttlMs override (allows shorter test windows)", () => {
    const now = 1_700_000_000_000;
    const record: ProviderModelsCacheRecord = {
      ...SAMPLE_RECORD,
      fetchedAt: now - 2 * 60_000, // 2 min ago
    };
    expect(isCacheStale(record, { now, ttlMs: 60_000 })).toBe(true);
    expect(isCacheStale(record, { now, ttlMs: 5 * 60_000 })).toBe(false);
  });
});
