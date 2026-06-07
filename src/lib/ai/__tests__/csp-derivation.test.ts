import { describe, expect, it } from "vitest";

import { deriveConnectOrigins, SEED_ORIGINS } from "../csp-origins";
import { EMBED_PRESETS } from "../providers/embed-presets";
import { PROVIDER_PRESETS } from "../providers/presets";

describe("deriveConnectOrigins — seeds", () => {
  it("includes every hard-coded seed (self + anthropic + huggingface + research/metadata helpers)", () => {
    const origins = deriveConnectOrigins();
    for (const s of SEED_ORIGINS) {
      expect(origins).toContain(s);
    }
  });

  it("contains 'self' literally (not a host)", () => {
    expect(deriveConnectOrigins()).toContain("'self'");
  });
});

describe("deriveConnectOrigins — preset coverage", () => {
  it("includes every cloud embed preset host", () => {
    const origins = deriveConnectOrigins();
    for (const preset of Object.values(EMBED_PRESETS)) {
      if (preset.isLocal === true) continue;
      const expected = new URL(preset.baseUrl);
      expect(origins).toContain(`${expected.protocol}//${expected.host}`);
    }
  });

  it("includes every cloud chat provider preset host (skipping local loopback entries)", () => {
    const origins = deriveConnectOrigins();
    for (const preset of Object.values(PROVIDER_PRESETS)) {
      if (!preset) continue;
      const u = new URL(preset.baseUrl);
      const host = u.host.replace(/:\d+$/, "");
      // local presets (ollama / lm-studio / llama-cpp) are filtered by URL.
      if (host === "localhost" || host === "127.0.0.1" || host === "[::1]") continue;
      expect(origins).toContain(`${u.protocol}//${u.host}`);
    }
  });

  it("includes voyage-3 preset host (smoke check on a specific cloud entry)", () => {
    expect(deriveConnectOrigins()).toContain("https://api.voyageai.com");
  });

  it("includes huggingface router host (router.huggingface.co)", () => {
    expect(deriveConnectOrigins()).toContain("https://router.huggingface.co");
  });
});

describe("deriveConnectOrigins — local exclusion", () => {
  it("excludes localhost / 127.0.0.1 / [::1] / *.local", () => {
    const origins = deriveConnectOrigins();
    for (const o of origins) {
      expect(o).not.toMatch(/localhost/i);
      expect(o).not.toMatch(/127\.0\.0\.1/);
      expect(o).not.toMatch(/\[::1\]/);
      expect(o).not.toMatch(/\.local(:|$)/);
    }
  });
});

describe("deriveConnectOrigins — dedup + stability", () => {
  it("deduplicates same host across presets (api.openai.com appears once across openai-3-small + openai-3-large + openai chat preset)", () => {
    const origins = deriveConnectOrigins();
    const matches = origins.filter((o) => o === "https://api.openai.com");
    expect(matches).toHaveLength(1);
  });

  it("is order-independent and stable across calls", () => {
    const a = deriveConnectOrigins();
    const b = deriveConnectOrigins();
    expect([...a].sort()).toEqual([...b].sort());
  });

  it("returns only http(s) absolute origins (no trailing path, no protocol-relative)", () => {
    for (const o of deriveConnectOrigins()) {
      if (o === "'self'") continue;
      expect(o).toMatch(/^https?:\/\/[^/]+$/);
    }
  });
});
