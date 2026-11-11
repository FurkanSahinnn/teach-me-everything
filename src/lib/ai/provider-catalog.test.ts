import { describe, expect, it } from "vitest";

import type { AgentAccountStatus } from "@/lib/ai/agent-status/types";
import { buildProviderCatalog, filterEnabledChatOptions, type ProviderCatalogInput } from "./provider-catalog";

function input(over: Partial<ProviderCatalogInput> = {}): ProviderCatalogInput {
  return {
    storedKeys: new Set(),
    agentStatuses: {},
    customEndpoints: [],
    disabledProviders: new Set(),
    ...over,
  };
}

function status(over: Partial<AgentAccountStatus>): AgentAccountStatus {
  return { cli: "claude", state: "authenticated", limits: [], checkedAt: 1, ...over };
}

describe("buildProviderCatalog", () => {
  it("lists the local CLIs first, then local servers, cloud providers and custom endpoints", () => {
    const groups = buildProviderCatalog(
      input({ customEndpoints: [{ id: "lab", label: "Lab server", baseUrl: "https://lab.example", hasKey: false }] }),
    ).map((e) => e.group);

    const firstIndex = (g: string) => groups.indexOf(g as never);
    expect(firstIndex("cli")).toBe(0);
    expect(firstIndex("local")).toBeGreaterThan(groups.lastIndexOf("cli"));
    expect(firstIndex("cloud")).toBeGreaterThan(groups.lastIndexOf("local"));
    expect(groups.at(-1)).toBe("custom");
  });

  it("orders Claude, then Codex, then OpenCode among the CLIs", () => {
    const cli = buildProviderCatalog(input()).filter((e) => e.group === "cli");

    expect(cli.map((e) => e.id)).toEqual(["claude-cli", "codex-cli", "opencode-cli"]);
  });

  it("describes a ready OpenCode by its model count instead of a plan", () => {
    const entry = buildProviderCatalog(
      input({ agentStatuses: { opencode: status({ cli: "opencode", modelCount: 73, version: "2.2.6" }) } }),
    ).find((e) => e.id === "opencode-cli");

    expect(entry?.status).toEqual({ tone: "ok", key: "cli_ready", values: { count: "73" } });
    expect(entry?.cli).toBe("opencode");
  });

  it("describes an authenticated CLI with its plan and version", () => {
    const entry = buildProviderCatalog(
      input({ agentStatuses: { claude: status({ planLabel: "Claude Max", version: "2.1.319" }) } }),
    ).find((e) => e.id === "claude-cli");

    expect(entry?.status).toEqual({ tone: "ok", key: "cli_authenticated", values: { plan: "Claude Max" } });
    expect(entry?.version).toBe("2.1.319");
  });

  it("maps every CLI probe state to a status", () => {
    const toneFor = (s: AgentAccountStatus | undefined) =>
      buildProviderCatalog(input({ agentStatuses: s ? { codex: s } : {} })).find((e) => e.id === "codex-cli")?.status
        .key;

    expect(toneFor(undefined)).toBe("cli_checking");
    expect(toneFor(status({ cli: "codex", state: "not_installed" }))).toBe("cli_not_installed");
    expect(toneFor(status({ cli: "codex", state: "unauthenticated" }))).toBe("cli_signed_out");
    expect(toneFor(status({ cli: "codex", state: "error", error: "boom" }))).toBe("cli_error");
    expect(toneFor(status({ cli: "codex", state: "authenticated" }))).toBe("cli_authenticated_no_plan");
  });

  it("surfaces cli_checking while a previously authenticated CLI is refreshing", () => {
    const entry = buildProviderCatalog(
      input({
        agentStatuses: { claude: status({ planLabel: "Claude Team", version: "2.1.322" }) },
        refreshingClis: { claude: true },
      }),
    ).find((e) => e.id === "claude-cli");

    expect(entry?.status).toEqual({ tone: "muted", key: "cli_checking" });
    expect(entry?.version).toBe("2.1.322");
  });

  it("marks cloud providers by whether a key is stored, counting the Claude OAuth token for Anthropic", () => {
    const byId = (keys: string[]) =>
      new Map(buildProviderCatalog(input({ storedKeys: new Set(keys) })).map((e) => [e.id, e.status.key]));

    expect(byId([]).get("openai")).toBe("key_missing");
    expect(byId(["openai"]).get("openai")).toBe("key_saved");
    expect(byId(["claude-code-oauth"]).get("anthropic")).toBe("key_saved");
  });

  it("treats loopback presets as keyless local servers", () => {
    const ollama = buildProviderCatalog(input()).find((e) => e.id === "ollama");

    expect(ollama?.group).toBe("local");
    expect(ollama?.status.key).toBe("local_server");
  });

  it("reflects the enabled flag from the disabled set", () => {
    const entries = buildProviderCatalog(input({ disabledProviders: new Set(["openai"]) }));

    expect(entries.find((e) => e.id === "openai")?.enabled).toBe(false);
    expect(entries.find((e) => e.id === "anthropic")?.enabled).toBe(true);
  });

  it("adds custom endpoints with a custom: id", () => {
    const custom = buildProviderCatalog(
      input({ customEndpoints: [{ id: "lab", label: "Lab server", baseUrl: "https://lab.example", hasKey: true }] }),
    ).find((e) => e.group === "custom");

    expect(custom).toMatchObject({ id: "custom:lab", label: "Lab server", status: { key: "key_saved" } });
  });
});

describe("filterEnabledChatOptions", () => {
  const opt = (presetId: string) => ({ id: `${presetId}::m`, presetId });

  it("drops options whose provider is disabled", () => {
    const kept = filterEnabledChatOptions([opt("openai"), opt("groq")], new Set(["groq"]), []);

    expect(kept.map((o) => o.presetId)).toEqual(["openai"]);
  });

  it("keeps a disabled provider that a current binding still uses", () => {
    const kept = filterEnabledChatOptions([opt("openai"), opt("groq")], new Set(["groq"]), ["groq::llama-3.3-70b"]);

    expect(kept.map((o) => o.presetId)).toEqual(["openai", "groq"]);
  });
});
