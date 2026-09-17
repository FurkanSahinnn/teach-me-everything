import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CodexCliChatProvider } from "./codex-cli";
import type { ChatRequest, StreamEvent } from "./types";
import type { AgentCliEvent } from "@/lib/tauri/agent-cli";

vi.mock("@/lib/tauri/agent-cli", () => ({ startAgentCli: vi.fn(), writeAgentCli: vi.fn(), stopAgentCli: vi.fn(async () => {}) }));
vi.mock("@/stores/prefs", () => ({ usePrefs: { getState: () => ({ agentCli: {} }) } }));
import { startAgentCli, writeAgentCli, stopAgentCli } from "@/lib/tauri/agent-cli";
const start = vi.mocked(startAgentCli), write = vi.mocked(writeAgentCli), stop = vi.mocked(stopAgentCli);
const request: ChatRequest = { apiKey: "", model: "codex-cli-model", system: [{ type: "text", text: "Tutor instructions" }], messages: [{ role: "user", content: "Hello" }] };
let emit: (event: AgentCliEvent) => void;
const line = (value: unknown): void => emit({ type: "line", data: JSON.stringify(value) });
const notify = (method: string, params: Record<string, unknown> = {}): void => line({ method, params: { threadId: "thread", turnId: "turn", ...params } });
const complete = (): void => notify("turn/completed", { turn: { id: "turn", status: "completed" } });
async function flush(): Promise<void> { for (let i = 0; i < 30; i++) await Promise.resolve(); }
async function collect(overrides: Partial<ChatRequest> = {}): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const event of new CodexCliChatProvider().streamChat({ ...request, ...overrides }).events) events.push(event);
  return events;
}
beforeEach(() => {
  vi.clearAllMocks();
  start.mockImplementation(async (options, callback) => {
    emit = callback;
    line({ id: 1, result: {} });
    return options.session;
  });
  write.mockImplementation(async (_session, data) => {
    const message = JSON.parse(data);
    if (message.method === "thread/start") line({ id: 2, result: { thread: { id: "thread" } } });
    if (message.method === "turn/start") line({ id: 3, result: { turn: { id: "turn" } } });
  });
});
afterEach(() => vi.useRealTimers());

