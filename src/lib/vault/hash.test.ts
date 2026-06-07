import { describe, expect, it } from "vitest";
import { hashNormalizedContent, sha256Hex } from "./hash";
import { BOM } from "./normalise";

describe("vault/hash", () => {
  it("sha256Hex returns 64 hex chars", async () => {
    const h = await sha256Hex("hello");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it("sha256Hex deterministic for known input", async () => {
    // SHA-256("hello") = 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824
    expect(await sha256Hex("hello")).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
  });

  it("sha256Hex differs for distinct input", async () => {
    expect(await sha256Hex("a")).not.toBe(await sha256Hex("b"));
  });

  it("sha256Hex handles empty string (NIST vector)", async () => {
    expect(await sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("sha256Hex handles UTF-8 multi-byte characters", async () => {
    const a = await sha256Hex("merhaba");
    const b = await sha256Hex("şüğı");
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(b).toMatch(/^[0-9a-f]{64}$/);
  });

  describe("hashNormalizedContent", () => {
    it("CRLF and LF hash to the same value", async () => {
      expect(await hashNormalizedContent("a\nb")).toBe(
        await hashNormalizedContent("a\r\nb"),
      );
    });
    it("BOM-prefixed and bare hash to the same value", async () => {
      expect(await hashNormalizedContent("hello")).toBe(
        await hashNormalizedContent(`${BOM}hello`),
      );
    });
    it("lone CR collapses to LF in hash", async () => {
      expect(await hashNormalizedContent("a\rb")).toBe(
        await hashNormalizedContent("a\nb"),
      );
    });
    it("distinct content still hashes distinctly after normalise", async () => {
      expect(await hashNormalizedContent("hello\nworld")).not.toBe(
        await hashNormalizedContent("hello\nworld\n"),
      );
    });
  });
});
