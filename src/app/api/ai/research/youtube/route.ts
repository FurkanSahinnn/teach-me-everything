// YouTube transcript fetcher — uses the youtube-transcript Node package
// server-side because browser fetches of timedtext are CORS-blocked. The
// route returns transcript segments + light metadata as JSON; the client
// formats Markdown in `lib/research/youtube-fetch.ts`.

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type YoutubeTranscriptSegment = {
  text: string;
  offset?: number;
  duration?: number;
};

type YoutubeTranscriptResponse = {
  videoId: string;
  title?: string | undefined;
  channel?: string | undefined;
  transcript: YoutubeTranscriptSegment[];
  language?: string | undefined;
  error?: string;
};

function badRequest(message: string, status = 400): Response {
  return NextResponse.json({ ok: false, error: message }, { status });
}

/** 11-char base64url-safe YouTube video id. */
function isValidVideoId(s: string): boolean {
  return /^[A-Za-z0-9_-]{11}$/.test(s);
}

export async function GET(req: Request): Promise<Response> {
  const { searchParams } = new URL(req.url);
  const videoId = searchParams.get("v");
  if (!videoId) return badRequest("Missing `v` query param");
  if (!isValidVideoId(videoId)) return badRequest("Invalid YouTube video id");

  // Dynamic import — the package is sizeable and we'd rather not pull it
  // into the cold-start surface of every route.
  let mod: typeof import("youtube-transcript");
  try {
    mod = await import("youtube-transcript");
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: `youtube-transcript not installed: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 500 },
    );
  }
  const { YoutubeTranscript } = mod;

  let raw: { text: string; offset?: number; duration?: number; lang?: string }[];
  try {
    raw = await YoutubeTranscript.fetchTranscript(videoId);
  } catch (err) {
    // The package throws when a video has no public captions, or when the
    // video is age-restricted / private. Surface 404 so the client can
    // branch to the Whisper fallback (Phase 5.B+) without parsing the msg.
    const msg = err instanceof Error ? err.message : String(err);
    const isNoTranscript = /transcript|caption/i.test(msg);
    return NextResponse.json(
      {
        videoId,
        transcript: [],
        error: msg,
      } satisfies YoutubeTranscriptResponse,
      { status: isNoTranscript ? 404 : 502 },
    );
  }

  if (!Array.isArray(raw) || raw.length === 0) {
    return NextResponse.json(
      {
        videoId,
        transcript: [],
        error: "Empty transcript",
      } satisfies YoutubeTranscriptResponse,
      { status: 404 },
    );
  }

  // Best-effort language detection from the first segment's `lang` if the
  // package surfaces it; otherwise omit.
  const language =
    raw[0] && typeof raw[0].lang === "string" ? raw[0].lang : undefined;

  // Pull human-readable title + channel via YouTube's official oEmbed
  // endpoint. No API key required, free, and explicitly intended for
  // metadata embedding. Failures are non-fatal — the client already has
  // a `YouTube ${videoId}` fallback for the title, so a flaky oEmbed
  // response never blocks the transcript from landing.
  let oembedTitle: string | undefined;
  let oembedChannel: string | undefined;
  try {
    const oembedUrl =
      `https://www.youtube.com/oembed?url=` +
      encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`) +
      `&format=json`;
    const oembedRes = await fetch(oembedUrl, { method: "GET" });
    if (oembedRes.ok) {
      const oembedJson = (await oembedRes.json()) as {
        title?: string;
        author_name?: string;
      };
      if (typeof oembedJson.title === "string" && oembedJson.title.length > 0) {
        oembedTitle = oembedJson.title;
      }
      if (
        typeof oembedJson.author_name === "string" &&
        oembedJson.author_name.length > 0
      ) {
        oembedChannel = oembedJson.author_name;
      }
    }
  } catch {
    /* oEmbed best-effort — silently fall through if Google rate-limits us. */
  }

  const body: YoutubeTranscriptResponse = {
    videoId,
    transcript: raw.map((s) => {
      const seg: YoutubeTranscriptSegment = { text: decodeHtmlEntities(s.text) };
      if (typeof s.offset === "number") seg.offset = s.offset;
      if (typeof s.duration === "number") seg.duration = s.duration;
      return seg;
    }),
    language,
    ...(oembedTitle !== undefined ? { title: oembedTitle } : {}),
    ...(oembedChannel !== undefined ? { channel: oembedChannel } : {}),
  };
  return NextResponse.json(body);
}

/**
 * youtube-transcript returns HTML-encoded text (`&#39;` etc). Decode the
 * common entities so the Markdown body reads naturally.
 */
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
