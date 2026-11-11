import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentAccountStatus } from "./types";

vi.mock("./probes", () => ({ probeClaudeStatus: vi.fn(), probeCodexStatus: vi.fn(), probeOpencodeStatus: vi.fn() }));
vi.mock("@/stores/prefs", () => ({
  usePrefs: {
    getState: () => ({
      agentCli: { claudePath: " /bin/claude ", claudeHome: "/ch", codexHome: "", opencodePath: "/bin/opencode", env: { A: "1" } },
    }),
  },
}));
import { probeClaudeStatus, probeCodexStatus, probeOpencodeStatus } from "./probes";
import { AGENT_STATUS_TTL_MS, useAgentStatus } from "./store";

const claude = vi.mocked(probeClaudeStatus);
const codex = vi.mocked(probeCodexStatus);
const opencode = vi.mocked(probeOpencodeStatus);
const ok = (cli: AgentAccountStatus["cli"]): AgentAccountStatus => ({
  cli,
  state: "authenticated",
  limits: [],
  checkedAt: Date.now(),
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  useAgentStatus.setState({ statuses: {}, refreshing: {}, loading: false });
  claude.mockImplementation(async () => ok("claude"));
  codex.mockImplementation(async () => ok("codex"));
  opencode.mockImplementation(async () => ok("opencode"));
});

describe("useAgentStatus", () => {
  it("passes path and env (with home) from prefs", async () => {
    await useAgentStatus.getState().refresh("claude");
    expect(claude).toHaveBeenCalledWith({ path: "/bin/claude", env: { A: "1", CLAUDE_CONFIG_DIR: "/ch" } });
    await useAgentStatus.getState().refresh("codex");
    expect(codex).toHaveBeenCalledWith({ env: { A: "1" } });
  });

  it("passes only path and env to OpenCode, which has no config-home setting", async () => {
    await useAgentStatus.getState().refresh("opencode");
    expect(opencode).toHaveBeenCalledWith({ path: "/bin/opencode", env: { A: "1" } });
  });

  it("de-duplicates concurrent refreshes", async () => {
    const { refresh } = useAgentStatus.getState();
    await Promise.all([refresh("claude"), refresh("claude", { force: true })]);
    expect(claude).toHaveBeenCalledTimes(1);
    expect(useAgentStatus.getState().loading).toBe(false);
  });

  it("serves the cache within the TTL and re-probes after it or when forced", async () => {
    vi.useFakeTimers();
    const { refresh } = useAgentStatus.getState();
    await refresh();
    expect(claude).toHaveBeenCalledTimes(1);
    expect(codex).toHaveBeenCalledTimes(1);
    expect(opencode).toHaveBeenCalledTimes(1);
    await refresh("claude");
    expect(claude).toHaveBeenCalledTimes(1);
    await refresh("claude", { force: true });
    expect(claude).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(AGENT_STATUS_TTL_MS + 1);
    await refresh("claude");
    expect(claude).toHaveBeenCalledTimes(3);
    expect(useAgentStatus.getState().statuses.claude?.state).toBe("authenticated");
  });

  it("tracks per-CLI refreshing state while a forced probe is in flight", async () => {
    let resolveClaude!: (s: AgentAccountStatus) => void;
    claude.mockImplementationOnce(
      () =>
        new Promise<AgentAccountStatus>((res) => {
          resolveClaude = res;
        }),
    );

    const p = useAgentStatus.getState().refresh("claude", { force: true });
    expect(useAgentStatus.getState().refreshing.claude).toBe(true);
    expect(useAgentStatus.getState().refreshing.codex).toBeFalsy();

    resolveClaude(ok("claude"));
    await p;
    expect(useAgentStatus.getState().refreshing.claude).toBe(false);
    expect(useAgentStatus.getState().loading).toBe(false);
  });
});
