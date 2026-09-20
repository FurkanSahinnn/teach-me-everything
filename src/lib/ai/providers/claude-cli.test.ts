import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildClaudeCliArgs,
  flattenMessagesToTurn,
  parseCliLine,
  ClaudeCliChatProvider,
  CLAUDE_CLI_DISALLOWED_TOOLS,
} from "./claude-cli";
import type { ChatRequest, StreamEvent } from "./types";

vi.mock("@/lib/tauri/agent-cli", () => ({
  startAgentCli: vi.fn(),
  stopAgentCli: vi.fn(async () => {}),
}));

// The real store pulls in zustand persist + localStorage, which the node test
// environment does not provide; the provider only reads two optional fields.
vi.mock("@/stores/prefs", () => ({
  usePrefs: { getState: () => ({ agentCli: {} }) },
}));

import { startAgentCli, stopAgentCli } from "@/lib/tauri/agent-cli";

const startMock = vi.mocked(startAgentCli);
const stopMock = vi.mocked(stopAgentCli);

/** Drives the provider against a canned transcript and collects its events. */
async function collect(
  lines: string[],
  overrides: Partial<ChatRequest> = {},
): Promise<StreamEvent[]> {
  startMock.mockImplementation(async (opts, onEvent) => {
    // Deliver asynchronously so the generator is already awaiting the queue,
    // which is the ordering the real Channel produces.
    queueMicrotask(() => {
      for (const data of lines) onEvent({ type: "line", data });
    });
    return opts.session;
  });

  const req: ChatRequest = {
    apiKey: "",
    model: "sonnet",
    system: [{ type: "text", text: "You are a tutor." }],
    messages: [{ role: "user", content: "Define spaced repetition." }],
    ...overrides,
  };

  const handle = new ClaudeCliChatProvider().streamChat(req);
  const out: StreamEvent[] = [];
  for await (const event of handle.events) out.push(event);
  return out;
}

/** `raw` is emitted for every payload; the typed events are what callers use. */
function typed(events: StreamEvent[]): StreamEvent[] {
  return events.filter((e) => e.kind !== "raw");
}

const LINE_INIT =
  '{"type":"system","subtype":"init","session_id":"s1","tools":[],"model":"claude-sonnet-4-6"}';
const LINE_START =
  '{"type":"stream_event","event":{"type":"message_start","message":{"model":"claude-sonnet-4-6","usage":{"input_tokens":10}}},"session_id":"s1"}';
const LINE_TEXT =
  '{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"PONG"}},"session_id":"s1"}';
const LINE_MSG_DELTA =
  '{"type":"stream_event","event":{"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":5}},"session_id":"s1"}';
const LINE_STOP =
  '{"type":"stream_event","event":{"type":"message_stop"},"session_id":"s1"}';
const LINE_RESULT_OK =
  '{"type":"result","subtype":"success","is_error":false,"result":"PONG","session_id":"s1","total_cost_usd":0.001}';

describe("buildClaudeCliArgs", () => {
  it("selects the non-interactive bidirectional streaming mode", () => {
    const args = buildClaudeCliArgs({ model: "sonnet" });
    expect(args).toContain("-p");
    expect(args.join(" ")).toContain("--output-format stream-json");
    expect(args.join(" ")).toContain("--input-format stream-json");
    expect(args).toContain("--include-partial-messages");
  });

  it("passes the model through", () => {
    const args = buildClaudeCliArgs({ model: "opus" });
    expect(args[args.indexOf("--model") + 1]).toBe("opus");
  });

  it("empties the tool set and strips the user's own CLI customisations", () => {
    const args = buildClaudeCliArgs({ model: "sonnet" });
    // Naming every tool is what drops the schema overhead to zero; --restricted
    // alone only removes the ones that run code.
    for (const tool of CLAUDE_CLI_DISALLOWED_TOOLS) expect(args).toContain(tool);
    expect(args).toContain("--safe-mode");
    expect(args).toContain("--strict-mcp-config");
    expect(args).toContain("--disable-slash-commands");
  });

  it("never puts the system prompt on the command line", () => {
    // It is staged to a file by the Rust side — Windows caps a command line
    // near 32k characters and an article window is far longer.
    const args = buildClaudeCliArgs({ model: "sonnet" });
    expect(args).not.toContain("--system-prompt");
    expect(args).not.toContain("--append-system-prompt");
  });
});

