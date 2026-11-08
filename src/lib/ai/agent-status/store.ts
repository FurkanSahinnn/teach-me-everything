import { create } from "zustand";
import { usePrefs } from "@/stores/prefs";
import { probeClaudeStatus, probeCodexStatus, probeOpencodeStatus } from "./probes";
import type { AgentAccountStatus, AgentCliId, AgentProbeOptions } from "./types";

export const AGENT_STATUS_TTL_MS = 5 * 60 * 1000;

const ALL: readonly AgentCliId[] = ["claude", "codex", "opencode"];
const PROBES: Readonly<Record<AgentCliId, (opts: AgentProbeOptions) => Promise<AgentAccountStatus>>> = {
  claude: probeClaudeStatus,
  codex: probeCodexStatus,
  opencode: probeOpencodeStatus,
};
type PrefKeys = {
  path: "claudePath" | "codexPath" | "opencodePath";
  home?: { key: "claudeHome" | "codexHome"; env: string };
};
/** Binary path pref and, where the CLI has one, its config-home variable. */
const PREF_KEYS: Readonly<Record<AgentCliId, PrefKeys>> = {
  claude: { path: "claudePath", home: { key: "claudeHome", env: "CLAUDE_CONFIG_DIR" } },
  codex: { path: "codexPath", home: { key: "codexHome", env: "CODEX_HOME" } },
  opencode: { path: "opencodePath" },
};
const inflight = new Map<AgentCliId, Promise<void>>();

type AgentStatusState = {
  statuses: Partial<Record<AgentCliId, AgentAccountStatus>>;
  loading: boolean;
  /** Refresh one CLI (or all). Cached results younger than the TTL are reused unless `force`. */
  refresh: (cli?: AgentCliId, opts?: { force?: boolean }) => Promise<void>;
};

function probeOptions(cli: AgentCliId): AgentProbeOptions {
  const prefs = usePrefs.getState().agentCli;
  const keys = PREF_KEYS[cli];
  const path = prefs?.[keys.path]?.trim();
  const home = keys.home ? prefs?.[keys.home.key]?.trim() : undefined;
  const env = {
    ...(prefs?.env ?? {}),
    ...(home && keys.home ? { [keys.home.env]: home } : {}),
  };
  return { ...(path ? { path } : {}), env };
}

export const useAgentStatus = create<AgentStatusState>()((set, get) => {
  const refreshOne = (cli: AgentCliId, force: boolean): Promise<void> => {
    const existing = inflight.get(cli);
    if (existing) return existing;
    const cached = get().statuses[cli];
    if (!force && cached && Date.now() - cached.checkedAt < AGENT_STATUS_TTL_MS) {
      return Promise.resolve();
    }
    const run = (async () => {
      const opts = probeOptions(cli);
      const status = await PROBES[cli](opts);
      set((s) => ({ statuses: { ...s.statuses, [cli]: status } }));
    })().finally(() => {
      inflight.delete(cli);
      set({ loading: inflight.size > 0 });
    });
    inflight.set(cli, run);
    set({ loading: true });
    return run;
  };

  return {
    statuses: {},
    loading: false,
    refresh: async (cli, opts) => {
      const targets = cli ? [cli] : ALL;
      await Promise.all(targets.map((c) => refreshOne(c, opts?.force === true)));
    },
  };
});
