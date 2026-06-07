import { describe, expect, it } from "vitest";
import { BOM, crlfToLf, normalizeForRead, stripBom } from "./normalise";

describe("vault/normalise", () => {
  describe("stripBom", () => {
    it("strips a leading BOM", () => {
      expect(stripBom(`${BOM}hello`)).toBe("hello");
    });
    it("leaves non-BOM text alone", () => {
      expect(stripBom("hello")).toBe("hello");
    });
    it("ignores a BOM mid-string", () => {
      expect(stripBom(`hello${BOM}world`)).toBe(`hello${BOM}world`);
    });
    it("handles empty string", () => {
      expect(stripBom("")).toBe("");
    });
  });

  describe("crlfToLf", () => {
    it("converts CRLF to LF", () => {
      expect(crlfToLf("a\r\nb")).toBe("a\nb");
    });
    it("converts lone CR to LF", () => {
      expect(crlfToLf("a\rb")).toBe("a\nb");
    });
    it("leaves LF alone", () => {
      expect(crlfToLf("a\nb")).toBe("a\nb");
    });
    it("handles mixed line endings in one pass", () => {
      expect(crlfToLf("a\r\nb\nc\rd")).toBe("a\nb\nc\nd");
    });
    it("does not double-substitute CRLF (no \\n\\n artefact)", () => {
      expect(crlfToLf("first\r\nsecond")).toBe("first\nsecond");
      expect(crlfToLf("first\r\nsecond")).not.toContain("\n\n");
    });
    it("handles empty string", () => {
      expect(crlfToLf("")).toBe("");
    });
  });

  describe("normalizeForRead", () => {
    it("strips BOM and converts CRLF in one go", () => {
      expect(normalizeForRead(`${BOM}a\r\nb`)).toBe("a\nb");
    });
    it("is idempotent on canonical text", () => {
      const s = "hello\nworld";
      expect(normalizeForRead(s)).toBe(s);
      expect(normalizeForRead(normalizeForRead(s))).toBe(s);
    });
    it("preserves Turkish UTF-8 characters", () => {
      expect(normalizeForRead("şüğı\r\nçöü")).toBe("şüğı\nçöü");
    });
  });
});
