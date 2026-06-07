import { ProviderError, type ProviderId } from "./types";
import type { AnthropicTool } from "../tools";
import type { ToolResultBlock, ToolUseBlock } from "./types";

// `[\s\S]` instead of `.` so newlines inside the block match; non-greedy `*?`
// so two adjacent blocks don't merge. Built fresh per call (factory) because
// /g regexes carry mutable lastIndex across .replace() invocations.
function jsonToolBlockRegex(): RegExp {
  return /```json\s*\n?([\s\S]*?)\n?```/g;
}

export type CanonicalToolUse = {
  id: string;
  name: string;
  input: Record<string, unknown>;
};

export type OpenAIToolDecl = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: AnthropicTool["input_schema"];
  };
};

export type OpenAIToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type OpenAIToolMessage = {
  role: "tool";
  tool_call_id: string;
  content: string;
};

export type GeminiFunctionDecl = {
  name: string;
  description: string;
  parameters: AnthropicTool["input_schema"];
};

export type GeminiFunctionCall = {
  functionCall: { name: string; args: Record<string, unknown> };
};

export type GeminiFunctionResponse = {
  functionResponse: {
    name: string;
    response: { content: string };
  };
};

// Identity for Anthropic (canonical shape); openai-family + gemini emit native shapes.
export function toProviderTools(
  providerId: ProviderId,
  tools: AnthropicTool[],
):
  | AnthropicTool[]
  | OpenAIToolDecl[]
  | GeminiFunctionDecl[] {
  if (providerId === "anthropic") return tools;
  if (isOpenAIFamily(providerId)) {
    return tools.map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
      },
    }));
  }
  if (providerId === "google-gemini") {
    return tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    }));
  }
  throw new ProviderError(
    501,
    "unsupported",
    `Tool translation not yet implemented for: ${providerId}`,
  );
}

export function toProviderToolUse(
  providerId: ProviderId,
  block: ToolUseBlock,
): ToolUseBlock | OpenAIToolCall | GeminiFunctionCall {
  if (block.input === null || typeof block.input !== "object") {
    throw new ProviderError(
      400,
      "invalid_tool_input",
      `tool_use.input must be an object for tool '${block.name}'`,
    );
  }
  if (providerId === "anthropic") return block;
  if (isOpenAIFamily(providerId)) {
    return {
      id: block.id,
      type: "function" as const,
      function: {
        name: block.name,
        arguments: JSON.stringify(block.input),
      },
    };
  }
  if (providerId === "google-gemini") {
    // Gemini has no tool-call id; round-trip uses synthesized ids on parse-back.
    return { functionCall: { name: block.name, args: block.input } };
  }
  throw new ProviderError(
    501,
    "unsupported",
    `Tool translation not yet implemented for: ${providerId}`,
  );
}

export function toProviderToolResult(
  providerId: ProviderId,
  block: ToolResultBlock,
  opts?: { name?: string },
): ToolResultBlock | OpenAIToolMessage | GeminiFunctionResponse {
  if (providerId === "anthropic") return block;
  if (isOpenAIFamily(providerId)) {
    return {
      role: "tool" as const,
      tool_call_id: block.tool_use_id,
      content: block.is_error ? `[error] ${block.content}` : block.content,
    };
  }
  if (providerId === "google-gemini") {
    return {
      functionResponse: {
        name: opts?.name ?? "",
        response: { content: block.content },
      },
    };
  }
  throw new ProviderError(
    501,
    "unsupported",
    `Tool translation not yet implemented for: ${providerId}`,
  );
}

