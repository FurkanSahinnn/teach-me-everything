import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentCliEvent } from "@/lib/tauri/agent-cli";
import { listOpencodeModels, parseOpencodeSession, readOpencodeCatalog } from "./opencode-cli";

vi.mock("@/lib/tauri/agent-cli", () => ({
  getAgentWorkspace: vi.fn(async () => "/app/agent-workspace"),
  startAgentCli: vi.fn(),
  writeAgentCli: vi.fn(),
  stopAgentCli: vi.fn(async () => {}),
}));
vi.mock("@/stores/prefs", () => ({
  usePrefs: { getState: () => ({ agentCli: { opencodePath: "/bin/opencode" } }) },
}));
import { getAgentWorkspace, startAgentCli, stopAgentCli, writeAgentCli } from "@/lib/tauri/agent-cli";

const workspace = vi.mocked(getAgentWorkspace);
const start = vi.mocked(startAgentCli);
const write = vi.mocked(writeAgentCli);
const stop = vi.mocked(stopAgentCli);

type Message = { id?: number; method?: string; params?: Record<string, unknown> };

/** What `session/new` returned from OpenCode 2.2.6, trimmed. */
const SESSION = {
  sessionId: "ses_1",
  configOptions: [
    {
      id: "model", name: "Model", category: "model", type: "select", currentValue: "opencode/big-pickle",
      options: [
        { value: "opencode/big-pickle", name: "opencode/Big Pickle" },
        { value: "opencode/glm-5.3-flash-free", name: "opencode/GLM-5.3-Flash Free" },
        { group: "go", name: "OpenCode Go", options: [{ value: "opencode-go/kimi-k3", name: "opencode-go/Kimi K3" }] },
      ],
    },
    {
      id: "mode", name: "Session Mode", category: "mode", type: "select", currentValue: "build",
      options: [{ value: "build", name: "Build" }, { value: "tme-tutor", name: "tme-tutor" }],
    },
  ],
};

let emit: (event: AgentCliEvent) => void;
let replies: Record<string, (message: Message) => unknown>;
const sent = (): Message[] => write.mock.calls.map((call) => JSON.parse(call[1]) as Message);

beforeEach(() => {
  vi.clearAllMocks();
  workspace.mockResolvedValue("/app/agent-workspace");
  start.mockImplementation(async (options, callback) => {
    emit = callback;
    return options.session;
  });
  replies = {
    initialize: () => ({ protocolVersion: 1, agentInfo: { name: "OpenCode", version: "2.2.6" } }),
    "session/new": () => SESSION,
    "session/delete": () => ({}),
  };
  write.mockImplementation(async (_session, data) => {
    const message = JSON.parse(data) as Message;
    const reply = message.method ? replies[message.method] : undefined;
    if (reply) emit({ type: "line", data: JSON.stringify({ jsonrpc: "2.0", id: message.id, result: reply(message) }) });
  });
});

describe("parseOpencodeSession", () => {
  it("lists models across groups with inferred tiers, the current model and providers", () => {
    expect(parseOpencodeSession(SESSION)).toEqual({
      models: [
        { id: "opencode/big-pickle", displayName: "opencode/Big Pickle", tier: "balanced" },
        { id: "opencode/glm-5.3-flash-free", displayName: "opencode/GLM-5.3-Flash Free", tier: "free" },
        { id: "opencode-go/kimi-k3", displayName: "opencode-go/Kimi K3", tier: "balanced" },
      ],
      defaultModel: "opencode/big-pickle",
      providers: ["opencode", "opencode-go"],
      profileLoaded: true,
    });
  });

  it("reports a missing TME agent and tolerates a result without options", () => {
    const withoutAgent = { configOptions: [{ id: "mode", options: [{ value: "build" }] }] };
    expect(parseOpencodeSession(withoutAgent).profileLoaded).toBe(false);
    expect(parseOpencodeSession(null)).toEqual({ models: [], providers: [], profileLoaded: false });
  });
});

