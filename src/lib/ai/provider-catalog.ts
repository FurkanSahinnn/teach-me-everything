import type { AgentAccountStatus, AgentCliId } from "@/lib/ai/agent-status/types";
import { isLocalUrl } from "@/lib/ai/providers/local-bypass";
import { listPresets } from "@/lib/ai/providers/presets";
import type { ProviderPreset } from "@/lib/ai/providers/types";

export type ProviderGroup = "cli" | "local" | "cloud" | "custom";

export type ProviderStatusTone = "ok" | "warn" | "muted" | "error";

/** Message key under `settings.providers.status.*`, plus ICU values. */
export type ProviderStatus = {
  tone: ProviderStatusTone;
  key:
    | "cli_checking"
    | "cli_not_installed"
    | "cli_signed_out"
    | "cli_error"
    | "cli_authenticated"
    | "cli_authenticated_no_plan"
    | "cli_ready"
    | "local_server"
    | "key_saved"
    | "key_missing";
  values?: Record<string, string>;
};

export type ProviderEntry = {
  /** Preset id, or `custom:<id>` for a user-defined endpoint. */
  id: string;
  group: ProviderGroup;
  label: string;
  /** Set for the local agent CLIs. */
  cli?: AgentCliId;
  version?: string;
  status: ProviderStatus;
  enabled: boolean;
};

export type CatalogCustomEndpoint = {
  id: string;
  label: string;
  baseUrl: string;
  hasKey: boolean;
};

export type ProviderCatalogInput = {
  /** Provider ids that have a credential on file (keychain or dexie). */
  storedKeys: ReadonlySet<string>;
  agentStatuses: Partial<Record<AgentCliId, AgentAccountStatus>>;
  /** CLIs currently running a status probe. */
  refreshingClis?: Partial<Record<AgentCliId, boolean>> | undefined;
  customEndpoints: readonly CatalogCustomEndpoint[];
  disabledProviders: ReadonlySet<string>;
};

const CLI_BY_PRESET: Readonly<Record<string, AgentCliId>> = {
  "claude-cli": "claude",
  "codex-cli": "codex",
  "opencode-cli": "opencode",
};

/** Display order inside the "On this computer" group. */
const CLI_ORDER: Readonly<Record<AgentCliId, number>> = { claude: 0, codex: 1, opencode: 2 };

/** Anthropic counts as configured with either an API key or a Claude Code OAuth token. */
const KEY_ALIASES: Readonly<Record<string, readonly string[]>> = {
  anthropic: ["anthropic", "claude-code-oauth"],
};

const GROUP_ORDER: Readonly<Record<ProviderGroup, number>> = { cli: 0, local: 1, cloud: 2, custom: 3 };

function cliStatus(status: AgentAccountStatus | undefined): ProviderStatus {
  if (!status) return { tone: "muted", key: "cli_checking" };
  switch (status.state) {
    case "not_installed":
      return { tone: "muted", key: "cli_not_installed" };
    case "unauthenticated":
      return { tone: "warn", key: "cli_signed_out" };
    case "error":
      return { tone: "error", key: "cli_error" };
    case "authenticated":
      // OpenCode has no single account or plan; what matters is how many
      // models its connected providers expose.
      if (status.cli === "opencode") {
        return { tone: "ok", key: "cli_ready", values: { count: String(status.modelCount ?? 0) } };
      }
      return status.planLabel
        ? { tone: "ok", key: "cli_authenticated", values: { plan: status.planLabel } }
        : { tone: "ok", key: "cli_authenticated_no_plan" };
  }
}

function groupOf(preset: ProviderPreset): ProviderGroup {
  if (CLI_BY_PRESET[preset.id]) return "cli";
  if (isLocalUrl(preset.baseUrl)) return "local";
  return "cloud";
}

function presetEntry(preset: ProviderPreset, input: ProviderCatalogInput): ProviderEntry {
  const group = groupOf(preset);
  const cli = CLI_BY_PRESET[preset.id];
  const base = { id: preset.id, group, label: preset.label, enabled: !input.disabledProviders.has(preset.id) };
  if (cli) {
    const status = input.agentStatuses[cli];
    const isRefreshing = Boolean(input.refreshingClis?.[cli]);
    return {
      ...base,
      cli,
      status: isRefreshing ? { tone: "muted", key: "cli_checking" } : cliStatus(status),
      ...(status?.version ? { version: status.version } : {}),
    };
  }
  if (group === "local") return { ...base, status: { tone: "muted", key: "local_server" } };
  const keyIds = KEY_ALIASES[preset.id] ?? [preset.id];
  const hasKey = keyIds.some((k) => input.storedKeys.has(k));
  return { ...base, status: hasKey ? { tone: "ok", key: "key_saved" } : { tone: "muted", key: "key_missing" } };
}

/** Chat-capable providers for the Providers settings list, in display order. */
export function buildProviderCatalog(input: ProviderCatalogInput): ProviderEntry[] {
  const presets = listPresets()
    .filter((p) => p.kind === "chat" || p.kind === "both")
    .map((p) => presetEntry(p, input));
  const custom: ProviderEntry[] = input.customEndpoints.map((c) => {
    const id = `custom:${c.id}`;
    return {
      id,
      group: "custom",
      label: c.label,
      status: c.hasKey ? { tone: "ok", key: "key_saved" } : { tone: "muted", key: "key_missing" },
      enabled: !input.disabledProviders.has(id),
    };
  });
  const cliOrder = (e: ProviderEntry) => (e.cli ? CLI_ORDER[e.cli] : 0);
  // Stable sort keeps preset declaration order within each group.
  return [...presets, ...custom].sort(
    (a, b) => GROUP_ORDER[a.group] - GROUP_ORDER[b.group] || (a.group === "cli" ? cliOrder(a) - cliOrder(b) : 0),
  );
}

/**
 * Hide options from providers the user switched off, but keep any provider a
 * current binding still points at so the picker never loses the saved choice.
 */
export function filterEnabledChatOptions<T extends { presetId: string }>(
  options: readonly T[],
  disabledProviders: ReadonlySet<string>,
  boundBindings: readonly string[],
): T[] {
  if (disabledProviders.size === 0) return [...options];
  const bound = new Set(boundBindings.map((b) => b.split("::")[0]));
  return options.filter((o) => !disabledProviders.has(o.presetId) || bound.has(o.presetId));
}
