import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildCodexCliArgs,
  buildCodexModelListStdin,
  buildCodexPrompt,
  CodexCliChatProvider,
  listCodexModels,
  parseCodexLine,
  parseCodexModelList,
} from "./codex-cli";
import type { ChatRequest, StreamEvent } from "./types";

vi.mock("@/lib/tauri/agent-cli", () => ({
  startAgentCli: vi.fn(),
  stopAgentCli: vi.fn(async () => {}),
}));

vi.mock("@/stores/prefs", () => ({
  usePrefs: { getState: () => ({ agentCli: {} }) },
}));

import { startAgentCli, stopAgentCli } from "@/lib/tauri/agent-cli";

const startMock = vi.mocked(startAgentCli);
const stopMock = vi.mocked(stopAgentCli);

// Captured from a real `codex exec --json` run (codex-cli 0.153.4, ChatGPT
// login) on 2026-09-06. Ids and thread ids shortened.
const LINE_THREAD = '{"type":"thread.started","thread_id":"t1"}';
const LINE_WARN =
  '{"type":"item.completed","item":{"id":"item_0","type":"error","message":"Ignoring malformed agent role definition: agent role file at C:\\\\Users\\\\me\\\\.codex\\\\agents\\\\x.toml must define a non-empty `name`"}}';
const LINE_TURN = '{"type":"turn.started"}';
const LINE_MSG =
  '{"type":"item.completed","item":{"id":"item_6","type":"agent_message","text":"PONG"}}';
const LINE_DONE =
  '{"type":"turn.completed","usage":{"input_tokens":15162,"cached_input_tokens":11776,"cache_write_input_tokens":0,"output_tokens":6,"reasoning_output_tokens":0}}';
const LINE_ERR =
  '{"type":"error","message":"{\\"type\\":\\"error\\",\\"status\\":400,\\"error\\":{\\"type\\":\\"invalid_request_error\\",\\"message\\":\\"The \'gpt-5\' model is not supported when using Codex with a ChatGPT account.\\"}}"}';
const LINE_FAILED =
  '{"type":"turn.failed","error":{"message":"{\\"type\\":\\"error\\",\\"status\\":400,\\"error\\":{\\"type\\":\\"invalid_request_error\\",\\"message\\":\\"The \'gpt-5\' model is not supported when using Codex with a ChatGPT account.\\"}}"}}';

async function collect(
  lines: string[],
  exitCode: number | null = 0,
  overrides: Partial<ChatRequest> = {},
): Promise<StreamEvent[]> {
  startMock.mockImplementation(async (opts, onEvent) => {
    queueMicrotask(() => {
      for (const data of lines) onEvent({ type: "line", data });
      onEvent({ type: "exit", code: exitCode });
    });
    return opts.session;
  });
  const req: ChatRequest = {
    apiKey: "",
    model: "gpt-6-astra",
    system: [{ type: "text", text: "You are a tutor." }],
    messages: [{ role: "user", content: "Define spaced repetition." }],
    ...overrides,
  };
  const handle = new CodexCliChatProvider().streamChat(req);
  const out: StreamEvent[] = [];
  for await (const event of handle.events) out.push(event);
  return out;
}

beforeEach(() => {
  startMock.mockReset();
  stopMock.mockClear();
});

describe("buildCodexCliArgs", () => {
  it("runs non-interactively with JSONL output and reads the prompt from stdin", () => {
    const args = buildCodexCliArgs({ model: "gpt-6-astra" });
    expect(args[0]).toBe("exec");
    expect(args).toContain("--json");
    expect(args[args.length - 1]).toBe("-");
  });

  it("passes the model through", () => {
    const args = buildCodexCliArgs({ model: "gpt-5.4-mini" });
    expect(args[args.indexOf("--model") + 1]).toBe("gpt-5.4-mini");
  });

  it("isolates the run from the user's own Codex setup", () => {
    const args = buildCodexCliArgs({ model: "m" });
    for (const flag of ["--ephemeral", "--ignore-user-config", "--ignore-rules", "--skip-git-repo-check"]) {
      expect(args).toContain(flag);
    }
    expect(args[args.indexOf("--sandbox") + 1]).toBe("read-only");
  });
});

describe("buildCodexPrompt", () => {
  it("leads with the instructions when there are any", () => {
    const text = buildCodexPrompt("Be brief.", [{ role: "user", content: "hi" }]);
    expect(text.startsWith("## Instructions\n\nBe brief.")).toBe(true);
    expect(text.endsWith("hi")).toBe(true);
  });

  it("is just the turn when there are no instructions", () => {
    expect(buildCodexPrompt("", [{ role: "user", content: "hi" }])).toBe("hi");
  });
});

