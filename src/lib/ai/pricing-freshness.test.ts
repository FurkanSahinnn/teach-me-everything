import { describe, expect, it } from "vitest";
import {
  PRICING_FRESHNESS_DAYS_MAX,
  PRICING_SNAPSHOT_DATE,
  isPricingSnapshotStale,
  pricingSnapshotAgeDays,
} from "./pricing";

describe("pricing snapshot freshness", () => {
  it("PRICING_SNAPSHOT_DATE is a valid ISO YYYY-MM-DD", () => {
    expect(PRICING_SNAPSHOT_DATE).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const parsed = new Date(`${PRICING_SNAPSHOT_DATE}T00:00:00Z`);
    expect(Number.isNaN(parsed.getTime())).toBe(false);
  });

  it("pricingSnapshotAgeDays returns 0 on the snapshot date", () => {
    const onSnapshot = new Date(`${PRICING_SNAPSHOT_DATE}T12:00:00Z`);
    expect(pricingSnapshotAgeDays(onSnapshot)).toBe(0);
  });

  it("pricingSnapshotAgeDays grows with elapsed days", () => {
    const snap = new Date(`${PRICING_SNAPSHOT_DATE}T00:00:00Z`);
    const plus30 = new Date(snap.getTime() + 30 * 24 * 60 * 60 * 1000);
    const plus120 = new Date(snap.getTime() + 120 * 24 * 60 * 60 * 1000);
    expect(pricingSnapshotAgeDays(plus30)).toBe(30);
    expect(pricingSnapshotAgeDays(plus120)).toBe(120);
  });

  it("isPricingSnapshotStale is false within the freshness window", () => {
    const snap = new Date(`${PRICING_SNAPSHOT_DATE}T00:00:00Z`);
    const within = new Date(
      snap.getTime() + PRICING_FRESHNESS_DAYS_MAX * 24 * 60 * 60 * 1000,
    );
    expect(isPricingSnapshotStale(within)).toBe(false);
  });

  it("isPricingSnapshotStale is true past the freshness window", () => {
    const snap = new Date(`${PRICING_SNAPSHOT_DATE}T00:00:00Z`);
    const past = new Date(
      snap.getTime() + (PRICING_FRESHNESS_DAYS_MAX + 1) * 24 * 60 * 60 * 1000,
    );
    expect(isPricingSnapshotStale(past)).toBe(true);
  });

  // CI-enforced cadence: when this fails, refresh PRICING + bump
  // PRICING_SNAPSHOT_DATE per docs/PROVIDERS.md § 5.
  it("current date is within the freshness window", () => {
    expect(isPricingSnapshotStale()).toBe(false);
  });
});
