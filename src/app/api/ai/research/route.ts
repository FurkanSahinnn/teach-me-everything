// Generic CORS-bypass proxy for the readability research provider.
// Client fetches `/api/ai/research?url=...` when the upstream blocks
// cross-origin reads with credentials omitted; the route streams back the
// HTML with the same status + content-type.
//
// SSRF defenses:
//   - Only http(s) URLs accepted.
//   - Reject private / loopback / link-local hosts.
//   - Cookies + Authorization headers never forwarded.
//   - Response body capped at MAX_BYTES so a 100MB page can't OOM the proxy.

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB — plenty for a readable article

function badRequest(message: string, status = 400): Response {
  return NextResponse.json({ ok: false, error: message }, { status });
}

function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h === "localhost.") return true;
  if (h.endsWith(".local") || h.endsWith(".localhost")) return true;
  // IPv4 dotted-quad fast path
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (m) {
    const oct1 = Number(m[1]);
    const oct2 = Number(m[2]);
    const oct3 = Number(m[3]);
    if (oct1 === 10) return true;
    if (oct1 === 127) return true;
    if (oct1 === 169 && oct2 === 254) return true; // link-local (incl. cloud metadata 169.254.169.254)
    if (oct1 === 172 && oct2 >= 16 && oct2 <= 31) return true;
    if (oct1 === 192 && oct2 === 168) return true;
    if (oct1 === 192 && oct2 === 0 && oct3 === 0) return true; // 192.0.0.0/24 IANA special-use
    if (oct1 === 100 && oct2 >= 64 && oct2 <= 127) return true; // 100.64.0.0/10 CGNAT
    if (oct1 === 0) return true;
    return false;
  }
  // IPv6 — block ::1 and fe80::/10 link-local. Real production deployments
  // should pin DNS to public resolvers; this is the cheap web-server gate.
  if (h === "::1" || h.startsWith("[::1]")) return true;
  if (h.startsWith("fe80:") || h.startsWith("[fe80:")) return true;
  return false;
}

class BlockedRedirectError extends Error {}

// Follow redirects manually so each Location hop is re-validated against
// isPrivateHost. `redirect: "follow"` would let a public URL 302 to
// http://169.254.169.254/ (cloud metadata) or localhost without any recheck,
// defeating the front-door SSRF guard.
async function fetchWithGuardedRedirects(startUrl: URL): Promise<Response> {
  const MAX_HOPS = 5;
  let current = startUrl;
  for (let hop = 0; ; hop += 1) {
    const res = await fetch(current.toString(), {
      method: "GET",
      redirect: "manual",
      headers: {
        Accept: "text/html,application/xhtml+xml,text/plain;q=0.9",
        // Use a generic UA — some CDNs reject empty UA. Keep it neutral so
        // the proxy doesn't impersonate a browser session.
        "User-Agent": "Mozilla/5.0 (compatible; TeachMeEverythingBot/0.1)",
      },
    });
    const isRedirect =
      res.status >= 300 && res.status < 400 && res.headers.has("location");
    if (!isRedirect) return res;
    // Drain/cancel the redirect response body before hopping.
    res.body?.cancel()?.catch(() => {});
    if (hop >= MAX_HOPS) throw new BlockedRedirectError("Too many redirects");
    const loc = res.headers.get("location") ?? "";
    let next: URL;
    try {
      next = new URL(loc, current);
    } catch {
      throw new BlockedRedirectError("Malformed redirect location");
    }
    if (next.protocol !== "http:" && next.protocol !== "https:") {
      throw new BlockedRedirectError("Redirect to non-http(s) blocked");
    }
    if (isPrivateHost(next.hostname)) {
      throw new BlockedRedirectError("Redirect to private/loopback host blocked");
    }
    current = next;
  }
}

export async function GET(req: Request): Promise<Response> {
  const { searchParams } = new URL(req.url);
  const target = searchParams.get("url");
  if (!target) return badRequest("Missing `url` query param");

  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return badRequest("Malformed `url`");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return badRequest("Only http(s) URLs are allowed");
  }
  if (isPrivateHost(parsed.hostname)) {
    return badRequest("Refusing to proxy private/loopback hosts", 403);
  }

  let upstream: Response;
  try {
    upstream = await fetchWithGuardedRedirects(parsed);
  } catch (err) {
    if (err instanceof BlockedRedirectError) {
      return badRequest(err.message, 403);
    }
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Upstream fetch failed",
      },
      { status: 502 },
    );
  }

  const contentType = upstream.headers.get("content-type") ?? "text/html";
  if (!upstream.body) {
    const text = await upstream.text();
    return new NextResponse(text.slice(0, MAX_BYTES), {
      status: upstream.status,
      headers: { "content-type": contentType },
    });
  }

  // Stream the body but enforce MAX_BYTES so a giant page can't blow up RAM.
  const reader = upstream.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      received += value.byteLength;
      if (received > MAX_BYTES) {
        reader.cancel().catch(() => {});
        break;
      }
      chunks.push(value);
    }
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Stream read failed",
      },
      { status: 502 },
    );
  }

  // Concatenate manually — small N + already bounded by MAX_BYTES.
  const total = chunks.reduce((sum, c) => sum + c.byteLength, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }
  return new NextResponse(merged, {
    status: upstream.status,
    headers: { "content-type": contentType },
  });
}
