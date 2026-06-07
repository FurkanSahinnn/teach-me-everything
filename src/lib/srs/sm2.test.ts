import { describe, it, expect } from "vitest";
import {
  computeSm2,
  formatNextDue,
  isLeech,
  LEECH_THRESHOLD,
  type Sm2State,
} from "./sm2";

const NOW = 1_700_000_000_000; // fixed instant for deterministic dueAt math
const DAY = 86_400_000;
const TEN_MIN = 10 * 60 * 1000;

const fresh = (): Sm2State => ({ ease: 2.5, interval: 0, repetitions: 0 });

describe("computeSm2", () => {
  it("again resets repetitions and reschedules in 10 minutes", () => {
    const next = computeSm2({ ease: 2.5, interval: 6, repetitions: 2 }, "again", NOW);
    expect(next.repetitions).toBe(0);
    expect(next.interval).toBe(0);
    expect(next.dueAt).toBe(NOW + TEN_MIN);
  });

  it("good on first review schedules in 1 day", () => {
    const next = computeSm2(fresh(), "good", NOW);
    expect(next.repetitions).toBe(1);
    expect(next.interval).toBe(1);
    expect(next.dueAt).toBe(NOW + DAY);
  });

  it("good on second review schedules in 6 days", () => {
    const next = computeSm2({ ease: 2.5, interval: 1, repetitions: 1 }, "good", NOW);
    expect(next.repetitions).toBe(2);
    expect(next.interval).toBe(6);
    expect(next.dueAt).toBe(NOW + 6 * DAY);
  });

  it("good on third+ review multiplies interval by ease", () => {
    const next = computeSm2({ ease: 2.5, interval: 6, repetitions: 2 }, "good", NOW);
    expect(next.interval).toBe(15); // round(6 * 2.5)
    expect(next.repetitions).toBe(3);
  });

  it("hard scales the interval by 0.8 (with min 1)", () => {
    const next = computeSm2({ ease: 2.5, interval: 10, repetitions: 5 }, "hard", NOW);
    // base would be round(10 * 2.5) = 25, then 25 * 0.8 = 20
    expect(next.interval).toBe(20);
  });

  it("easy scales the interval by 1.3", () => {
    const next = computeSm2({ ease: 2.5, interval: 10, repetitions: 5 }, "easy", NOW);
    // base would be round(10 * 2.5) = 25, then 25 * 1.3 = round(32.5) = 33
    expect(next.interval).toBe(33);
  });

  it("clamps ease to 1.3 floor on consecutive 'again' ratings", () => {
    let state: Sm2State = { ease: 1.4, interval: 0, repetitions: 0 };
    for (let i = 0; i < 10; i += 1) {
      const u = computeSm2(state, "again", NOW);
      state = { ease: u.ease, interval: u.interval, repetitions: u.repetitions };
    }
    expect(state.ease).toBe(1.3);
  });

  it("ease grows on easy reviews", () => {
    const next = computeSm2(fresh(), "easy", NOW);
    expect(next.ease).toBeGreaterThan(2.5);
  });

  it("interval is clamped to MAX_INTERVAL_DAYS", () => {
    const next = computeSm2(
      { ease: 2.5, interval: 30_000, repetitions: 100 },
      "easy",
      NOW,
    );
    expect(next.interval).toBeLessThanOrEqual(36_500);
  });

  it("uses Date.now() when caller omits the now argument", () => {
    const before = Date.now();
    const next = computeSm2(fresh(), "good");
    const after = Date.now();
    expect(next.dueAt).toBeGreaterThanOrEqual(before + DAY - 1);
    expect(next.dueAt).toBeLessThanOrEqual(after + DAY + 1);
  });
});

describe("formatNextDue", () => {
  const pickTr = (tr: string, _en: string) => tr;
  const pickEn = (_tr: string, en: string) => en;

  it("again returns the relearning label per locale", () => {
    expect(formatNextDue("again", { ease: 2.5, interval: 0, repetitions: 0, dueAt: 0 }, pickTr)).toBe("~10 dk");
    expect(formatNextDue("again", { ease: 2.5, interval: 0, repetitions: 0, dueAt: 0 }, pickEn)).toBe("~10 min");
  });

  it("interval=0 returns today / bugün", () => {
    expect(formatNextDue("good", { ease: 2.5, interval: 0, repetitions: 0, dueAt: 0 }, pickTr)).toBe("bugün");
  });

  it("interval=1 returns single-day label", () => {
    expect(formatNextDue("good", { ease: 2.5, interval: 1, repetitions: 1, dueAt: 0 }, pickEn)).toBe("1 day");
  });

  it("interval>1 returns the day count label", () => {
    expect(formatNextDue("good", { ease: 2.5, interval: 14, repetitions: 4, dueAt: 0 }, pickTr)).toBe("14 gün");
    expect(formatNextDue("good", { ease: 2.5, interval: 14, repetitions: 4, dueAt: 0 }, pickEn)).toBe("14 days");
  });
});

describe("isLeech", () => {
  it("threshold constant is 8", () => {
    expect(LEECH_THRESHOLD).toBe(8);
  });

  it("returns false when lapses is undefined (legacy / unbackfilled row)", () => {
    expect(isLeech({ lapses: undefined })).toBe(false);
  });

  it("returns false below the threshold", () => {
    for (let n = 0; n < LEECH_THRESHOLD; n += 1) {
      expect(isLeech({ lapses: n })).toBe(false);
    }
  });

  it("returns true at and above the threshold", () => {
    expect(isLeech({ lapses: LEECH_THRESHOLD })).toBe(true);
    expect(isLeech({ lapses: LEECH_THRESHOLD + 5 })).toBe(true);
  });

  it("simulating 8 consecutive 'again' ratings flips a card to leech", () => {
    // Mirrors what flashcards.applyReview does on each "again": lapses += 1.
    // We don't import the Dexie repo here (keeps the test pure); the math is
    // simply "increment per again".
    let lapses = 0;
    for (let i = 0; i < LEECH_THRESHOLD; i += 1) {
      lapses += 1;
    }
    expect(isLeech({ lapses })).toBe(true);
  });
});