describe("parseCodexLine", () => {
  it("reads the agent message as text", () => {
    expect(parseCodexLine(LINE_MSG)).toEqual({ kind: "text", text: "PONG" });
  });

  it("splits cached tokens out of input_tokens the way Anthropic usage does", () => {
    expect(parseCodexLine(LINE_DONE)).toEqual({
      kind: "usage",
      usage: { input_tokens: 15162 - 11776, output_tokens: 6, cache_read_input_tokens: 11776 },
    });
  });

  it("treats error items as setup warnings, not failures", () => {
    expect(parseCodexLine(LINE_WARN)).toEqual({ kind: "ignored" });
  });

  it("unwraps the stringified upstream error and keeps its status", () => {
    const parsed = parseCodexLine(LINE_FAILED);
    expect(parsed.kind).toBe("error");
    if (parsed.kind !== "error") return;
    expect(parsed.status).toBe(400);
    expect(parsed.message).toContain("not supported when using Codex with a ChatGPT account");
  });

  it("ignores lifecycle lines and non-JSON chatter", () => {
    expect(parseCodexLine(LINE_THREAD)).toEqual({ kind: "ignored" });
    expect(parseCodexLine(LINE_TURN)).toEqual({ kind: "ignored" });
    expect(parseCodexLine("warning: something")).toEqual({ kind: "ignored" });
  });
});

describe("CodexCliChatProvider.streamChat", () => {
  it("maps a real transcript onto the shared event vocabulary", async () => {
    const out = await collect([LINE_THREAD, LINE_WARN, LINE_TURN, LINE_MSG, LINE_DONE]);
    expect(out.map((e) => e.kind)).toEqual(["start", "text", "delta", "stop"]);
    const text = out.find((e) => e.kind === "text");
    expect(text && text.kind === "text" ? text.delta : "").toBe("PONG");
    const delta = out.find((e) => e.kind === "delta");
    expect(delta && delta.kind === "delta" ? delta.usage.cache_read_input_tokens : 0).toBe(11776);
  });

  it("sends the instructions and the turn on stdin, never on argv", async () => {
    await collect([LINE_MSG, LINE_DONE]);
    const opts = startMock.mock.calls[0]?.[0];
    expect(opts?.cli).toBe("codex");
    expect(opts?.stdin).toContain("You are a tutor.");
    expect(opts?.stdin).toContain("Define spaced repetition.");
    expect(opts?.args.join(" ")).not.toContain("You are a tutor.");
    expect(opts?.systemPrompt).toBeUndefined();
    // `-` reads to EOF: stdin must be closed or the CLI waits forever.
    expect(opts?.closeStdin).toBe(true);
  });

  it("surfaces a failed turn with its status and no text", async () => {
    const out = await collect([LINE_THREAD, LINE_TURN, LINE_ERR, LINE_FAILED], 1);
    const kinds = out.map((e) => e.kind);
    expect(kinds).toEqual(["start", "error"]);
    const err = out[1];
    expect(err && err.kind === "error" ? err.status : 0).toBe(400);
  });

  it("reports a non-zero exit with no other explanation as an error", async () => {
    const out = await collect([LINE_THREAD], 2);
    expect(out[out.length - 1]?.kind).toBe("error");
  });

  it("explains itself on the web build instead of hanging", async () => {
    startMock.mockImplementation(async () => null);
    const handle = new CodexCliChatProvider().streamChat({
      apiKey: "",
      model: "gpt-6-astra",
      system: [],
      messages: [{ role: "user", content: "hi" }],
    });
    const out: StreamEvent[] = [];
    for await (const event of handle.events) out.push(event);
    expect(out).toHaveLength(1);
    expect(out[0]?.kind).toBe("error");
  });

  it("reports an abort when cancelled while the CLI is still thinking", async () => {
    startMock.mockImplementation(async (opts) => opts.session);
    const handle = new CodexCliChatProvider().streamChat({
      apiKey: "",
      model: "gpt-6-astra",
      system: [],
      messages: [{ role: "user", content: "hi" }],
    });
    const out: StreamEvent[] = [];
    const drained = (async () => {
      for await (const event of handle.events) out.push(event);
    })();
    await new Promise((r) => setTimeout(r, 0));
    handle.abort();
    await drained;
    expect(out.map((e) => e.kind)).toEqual(["start", "abort"]);
    expect(stopMock).toHaveBeenCalled();
  });
});

