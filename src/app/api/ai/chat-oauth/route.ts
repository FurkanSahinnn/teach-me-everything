import { createSdkMcpServer, query, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Anthropic system block we accept on the wire — same shape as /api/ai/chat.
type SystemBlock =
  | { type: "text"; text: string; cache_control?: unknown }
  | string;

type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: unknown };

type ChatMessage = {
  role: "user" | "assistant";
  content: string | ContentBlock[];
};

type ProxyBody = {
  model?: unknown;
  system?: unknown;
  messages?: unknown;
  max_tokens?: unknown;
  // Optional override — when present, SDK uses this binary instead of its
  // bundled native deps. Lets the user point at their own `claude` install.
  pathToClaudeCodeExecutable?: unknown;
};

const MCP_SERVER_NAME = "tme";
const MCP_PREFIX = `mcp__${MCP_SERVER_NAME}__`;

// Built-in Claude Code tools we always disable: this is a notebook chat, not
// a coding session, so file/shell tools have no business firing.
const DISALLOWED_BUILTINS = [
  "Read",
  "Write",
  "Edit",
  "Bash",
  "Grep",
  "Glob",
  "Task",
  "WebFetch",
  "WebSearch",
  "TodoWrite",
  "NotebookEdit",
] as const;

function jsonError(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ ok: false, code, error: message }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function flattenSystem(blocks: SystemBlock[]): string {
  return blocks
    .map((b) => (typeof b === "string" ? b : b.type === "text" ? b.text : ""))
    .filter((s) => s.length > 0)
    .join("\n\n");
}

