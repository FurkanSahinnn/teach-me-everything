import { beforeEach, describe, expect, it, vi } from "vitest";
import { getEmbedProvider } from "@/lib/ai/providers/registry";
import { embedSourceChunks } from "./embed";

vi.mock("@/lib/ai/providers/registry", () => ({ getEmbedProvider: vi.fn() }));

describe("local embedding ingestion", () => {
  beforeEach(() => vi.clearAllMocks());

  it("passes document input type and uses small sequential batches", async () => {
    let active = 0;
    let maxActive = 0;
    const embed = vi.fn(async ({ inputs }: { inputs: string[] }) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      active -= 1;
      return {
        vectors: inputs.map(() => new Float32Array(384)),
        model: "local-minilm-multilingual",
        dim: 384,
      };
    });
    vi.mocked(getEmbedProvider).mockReturnValue({
      id: "local-embed",
      embed,
      dimFor: () => 384,
    });
    const chunks = Array.from({ length: 9 }, (_, i) => ({ id: `${i}`, text: `chunk ${i}` }));

    const result = await embedSourceChunks({
      apiKey: "",
      providerId: "local-embed",
      model: "local-minilm-multilingual",
      chunks,
    }).promise;

    expect(result.embeddings).toHaveLength(9);
    expect(embed).toHaveBeenCalledTimes(2);
    expect(maxActive).toBe(1);
    expect(embed).toHaveBeenCalledWith(expect.objectContaining({ inputType: "document" }));
  });
});
