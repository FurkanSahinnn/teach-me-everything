import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentCliEvent } from "@/lib/tauri/agent-cli";

vi.mock("@/lib/tauri/agent-cli", () => ({
  getAgentWorkspace: vi.fn(async () => "/app/agent-workspace"),
  probeAgentCli: vi.fn(),
  readOpencodeCliStats: vi.fn(async () => null),
  startAgentCli: vi.fn(),
  writeAgentCli: vi.fn(),
  stopAgentCli: vi.fn(async () => {}),
}));
import {
  probeAgentCli,
  readOpencodeCliStats,
  startAgentCli,
  stopAgentCli,
  writeAgentCli,
} from "@/lib/tauri/agent-cli";
import { probeClaudeStatus, probeCodexStatus, probeOpencodeStatus } from "./probes";

const probe = vi.mocked(probeAgentCli);
const opencodeStats = vi.mocked(readOpencodeCliStats);
const start = vi.mocked(startAgentCli);
const write = vi.mocked(writeAgentCli);
const stop = vi.mocked(stopAgentCli);

let emit: (e: AgentCliEvent) => void;
const line = (v: unknown): void => emit({ type: "line", data: JSON.stringify(v) });
const found = { found: true, path: "x", launcher: null, version: "9.9.9 (cli)", error: null };

function startWith(onWrite: (msg: Record<string, unknown>) => void): void {
  start.mockImplementation(async (options, cb) => {
    emit = cb;
    return options.session;
  });
  write.mockImplementation(async (_s, data) => onWrite(JSON.parse(data)));
}

beforeEach(() => {
  vi.clearAllMocks();
  probe.mockResolvedValue(found);
});

function claudeReply(msg: Record<string, unknown>, inner: unknown, subtype = "success"): void {
  const request_id = (msg as { request_id: string }).request_id;
  line({ type: "control_response", response: { subtype, request_id, response: inner } });
}

