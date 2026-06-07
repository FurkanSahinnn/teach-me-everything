// Pure builder for Anthropic OAuth chat. In web mode the request is
// routed through `/api/ai/chat-oauth`, which fronts
// `@anthropic-ai/claude-agent-sdk` server-side with the Claude Code OAuth
// token. In Tauri mode the SDK isn't available client-side, but the OAuth
// token is just a bearer-style credential against the public Anthropic
// API, so we call `/v1/messages` directly with the `oauth-2025-04-20`
// beta flag. Tool-side execution (web search etc.) collapses to the
// native Anthropic tool round-trip — same wire shape `consumeAnthropicStream`
// already parses.

const ANTHROPIC_VERSION = "2023-06-01";
const ANTHROPIC_OAUTH_BETA = "oauth-2025-04-20";
// Anthropic gates every direct-HTTP OAuth bearer call ("CORS request" in
// their wording) behind this opt-in header. Without it Anthropic returns
// 401 with the literal message "CORS requests must set 'anthropic-
// dangerous-direct-browser-access' header". Sending it does NOT bypass
// the org-level "Direct browser access" toggle — users on Claude Code
// plans where that toggle is off still see a 401, but with the more
// specific "org settings" wording. (Web build skips this entirely; the
// agent-SDK proxy at /api/ai/chat-oauth spawns the `claude` CLI which
// has its own auth surface and never trips this gate.)
const ANTHROPIC_DIRECT_BROWSER_ACCESS_HEADER =
  "anthropic-dangerous-direct-browser-access";

export type OAuthChatProxyBody = {
  model?: string;
  system?: unknown;
  messages?: unknown;
  max_tokens?: number;
  tools?: unknown;
  tool_choice?: unknown;
};

export type OAuthUpstreamRequest = {
  url: string;
  headers: Record<string, string>;
  body: string;
};

export type OAuthUpstreamError = {
  code: "invalid_shape" | "missing_key";
  message: string;
};

export type OAuthUpstreamResult =
  | { ok: true; request: OAuthUpstreamRequest }
  | { ok: false; error: OAuthUpstreamError };

export function buildOAuthChatUpstream(
  body: OAuthChatProxyBody,
  oauthToken: string,
): OAuthUpstreamResult {
  if (!oauthToken || oauthToken.length === 0) {
    return { ok: false, error: { code: "missing_key", message: "OAuth token gerekli." } };
  }
  if (typeof body.model !== "string" || body.model.length === 0) {
    return { ok: false, error: { code: "invalid_shape", message: "model alanı eksik." } };
  }
  if (!Array.isArray(body.system) || !Array.isArray(body.messages)) {
    return { ok: false, error: { code: "invalid_shape", message: "system/messages eksik." } };
  }

  const upstreamBody: Record<string, unknown> = {
    model: body.model,
    max_tokens: typeof body.max_tokens === "number" ? body.max_tokens : 1024,
    stream: true,
    system: body.system,
    messages: body.messages,
    ...(Array.isArray(body.tools) && body.tools.length > 0 ? { tools: body.tools } : {}),
    ...(body.tool_choice && typeof body.tool_choice === "object"
      ? { tool_choice: body.tool_choice }
      : {}),
  };

  return {
    ok: true,
    request: {
      url: "https://api.anthropic.com/v1/messages",
      headers: {
        "content-type": "application/json",
        "anthropic-version": ANTHROPIC_VERSION,
        "anthropic-beta": ANTHROPIC_OAUTH_BETA,
        [ANTHROPIC_DIRECT_BROWSER_ACCESS_HEADER]: "true",
        authorization: `Bearer ${oauthToken}`,
      },
      body: JSON.stringify(upstreamBody),
    },
  };
}
