import { describe, it, expect } from "vitest";
import { classifyUrl } from "./url-classifier";

describe("classifyUrl", () => {
  it("returns invalid for empty input", () => {
    expect(classifyUrl("")).toEqual({ kind: "invalid", raw: "", reason: "empty" });
    expect(classifyUrl("   ")).toMatchObject({ kind: "invalid", reason: "empty" });
  });

  it("classifies raw DOIs", () => {
    expect(classifyUrl("10.1038/nature12345")).toMatchObject({
      kind: "doi",
      doi: "10.1038/nature12345",
    });
    expect(classifyUrl("10.1234/foo.bar.baz")).toMatchObject({ kind: "doi" });
  });

  it("classifies doi.org URLs", () => {
    expect(classifyUrl("https://doi.org/10.1038/nature12345")).toMatchObject({
      kind: "doi",
      doi: "10.1038/nature12345",
    });
    expect(classifyUrl("https://dx.doi.org/10.5555/abcd")).toMatchObject({
      kind: "doi",
      doi: "10.5555/abcd",
    });
  });

  it("degrades doi.org URLs with malformed paths to web", () => {
    const result = classifyUrl("https://doi.org/not-a-doi");
    expect(result.kind).toBe("web");
  });

  it("classifies YouTube watch URLs", () => {
    expect(
      classifyUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
    ).toMatchObject({ kind: "youtube", videoId: "dQw4w9WgXcQ" });
    expect(classifyUrl("https://youtu.be/dQw4w9WgXcQ")).toMatchObject({
      kind: "youtube",
      videoId: "dQw4w9WgXcQ",
    });
    expect(
      classifyUrl("https://www.youtube.com/shorts/dQw4w9WgXcQ"),
    ).toMatchObject({ kind: "youtube", videoId: "dQw4w9WgXcQ" });
  });

  it("rejects playlist-only YouTube URLs (no v=)", () => {
    expect(
      classifyUrl("https://www.youtube.com/playlist?list=PLxyz"),
    ).toMatchObject({ kind: "web" });
  });

  it("rejects YouTube URLs with malformed video ids", () => {
    expect(
      classifyUrl("https://www.youtube.com/watch?v=tooLong123456"),
    ).toMatchObject({ kind: "web" });
    expect(classifyUrl("https://youtu.be/short")).toMatchObject({ kind: "web" });
  });

  it("classifies arXiv abs / pdf URLs", () => {
    expect(classifyUrl("https://arxiv.org/abs/2401.12345")).toMatchObject({
      kind: "arxiv",
      arxivId: "2401.12345",
    });
    expect(classifyUrl("https://arxiv.org/pdf/2401.12345.pdf")).toMatchObject({
      kind: "arxiv",
      arxivId: "2401.12345",
    });
    // Versioned id
    expect(classifyUrl("https://arxiv.org/abs/2401.12345v2")).toMatchObject({
      kind: "arxiv",
      arxivId: "2401.12345v2",
    });
    // Pre-2007 namespaced id
    expect(classifyUrl("https://arxiv.org/abs/hep-ph/9901234")).toMatchObject({
      kind: "arxiv",
      arxivId: "hep-ph/9901234",
    });
  });

  it("classifies plain web URLs", () => {
    expect(classifyUrl("https://example.com/article")).toMatchObject({
      kind: "web",
    });
    expect(classifyUrl("https://en.wikipedia.org/wiki/Bayes_theorem")).toMatchObject({
      kind: "web",
    });
  });

  it("prepends https:// for schemeless inputs", () => {
    expect(classifyUrl("example.com/foo")).toMatchObject({
      kind: "web",
      url: "https://example.com/foo",
    });
  });

  it("returns invalid for malformed URLs", () => {
    expect(classifyUrl("ht!tp://broken")).toMatchObject({ kind: "invalid" });
  });

  it("rejects non-http(s) protocols", () => {
    expect(classifyUrl("ftp://example.com/foo")).toMatchObject({ kind: "invalid" });
    expect(classifyUrl("javascript:alert(1)")).toMatchObject({ kind: "invalid" });
  });

  it("trims leading/trailing whitespace", () => {
    expect(classifyUrl("   10.1234/abc   ")).toMatchObject({
      kind: "doi",
      doi: "10.1234/abc",
    });
  });
});