export function fromProviderToolUse(
  providerId: ProviderId,
  raw: unknown,
): CanonicalToolUse | null {
  if (providerId === "anthropic") {
    if (!raw || typeof raw !== "object") return null;
    const r = raw as Record<string, unknown>;
    if (
      typeof r.id === "string" &&
      typeof r.name === "string" &&
      r.input !== null &&
      typeof r.input === "object"
    ) {
      return {
        id: r.id,
        name: r.name,
        input: r.input as Record<string, unknown>,
      };
    }
    return null;
  }
  if (isOpenAIFamily(providerId)) {
    if (!raw || typeof raw !== "object") return null;
    const r = raw as Record<string, unknown>;
    const fn = r.function as Record<string, unknown> | undefined;
    if (
      typeof r.id !== "string" ||
      !fn ||
      typeof fn.name !== "string"
    ) {
      return null;
    }
    const argsRaw = fn.arguments;
    let input: Record<string, unknown> = {};
    if (typeof argsRaw === "string" && argsRaw.length > 0) {
      try {
        const parsed: unknown = JSON.parse(argsRaw);
        if (parsed && typeof parsed === "object") {
          input = parsed as Record<string, unknown>;
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new ProviderError(
          502,
          "tool_args_parse",
          `Invalid JSON in OpenAI tool arguments for '${fn.name}': ${msg}`,
        );
      }
    }
    return { id: r.id, name: fn.name, input };
  }
  if (providerId === "google-gemini") {
    if (!raw || typeof raw !== "object") return null;
    const r = raw as Record<string, unknown>;
    const fc = r.functionCall as Record<string, unknown> | undefined;
    if (!fc || typeof fc.name !== "string") return null;
    const args = fc.args;
    const input: Record<string, unknown> =
      args && typeof args === "object" ? (args as Record<string, unknown>) : {};
    // Gemini omits ids; synthesize a stable per-call id so the canonical pair-up works.
    return { id: `gemini-${cryptoRandomId()}`, name: fc.name, input };
  }
  throw new ProviderError(
    501,
    "unsupported",
    `Tool translation not yet implemented for: ${providerId}`,
  );
}

export function fromProviderToolResult(
  providerId: ProviderId,
  raw: unknown,
): ToolResultBlock | null {
  if (providerId === "anthropic") {
    if (!raw || typeof raw !== "object") return null;
    const r = raw as Record<string, unknown>;
    if (
      typeof r.tool_use_id === "string" &&
      typeof r.content === "string"
    ) {
      return {
        type: "tool_result",
        tool_use_id: r.tool_use_id,
        content: r.content,
        ...(typeof r.is_error === "boolean" ? { is_error: r.is_error } : {}),
      };
    }
    return null;
  }
  throw new ProviderError(
    501,
    "unsupported",
    `Tool result parse not yet implemented for: ${providerId}`,
  );
}

// Builds a system-prompt suffix that teaches a tool-naive model how to invoke
// our tools by emitting JSON code blocks. Used by the openai-compat adapter
// when the active preset advertises `toolUse: "json"` (LM Studio, llama.cpp,
// many self-hosted models). English-only by design — this prompt addresses
// the model, not the user, and stable English keeps the parser regex simple.
export function buildJsonToolPrompt(tools: AnthropicTool[]): string {
  if (tools.length === 0) return "";

  const intro =
    "## Tool use (JSON protocol)\n\n" +
    "This model has no native tool-calling; instead, invoke a tool by emitting " +
    "a JSON code block in EXACTLY this format (any other format is ignored):\n\n" +
    '```json\n{"tool": "<tool_name>", "args": { ... }}\n```\n\n' +
    "Rules:\n" +
    "- Emit one JSON block per tool call. Multiple calls = multiple blocks.\n" +
    "- If you do NOT need to call a tool, emit normal prose only — never an empty block.\n" +
    '- "args" must satisfy the tool\'s schema below; unknown fields are dropped.\n' +
    "- After a tool runs you will see a `[Tool result …]` line in the next turn — react to it like normal text.\n\n" +
    "Available tools:";

  const decls = tools.map((t) => describeTool(t)).join("\n\n");
  return `${intro}\n\n${decls}`;
}

function describeTool(tool: AnthropicTool): string {
  const required = new Set(tool.input_schema.required ?? []);
  const props = Object.entries(tool.input_schema.properties).map(([key, schema]) => {
    const desc = (schema as { description?: string; type?: string }).description ?? "";
    const t = (schema as { type?: string }).type ?? "any";
    const tag = required.has(key) ? " (required)" : "";
    return `  - "${key}": ${t}${tag}${desc ? ` — ${desc}` : ""}`;
  });
  return `### ${tool.name}\n${tool.description}\n\nargs:\n${props.join("\n")}`;
}

// Walks an assistant text response, pulls every well-formed `json` tool block
// out into canonical ToolUseBlocks, and returns the remaining prose. Malformed
// blocks (invalid JSON, missing `tool`, missing `args`) stay in cleanText so
// the user sees what the model actually said instead of silent truncation.
export function parseJsonToolUseFromText(text: string): {
  cleanText: string;
  toolUses: ToolUseBlock[];
} {
  const toolUses: ToolUseBlock[] = [];
  const cleanText = text.replace(jsonToolBlockRegex(), (match, raw: string) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.trim());
    } catch {
      return match; // keep ill-formed JSON visible to the user
    }
    if (!parsed || typeof parsed !== "object") return match;
    const obj = parsed as Record<string, unknown>;
    if (typeof obj.tool !== "string" || obj.tool.length === 0) return match;
    if (!obj.args || typeof obj.args !== "object") return match;
    toolUses.push({
      type: "tool_use",
      id: `json-${cryptoRandomId()}`,
      name: obj.tool,
      input: obj.args as Record<string, unknown>,
    });
    return ""; // strip the block out of the visible text
  });
  // Collapse the double newlines we leave behind when a block is removed.
  return { cleanText: cleanText.replace(/\n{3,}/g, "\n\n").trim(), toolUses };
}

// Renders a canonical ChatMessage block list as a single plain-text payload
// suitable for a model that does not understand tool_use / tool_result roles.
// Tool calls are echoed back as JSON blocks (so the conversation transcript
// stays parseable on a re-read); tool results are folded into a labelled line
// the model can react to in plain prose.
export function renderBlocksAsJsonProtocolText(
  blocks: ReadonlyArray<{
    type: "text" | "tool_use" | "tool_result";
    text?: string;
    id?: string;
    name?: string;
    input?: Record<string, unknown>;
    tool_use_id?: string;
    content?: string;
    is_error?: boolean;
  }>,
): string {
  const parts: string[] = [];
  for (const block of blocks) {
    if (block.type === "text" && typeof block.text === "string") {
      parts.push(block.text);
    } else if (block.type === "tool_use" && block.name && block.input) {
      const json = JSON.stringify({ tool: block.name, args: block.input });
      parts.push("```json\n" + json + "\n```");
    } else if (block.type === "tool_result" && typeof block.content === "string") {
      const tag = block.is_error ? " (error)" : "";
      parts.push(`[Tool result${tag}]: ${block.content}`);
    }
  }
  return parts.join("\n\n");
}

function isOpenAIFamily(id: ProviderId): boolean {
  // OpenAI-compatible family: native + every cloud preset using OpenAI tool-calling.
  return (
    id === "openai" ||
    id === "openrouter" ||
    id === "groq" ||
    id === "deepseek" ||
    id === "glm" ||
    id === "xai" ||
    id === "mistral" ||
    id === "together" ||
    id === "cerebras" ||
    id === "perplexity" ||
    (typeof id === "string" && id.startsWith("custom:"))
  );
}

function cryptoRandomId(): string {
  const g = (globalThis as { crypto?: Crypto }).crypto;
  if (g && typeof g.randomUUID === "function") return g.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
