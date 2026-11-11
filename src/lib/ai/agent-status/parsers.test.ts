import { describe, expect, it } from "vitest";
import {
  codexPlanLabel,
  parseClaudeInitialize,
  parseClaudeUsage,
  parseCliVersion,
  parseCodexAccount,
  parseCodexRateLimits,
  parseCodexUserAgent,
  parseOpencodeStats,
} from "./parsers";

describe("versions", () => {
  it("extracts semver from CLI output", () => {
    expect(parseCliVersion("2.1.319 (Claude Code)")).toBe("2.1.319");
    expect(parseCliVersion("codex-cli 0.154.0")).toBe("0.154.0");
    expect(parseCliVersion(null)).toBeUndefined();
    expect(parseCliVersion("nothing")).toBeUndefined();
  });
  it("extracts the codex user agent version", () => {
    expect(parseCodexUserAgent("tme/0.154.0 (Windows 11; x64) term")).toBe("0.154.0");
    expect(parseCodexUserAgent(undefined)).toBeUndefined();
  });
});

describe("parseClaudeInitialize", () => {
  it("reads account and version", () => {
    expect(
      parseClaudeInitialize({
        claude_code_version: "2.1.319",
        account: {
          email: "user@example.test",
          organization: "Example Org",
          subscriptionType: "Claude Max",
          apiProvider: "firstParty",
        },
        pid: 1,
      }),
    ).toEqual({
      version: "2.1.319",
      email: "user@example.test",
      organization: "Example Org",
      planLabel: "Claude Max",
    });
  });
  it("tolerates garbage", () => {
    expect(parseClaudeInitialize(null)).toEqual({});
    expect(parseClaudeInitialize({ account: "x" })).toEqual({});
  });
});

describe("parseClaudeUsage", () => {
  const usage = {
    session: {},
    subscription_type: "max",
    rate_limits_available: true,
    rate_limits: {
      five_hour: { utilization: 34, resets_at: "2026-11-08T13:50:00.030749+00:00" },
      seven_day: { utilization: 145, resets_at: "2026-11-12T00:00:00+00:00" },
      model_scoped: [
        { display_name: "Fable", utilization: 0, resets_at: "2026-11-12T00:00:00+00:00" },
        { display_name: "", utilization: 5 },
        { display_name: "Broken", utilization: null },
      ],
      seven_day_opus: null,
      spend: {},
    },
  };
  it("maps windows, clamps and converts reset times", () => {
    const { limits } = parseClaudeUsage(usage);
    expect(limits.map((l) => l.id)).toEqual(["session", "weekly", "weekly_model:Fable"]);
    expect(limits[0]).toMatchObject({
      kind: "session",
      usedPercent: 34,
      windowMinutes: 300,
      resetsAt: Date.parse("2026-11-08T13:50:00.030749+00:00"),
    });
    expect(limits[1]?.usedPercent).toBe(100);
    expect(limits[2]).toMatchObject({ kind: "weekly_model", modelName: "Fable", label: "Weekly · Fable" });
  });
  it("returns nothing when limits are unavailable or the shape changed", () => {
    expect(parseClaudeUsage({ rate_limits_available: false, rate_limits: usage.rate_limits }).limits).toEqual([]);
    expect(parseClaudeUsage({ rate_limits: { five_hour: null } }).limits).toEqual([]);
    expect(parseClaudeUsage(undefined).limits).toEqual([]);
  });
  it("omits resetsAt when the timestamp is invalid", () => {
    const { limits } = parseClaudeUsage({ rate_limits: { five_hour: { utilization: 1, resets_at: "nope" } } });
    expect(limits[0]).not.toHaveProperty("resetsAt");
  });
});

describe("codexPlanLabel", () => {
  it("maps known plans", () => {
    expect(codexPlanLabel("plus")).toBe("ChatGPT Plus");
    expect(codexPlanLabel("pro")).toBe("ChatGPT Pro");
    expect(codexPlanLabel("team")).toBe("ChatGPT Team");
    expect(codexPlanLabel("edu_plus")).toBe("ChatGPT Edu");
    expect(codexPlanLabel("free")).toBe("ChatGPT Free");
  });
  it("capitalizes unknown values and drops empty/unknown", () => {
    expect(codexPlanLabel("shiny_new")).toBe("Shiny new");
    expect(codexPlanLabel("unknown")).toBeUndefined();
    expect(codexPlanLabel("")).toBeUndefined();
    expect(codexPlanLabel(5)).toBeUndefined();
  });
});

