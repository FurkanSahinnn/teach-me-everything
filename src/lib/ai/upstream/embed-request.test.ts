import { describe, it, expect } from "vitest";
import { buildEmbedUpstream } from "./embed-request";

describe("buildEmbedUpstream", () => {
  it("rejects empty key", () => {
    const r = buildEmbedUpstream({ provider: "openai", model: "x", input: ["hi"] }, "");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("missing_key");
  });

  it("rejects ollama / lm-studio / llama-cpp (must bypass proxy)", () => {
    for (const provider of ["ollama", "lm-studio", "llama-cpp"]) {
      const r = buildEmbedUpstream({ provider, model: "x", input: ["a"] }, "k");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("proxy_local_forbidden");
    }
  });

  it("rejects custom: endpoints (client-direct)", () => {
    const r = buildEmbedUpstream({ provider: "custom:something", model: "x", input: [] }, "k");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("custom_endpoint_forbidden");
  });

  it("rejects unknown provider", () => {
    const r = buildEmbedUpstream({ provider: "xyz", model: "m", input: [] }, "k");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("provider_not_allowed");
  });

  it("builds OpenAI embed call (provider stripped, model retained)", () => {
    const r = buildEmbedUpstream(
      { provider: "openai", model: "text-embedding-3-small", input: ["a", "b"] },
      "sk-openai",
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.request.url).toBe("https://api.openai.com/v1/embeddings");
      expect(r.request.headers.authorization).toBe("Bearer sk-openai");
      const body = JSON.parse(r.request.body) as Record<string, unknown>;
      expect(body.model).toBe("text-embedding-3-small");
      expect(body.provider).toBeUndefined();
    }
  });

  it("embeds model id into Gemini URL and strips both provider+model from body", () => {
    const r = buildEmbedUpstream(
      { provider: "google-gemini", model: "text-embedding-004", requests: [] },
      "AIza-key",
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.request.url).toBe(
        "https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:batchEmbedContents",
      );
      expect(r.request.headers["x-goog-api-key"]).toBe("AIza-key");
      const body = JSON.parse(r.request.body) as Record<string, unknown>;
      expect(body.model).toBeUndefined();
      expect(body.provider).toBeUndefined();
    }
  });

  it("requires model for huggingface", () => {
    const r = buildEmbedUpstream({ provider: "huggingface", input: ["x"] }, "hf-key");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("invalid_shape");
  });

  it("builds Mistral embed call", () => {
    const r = buildEmbedUpstream(
      { provider: "mistral", model: "mistral-embed", input: ["x"] },
      "mistral-key",
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.request.url).toBe("https://api.mistral.ai/v1/embeddings");
      expect(r.request.headers.authorization).toBe("Bearer mistral-key");
    }
  });
});
