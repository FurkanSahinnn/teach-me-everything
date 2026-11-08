import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentCliEvent } from "@/lib/tauri/agent-cli";
import { opencodeFailure, opencodeUsage, streamOpencodeAcp } from "./opencode-acp";
import type { ChatRequest, StreamEvent } from "./types";

vi.mock("@/lib/tauri/agent-cli", () => ({
  getAgentWorkspace: vi.fn(async () => "/app/agent-workspace"),
  startAgentCli: vi.fn(),
  writeAgentCli: vi.fn(),
  stopAgentCli: vi.fn(async () => {}),
}));
vi.mock("@/stores/prefs", () => ({
  usePrefs: { getState: () => ({ agentCli: { opencodePath: " /bin/opencode ", env: { HTTPS_PROXY: "http://proxy:8080" } } }) },
}));
import { getAgentWorkspace, startAgentCli, stopAgentCli, writeAgentCli } from "@/lib/tauri/agent-cli";

const workspace = vi.mocked(getAgentWorkspace);
const start = vi.mocked(startAgentCli);
const write = vi.mocked(writeAgentCli);
const stop = vi.mocked(stopAgentCli);

type Message = Record<string, unknown> & { id?: number; method?: string; params?: Record<string, unknown> };
const request: ChatRequest = {
  apiKey: "", model: "opencode-go/kimi-k3",
  system: [{ type: "text", text: "Tutor instructions" }],
  messages: [{ role: "user", content: "Hello" }],
};

let emit: (event: AgentCliEvent) => void;
let handlers: Record<string, (message: Message) => void>;
const line = (value: unknown): void => emit({ type: "line", data: JSON.stringify(value) });
const respond = (id: unknown, result: unknown): void => line({ jsonrpc: "2.0", id, result });
const update = (sessionId: string, value: Record<string, unknown>): void =>
  line({ jsonrpc: "2.0", method: "session/update", params: { sessionId, update: value } });
const chunk = (text: string): void =>
  update("ses_1", { sessionUpdate: "agent_message_chunk", content: { type: "text", text } });
const sent = (): Message[] => write.mock.calls.map((call) => JSON.parse(call[1]) as Message);

async function flush(): Promise<void> { for (let i = 0; i < 40; i++) await Promise.resolve(); }
async function collect(overrides: Partial<ChatRequest> = {}): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const event of streamOpencodeAcp({ ...request, ...overrides }).events) events.push(event);
  return events;
}

beforeEach(() => {
  vi.clearAllMocks();
  workspace.mockResolvedValue("/app/agent-workspace");
  start.mockImplementation(async (options, callback) => {
    emit = callback;
    respond(1, { protocolVersion: 1, agentInfo: { name: "OpenCode", version: "2.2.6" } });
    return options.session;
  });
  handlers = {
    "session/new": (m) => respond(m.id, { sessionId: "ses_1", configOptions: [] }),
    "session/set_config_option": (m) => respond(m.id, { configOptions: [] }),
    "session/delete": (m) => respond(m.id, {}),
  };
  write.mockImplementation(async (_session, data) => {
    const message = JSON.parse(data) as Message;
    if (message.method) handlers[message.method]?.(message);
  });
});
afterEach(() => vi.useRealTimers());