describe("readOpencodeCatalog", () => {
  it("reads the catalog from a throwaway session and deletes it", async () => {
    const catalog = await readOpencodeCatalog({ timeoutMs: 1000 });

    expect(catalog).toMatchObject({ version: "2.2.6", defaultModel: "opencode/big-pickle", profileLoaded: true });
    expect(catalog?.models).toHaveLength(3);
    expect(sent().map((m) => m.method)).toEqual(["initialize", "session/new", "session/delete"]);
    expect(sent()[1]?.params).toEqual({ cwd: "/app/agent-workspace", mcpServers: [] });
    expect(sent()[2]?.params).toEqual({ sessionId: "ses_1" });
    expect(start.mock.calls[0]?.[0]).toMatchObject({ cli: "opencode", args: ["acp"] });
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("still returns the catalog when the delete fails", async () => {
    write.mockImplementation(async (_session, data) => {
      const message = JSON.parse(data) as Message;
      const body = message.method === "session/delete"
        ? { error: { code: -32603, message: "Internal error: busy" } }
        : { result: replies[message.method ?? ""]?.(message) };
      emit({ type: "line", data: JSON.stringify({ jsonrpc: "2.0", id: message.id, ...body }) });
    });

    expect((await readOpencodeCatalog({ timeoutMs: 1000 }))?.models).toHaveLength(3);
  });

  it("throws OpenCode's reason when the session cannot be created", async () => {
    write.mockImplementation(async (_session, data) => {
      const message = JSON.parse(data) as Message;
      const body = message.method === "session/new"
        ? { error: { code: -32603, message: "Internal error: Internal service failure" } }
        : { result: replies[message.method ?? ""]?.(message) };
      emit({ type: "line", data: JSON.stringify({ jsonrpc: "2.0", id: message.id, ...body }) });
    });

    await expect(readOpencodeCatalog({ timeoutMs: 1000 })).rejects.toThrow("Internal service failure");
    expect(stop).toHaveBeenCalledTimes(1);
  });
});

describe("listOpencodeModels", () => {
  it("leads with an entry that keeps OpenCode's own default model", async () => {
    const models = await listOpencodeModels();

    expect(models[0]).toEqual({ id: "default", displayName: "OpenCode default", tier: "balanced", hint: "opencode/big-pickle" });
    expect(models.slice(1).map((m) => m.id)).toEqual(["opencode/big-pickle", "opencode/glm-5.3-flash-free", "opencode-go/kimi-k3"]);
    expect(start.mock.calls[0]?.[0].path).toBe("/bin/opencode");
  });

  it("returns an empty list on the web build so the picker keeps its fallback", async () => {
    workspace.mockResolvedValue(null);

    expect(await listOpencodeModels()).toEqual([]);
    expect(start).not.toHaveBeenCalled();
  });

  it("does not spawn for a pre-aborted lookup", async () => {
    expect(await listOpencodeModels({ signal: AbortSignal.abort() })).toEqual([]);
    expect(start).not.toHaveBeenCalled();
  });

  it("stops a lookup whose signal aborted while OpenCode was starting", async () => {
    const controller = new AbortController();
    let stopped = false;
    start.mockImplementation(async (options, callback) => {
      emit = callback;
      controller.abort();
      return options.session;
    });
    stop.mockImplementation(async () => {
      stopped = true;
      emit({ type: "exit", code: null });
    });
    const answer = write.getMockImplementation();
    write.mockImplementation(async (session, data) => {
      if (stopped) throw new Error("No running agent session");
      await answer?.(session, data);
    });

    expect(await listOpencodeModels({ signal: controller.signal })).toEqual([]);
    expect(sent().map((m) => m.method)).not.toContain("session/new");
  });

  it("returns an empty list when OpenCode exits before answering", async () => {
    write.mockImplementation(async () => emit({ type: "exit", code: 1 }));

    expect(await listOpencodeModels()).toEqual([]);
  });
});
