import { describe, expect, it } from "vitest";
import {
  badgesForChat,
  badgesForEmbed,
  encodeChatModelBinding,
  findChatOption,
  listChatOptions,
  listEmbedOptions,
} from "../model-options";
import { EMBED_PRESETS } from "../providers/embed-presets";
import { PROVIDER_PRESETS } from "../providers/presets";

describe("listChatOptions", () => {
  it("returns one entry per chat-capable preset; custom: ids excluded", () => {
    const opts = listChatOptions();
    const chatPresetCount = Object.values(PROVIDER_PRESETS).filter(
      (p) => p.kind === "chat" || p.kind === "both",
    ).length;
    expect(opts.length).toBe(chatPresetCount);
    expect(opts.every((o) => !String(o.presetId).startsWith("custom:"))).toBe(
      true,
    );
    const presetIds = new Set(opts.map((o) => o.presetId));
    expect(presetIds.size).toBe(opts.length);
  });

  it("uses unique option ids even when providers share the same upstream model", () => {
    const opts = listChatOptions();
    const optionIds = new Set(opts.map((o) => o.id));
    expect(optionIds.size).toBe(opts.length);

    const localOptions = opts.filter((o) => o.modelId === "local-model");
    expect(localOptions.length).toBeGreaterThan(1);
    expect(localOptions.every((o) => o.id.includes("::local-model"))).toBe(true);
  });

  it("resolves provider-scoped ids, custom provider model ids, and legacy raw model ids", () => {
    const lmStudio = findChatOption("lm-studio::local-model");
    expect(lmStudio?.presetId).toBe("lm-studio");
    expect(lmStudio?.modelId).toBe("local-model");

    const openRouterCustom = findChatOption(
      encodeChatModelBinding("openrouter", "anthropic/claude-sonnet-4.5"),
    );
    expect(openRouterCustom?.presetId).toBe("openrouter");
    expect(openRouterCustom?.modelId).toBe("anthropic/claude-sonnet-4.5");

    const legacyLocal = findChatOption("local-model");
    expect(legacyLocal?.modelId).toBe("local-model");

    const previousScopedLocal = findChatOption("lm-studio:local-model");
    expect(previousScopedLocal?.presetId).toBe("lm-studio");
    expect(previousScopedLocal?.modelId).toBe("local-model");
  });

  it("requireToolUse:true drops toolUse:'none' entries", () => {
    const all = listChatOptions();
    const onlyTool = listChatOptions({ requireToolUse: true });
    const noneCount = Object.values(PROVIDER_PRESETS).filter(
      (p) =>
        (p.kind === "chat" || p.kind === "both") &&
        p.capabilities.toolUse === "none",
    ).length;
    expect(onlyTool.length).toBe(all.length - noneCount);
    for (const o of onlyTool) {
      const preset = Object.values(PROVIDER_PRESETS).find(
        (p) => p?.id === o.presetId,
      );
      expect(preset?.capabilities.toolUse).not.toBe("none");
    }
  });

  it("orders native-tool presets before json-tool presets", () => {
    const opts = listChatOptions();
    let sawJson = false;
    for (const o of opts) {
      const preset = Object.values(PROVIDER_PRESETS).find(
        (p) => p?.id === o.presetId,
      );
      if (preset?.capabilities.toolUse === "json") sawJson = true;
      if (preset?.capabilities.toolUse === "native") {
        expect(sawJson).toBe(false);
      }
    }
  });
});

describe("listEmbedOptions", () => {
  it("includes every EMBED_PRESETS entry", () => {
    const opts = listEmbedOptions();
    expect(opts.length).toBe(Object.keys(EMBED_PRESETS).length);
    const optIds = new Set(opts.map((o) => o.id));
    for (const id of Object.keys(EMBED_PRESETS)) {
      expect(optIds.has(id)).toBe(true);
    }
  });

  it("preserves matryoshka dim arrays in the dim badge", () => {
    const opts = listEmbedOptions();
    const jina = opts.find((o) => o.id === "jina-v3");
    expect(jina).toBeDefined();
    const dimBadge = jina!.badges.find((b) => b.kind === "dim");
    expect(dimBadge?.label).toBe("256/512/1024-d");
  });
});

describe("badgesForChat", () => {
  it("anthropic has cache + tool + vision (no free, no local)", () => {
    const anthropic = PROVIDER_PRESETS.anthropic!;
    const kinds = badgesForChat(anthropic).map((b) => b.kind);
    expect(kinds).toContain("cache");
    expect(kinds).toContain("tool");
    expect(kinds).toContain("vision");
    expect(kinds).not.toContain("free");
    expect(kinds).not.toContain("local");
  });

  it("ollama gets local; gemini-flash gets free + tool", () => {
    const ollama = PROVIDER_PRESETS.ollama!;
    const ollamaKinds = badgesForChat(ollama).map((b) => b.kind);
    expect(ollamaKinds).toContain("local");

    const gemini = PROVIDER_PRESETS["google-gemini"]!;
    const geminiKinds = badgesForChat(gemini).map((b) => b.kind);
    expect(geminiKinds).toContain("free");
    expect(geminiKinds).toContain("tool");
  });
});

describe("badgesForEmbed", () => {
  it("ollama-nomic includes local + dim", () => {
    const preset = EMBED_PRESETS["ollama-nomic"];
    const kinds = badgesForEmbed(preset).map((b) => b.kind);
    expect(kinds).toContain("local");
    expect(kinds).toContain("dim");
  });

  it("gemini-004 includes free + dim (free tier)", () => {
    const preset = EMBED_PRESETS["gemini-004"];
    const kinds = badgesForEmbed(preset).map((b) => b.kind);
    expect(kinds).toContain("free");
    expect(kinds).toContain("dim");
  });

  it("voyage-3 has no free badge (paid tier)", () => {
    const preset = EMBED_PRESETS["voyage-3"];
    const kinds = badgesForEmbed(preset).map((b) => b.kind);
    expect(kinds).not.toContain("free");
    expect(kinds).toContain("dim");
  });
});