function stringifyContent(content: ChatMessage["content"]): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((b) => {
      if (b.type === "text") return b.text;
      if (b.type === "tool_use")
        return `[tool call: ${b.name}(${JSON.stringify(b.input)})]`;
      if (b.type === "tool_result") {
        const c =
          typeof b.content === "string" ? b.content : JSON.stringify(b.content);
        return `[tool result: ${c}]`;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function buildPrompt(messages: ChatMessage[]): {
  prompt: string;
  ok: boolean;
} {
  if (messages.length === 0) return { prompt: "", ok: false };
  const last = messages[messages.length - 1];
  if (!last || last.role !== "user") return { prompt: "", ok: false };

  const history = messages.slice(0, -1);
  const currentText = stringifyContent(last.content);
  if (history.length === 0) return { prompt: currentText, ok: true };

  const transcript = history
    .map((m) => {
      const tag = m.role === "user" ? "User" : "Assistant";
      return `${tag}: ${stringifyContent(m.content)}`;
    })
    .join("\n\n");

  const prompt = `Previous conversation in this thread:\n\n${transcript}\n\n---\n\nCurrent user message:\n\n${currentText}`;
  return { prompt, ok: true };
}

// Stub MCP server — handlers always succeed. The actual side effects
// (Dexie write, citation jump, etc.) run on the client when it sees the
// `tool_start`/`tool_input_delta`/`tool_stop` SSE events propagated below.
function buildToolsServer() {
  return createSdkMcpServer({
    name: MCP_SERVER_NAME,
    tools: [
      tool(
        "add_flashcard",
        "Add a flashcard (question/answer pair) to the user's deck for this source. Use when the model identifies a memorable fact worth reviewing later.",
        // Arg shape MUST match buildNotebookTools() in lib/ai/tools.ts — the
        // client handler reads sourceSection/sourceChunkId, so a divergent
        // tags/chunkIndex schema here silently drops those fields.
        {
          question: z.string(),
          answer: z.string(),
          sourceSection: z.string().optional(),
          sourceChunkId: z.string().optional(),
        },
        async () => ({
          content: [
            {
              type: "text",
              text: JSON.stringify({
                ok: true,
                queued: true,
                note: "Client will persist this flashcard.",
              }),
            },
          ],
        }),
      ),
      tool(
        "open_citation",
        "Highlight a passage in the source viewer. Use when the user wants to be shown where a claim came from.",
        { sectionRef: z.string() },
        async () => ({
          content: [
            {
              type: "text",
              text: JSON.stringify({ ok: true, note: "Client will scroll." }),
            },
          ],
        }),
      ),
      tool(
        "simplify_explanation",
        "Re-explain a concept in plainer language. Use when the user signals they did not follow the previous answer.",
        { reason: z.string().optional() },
        async () => ({
          content: [
            {
              type: "text",
              text: JSON.stringify({ ok: true, queued: true }),
            },
          ],
        }),
      ),
    ],
  });
}

export async function POST(req: Request): Promise<Response> {
  const auth = req.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(auth);
  const token = match?.[1]?.trim();
  if (!token) return jsonError(401, "missing_key", "OAuth token gerekli.");

  let body: ProxyBody;
  try {
    body = (await req.json()) as ProxyBody;
  } catch {
    return jsonError(400, "invalid_body", "Geçersiz JSON gövdesi.");
  }

  if (typeof body.model !== "string" || body.model.length === 0) {
    return jsonError(400, "invalid_shape", "model alanı eksik.");
  }
  if (!Array.isArray(body.system) || !Array.isArray(body.messages)) {
    return jsonError(400, "invalid_shape", "system/messages eksik.");
  }

  const model = body.model;
  const systemPrompt = flattenSystem(body.system as SystemBlock[]);
  const { prompt, ok } = buildPrompt(body.messages as ChatMessage[]);
  if (!ok) {
    return jsonError(
      400,
      "invalid_messages",
      "Son mesaj kullanıcı turu olmalı.",
    );
  }

  const ac = new AbortController();
  const tmeServer = buildToolsServer();

  const allowedTools = [
    `${MCP_PREFIX}add_flashcard`,
    `${MCP_PREFIX}open_citation`,
    `${MCP_PREFIX}simplify_explanation`,
  ];

  const env: Record<string, string | undefined> = {
    ...process.env,
    CLAUDE_CODE_OAUTH_TOKEN: token,
  };
  // Defense in depth: if the user also has ANTHROPIC_API_KEY in their shell,
  // the SDK might prefer it. Force OAuth by clearing it for this child only.
  delete env.ANTHROPIC_API_KEY;

  const queryHandle = query({
    prompt,
    options: {
      abortController: ac,
      systemPrompt,
      model,
      env,
      mcpServers: { [MCP_SERVER_NAME]: tmeServer },
      allowedTools,
      disallowedTools: [...DISALLOWED_BUILTINS],
      includePartialMessages: true,
      persistSession: false,
      maxTurns: 5,
      ...(typeof body.pathToClaudeCodeExecutable === "string"
        ? { pathToClaudeCodeExecutable: body.pathToClaudeCodeExecutable }
        : {}),
    },
  });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder();
      const writeFrame = (eventName: string, data: unknown): void => {
        const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(enc.encode(payload));
      };

      try {
        for await (const msg of queryHandle) {
          if (msg.type === "stream_event") {
            const ev = msg.event as
              | {
                  type: "message_start";
                  message?: { model?: string; usage?: unknown };
                }
              | {
                  type: "content_block_start";
                  index?: number;
                  content_block?: {
                    type?: string;
                    id?: string;
                    name?: string;
                  };
                }
              | {
                  type: "content_block_delta";
                  index?: number;
                  delta?: {
                    type?: string;
                    text?: string;
                    partial_json?: string;
                  };
                }
              | { type: "content_block_stop"; index?: number }
              | {
                  type: "message_delta";
                  delta?: { stop_reason?: string | null };
                  usage?: unknown;
                }
              | { type: "message_stop" }
              | { type: "ping" };

            // Strip the `mcp__tme__` prefix from tool_use block names so the
            // client tool loop sees the same names as the API-key path.
            if (
              ev.type === "content_block_start" &&
              ev.content_block?.type === "tool_use" &&
              typeof ev.content_block.name === "string" &&
              ev.content_block.name.startsWith(MCP_PREFIX)
            ) {
              const renamed = {
                ...ev,
                content_block: {
                  ...ev.content_block,
                  name: ev.content_block.name.slice(MCP_PREFIX.length),
                },
              };
              writeFrame(ev.type, renamed);
              continue;
            }

            writeFrame(ev.type, ev);
          } else if (msg.type === "result") {
            // SDK fires `result` after the SSE stream has already closed
            // upstream (usage is also baked into the last message_delta).
            // Surface it as an out-of-band event so cost UI can pick it up
            // if it ever needs the SDK-aggregated numbers.
            const r = msg as {
              subtype: "success" | "error_max_turns" | "error_during_execution";
              total_cost_usd?: number;
              usage?: unknown;
              is_error?: boolean;
              api_error_status?: number | null;
            };
            writeFrame("tme_sdk_result", {
              subtype: r.subtype,
              total_cost_usd: r.total_cost_usd ?? null,
              usage: r.usage ?? null,
              is_error: r.is_error ?? false,
              api_error_status: r.api_error_status ?? null,
            });
            if (r.is_error && r.subtype !== "success") {
              writeFrame("error", {
                type: "error",
                error: {
                  message:
                    r.subtype === "error_max_turns"
                      ? "SDK max turns reached."
                      : "SDK execution error.",
                },
              });
            }
          }
          // Other SDK message kinds (system init, status, retry, etc.) are
          // intentionally dropped — the existing client SSE consumer only
          // understands the Anthropic event vocabulary above.
        }
        controller.close();
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "SDK query failed.";
        // Friendly error for missing CLI binary.
        const friendly = /ENOENT|spawn.*claude|not found/i.test(message)
          ? "Claude Code CLI bulunamadı. `claude` PATH'inde olmalı veya pathToClaudeCodeExecutable belirt."
          : message;
        writeFrame("error", {
          type: "error",
          error: { message: friendly },
        });
        controller.close();
      }
    },
    cancel() {
      ac.abort();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
}
