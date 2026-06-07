import { afterEach, describe, expect, it, vi } from "vitest";

import { POST } from "../route";

function makeRequest(body: unknown): Request {
  return new Request("https://localhost/api/ai/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/ai/test", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("uses max_completion_tokens for native OpenAI chat model tests", async () => {
    let capturedBody: Record<string, unknown> = {};
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url, init) => {
        capturedBody = JSON.parse(String((init as RequestInit).body));
        return Promise.resolve(
          new Response(
            JSON.stringify({
              model: "gpt-5-mini",
              usage: { prompt_tokens: 1, completion_tokens: 1 },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );
      }),
    );

    const res = await POST(makeRequest({ provider: "openai", key: "sk-test-key" }));

    expect(res.status).toBe(200);
    expect(capturedBody.model).toBe("gpt-5-mini");
    expect(capturedBody.max_completion_tokens).toBe(8);
    expect(capturedBody.max_tokens).toBeUndefined();
  });

  it("keeps max_tokens for non-OpenAI compatible providers", async () => {
    let capturedBody: Record<string, unknown> = {};
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url, init) => {
        capturedBody = JSON.parse(String((init as RequestInit).body));
        return Promise.resolve(
          new Response(
            JSON.stringify({
              model: "deepseek-chat",
              usage: { prompt_tokens: 1, completion_tokens: 1 },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );
      }),
    );

    const res = await POST(makeRequest({ provider: "deepseek", key: "sk-test-key" }));

    expect(res.status).toBe(200);
    expect(capturedBody.max_tokens).toBe(8);
    expect(capturedBody.max_completion_tokens).toBeUndefined();
  });

  it("validates OpenRouter via /auth/key, not chat/completions", async () => {
    const fetchMock = vi.fn().mockImplementation((url, init) => {
      const u = String(url);
      const method = ((init as RequestInit | undefined)?.method ?? "GET").toUpperCase();
      // The whole point of this branch is to avoid hitting model endpoints
      // that may 404 due to OpenRouter's rotating :free hosting.
      if (u.includes("/chat/completions")) {
        throw new Error("Should not call chat/completions for OpenRouter test");
      }
      expect(u).toBe("https://openrouter.ai/api/v1/auth/key");
      expect(method).toBe("GET");
      return Promise.resolve(
        new Response(
          JSON.stringify({ data: { label: "sk-or-test-…-abc", is_free_tier: true } }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(
      makeRequest({ provider: "openrouter", key: "sk-or-v1-deadbeefdeadbeef" }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; model?: string };
    expect(body.ok).toBe(true);
    expect(body.model).toBe("sk-or-test-…-abc");
  });

  it("surfaces OpenRouter 401 from /auth/key as ok:false", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ error: { message: "No auth credentials found" } }),
          { status: 401, headers: { "content-type": "application/json" } },
        ),
      ),
    );

    const res = await POST(makeRequest({ provider: "openrouter", key: "sk-or-bad-key" }));
    const body = (await res.json()) as { ok: boolean; status?: number; error?: string };
    expect(body.ok).toBe(false);
    expect(body.status).toBe(401);
    expect(body.error).toBe("No auth credentials found");
  });
});
