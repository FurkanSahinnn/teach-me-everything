import { describe, expect, it } from "vitest";
import {
  getResearchProvider,
  listResearchProviderIds,
} from "./registry";

describe("research registry", () => {
  it("lists all 7 provider ids", () => {
    expect(listResearchProviderIds()).toEqual([
      "readability",
      "firecrawl",
      "exa",
      "jina-reader",
      "tavily",
      "diffbot",
      "brightdata",
    ]);
  });

  it("constructs each provider with the correct id and capability shape", () => {
    for (const id of listResearchProviderIds()) {
      const p = getResearchProvider(id);
      expect(p.id).toBe(id);
      expect(typeof p.capabilities.jsRender).toBe("boolean");
      expect(typeof p.capabilities.search).toBe("boolean");
      expect(typeof p.capabilities.local).toBe("boolean");
      expect(typeof p.capabilities.freeTier).toBe("boolean");
    }
  });

  it("returns a stable singleton per id", () => {
    const a = getResearchProvider("readability");
    const b = getResearchProvider("readability");
    expect(a).toBe(b);
  });

  it("readability is the only local provider", () => {
    const readability = getResearchProvider("readability");
    expect(readability.capabilities.local).toBe(true);
    for (const id of listResearchProviderIds()) {
      if (id === "readability") continue;
      expect(getResearchProvider(id).capabilities.local).toBe(false);
    }
  });
});
