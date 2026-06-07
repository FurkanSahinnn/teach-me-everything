import { describe, expect, it } from "vitest";

import { CohereEmbedProvider } from "../embed-cohere";
import { GeminiEmbedProvider } from "../embed-gemini";
import { HuggingFaceEmbedProvider } from "../embed-hf";
import { JinaEmbedProvider } from "../embed-jina";
import { OpenAICompatEmbedProvider } from "../embed-openai-compat";
import { OpenAIEmbedProvider } from "../embed-openai";
import { VoyageEmbedProvider } from "../embed-voyage";
import { getEmbedProvider } from "../registry";
import { ProviderError } from "../types";

describe("registry.getEmbedProvider — Phase 3.3.C branches", () => {
  it("openai → OpenAIEmbedProvider (cached canon)", () => {
    const p = getEmbedProvider("openai");
    expect(p).toBeInstanceOf(OpenAIEmbedProvider);
    expect(p.id).toBe("openai");
  });

  it("voyage → VoyageEmbedProvider", () => {
    const p = getEmbedProvider("voyage");
    expect(p).toBeInstanceOf(VoyageEmbedProvider);
    expect(p.id).toBe("voyage");
  });

  it("google-gemini → GeminiEmbedProvider", () => {
    const p = getEmbedProvider("google-gemini");
    expect(p).toBeInstanceOf(GeminiEmbedProvider);
    expect(p.id).toBe("google-gemini");
  });

  it("cohere → CohereEmbedProvider", () => {
    const p = getEmbedProvider("cohere");
    expect(p).toBeInstanceOf(CohereEmbedProvider);
    expect(p.id).toBe("cohere");
  });

  it("jina → JinaEmbedProvider", () => {
    const p = getEmbedProvider("jina");
    expect(p).toBeInstanceOf(JinaEmbedProvider);
    expect(p.id).toBe("jina");
  });

  it("huggingface → HuggingFaceEmbedProvider", () => {
    const p = getEmbedProvider("huggingface");
    expect(p).toBeInstanceOf(HuggingFaceEmbedProvider);
    expect(p.id).toBe("huggingface");
  });

  it("mistral → OpenAICompatEmbedProvider (proxy mode)", () => {
    const p = getEmbedProvider("mistral");
    expect(p).toBeInstanceOf(OpenAICompatEmbedProvider);
    expect(p.id).toBe("mistral");
  });

  it("ollama → OpenAICompatEmbedProvider (local bypass mode)", () => {
    const p = getEmbedProvider("ollama");
    expect(p).toBeInstanceOf(OpenAICompatEmbedProvider);
    expect(p.id).toBe("ollama");
  });

  it("anthropic → ProviderError(400, chat_only)", () => {
    expect(() => getEmbedProvider("anthropic")).toThrow(ProviderError);
    try {
      getEmbedProvider("anthropic");
    } catch (err) {
      expect((err as ProviderError).status).toBe(400);
      expect((err as ProviderError).code).toBe("chat_only");
    }
  });

  it("groq → ProviderError(400, chat_only) for any chat-only preset", () => {
    expect(() => getEmbedProvider("groq")).toThrow(ProviderError);
    try {
      getEmbedProvider("groq");
    } catch (err) {
      expect((err as ProviderError).code).toBe("chat_only");
    }
  });

  it("caches the constructed instance across calls", () => {
    const a = getEmbedProvider("voyage");
    const b = getEmbedProvider("voyage");
    expect(a).toBe(b);
  });
});
