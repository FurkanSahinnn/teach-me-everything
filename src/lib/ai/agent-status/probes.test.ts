import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentCliEvent } from "@/lib/tauri/agent-cli";

vi.mock("@/lib/tauri/agent-cli", () => ({
  probeAgentCli: vi.fn(),
  startAgentCli: vi.fn(),
  writeAgentCli: vi.fn(),
  stopAgentCli: vi.fn(async () => {}),
}));
import { probeAgentCli, startAgentCli, stopAgentCli, writeAgentCli } from "@/lib/tauri/agent-cli";
import { probeClaudeStatus, probeCodexStatus } from "./probes";

const probe = vi.mocked(probeAgentCli);
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