describe("Codex app-server streaming", () => {
  it("yields deltas before completion and does not replay completed items", async () => {
    const iterator = new CodexCliChatProvider().streamChat(request).events[Symbol.asyncIterator]();
    expect((await iterator.next()).value.kind).toBe("start");
    await flush();
    notify("item/agentMessage/delta", { itemId: "a", delta: "Hel" });
    expect((await iterator.next()).value).toEqual({ kind: "text", delta: "Hel" });
    notify("item/agentMessage/delta", { itemId: "a", delta: "lo" });
    expect((await iterator.next()).value).toEqual({ kind: "text", delta: "lo" });
    notify("item/completed", { item: { id: "a", type: "agentMessage", text: "Hello" } });
    notify("thread/tokenUsage/updated", { tokenUsage: { total: { inputTokens: 100, cachedInputTokens: 60, outputTokens: 12 }, last: { inputTokens: 5 } } });
    complete();
    emit({ type: "exit", code: 1 });
    expect((await iterator.next()).value).toEqual({ kind: "delta", stopReason: "end_turn", usage: { input_tokens: 40, cache_read_input_tokens: 60, output_tokens: 12 } });
    expect((await iterator.next()).value.kind).toBe("stop");
    expect((await iterator.next()).done).toBe(true);
    expect(stop).toHaveBeenCalledTimes(1);
    const messages = write.mock.calls.map((call) => JSON.parse(call[1]));
    expect(messages.map((m) => m.method)).toEqual(["initialized", "thread/start", "turn/start"]);
    expect(messages[1].params).toMatchObject({ model: request.model, ephemeral: true, sandbox: "read-only", approvalPolicy: "never", baseInstructions: "Tutor instructions" });
    expect(messages[2].params.input[0].text).toBe("Hello");
    expect(start.mock.calls[0]?.[0].args).toEqual(["app-server"]);
    expect(start.mock.calls[0]?.[0].closeStdin).not.toBe(true);
    expect(start.mock.calls[0]?.[0].stdin).not.toContain("Tutor instructions");
  });

  it("accepts item-only output once and ignores other threads and turns", async () => {
    const result = collect(); await flush();
    notify("item/agentMessage/delta", { threadId: "other", itemId: "x", delta: "wrong" });
    notify("item/agentMessage/delta", { turnId: "other", itemId: "x", delta: "wrong" });
    for (let i = 0; i < 2; i++) notify("item/completed", { item: { id: "a", type: "agentMessage", text: "Answer" } });
    complete();
    expect((await result).filter((e) => e.kind === "text")).toEqual([{ kind: "text", delta: "Answer" }]);
  });

  it("ignores retryable errors and preserves usage on final failure", async () => {
    const result = collect(); await flush();
    notify("error", { willRetry: true, error: { message: "retry" } });
    notify("thread/tokenUsage/updated", { tokenUsage: { total: { inputTokens: 10, outputTokens: 2 } } });
    notify("turn/completed", { turn: { id: "turn", status: "failed", error: { message: "Rate limited", codexErrorInfo: { httpConnectionFailed: { httpStatusCode: 429 } } } } });
    const events = await result;
    expect(events.map((e) => e.kind)).toEqual(["start", "delta", "error"]);
    expect(events.at(-1)).toEqual({ kind: "error", status: 429, message: "Rate limited" });
  });

  it.each([0, 2, null])("rejects premature exit %s", async (code) => {
    const result = collect(); await flush(); emit({ type: "exit", code });
    expect((await result).at(-1)?.kind).toBe("error");
  });

  it("surfaces initialization errors and write rejections", async () => {
    write.mockRejectedValue(new Error("stdin closed"));
    expect((await collect()).at(-1)).toMatchObject({ kind: "error", message: "stdin closed" });
    start.mockImplementation(async (opts, callback) => { callback({ type: "line", data: JSON.stringify({ id: 1, error: { message: "Unsupported version" } }) }); return opts.session; });
    expect((await collect()).at(-1)).toMatchObject({ kind: "error", message: "Unsupported version" });
  });

  it("times out an incomplete handshake and stops its process", async () => {
    vi.useFakeTimers();
    write.mockResolvedValue();
    const result = collect(); await flush();
    await vi.advanceTimersByTimeAsync(20_001);
    expect((await result).at(-1)?.kind).toBe("error");
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("unwraps upstream HTTP errors without replaying tools from failed output", async () => {
    const result = collect({ tools: [{ name: "lookup", description: "Find", input_schema: { type: "object", properties: {} } }] });
    await flush();
    notify("item/agentMessage/delta", { itemId: "a", delta: '```json\n{"tool":"lookup","args":{}}\n```' });
    notify("error", { willRetry: false, error: { message: JSON.stringify({ status: 400, error: { message: "Unsupported model" } }) } });
    const events = await result;
    expect(events.at(-1)).toEqual({ kind: "error", status: 400, message: "Unsupported model" });
    expect(events.some((e) => e.kind === "tool_start")).toBe(false);
  });

  it("handles turn notifications that arrive before the turn/start reply", async () => {
    write.mockImplementation(async (_session, data) => {
      const message = JSON.parse(data);
      if (message.method === "thread/start") line({ id: 2, result: { thread: { id: "thread" } } });
      if (message.method === "turn/start") {
        notify("item/agentMessage/delta", { itemId: "a", delta: "Answer" });
        complete();
        line({ id: 3, result: { turn: { id: "turn" } } });
      }
    });
    expect((await collect()).map((e) => e.kind)).toEqual(["start", "text", "delta", "stop"]);
  });

  it("cancels before spawn, during spawn, and while waiting for tokens", async () => {
    expect(await collect({ signal: AbortSignal.abort() })).toEqual([{ kind: "abort" }]);
    expect(start).not.toHaveBeenCalled();
    const controller = new AbortController();
    start.mockImplementationOnce(async (opts) => { controller.abort(); return opts.session; });
    expect((await collect({ signal: controller.signal })).at(-1)?.kind).toBe("abort");
    expect(stop).toHaveBeenCalledTimes(1);
    const handle = new CodexCliChatProvider().streamChat(request);
    const iterator = handle.events[Symbol.asyncIterator]();
    await iterator.next(); await flush(); handle.abort();
    expect((await iterator.next()).value.kind).toBe("abort");
    await iterator.next();
    expect(stop).toHaveBeenCalledTimes(2);
  });

  it("cleans up when the consumer stops early", async () => {
    const iterator = new CodexCliChatProvider().streamChat(request).events[Symbol.asyncIterator]();
    await iterator.next();
    await iterator.return?.();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("rejects unsupported server requests instead of hanging", async () => {
    const result = collect(); await flush();
    line({ id: 99, method: "item/commandExecution/requestApproval", params: {} });
    expect((await result).at(-1)?.kind).toBe("error");
    expect(write.mock.calls.map((c) => JSON.parse(c[1]))).toContainEqual({ id: 99, error: { code: -32601, message: "This client does not support server requests" } });
  });

  it("keeps JSON tool fallback working with split deltas", async () => {
    const result = collect({ tools: [{ name: "lookup", description: "Find", input_schema: { type: "object", properties: {} } }] });
    await flush();
    notify("item/agentMessage/delta", { itemId: "a", delta: '```json\n{"tool":"lookup",' });
    notify("item/agentMessage/delta", { itemId: "a", delta: '"args":{}}\n```' });
    complete();
    expect((await result).some((e) => e.kind === "tool_start")).toBe(true);
  });

  it("reports desktop-only availability", async () => {
    start.mockResolvedValue(null);
    expect((await collect()).map((e) => e.kind)).toEqual(["error"]);
    expect(stop).not.toHaveBeenCalled();
  });
});