describe("flattenMessagesToTurn", () => {
  it("passes a lone user message through untouched", () => {
    expect(
      flattenMessagesToTurn([{ role: "user", content: "What is SM-2?" }]),
    ).toBe("What is SM-2?");
  });

  it("transcribes history into one turn", () => {
    // The CLI answers every user line it reads, so prior turns cannot be
    // replayed as separate lines.
    const out = flattenMessagesToTurn([
      { role: "user", content: "First question" },
      { role: "assistant", content: "First answer" },
      { role: "user", content: "Second question" },
    ]);
    expect(out).toContain("User: First question");
    expect(out).toContain("Assistant: First answer");
    expect(out).toContain("## Current message");
    expect(out).toContain("Second question");
  });

  it("asks the model to continue when the last message is a prefill", () => {
    const out = flattenMessagesToTurn([
      { role: "user", content: "Explain" },
      { role: "assistant", content: "Sure, here goes" },
    ]);
    expect(out).toContain("## Continue this reply");
  });

  it("drops blank messages and survives an empty list", () => {
    expect(flattenMessagesToTurn([])).toBe("");
    expect(
      flattenMessagesToTurn([
        { role: "user", content: "   " },
        { role: "user", content: "Real question" },
      ]),
    ).toBe("Real question");
  });

  it("renders content blocks rather than stringifying the array", () => {
    const out = flattenMessagesToTurn([
      { role: "user", content: [{ type: "text", text: "Block text" }] },
    ]);
    expect(out).toBe("Block text");
  });
});

describe("parseCliLine", () => {
  it("surfaces real SDK error result messages", () => {
    expect(parseCliLine(JSON.stringify({ type: "result", subtype: "error_during_execution",
      is_error: true, errors: ["Login required", "Run /login"] }))).toMatchObject({
      kind: "result", isError: true, message: "Login required\nRun /login",
    });
  });
  it("unwraps a stream_event into its Anthropic payload", () => {
    const parsed = parseCliLine(LINE_TEXT);
    expect(parsed.kind).toBe("payload");
    if (parsed.kind !== "payload") throw new Error("expected payload");
    expect(parsed.payload.type).toBe("content_block_delta");
  });

  it("reads a successful result as a non-error terminator", () => {
    const parsed = parseCliLine(LINE_RESULT_OK);
    expect(parsed.kind).toBe("result");
    if (parsed.kind !== "result") throw new Error("expected result");
    expect(parsed.isError).toBe(false);
  });

  it("carries the upstream HTTP status so a 429 stays retryable", () => {
    const parsed = parseCliLine(
      '{"type":"result","subtype":"error_during_execution","is_error":true,"result":"rate limited","api_error_status":429}',
    );
    if (parsed.kind !== "result") throw new Error("expected result");
    expect(parsed.isError).toBe(true);
    expect(parsed.status).toBe(429);
  });

  it("treats a non-success subtype as an error even without is_error", () => {
    const parsed = parseCliLine('{"type":"result","subtype":"error_max_turns"}');
    if (parsed.kind !== "result") throw new Error("expected result");
    expect(parsed.isError).toBe(true);
  });

  it("ignores non-JSON chatter instead of failing the turn", () => {
    expect(parseCliLine("Loading plugins...").kind).toBe("ignored");
    expect(parseCliLine("").kind).toBe("ignored");
    expect(parseCliLine("null").kind).toBe("ignored");
  });

  it("ignores lines that carry no stream content", () => {
    expect(parseCliLine(LINE_INIT).kind).toBe("ignored");
    expect(
      parseCliLine('{"type":"rate_limit_event","rate_limit_info":{}}').kind,
    ).toBe("ignored");
  });
});