describe("probeClaudeStatus", () => {
  it("returns account and limits and stops the session", async () => {
    startWith((msg) => {
      const sub = (msg.request as { subtype: string }).subtype;
      if (sub === "initialize")
        claudeReply(msg, { claude_code_version: "2.1.319", account: { email: "a@example.test", subscriptionType: "Claude Max" } });
      else claudeReply(msg, { rate_limits_available: true, rate_limits: { five_hour: { utilization: 10 } } });
    });
    const s = await probeClaudeStatus({ env: { CLAUDE_CONFIG_DIR: "/h" } });
    expect(s).toMatchObject({ cli: "claude", state: "authenticated", version: "2.1.319", planLabel: "Claude Max" });
    expect(s.limits).toHaveLength(1);
    expect(start.mock.calls[0]?.[0].env).toEqual({ CLAUDE_CONFIG_DIR: "/h" });
    expect(start.mock.calls[0]?.[0].args).toContain("--safe-mode");
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("keeps account info when get_usage fails", async () => {
    startWith((msg) => {
      const sub = (msg.request as { subtype: string }).subtype;
      if (sub === "initialize") claudeReply(msg, { account: { email: "a@example.test" } });
      else claudeReply(msg, undefined, "error");
    });
    const s = await probeClaudeStatus();
    expect(s.state).toBe("authenticated");
    expect(s.limits).toEqual([]);
    expect(s.limitsError).toBeTruthy();
    expect(s.version).toBe("9.9.9");
  });

  it("reports unauthenticated when no account is present", async () => {
    startWith((msg) => claudeReply(msg, { account: {} }));
    expect((await probeClaudeStatus()).state).toBe("unauthenticated");
  });

  it("maps a dead process to an error state", async () => {
    startWith(() => emit({ type: "exit", code: 1 }));
    const s = await probeClaudeStatus();
    expect(s.state).toBe("error");
    expect(s.error).toMatch(/exited/);
    expect(stop).toHaveBeenCalled();
  });

  it("times out instead of hanging", async () => {
    vi.useFakeTimers();
    try {
      startWith(() => {});
      const p = probeClaudeStatus();
      await vi.advanceTimersByTimeAsync(21_000);
      const s = await p;
      expect(s.state).toBe("error");
      expect(stop).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports not_installed when the binary is missing or on web", async () => {
    probe.mockResolvedValueOnce({ ...found, found: false, error: "not on PATH" });
    expect((await probeClaudeStatus()).state).toBe("not_installed");
    probe.mockResolvedValueOnce(null);
    const web = await probeClaudeStatus();
    expect(web.state).toBe("not_installed");
    expect(web.error).toBeTruthy();
    expect(start).not.toHaveBeenCalled();
  });
});

function codexServer(account: unknown, limits: unknown | Error): (msg: Record<string, unknown>) => void {
  return (msg) => {
    const id = msg.id;
    if (msg.method === "initialize") line({ id, result: { userAgent: "tme/0.154.0 (os)" } });
    else if (msg.method === "account/read") line({ id, result: account });
    else if (msg.method === "account/rateLimits/read") {
      if (limits instanceof Error) line({ id, error: { code: -1, message: limits.message } });
      else line({ id, result: limits });
    }
  };
}

describe("probeCodexStatus", () => {
  it("runs the handshake, reads account and limits, stops the session", async () => {
    startWith(
      codexServer(
        { account: { type: "chatgpt", email: "c@example.test", planType: "plus" }, requiresOpenaiAuth: true },
        { rateLimits: { planType: "pro", primary: { usedPercent: 5 } } },
      ),
    );
    const s = await probeCodexStatus({ env: { CODEX_HOME: "/c" } });
    expect(s).toMatchObject({ state: "authenticated", version: "0.154.0", planLabel: "ChatGPT Pro" });
    expect(s.limits).toHaveLength(1);
    const methods = write.mock.calls.map((c) => JSON.parse(c[1]).method);
    expect(methods).toEqual(["initialize", "initialized", "account/read", "account/rateLimits/read"]);
    expect(start.mock.calls[0]?.[0]).toMatchObject({ args: ["app-server"], env: { CODEX_HOME: "/c" } });
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("reports unauthenticated without asking for limits", async () => {
    startWith(codexServer({ account: null, requiresOpenaiAuth: true }, {}));
    const s = await probeCodexStatus();
    expect(s.state).toBe("unauthenticated");
    expect(write.mock.calls.map((c) => JSON.parse(c[1]).method)).not.toContain("account/rateLimits/read");
  });

  it("keeps the account when the limits request errors", async () => {
    startWith(codexServer({ account: { type: "chatgpt", email: "c@example.test", planType: "plus" } }, new Error("boom")));
    const s = await probeCodexStatus();
    expect(s.state).toBe("authenticated");
    expect(s.limitsError).toBe("boom");
    expect(s.planLabel).toBe("ChatGPT Plus");
  });

  it("maps a failed start to error and still resolves", async () => {
    start.mockRejectedValue(new Error("Could not launch codex"));
    const s = await probeCodexStatus();
    expect(s).toMatchObject({ state: "error", error: "Could not launch codex" });
  });
});

describe("probeOpencodeStatus", () => {
  const session = (models: string[], modes = ["build", "tme-tutor"]) => ({
    sessionId: "ses_1",
    configOptions: [
      { id: "model", currentValue: models[0], options: models.map((value) => ({ value, name: value })) },
      { id: "mode", options: modes.map((value) => ({ value, name: value })) },
    ],
  });
  function opencodeWith(result: unknown): void {
    startWith((msg) => {
      if (msg.method === "initialize") line({ jsonrpc: "2.0", id: msg.id, result: { agentInfo: { version: "2.2.6" } } });
      else if (msg.method === "session/new") line({ jsonrpc: "2.0", id: msg.id, result });
      else line({ jsonrpc: "2.0", id: msg.id, result: {} });
    });
  }

  it("reports ready with the model count, connected providers, and parsed stats", async () => {
    opencodeWith(session(["opencode/big-pickle", "opencode-go/kimi-k3", "anthropic/claude-sonnet-5-5"]));
    opencodeStats.mockResolvedValueOnce({
      sessions: 3,
      prompts: 10,
      steps: 42,
      tokens: { input: 5000, output: 1000, reasoning: 0, cache: { read: 20000, write: 0 } },
      cost: 0,
      models: [],
    });

    const s = await probeOpencodeStatus({ path: "/bin/opencode", env: { HTTPS_PROXY: "http://p" } });

    expect(s).toMatchObject({
      cli: "opencode", state: "authenticated", version: "2.2.6", modelCount: 3,
      providers: ["opencode", "opencode-go", "anthropic"],
      opencodeStats: {
        days: 7,
        sessions: 3,
        prompts: 10,
        steps: 42,
        inputTokens: 5000,
        outputTokens: 1000,
        cacheReadTokens: 20000,
      },
    });
    expect(start.mock.calls[0]?.[0]).toMatchObject({ cli: "opencode", args: ["acp"], path: "/bin/opencode", env: { HTTPS_PROXY: "http://p" } });
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("reports signed out when no provider exposes a model", async () => {
    opencodeWith(session([]));

    expect((await probeOpencodeStatus()).state).toBe("unauthenticated");
  });

  it("flags an OpenCode that ignored TME's agent profile", async () => {
    opencodeWith(session(["opencode/big-pickle"], ["build", "plan"]));

    const s = await probeOpencodeStatus();

    expect(s.state).toBe("error");
    expect(s.error).toContain("agent profile");
  });

  it("refuses OpenCode 1.x without starting it", async () => {
    probe.mockResolvedValue({ ...found, version: "1.19.5" });

    const s = await probeOpencodeStatus();

    expect(s).toMatchObject({ state: "error", version: "1.19.5", error: "OpenCode 2 or newer is required" });
    expect(start).not.toHaveBeenCalled();
  });
});