describe("OpenCode ACP streaming", () => {
  it("streams message chunks, reports usage and deletes the session afterwards", async () => {
    handlers["session/prompt"] = (m) => {
      chunk("Mer");
      chunk("haba");
      respond(m.id, { stopReason: "end_turn", usage: { inputTokens: 100, outputTokens: 7, totalTokens: 127, cachedReadTokens: 20 } });
    };

    const events = await collect();

    expect(events).toEqual([
      { kind: "start", model: "opencode-go/kimi-k3", usage: {} },
      { kind: "text", delta: "Mer" },
      { kind: "text", delta: "haba" },
      { kind: "delta", stopReason: "end_turn", usage: { input_tokens: 100, output_tokens: 7, cache_read_input_tokens: 20 } },
      { kind: "stop" },
    ]);
    const messages = sent();
    expect(messages.map((m) => m.method)).toEqual([
      "session/new", "session/set_config_option", "session/set_config_option", "session/prompt", "session/delete",
    ]);
    expect(messages[0]?.params).toEqual({ cwd: "/app/agent-workspace", mcpServers: [] });
    expect(messages[1]?.params).toEqual({ sessionId: "ses_1", configId: "mode", value: "tme-tutor" });
    expect(messages[2]?.params).toEqual({ sessionId: "ses_1", configId: "model", value: "opencode-go/kimi-k3" });
    expect(messages[3]?.params).toEqual({ sessionId: "ses_1", prompt: [{ type: "text", text: "Hello" }] });
    expect(messages[4]?.params).toEqual({ sessionId: "ses_1" });
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("starts the Rust ACP profile with the system prompt and proxy env only", async () => {
    handlers["session/prompt"] = (m) => respond(m.id, { stopReason: "end_turn" });

    await collect();

    const options = start.mock.calls[0]?.[0];
    expect(options).toMatchObject({
      cli: "opencode", args: ["acp"], path: "/bin/opencode",
      env: { HTTPS_PROXY: "http://proxy:8080" }, systemPrompt: "Tutor instructions",
    });
    expect(JSON.parse(options?.stdin ?? "{}")).toMatchObject({ jsonrpc: "2.0", id: 1, method: "initialize" });
    expect(options?.stdin).not.toContain("Tutor instructions");
    expect(options?.closeStdin).not.toBe(true);
  });

  it("keeps OpenCode's own model for the default entry", async () => {
    handlers["session/prompt"] = (m) => respond(m.id, { stopReason: "end_turn" });

    await collect({ model: "default" });

    expect(sent().map((m) => m.method)).toEqual(["session/new", "session/set_config_option", "session/prompt", "session/delete"]);
    expect(sent()[1]?.params).toMatchObject({ configId: "mode" });
  });

  it("appends the JSON tool protocol to the system prompt when tools are requested", async () => {
    handlers["session/prompt"] = (m) => respond(m.id, { stopReason: "end_turn" });
    const tool = { name: "add_flashcard", description: "Add a card", input_schema: { type: "object" as const, properties: {} } };

    await collect({ tools: [tool] });

    expect(start.mock.calls[0]?.[0].systemPrompt).toContain("add_flashcard");
  });

  it("ignores other sessions and non-text updates and declines server requests", async () => {
    handlers["session/prompt"] = (m) => {
      update("ses_other", { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "wrong" } });
      update("ses_1", { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "thinking" } });
      line({ jsonrpc: "2.0", id: 99, method: "session/request_permission", params: { sessionId: "ses_1" } });
      line({ jsonrpc: "2.0", id: 100, method: "fs/read_text_file", params: { path: "/etc/passwd" } });
      chunk("ok");
      respond(m.id, { stopReason: "end_turn" });
    };

    const events = await collect();

    expect(events.filter((e) => e.kind === "text")).toEqual([{ kind: "text", delta: "ok" }]);
    expect(sent()).toContainEqual({ jsonrpc: "2.0", id: 99, result: { outcome: { outcome: "cancelled" } } });
    expect(sent()).toContainEqual(expect.objectContaining({ id: 100, error: expect.objectContaining({ code: -32601 }) }));
  });

  it("surfaces a prompt failure with an HTTP-like status and still deletes the session", async () => {
    handlers["session/prompt"] = (m) => line({ jsonrpc: "2.0", id: m.id, error: {
      code: -32603, message: "Internal error: Free usage limit reached.", data: { errorName: "provider.free-limit" },
    } });

    const events = await collect();

    expect(events.at(-1)).toEqual({ kind: "error", status: 429, message: "Free usage limit reached." });
    expect(sent().at(-1)?.method).toBe("session/delete");
  });

  it("explains a missing agent profile instead of OpenCode's raw mode error", async () => {
    handlers["session/set_config_option"] = (m) => line({ jsonrpc: "2.0", id: m.id, error: {
      code: -32602, message: "Invalid params: mode not found: tme-tutor",
    } });

    const events = await collect();

    expect(events.at(-1)).toMatchObject({ kind: "error", message: expect.stringContaining("OpenCode 2 or newer") });
    expect(sent().map((m) => m.method)).not.toContain("session/prompt");
  });

  it("cancels the running prompt and deletes the session when aborted", async () => {
    handlers["session/prompt"] = () => chunk("partial");
    const handle = streamOpencodeAcp(request);
    const iterator = handle.events[Symbol.asyncIterator]();

    expect((await iterator.next()).value).toMatchObject({ kind: "start" });
    expect((await iterator.next()).value).toEqual({ kind: "text", delta: "partial" });
    handle.abort();
    expect((await iterator.next()).value).toEqual({ kind: "abort" });
    expect((await iterator.next()).done).toBe(true);

    const tail = sent().slice(-2);
    expect(tail.map((m) => m.method)).toEqual(["session/cancel", "session/delete"]);
    expect(tail[0]?.id).toBeUndefined();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("reports a mid-turn exit without waiting to delete from a dead process", async () => {
    handlers["session/prompt"] = () => emit({ type: "exit", code: 3 });

    const events = await collect();

    expect(events.at(-1)).toMatchObject({ kind: "error", message: expect.stringContaining("code 3") });
    expect(sent().map((m) => m.method)).not.toContain("session/delete");
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("gives up on a stalled handshake", async () => {
    vi.useFakeTimers();
    handlers["session/new"] = () => {};
    const iterator = streamOpencodeAcp(request).events[Symbol.asyncIterator]();

    expect((await iterator.next()).value).toMatchObject({ kind: "start" });
    await flush();
    await vi.advanceTimersByTimeAsync(20_000);

    expect((await iterator.next()).value).toMatchObject({ kind: "error", message: expect.stringContaining("in time") });
    expect((await iterator.next()).done).toBe(true);
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("stops waiting for session/delete after its bound when OpenCode never answers", async () => {
    vi.useFakeTimers();
    handlers["session/prompt"] = (m) => respond(m.id, { stopReason: "end_turn" });
    handlers["session/delete"] = () => {};
    const iterator = streamOpencodeAcp(request).events[Symbol.asyncIterator]();
    for (let i = 0; i < 3; i++) await iterator.next();

    const done = iterator.next();
    await flush();
    expect(stop).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2_000);

    expect((await done).done).toBe(true);
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("does not spawn OpenCode when aborted while the workspace resolves", async () => {
    const controller = new AbortController();
    workspace.mockImplementation(async () => {
      controller.abort();
      return "/app/agent-workspace";
    });

    const events = await collect({ signal: controller.signal });

    expect(events).toEqual([{ kind: "abort" }]);
    expect(start).not.toHaveBeenCalled();
  });

  it("reports desktop-only on the web build without spawning anything", async () => {
    workspace.mockResolvedValue(null);

    const events = await collect();

    expect(events).toEqual([{ kind: "error", status: 0, message: expect.stringContaining("desktop app") }]);
    expect(start).not.toHaveBeenCalled();
  });
});

describe("opencodeUsage", () => {
  it("counts reasoning as output and keeps cache reads and writes apart", () => {
    expect(opencodeUsage({ inputTokens: 50, outputTokens: 10, thoughtTokens: 5, cachedReadTokens: 30, cachedWriteTokens: 8 }))
      .toEqual({ input_tokens: 50, output_tokens: 15, cache_read_input_tokens: 30, cache_creation_input_tokens: 8 });
  });

  it("treats a missing or malformed usage block as zero", () => {
    expect(opencodeUsage(undefined)).toEqual({ input_tokens: 0, output_tokens: 0 });
    expect(opencodeUsage({ inputTokens: "12", outputTokens: -4 })).toEqual({ input_tokens: 0, output_tokens: 0 });
  });
});

describe("opencodeFailure", () => {
  it("maps ACP's authentication error to 401 with a sign-in hint", () => {
    expect(opencodeFailure({ code: -32000, message: "Authentication required" })).toEqual({
      kind: "error", status: 401, message: "Authentication required. Run `opencode auth login` in a terminal.",
    });
    expect(opencodeFailure({ code: -32000, message: "Not signed in." }).message)
      .toBe("Not signed in. Run `opencode auth login` in a terminal.");
  });

  it("keeps unknown failures as status 0 with OpenCode's message", () => {
    expect(opencodeFailure({ code: -32603, message: "Internal error: Model not found" })).toEqual({
      kind: "error", status: 0, message: "Model not found",
    });
  });
});