describe("parseCodexAccount", () => {
  it("reads a chatgpt account", () => {
    expect(
      parseCodexAccount({ account: { type: "chatgpt", email: "u@example.test", planType: "plus" }, requiresOpenaiAuth: true }),
    ).toEqual({ kind: "chatgpt", email: "u@example.test", planLabel: "ChatGPT Plus", requiresLogin: false });
  });
  it("flags a logged-out CLI", () => {
    expect(parseCodexAccount({ account: null, requiresOpenaiAuth: true })).toEqual({ kind: "none", requiresLogin: true });
  });
  it("handles api key and unknown account types", () => {
    expect(parseCodexAccount({ account: { type: "apiKey" }, requiresOpenaiAuth: false }).kind).toBe("apiKey");
    expect(parseCodexAccount({ account: { type: "gcp" } }).kind).toBe("other");
  });
});

describe("parseCodexRateLimits", () => {
  const snapshot = (over: Record<string, unknown> = {}) => ({
    limitId: "codex",
    planType: "pro",
    primary: { usedPercent: 12, resetsAt: 1_800_000_000, windowDurationMins: 300 },
    secondary: { usedPercent: 40, resetsAt: 1_800_500_000, windowDurationMins: 10080 },
    individualLimit: { limit: "100", used: "25", remainingPercent: 75, resetsAt: 1_801_000_000 },
    ...over,
  });
  it("maps primary, secondary and the monthly credit", () => {
    const out = parseCodexRateLimits({ rateLimits: snapshot() });
    expect(out.planLabel).toBe("ChatGPT Pro");
    expect(out.limits.map((l) => [l.id, l.usedPercent])).toEqual([
      ["session", 12],
      ["weekly", 40],
      ["monthly", 25],
    ]);
    expect(out.limits[0]).toMatchObject({ resetsAt: 1_800_000_000_000, windowMinutes: 300 });
  });
  it("prefers the codex bucket over the default", () => {
    const out = parseCodexRateLimits({
      rateLimits: snapshot({ primary: { usedPercent: 99 } }),
      rateLimitsByLimitId: { codex: snapshot({ primary: { usedPercent: 7 } }), other: snapshot() },
    });
    expect(out.limits[0]?.usedPercent).toBe(7);
  });
  it("copes with missing windows and clamps", () => {
    const out = parseCodexRateLimits({
      rateLimits: { primary: { usedPercent: 130 }, secondary: null, individualLimit: null },
    });
    expect(out.limits).toHaveLength(1);
    expect(out.limits[0]?.usedPercent).toBe(100);
    expect(out.planLabel).toBeUndefined();
    expect(parseCodexRateLimits(null).limits).toEqual([]);
  });
});

describe("parseOpencodeStats", () => {
  it("parses opencode stats --json output including model breakdown", () => {
    const parsed = parseOpencodeStats(
      {
        sessions: 2,
        prompts: 8,
        steps: 61,
        tokens: {
          input: 607101,
          output: 32949,
          reasoning: 32633,
          cache: { read: 8168258, write: 0 },
        },
        cost: 0,
        models: [
          {
            model: { id: "gemini-4-argon", providerID: "opencode-go", variant: "high" },
            steps: 61,
            tokens: {
              input: 607101,
              output: 32949,
              reasoning: 32633,
              cache: { read: 8168258, write: 0 },
            },
            cost: 0,
          },
        ],
      },
      7,
    );

    expect(parsed).toEqual({
      days: 7,
      sessions: 2,
      prompts: 8,
      steps: 61,
      inputTokens: 607101,
      outputTokens: 32949,
      reasoningTokens: 32633,
      cacheReadTokens: 8168258,
      cacheWriteTokens: 0,
      costUsd: 0,
      models: [
        {
          modelId: "gemini-4-argon",
          providerId: "opencode-go",
          steps: 61,
          inputTokens: 607101,
          outputTokens: 32949,
          reasoningTokens: 32633,
          cacheReadTokens: 8168258,
          cacheWriteTokens: 0,
          costUsd: 0,
        },
      ],
    });
  });

  it("returns undefined for non-object or unrelated payloads", () => {
    expect(parseOpencodeStats(null)).toBeUndefined();
    expect(parseOpencodeStats({})).toBeUndefined();
  });
});
