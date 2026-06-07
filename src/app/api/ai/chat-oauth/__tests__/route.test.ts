import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Capture options the SUT passes into query() so individual tests can assert.
let lastQueryArgs:
  | {
      prompt: string;
      options: Record<string, unknown>;
    }
  | null = null;

// Each test installs its own scenario by setting this generator before
// importing the route. Defaults to an empty stream.
let scenario: () => AsyncGenerator<unknown> = async function* () {};

vi.mock("@anthropic-ai/claude-agent-sdk", () => {
  return {
    query: vi.fn((args: { prompt: string; options: Record<string, unknown> }) => {
      lastQueryArgs = args;
      return scenario();
    }),
    createSdkMcpServer: vi.fn((opts: unknown) => ({ __mock: "mcp-server", opts })),
    tool: vi.fn(
      (name: string, description: string, schema: unknown, handler: unknown) => ({
        name,
        description,
        schema,
        handler,
      }),
    ),
  };
});

// Now import after mocks are wired.
async function importRoute() {
  return await import("../route");
}

function makeRequest(body: unknown, opts?: { auth?: string | null }): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts?.auth !== null) headers.authorization = opts?.auth ?? "Bearer sk-ant-oat01-test";
  return new Request("https://localhost/api/ai/chat-oauth", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

async function readSse(res: Response): Promise<{ event: string; data: unknown }[]> {
  const text = await res.text();
  const frames: { event: string; data: unknown }[] = [];
  for (const raw of text.split("\n\n")) {
    const lines = raw.split("\n");
    let event = "message";
    const dataParts: string[] = [];
    for (const line of lines) {
      if (line.startsWith("event: ")) event = line.slice("event: ".length);
      else if (line.startsWith("data: ")) dataParts.push(line.slice("data: ".length));
    }
    if (dataParts.length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(dataParts.join("\n"));
    } catch {
      continue;
    }
    frames.push({ event, data: parsed });
  }
  return frames;
}

const VALID_BODY = {
  model: "claude-sonnet-4-6",
  system: [{ type: "text", text: "You are a helpful tutor." }],
  messages: [{ role: "user", content: "What is X?" }],
  max_tokens: 256,
};

describe("POST /api/ai/chat-oauth", () => {
  beforeEach(() => {
    lastQueryArgs = null;
    scenario = async function* () {};
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("rejects requests without a Bearer token", async () => {
    const { POST } = await importRoute();
    const res = await POST(makeRequest(VALID_BODY, { auth: null }));
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("missing_key");
  });

  it("rejects requests with malformed body shape", async () => {
    const { POST } = await importRoute();
    const res = await POST(
      makeRequest({ model: "claude-sonnet-4-6", system: "not-array", messages: [] }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("invalid_shape");
  });

  it("rejects when last message is not from the user", async () => {
    const { POST } = await importRoute();
    const res = await POST(
      makeRequest({
        ...VALID_BODY,
        messages: [{ role: "assistant", content: "hi" }],
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("invalid_messages");
  });

  it("forwards CLAUDE_CODE_OAUTH_TOKEN env var to SDK and clears ANTHROPIC_API_KEY", async () => {
    process.env.ANTHROPIC_API_KEY = "should-be-stripped";
    scenario = async function* () {
      yield {
        type: "stream_event",
        event: { type: "message_stop" },
      };
    };
    const { POST } = await importRoute();
    const res = await POST(
      makeRequest(VALID_BODY, { auth: "Bearer sk-ant-oat01-secret" }),
    );
    expect(res.status).toBe(200);
    // Drain the stream so the route runs through.
    await res.text();
    expect(lastQueryArgs).not.toBeNull();
    const env = (lastQueryArgs!.options.env as Record<string, string | undefined>) ?? {};
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe("sk-ant-oat01-secret");
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    delete process.env.ANTHROPIC_API_KEY;
  });

  it("flattens multi-block system prompt to a single string", async () => {
    scenario = async function* () {
      yield { type: "stream_event", event: { type: "message_stop" } };
    };
    const { POST } = await importRoute();
    await POST(
      makeRequest({
        ...VALID_BODY,
        system: [
          { type: "text", text: "Block one." },
          { type: "text", text: "Block two." },
        ],
      }),
    );
    expect(lastQueryArgs!.options.systemPrompt).toBe(
      "Block one.\n\nBlock two.",
    );
  });

  it("strips mcp__tme__ prefix from tool_use block names in SSE output", async () => {
    scenario = async function* () {
      yield {
        type: "stream_event",
        event: {
          type: "content_block_start",
          index: 0,
          content_block: {
            type: "tool_use",
            id: "toolu_01",
            name: "mcp__tme__add_flashcard",
          },
        },
      };
      yield { type: "stream_event", event: { type: "message_stop" } };
    };
    const { POST } = await importRoute();
    const res = await POST(makeRequest(VALID_BODY));
    const frames = await readSse(res);

    const startFrame = frames.find((f) => f.event === "content_block_start");
    expect(startFrame).toBeDefined();
    const block = (startFrame!.data as {
      content_block: { name: string };
    }).content_block;
    expect(block.name).toBe("add_flashcard");
  });

  it("registers exactly the three TME tools as MCP server contents", async () => {
    scenario = async function* () {
      yield { type: "stream_event", event: { type: "message_stop" } };
    };
    const { POST } = await importRoute();
    await POST(makeRequest(VALID_BODY));

    const allowed = lastQueryArgs!.options.allowedTools as string[];
    expect(allowed).toEqual([
      "mcp__tme__add_flashcard",
      "mcp__tme__open_citation",
      "mcp__tme__simplify_explanation",
    ]);

    const disallowed = lastQueryArgs!.options.disallowedTools as string[];
    // Spot-check that built-in coding tools are blocked so a notebook chat
    // can't accidentally fire Read/Bash/etc.
    expect(disallowed).toContain("Bash");
    expect(disallowed).toContain("Read");
    expect(disallowed).toContain("WebFetch");
  });

  it("includes prior conversation as transcript when history present", async () => {
    scenario = async function* () {
      yield { type: "stream_event", event: { type: "message_stop" } };
    };
    const { POST } = await importRoute();
    await POST(
      makeRequest({
        ...VALID_BODY,
        messages: [
          { role: "user", content: "First question?" },
          { role: "assistant", content: "First answer." },
          { role: "user", content: "Follow-up?" },
        ],
      }),
    );
    const prompt = lastQueryArgs!.prompt;
    expect(prompt).toContain("First question?");
    expect(prompt).toContain("First answer.");
    expect(prompt).toContain("Follow-up?");
    // Current message is set off so the model knows what to answer now.
    expect(prompt).toMatch(/Current user message[\s\S]*Follow-up\?/);
  });

  it("sends single message with no transcript wrapper when no history", async () => {
    scenario = async function* () {
      yield { type: "stream_event", event: { type: "message_stop" } };
    };
    const { POST } = await importRoute();
    await POST(makeRequest(VALID_BODY));
    expect(lastQueryArgs!.prompt).toBe("What is X?");
  });

  it("forwards content_block_delta text frames unchanged", async () => {
    scenario = async function* () {
      yield {
        type: "stream_event",
        event: {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "Hello world" },
        },
      };
      yield { type: "stream_event", event: { type: "message_stop" } };
    };
    const { POST } = await importRoute();
    const res = await POST(makeRequest(VALID_BODY));
    const frames = await readSse(res);
    const delta = frames.find((f) => f.event === "content_block_delta");
    expect(delta).toBeDefined();
    expect((delta!.data as { delta: { text: string } }).delta.text).toBe(
      "Hello world",
    );
  });

  it("emits an error frame with friendly text when SDK throws ENOENT (claude binary missing)", async () => {
    scenario = async function* () {
      throw new Error("spawn claude ENOENT");
      // eslint-disable-next-line no-unreachable
      yield;
    };
    const { POST } = await importRoute();
    const res = await POST(makeRequest(VALID_BODY));
    const frames = await readSse(res);
    const errFrame = frames.find((f) => f.event === "error");
    expect(errFrame).toBeDefined();
    const msg = (errFrame!.data as { error: { message: string } }).error.message;
    expect(msg).toMatch(/Claude Code CLI bulunamadı/);
  });

  it("honours pathToClaudeCodeExecutable override when provided in body", async () => {
    scenario = async function* () {
      yield { type: "stream_event", event: { type: "message_stop" } };
    };
    const { POST } = await importRoute();
    await POST(
      makeRequest({
        ...VALID_BODY,
        pathToClaudeCodeExecutable: "/usr/local/bin/claude",
      }),
    );
    expect(lastQueryArgs!.options.pathToClaudeCodeExecutable).toBe(
      "/usr/local/bin/claude",
    );
  });

  it("emits a tme_sdk_result frame with cost/usage when SDK yields a result", async () => {
    scenario = async function* () {
      yield {
        type: "stream_event",
        event: {
          type: "message_delta",
          delta: { stop_reason: "end_turn" },
          usage: { output_tokens: 42 },
        },
      };
      yield { type: "stream_event", event: { type: "message_stop" } };
      yield {
        type: "result",
        subtype: "success",
        is_error: false,
        total_cost_usd: 0.0123,
        usage: { input_tokens: 12, output_tokens: 42 },
      };
    };
    const { POST } = await importRoute();
    const res = await POST(makeRequest(VALID_BODY));
    const frames = await readSse(res);
    const resultFrame = frames.find((f) => f.event === "tme_sdk_result");
    expect(resultFrame).toBeDefined();
    expect(
      (resultFrame!.data as { total_cost_usd: number }).total_cost_usd,
    ).toBeCloseTo(0.0123);
    expect(
      (resultFrame!.data as { is_error: boolean }).is_error,
    ).toBe(false);
  });
});