describe("model discovery", () => {
  it("settles immediately when cancelled during spawn", async () => {
    const controller = new AbortController();
    startMock.mockImplementation(async (opts) => {
      controller.abort();
      return opts.session;
    });
    expect(await listCodexModels({ signal: controller.signal })).toEqual([]);
    expect(stopMock).toHaveBeenCalled();
  });

  it("does not spawn for a pre-aborted model lookup", async () => {
    startMock.mockClear();
    expect(await listCodexModels({ signal: AbortSignal.abort() })).toEqual([]);
    expect(startMock).not.toHaveBeenCalled();
  });
  const LIST_REPLY =
    '{"id":2,"result":{"data":[{"id":"gpt-6-astra","model":"gpt-6-astra","displayName":"GPT-6-Astra","hidden":false,"isDefault":true},{"id":"gpt-5.4-mini","model":"gpt-5.4-mini","displayName":"GPT-5.4-Mini","hidden":false,"isDefault":false},{"id":"secret","model":"secret","displayName":"Secret","hidden":true,"isDefault":false}]}}';

  it("speaks the initialize → initialized → model/list handshake", () => {
    const lines = buildCodexModelListStdin().trim().split("\n").map((l) => JSON.parse(l));
    expect(lines.map((l) => l.method)).toEqual(["initialize", "initialized", "model/list"]);
    expect(lines[2].id).toBe(2);
  });

  it("parses the reply, drops hidden rows and infers tiers", () => {
    expect(parseCodexModelList(LIST_REPLY)).toEqual([
      { id: "gpt-6-astra", displayName: "GPT-6-Astra", tier: "balanced", hint: "Default" },
      { id: "gpt-5.4-mini", displayName: "GPT-5.4-Mini", tier: "fast" },
    ]);
  });

  it("ignores every other line", () => {
    expect(parseCodexModelList('{"id":1,"result":{"userAgent":"x"}}')).toBeNull();
    expect(parseCodexModelList('{"method":"remoteControl/status/changed"}')).toBeNull();
    expect(parseCodexModelList("not json")).toBeNull();
  });

  it("runs the app-server, reads the list and stops it", async () => {
    startMock.mockImplementation(async (opts, onEvent) => {
      queueMicrotask(() => {
        onEvent({ type: "line", data: '{"id":1,"result":{}}' });
        onEvent({ type: "line", data: LIST_REPLY });
      });
      return opts.session;
    });
    const models = await listCodexModels();
    expect(models.map((m) => m.id)).toEqual(["gpt-6-astra", "gpt-5.4-mini"]);
    expect(startMock.mock.calls[0]?.[0].args).toEqual(["app-server"]);
    expect(stopMock).toHaveBeenCalled();
  });

  it("returns an empty list on the web build", async () => {
    startMock.mockImplementation(async () => null);
    expect(await listCodexModels()).toEqual([]);
  });
});

describe("Codex CLI terminal races", () => {
  const request: ChatRequest = { apiKey: "", model: "gpt-6-astra", system: [], messages: [] };
  beforeEach(() => { startMock.mockReset(); stopMock.mockClear(); });

  it("keeps a completed answer without waiting for process exit", async () => {
    startMock.mockImplementation(async (opts, onEvent) => {
      onEvent({ type: "line", data: JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "Answer" } }) });
      onEvent({ type: "line", data: JSON.stringify({ type: "turn.completed", usage: { input_tokens: 10, output_tokens: 2 } }) });
      onEvent({ type: "error", message: "Late teardown failure" });
      return opts.session;
    });
    const events: StreamEvent[] = [];
    for await (const event of new CodexCliChatProvider().streamChat(request).events) events.push(event);
    expect(events.map((e) => e.kind)).toEqual(["start", "text", "delta", "stop"]);
    expect(events[1]).toEqual({ kind: "text", delta: "Answer" });
  });

  it("cancels a spawn round-trip without waiting for output", async () => {
    const controller = new AbortController();
    startMock.mockImplementation(async (opts) => { controller.abort(); return opts.session; });
    const events: StreamEvent[] = [];
    for await (const event of new CodexCliChatProvider().streamChat({ ...request, signal: controller.signal }).events) events.push(event);
    expect(events.at(-1)?.kind).toBe("abort");
    expect(stopMock).toHaveBeenCalledTimes(1);
  });
});
