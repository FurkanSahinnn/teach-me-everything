import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildCodexModelListStdin,
  listCodexModels,
  parseCodexModelList,
} from "./codex-cli";

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



beforeEach(() => {
  startMock.mockReset();
  stopMock.mockClear();
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
