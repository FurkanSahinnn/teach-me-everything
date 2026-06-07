// YouTube transcript fetcher.
//
// Web mode: proxies through the same-origin `/api/ai/research/youtube`
// Edge route which uses the `youtube-transcript` Node package. The route
// also calls YouTube's oEmbed endpoint server-side to pull title +
// channel metadata.
//
// Tauri mode: re-implements the same flow client-side via `tauriFetch`
// (no CORS gate on the watch page or timedtext URL). Walks the same path
// the Node package does — fetch watch.html → extract
// `ytInitialPlayerResponse` JSON → pick first caption track's `baseUrl`
// → fetch timedtext XML → parse `<text>` segments. oEmbed call also
// client-side. Mirrors the route's response shape exactly so the
// Markdown composer below works in both modes.

import { isTauriEnvWithOverride } from "@/lib/tauri/env";
import { tauriFetch } from "@/lib/tauri/fetch";
import { ResearchError } from "./providers/types";
import type { ResearchResult } from "./providers/types";

type YoutubeTranscriptResponse = {
  videoId?: string;
  title?: string;
  channel?: string;
  transcript?: { text: string; offset?: number; duration?: number }[];
  language?: string;
  error?: string;
};

export async function fetchYoutubeTranscript(
  videoId: string,
  opts: { signal?: AbortSignal } = {},
): Promise<ResearchResult> {
  const data = isTauriEnvWithOverride()
    ? await fetchYoutubeViaTauri(videoId, opts)
    : await fetchYoutubeViaProxy(videoId, opts);

  if (!data.transcript || data.transcript.length === 0) {
    throw new ResearchError(
      404,
      "no_transcript",
      data.error ?? "Video has no public transcript; enable Whisper fallback to transcribe",
    );
  }

  const title = data.title ?? `YouTube ${videoId}`;
  const lines: string[] = [`# ${title}`];
  if (data.channel) lines.push("", `**Channel:** ${data.channel}`);
  lines.push(
    "",
    `**Source:** [youtube.com/watch?v=${videoId}](https://www.youtube.com/watch?v=${videoId})`,
    "",
    "## Transcript",
    "",
  );
  // Compose transcript with paragraph breaks every ~6 segments so the
  // chunker has natural boundaries. We could also use timestamp deltas to
  // pick boundaries but a fixed cadence is simpler and good enough for
  // chunking 500–1000 token windows.
  const paras: string[] = [];
  let buf: string[] = [];
  for (const seg of data.transcript) {
    buf.push(seg.text.trim());
    if (buf.length >= 6) {
      paras.push(buf.join(" "));
      buf = [];
    }
  }
  if (buf.length > 0) paras.push(buf.join(" "));
  lines.push(paras.join("\n\n"));

  const markdown = lines.join("\n").trim();
  return {
    markdown,
    url: `https://www.youtube.com/watch?v=${videoId}`,
    title,
    author: data.channel,
    byteSize: new Blob([markdown]).size,
    providerId: "readability",
    meta: {
      extractor: "youtube-transcript",
      videoId,
      language: data.language,
      segmentCount: data.transcript.length,
    },
  };
}

async function fetchYoutubeViaProxy(
  videoId: string,
  opts: { signal?: AbortSignal },
): Promise<YoutubeTranscriptResponse> {
  const endpoint = `/api/ai/research/youtube?v=${encodeURIComponent(videoId)}`;
  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "GET",
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ResearchError(0, "fetch_failed", msg);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const code = res.status === 404 ? "no_transcript" : "upstream_error";
    throw new ResearchError(
      res.status,
      code,
      `YouTube transcript ${res.status}: ${body.slice(0, 200)}`,
    );
  }
  return (await res.json()) as YoutubeTranscriptResponse;
}

