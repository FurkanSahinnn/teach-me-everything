import { describe, expect, it } from "vitest";
import {
  classifyGeminiError,
  computeBackoffMs,
  isRetryableStatus,
  parseDurationToMs,
} from "./gemini-retry";

describe("parseDurationToMs", () => {
  it("parses whole + fractional seconds", () => {
    expect(parseDurationToMs("53s")).toBe(53000);
    expect(parseDurationToMs("1.7s")).toBe(1700);
  });
  it("returns null for junk / non-strings", () => {
    expect(parseDurationToMs("nope")).toBeNull();
    expect(parseDurationToMs(53)).toBeNull();
    expect(parseDurationToMs(undefined)).toBeNull();
  });
});

describe("classifyGeminiError", () => {
  it("extracts RetryInfo.retryDelay", () => {
    const body = {
      error: {
        code: 429,
        details: [
          {
            "@type": "type.googleapis.com/google.rpc.RetryInfo",
            retryDelay: "30s",
          },
        ],
      },
    };
    const v = classifyGeminiError(body);
    expect(v.retryDelayMs).toBe(30000);
    expect(v.terminal).toBe(false);
  });

  it("flags a per-day quota failure as terminal", () => {
    const body = {
      error: {
        details: [
          {
            "@type": "type.googleapis.com/google.rpc.QuotaFailure",
            violations: [
              { quotaId: "GenerateRequestsPerDayPerProjectPerModel" },
            ],
          },
        ],
      },
    };
    expect(classifyGeminiError(body).terminal).toBe(true);
  });

  it("flags limit:0 (no free-tier quota) as terminal", () => {
    const body = {
      error: {
        details: [
          {
            "@type": "type.googleapis.com/google.rpc.QuotaFailure",
            violations: [{ quotaId: "X", quotaValue: "0" }],
          },
        ],
      },
    };
    expect(classifyGeminiError(body).terminal).toBe(true);
  });

  it("returns neutral when there are no details", () => {
    expect(classifyGeminiError({ error: { message: "x" } })).toEqual({
      retryDelayMs: null,
      terminal: false,
    });
    expect(classifyGeminiError(null)).toEqual({
      retryDelayMs: null,
      terminal: false,
    });
  });
});

describe("isRetryableStatus", () => {
  it("retries 408 / 429 / 5xx only", () => {
    for (const s of [408, 429, 500, 502, 503, 504]) {
      expect(isRetryableStatus(s)).toBe(true);
    }
    for (const s of [400, 401, 403, 404]) {
      expect(isRetryableStatus(s)).toBe(false);
    }
  });
});

describe("computeBackoffMs", () => {
  const rand = (): number => 0; // deterministic: no jitter

  it("uses exponential backoff when there is no server delay", () => {
    expect(computeBackoffMs(0, null, { rand })).toBe(1000);
    expect(computeBackoffMs(1, null, { rand })).toBe(2000);
    expect(computeBackoffMs(2, null, { rand })).toBe(4000);
  });

  it("honors the server retryDelay above the exponential", () => {
    expect(computeBackoffMs(0, 53000, { rand })).toBe(53000);
  });

  it("caps the exponential part and the total", () => {
    expect(computeBackoffMs(10, null, { rand })).toBe(32000); // expo capped
    expect(computeBackoffMs(0, 999999, { rand })).toBe(90000); // hard cap
  });

  it("adds jitter on top", () => {
    expect(computeBackoffMs(0, null, { rand: () => 1 })).toBe(2000);
  });
});
