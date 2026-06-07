import { describe, it, expect } from "vitest";
import { buildChatUpstream } from "./chat-request";

describe("buildChatUpstream", () => {
  const baseBody = {
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    system: [{ type: "text", text: "Sen yardımcı bir AI'sin." }],
    messages: [{ role: "user", content: [{ type: "text", text: "merhaba" }] }],
    max_tokens: 256,
  };

  it("rejects when key is empty", () => {
    const r = buildChatUpstream(baseBody, "");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("missing_key");
  });

  it("rejects when model is missing", () => {
    const { model: _m, ...rest } = baseBody;
    const r = buildChatUpstream(rest, "sk-xxx");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("invalid_shape");
  });

  it("builds anthropic x-api-key request", () => {
    const r = buildChatUpstream(baseBody, "sk-ant-test");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.request.url).toBe("https://api.anthropic.com/v1/messages");
      expect(r.request.headers["x-api-key"]).toBe("sk-ant-test");
      expect(r.request.headers["anthropic-version"]).toBe("2023-06-01");
      expect(r.request.headers["authorization"]).toBeUndefined();
      const parsed = JSON.parse(r.request.body) as Record<string, unknown>;
      expect(parsed.stream).toBe(true);
      expect(parsed.max_tokens).toBe(256);
      expect(parsed.model).toBe("claude-sonnet-4-6");
    }
  });

  it("uses Bearer + oauth-beta when authKind=oauth", () => {
    const r = buildChatUpstream({ ...baseBody, authKind: "oauth" }, "tok-oauth");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.request.headers["authorization"]).toBe("Bearer tok-oauth");
      expect(r.request.headers["anthropic-beta"]).toBe("oauth-2025-04-20");
      expect(r.request.headers["x-api-key"]).toBeUndefined();
    }
  });

  it("rejects anthropic family when system/messages missing", () => {
    const r = buildChatUpstream({ provider: "anthropic", model: "x" }, "sk-x");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("invalid_shape");
  });

  it("strips provider+authKind from forwarded body for openai-compat", () => {
    const r = buildChatUpstream(
      {
        provider: "openai",
        model: "gpt-5-mini",
        authKind: "api-key",
        messages: [{ role: "user", content: "ping" }],
        stream: true,
      },
      "sk-openai-x",
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.request.url).toBe("https://api.openai.com/v1/chat/completions");
      expect(r.request.headers["authorization"]).toBe("Bearer sk-openai-x");
      const parsed = JSON.parse(r.request.body) as Record<string, unknown>;
      expect(parsed.provider).toBeUndefined();
      expect(parsed.authKind).toBeUndefined();
      expect(parsed.model).toBe("gpt-5-mini");
    }
  });

  it("builds gemini SSE endpoint with model URL segment encoded", () => {
    const r = buildChatUpstream(
      {
        provider: "google-gemini",
        model: "gemini-2.5-flash",
        contents: [{ role: "user", parts: [{ text: "merhaba" }] }],
      },
      "AIza-test",
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.request.url).toContain(
        "/models/gemini-2.5-flash:streamGenerateContent?alt=sse",
      );
      // Body must not carry top-level `model` for Gemini.
      const parsed = JSON.parse(r.request.body) as Record<string, unknown>;
      expect(parsed.model).toBeUndefined();
    }
  });

  it("returns unknown_provider for unrecognised id", () => {
    const r = buildChatUpstream({ ...baseBody, provider: "imaginary-x" }, "k");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("unknown_provider");
  });
});