// Tauri client-side reimplementation. Same response shape the proxy
// returns so the caller's transcript-or-error branch stays uniform.
async function fetchYoutubeViaTauri(
  videoId: string,
  opts: { signal?: AbortSignal },
): Promise<YoutubeTranscriptResponse> {
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
    throw new ResearchError(400, "invalid_video_id", "Invalid YouTube video id");
  }

  // 1. Fetch the watch page HTML — YouTube embeds the player config (which
  //    includes the timedtext baseUrl) as a JSON blob assigned to
  //    `ytInitialPlayerResponse`.
  let watchHtml: string;
  try {
    const watchRes = await tauriFetch(
      `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
      {
        method: "GET",
        headers: {
          accept: "text/html,application/xhtml+xml",
          "accept-language": "en-US,en;q=0.9",
        },
        ...(opts.signal ? { signal: opts.signal } : {}),
      },
    );
    if (!watchRes.ok) {
      throw new ResearchError(
        watchRes.status,
        "upstream_error",
        `YouTube watch page returned ${watchRes.status}`,
      );
    }
    watchHtml = await watchRes.text();
  } catch (err) {
    if (err instanceof ResearchError) throw err;
    throw new ResearchError(
      0,
      "fetch_failed",
      err instanceof Error ? err.message : String(err),
    );
  }

  // 2. Extract `ytInitialPlayerResponse`. YouTube has periodically
  //    changed how this is emitted — sometimes `var ytInitialPlayerResponse = `,
  //    sometimes `ytInitialPlayerResponse =` (no var), sometimes inside a
  //    `window["ytInitialPlayerResponse"] = ` assignment. The regex covers
  //    the common forms and stops at the matching `};` boundary.
  const playerJson = extractPlayerResponse(watchHtml);
  if (!playerJson) {
    return {
      videoId,
      transcript: [],
      error: "Could not locate ytInitialPlayerResponse in watch page",
    };
  }

  let playerData: PlayerResponse;
  try {
    playerData = JSON.parse(playerJson) as PlayerResponse;
  } catch (err) {
    return {
      videoId,
      transcript: [],
      error: `Player JSON parse failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const tracks =
    playerData.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
  if (tracks.length === 0) {
    return { videoId, transcript: [], error: "No caption tracks available" };
  }

  // Prefer the first track YouTube ranks (usually the original language).
  // A future polish iteration could honour a `preferredLang` opt similar to
  // the youtube-transcript package's `lang` arg.
  const track = tracks[0];
  if (!track || typeof track.baseUrl !== "string") {
    return { videoId, transcript: [], error: "Caption track missing baseUrl" };
  }
  const language =
    typeof track.languageCode === "string" ? track.languageCode : undefined;

  // 3. Fetch the timedtext XML. The baseUrl already includes all required
  //    query params (lang, format, signature etc.).
  let xml: string;
  try {
    const xmlRes = await tauriFetch(track.baseUrl, {
      method: "GET",
      headers: { accept: "application/xml,text/xml" },
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
    if (!xmlRes.ok) {
      return {
        videoId,
        transcript: [],
        error: `Timedtext fetch returned ${xmlRes.status}`,
      };
    }
    xml = await xmlRes.text();
  } catch (err) {
    return {
      videoId,
      transcript: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const segments = parseTimedTextXml(xml);
  if (segments.length === 0) {
    return { videoId, transcript: [], error: "Empty transcript" };
  }

  // 4. oEmbed for title + channel. Best-effort — Google rate-limits oEmbed
  //    occasionally; failures fall through to the caller's "YouTube {id}"
  //    fallback. Mirrors the route's defensive try-catch.
  let title: string | undefined;
  let channel: string | undefined;
  try {
    const oembedRes = await tauriFetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(
        `https://www.youtube.com/watch?v=${videoId}`,
      )}&format=json`,
      { method: "GET" },
    );
    if (oembedRes.ok) {
      const data = (await oembedRes.json()) as {
        title?: string;
        author_name?: string;
      };
      if (typeof data.title === "string" && data.title.length > 0) title = data.title;
      if (typeof data.author_name === "string" && data.author_name.length > 0) {
        channel = data.author_name;
      }
    }
  } catch {
    /* oEmbed best-effort. */
  }

  return {
    videoId,
    transcript: segments,
    ...(language !== undefined ? { language } : {}),
    ...(title !== undefined ? { title } : {}),
    ...(channel !== undefined ? { channel } : {}),
  };
}

type PlayerResponse = {
  captions?: {
    playerCaptionsTracklistRenderer?: {
      captionTracks?: { baseUrl?: string; languageCode?: string }[];
    };
  };
};

function extractPlayerResponse(html: string): string | null {
  // The `/s` (dotall) flag isn't available at our ES2017 target, so use
  // `[\s\S]` to span newlines. The JSON blob itself is multi-line.
  // Pattern 1: `var ytInitialPlayerResponse = {...};`
  const m1 = /var ytInitialPlayerResponse\s*=\s*(\{[\s\S]+?\});/.exec(html);
  if (m1?.[1]) return m1[1];
  // Pattern 2: `ytInitialPlayerResponse = {...};` (no var, mobile/embed pages)
  const m2 = /ytInitialPlayerResponse\s*=\s*(\{[\s\S]+?\})\s*;/.exec(html);
  if (m2?.[1]) return m2[1];
  return null;
}

function parseTimedTextXml(
  xml: string,
): { text: string; offset?: number; duration?: number }[] {
  const out: { text: string; offset?: number; duration?: number }[] = [];
  const textRe = /<text\b([^>]*)>([\s\S]*?)<\/text>/g;
  let match: RegExpExecArray | null;
  while ((match = textRe.exec(xml)) !== null) {
    const attrs = match[1] ?? "";
    const raw = match[2] ?? "";
    const startMatch = /start="([^"]+)"/.exec(attrs);
    const durMatch = /dur="([^"]+)"/.exec(attrs);
    const text = decodeHtmlEntities(raw).trim();
    if (text.length === 0) continue;
    const seg: { text: string; offset?: number; duration?: number } = { text };
    const start = startMatch?.[1] ? Number.parseFloat(startMatch[1]) : NaN;
    const dur = durMatch?.[1] ? Number.parseFloat(durMatch[1]) : NaN;
    if (Number.isFinite(start)) seg.offset = start;
    if (Number.isFinite(dur)) seg.duration = dur;
    out.push(seg);
  }
  return out;
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, code: string) => String.fromCharCode(Number(code)));
}