describe("ClaudeCliChatProvider.streamChat", () => {
  beforeEach(() => {
    startMock.mockReset();
    stopMock.mockClear();
  });

  it("maps a real transcript onto the shared Anthropic event vocabulary", async () => {
    const events = typed(
      await collect([
        LINE_INIT,
        LINE_START,
        LINE_TEXT,
        LINE_MSG_DELTA,
        LINE_STOP,
        LINE_RESULT_OK,
      ]),
    );
    expect(events.map((e) => e.kind)).toEqual([
      "start",
      "text",
      "delta",
      "stop",
    ]);
    expect(events.find((e) => e.kind === "text")).toEqual({
      kind: "text",
      delta: "PONG",
    });
    expect(events.find((e) => e.kind === "start")).toMatchObject({ model: "sonnet" });
  });

  it("stops exactly once when cancellation lands during spawn", async () => {
    const controller = new AbortController();
    startMock.mockImplementation(async (opts) => {
      controller.abort();
      return opts.session;
    });
    const handle = new ClaudeCliChatProvider().streamChat({ apiKey: "", model: "sonnet",
      system: [], messages: [], signal: controller.signal });
    const events: StreamEvent[] = [];
    for await (const event of handle.events) events.push(event);
    expect(typed(events)).toEqual([{ kind: "abort" }]);
    expect(stopMock).toHaveBeenCalledTimes(1);
  });

  it("does not spawn a pre-aborted request", async () => {
    const events = await collect([], { signal: AbortSignal.abort() });
    expect(events).toEqual([{ kind: "abort" }]);
    expect(startMock).not.toHaveBeenCalled();
  });

  it("stages the system prompt for the file flag rather than argv", async () => {
    await collect([LINE_START, LINE_STOP, LINE_RESULT_OK]);
    const opts = startMock.mock.calls[0]?.[0];
    expect(opts?.systemPrompt).toBe("You are a tutor.");
    expect(opts?.args).not.toContain("You are a tutor.");
  });

  it("sends the turn as one NDJSON user line on stdin", async () => {
    await collect([LINE_START, LINE_STOP, LINE_RESULT_OK]);
    const opts = startMock.mock.calls[0]?.[0];
    expect(opts?.stdin?.endsWith("\n")).toBe(true);
    const parsed = JSON.parse((opts?.stdin ?? "").trim()) as {
      type: string;
      message: { role: string; content: { text: string }[] };
    };
    expect(parsed.type).toBe("user");
    expect(parsed.message.content[0]?.text).toBe("Define spaced repetition.");
  });

  it("surfaces a failed result with its status so retry logic can see it", async () => {
    const events = typed(
      await collect([
        LINE_START,
        '{"type":"result","subtype":"error_during_execution","is_error":true,"result":"overloaded","api_error_status":529}',
      ]),
    );
    expect(events.find((e) => e.kind === "error")).toEqual({
      kind: "error",
      status: 529,
      message: "overloaded",
    });
  });

  it("reports a non-zero exit as an error", async () => {
    startMock.mockImplementation(async (opts, onEvent) => {
      queueMicrotask(() => onEvent({ type: "exit", code: 1 }));
      return opts.session;
    });
    const handle = new ClaudeCliChatProvider().streamChat({
      apiKey: "",
      model: "sonnet",
      system: [],
      messages: [{ role: "user", content: "hi" }],
    });
    const out: StreamEvent[] = [];
    for await (const e of handle.events) out.push(e);
    expect(out.find((e) => e.kind === "error")).toBeDefined();
  });

  it("explains itself on the web build instead of hanging", async () => {
    startMock.mockResolvedValue(null);
    const handle = new ClaudeCliChatProvider().streamChat({
      apiKey: "",
      model: "sonnet",
      system: [],
      messages: [{ role: "user", content: "hi" }],
    });
    const out: StreamEvent[] = [];
    for await (const e of handle.events) out.push(e);
    expect(out).toHaveLength(1);
    expect(out[0]?.kind).toBe("error");
  });

  it("kills the child when the turn ends, since it waits for more stdin", async () => {
    await collect([LINE_START, LINE_STOP, LINE_RESULT_OK]);
    expect(stopMock).toHaveBeenCalled();
  });

  it("reports an abort even when cancelled before any output arrived", async () => {
    // Nothing is ever delivered: the CLI is "still thinking" when the user
    // cancels. The mapper cannot notice that on its own (it checks the signal
    // per payload), so the provider has to say it.
    startMock.mockImplementation(async (opts) => opts.session);
    const handle = new ClaudeCliChatProvider().streamChat({
      apiKey: "",
      model: "sonnet",
      system: [],
      messages: [{ role: "user", content: "hi" }],
    });
    const out: StreamEvent[] = [];
    const drained = (async () => {
      for await (const event of handle.events) out.push(event);
    })();
    // Let the generator reach the queue wait before cancelling.
    await new Promise((r) => setTimeout(r, 0));
    handle.abort();
    await drained;
    expect(typed(out)).toEqual([{ kind: "abort" }]);
    expect(stopMock).toHaveBeenCalled();
  });
});
