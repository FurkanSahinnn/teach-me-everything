/**
 * Phase 6.9.5 — Unit tests for the production embedder factory.
 *
 * The factory has three failure modes the toolbar button needs to surface
 * distinctly, plus a happy path and a local-preset branch that intentionally
 * skips the vault. Every branch is covered here so the toast/UX wiring at
 * the route level can rely on the resolution shape without integration
 * tests against the real Zustand singletons.
 */

import { describe, expect, it, vi } from "vitest";
import type { EmbedProvider } from "@/lib/ai/providers/types";
import { resolveEmbedderFromState } from "./embedder-factory";

function fakeProvider(overrides: Partial<EmbedProvider> = {}): EmbedProvider {
  return {
    id: "openai",
    dimFor: () => 1536,
    embed: async ({ inputs }) => ({
      vectors: inputs.map(() => new Float32Array([0.1, 0.2, 0.3])),
      model: "text-embedding-3-small",
      dim: 1536,
    }),
    ...overrides,
  } as EmbedProvider;
}

describe("resolveEmbedderFromState", () => {
  it("Phase 9 — never returns vault-locked: gating was removed when the master-password vault was deleted", async () => {
    // Pre-Phase-9 this configuration (no `isUnlocked: true`) would have
    // returned `{ handle: null, reason: "vault-locked" }`. The factory no
    // longer reads the vault store at all, so as long as a key is stored
    // it resolves to a working handle.
    const result = await resolveEmbedderFromState({
      presetId: "openai-3-small",
      getProvider: () => fakeProvider(),
      getKey: async () => "stored-key",
    });
    expect(result.handle).not.toBeNull();
    expect(result.reason).toBeNull();
  });

  it("returns no-key when the vault is unlocked but no key is stored", async () => {
    const result = await resolveEmbedderFromState({
      presetId: "openai-3-small",
      getProvider: () => fakeProvider(),
      getKey: async () => null,
    });
    expect(result.handle).toBeNull();
    expect(result.reason).toBe("no-key");
  });

  it("returns no-key when the stored key decrypts to an empty string", async () => {
    const result = await resolveEmbedderFromState({
      presetId: "openai-3-small",
      getProvider: () => fakeProvider(),
      getKey: async () => "",
    });
    expect(result.handle).toBeNull();
    expect(result.reason).toBe("no-key");
  });

  it("returns provider-unavailable when the registry throws", async () => {
    const result = await resolveEmbedderFromState({
      presetId: "openai-3-small",
      getProvider: () => {
        throw new Error("unknown_provider");
      },
      getKey: async () => "stored-key",
    });
    expect(result.handle).toBeNull();
    expect(result.reason).toBe("provider-unavailable");
  });

  it("returns a working handle for the happy path", async () => {
    const embedSpy = vi.fn(async ({ inputs }: { inputs: string[] }) => ({
      vectors: inputs.map(() => new Float32Array([0.5])),
      model: "text-embedding-3-small",
      dim: 1,
    }));
    const result = await resolveEmbedderFromState({
      presetId: "openai-3-small",
      getProvider: () =>
        fakeProvider({ embed: embedSpy as EmbedProvider["embed"] }),
      getKey: async () => "sk-test",
    });
    expect(result.reason).toBeNull();
    expect(result.handle).not.toBeNull();
    expect(result.handle?.providerId).toBe("openai");
    expect(result.handle?.model).toBe("text-embedding-3-small");
    // OpenAI text-embedding-3-small lists at $0.02 per 1M input tokens.
    expect(result.handle?.pricePerMillionTokensUsd).toBeCloseTo(0.02, 4);

    const vectors = await result.handle!.embed(["hello world"]);
    expect(vectors).toHaveLength(1);
    expect(vectors[0]).toBeInstanceOf(Float32Array);
    expect(embedSpy).toHaveBeenCalledWith({
      apiKey: "sk-test",
      model: "text-embedding-3-small",
      inputs: ["hello world"],
    });
  });

  it("skips the vault when the preset is local (Ollama / LAN)", async () => {
    // ollama-nomic is in EMBED_PRESETS with a localhost baseUrl — even with a
    // locked vault the factory should resolve a handle that fires `embed()`
    // with an empty api key (local adapters accept that).
    const embedSpy = vi.fn(async ({ inputs }: { inputs: string[] }) => ({
      vectors: inputs.map(() => new Float32Array([0.1])),
      model: "nomic-embed-text",
      dim: 1,
    }));
    const result = await resolveEmbedderFromState({
      presetId: "ollama-nomic",
      getProvider: () =>
        fakeProvider({ embed: embedSpy as EmbedProvider["embed"] }),
      getKey: async () => null,
    });
    expect(result.reason).toBeNull();
    expect(result.handle).not.toBeNull();
    await result.handle!.embed(["hi"]);
    expect(embedSpy).toHaveBeenCalledWith({
      apiKey: "",
      model: "nomic-embed-text",
      inputs: ["hi"],
    });
  });

  it("falls back to openai-3-small for an unknown preset id (forward-compat)", async () => {
    // Future build emits a preset id this build doesn't know — the factory
    // shouldn't strand the user; falling back to the default keeps the
    // pipeline alive while Settings flags the mismatch.
    const result = await resolveEmbedderFromState({
      presetId: "future-preset-2099",
      getProvider: () => fakeProvider(),
      getKey: async () => "sk-test",
    });
    expect(result.reason).toBeNull();
    expect(result.handle?.providerId).toBe("openai");
  });

  it("treats a thrown getKey as no-key (decrypt failure)", async () => {
    const result = await resolveEmbedderFromState({
      presetId: "openai-3-small",
      getProvider: () => fakeProvider(),
      getKey: async () => {
        throw new Error("decrypt failed — wrong master key");
      },
    });
    expect(result.handle).toBeNull();
    expect(result.reason).toBe("no-key");
  });
});
