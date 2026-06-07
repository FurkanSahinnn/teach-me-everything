import { describe, expect, it } from "vitest";

import nextConfig from "./next.config";

describe("next CSP", () => {
  it("allows blob-backed audio playback in dev/Tauri dev mode", async () => {
    const headersFn = "headers" in nextConfig ? nextConfig.headers : undefined;
    expect(headersFn).toBeTypeOf("function");

    const headers = await headersFn?.();
    const csp = headers?.[0]?.headers.find(
      (header) => header.key === "Content-Security-Policy",
    )?.value;

    expect(csp).toContain("media-src 'self' blob: data:");
  });
});
