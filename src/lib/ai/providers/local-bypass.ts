// When the chat target lives on the user's own machine or LAN, the adapter
// MUST skip the Edge proxy so the prompt and response never traverse our
// infra. The detector is intentionally conservative: any URL that does not
// match a loopback/.local/RFC1918 pattern is treated as cloud and routed
// through the proxy (so we keep CORS + key-redaction guarantees on by
// default). Mistakes leak data, not break functionality.

const RFC1918_10 = /^10\.(?:\d{1,3})\.(?:\d{1,3})\.(?:\d{1,3})$/;
const RFC1918_192 = /^192\.168\.(?:\d{1,3})\.(?:\d{1,3})$/;
const RFC1918_172 = /^172\.(\d{1,3})\.(?:\d{1,3})\.(?:\d{1,3})$/;
const LOOPBACK_127 = /^127\.(?:\d{1,3})\.(?:\d{1,3})\.(?:\d{1,3})$/;

export function isLocalUrl(url: string): boolean {
  if (!url || typeof url !== "string") return false;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;

  // WHATWG URL.hostname returns IPv6 literals wrapped in brackets (e.g.
  // "[::1]"); strip them so we can compare to the canonical address form.
  let host = parsed.hostname.toLowerCase();
  if (host.startsWith("[") && host.endsWith("]")) {
    host = host.slice(1, -1);
  }
  if (!host) return false;

  if (host === "localhost") return true;
  if (host === "0.0.0.0") return true;
  if (host === "::1") return true;

  if (host.endsWith(".local")) return true;

  if (LOOPBACK_127.test(host)) return true;
  if (RFC1918_10.test(host)) return true;
  if (RFC1918_192.test(host)) return true;

  const m = host.match(RFC1918_172);
  if (m) {
    const second = Number(m[1]);
    if (second >= 16 && second <= 31) return true;
  }

  return false;
}
