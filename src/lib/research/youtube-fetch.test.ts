import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchYoutubeTranscript } from "./youtube-fetch";

describe("fetchYoutubeTranscript", () => {
  let originalFetch: typeof globalThis.fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("formats transcript segments into Markdown", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          videoId: "dQw4w9WgXcQ",
          title: "Sample Video",
          channel: "Sample Channel",
          language: "en",
          transcript: [
            { text: "hello", offset: 0, duration: 1 },
            { text: "world", offset: 1, duration: 1 },
            { text: "and so", offset: 2, duration: 1 },
            { text: "on we", offset: 3, duration: 1 },
            { text: "continue", offset: 4, duration: 1 },
            { text: "speaking", offset: 5, duration: 1 },
            { text: "into the", offset: 6, duration: 1 },
            { text: "next paragraph", offset: 7, duration: 1 },
          ],
        }),
        { status: 200 },
      ),
    ) as unknown as typeof globalThis.fetch;

    const result = await fetchYoutubeTranscript("dQw4w9WgXcQ");
    expect(result.title).toBe("Sample Video");
    expect(result.author).toBe("Sample Channel");
    expect(result.markdown).toContain("# Sample Video");
    expect(result.markdown).toContain("**Channel:** Sample Channel");
    expect(result.markdown).toContain("## Transcript");
    expect(result.markdown).toContain("hello world and so on we continue");
    // Two paragraphs of 6+ segments split into separate paragraphs
    expect(result.markdown.split("\n\n").length).toBeGreaterThan(1);
    expect(result.meta?.segmentCount).toBe(8);
  });

  it("throws no_transcript when route returns 404", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({ videoId: "x", transcript: [], error: "none" }),
        { status: 404 },
      ),
    ) as unknown as typeof globalThis.fetch;
    await expect(
      fetchYoutubeTranscript("dQw4w9WgXcQ"),
    ).rejects.toMatchObject({ code: "no_transcript" });
  });

  it("throws no_transcript when route returns 200 but empty transcript", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ videoId: "x", transcript: [] }), {
        status: 200,
      }),
    ) as unknown as typeof globalThis.fetch;
    await expect(
      fetchYoutubeTranscript("dQw4w9WgXcQ"),
    ).rejects.toMatchObject({ code: "no_transcript" });
  });
});
