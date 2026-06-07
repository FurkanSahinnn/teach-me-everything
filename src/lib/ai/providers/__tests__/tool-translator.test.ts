import { describe, expect, it } from "vitest";
import {
  buildJsonToolPrompt,
  fromProviderToolUse,
  parseJsonToolUseFromText,
  renderBlocksAsJsonProtocolText,
  toProviderTools,
  toProviderToolResult,
  toProviderToolUse,
} from "../tool-translator";
import { ProviderError } from "../types";
import type { ToolUseBlock, ToolResultBlock } from "../types";
import type { AnthropicTool } from "../../tools";

const sample: AnthropicTool = {
  name: "add_flashcard",
  description: "test",
  input_schema: {
    type: "object",
    properties: { q: { type: "string" } },
    required: ["q"],
    additionalProperties: false,
  },
};

describe("toProviderTools", () => {
  it("returns input array unchanged for anthropic (identity)", () => {
    const tools = [sample];
    const out = toProviderTools("anthropic", tools);
    expect(out).toBe(tools);
    expect(out).toEqual([sample]);
  });

  it("converts to OpenAI function shape for openai family", () => {
    const out = toProviderTools("openai", [sample]) as Array<{
      type: string;
      function: { name: string; description?: string; parameters: unknown };
    }>;
    expect(out).toHaveLength(1);
    expect(out[0]?.type).toBe("function");
    expect(out[0]?.function.name).toBe("add_flashcard");
    expect(out[0]?.function.parameters).toEqual(sample.input_schema);
  });

  it("converts to Gemini function decl (no type wrapper)", () => {
    const out = toProviderTools("google-gemini", [sample]) as Array<{
      name: string;
      description: string;
      parameters: unknown;
    }>;
    expect(out).toHaveLength(1);
    expect(out[0]).not.toHaveProperty("type");
    expect(out[0]).not.toHaveProperty("function");
    expect(out[0]?.name).toBe("add_flashcard");
    expect(out[0]?.parameters).toEqual(sample.input_schema);
  });

  it("uses OpenAI-compat shape for groq and openrouter aliases", () => {
    const groq = toProviderTools("groq", [sample]) as Array<{
      type: string;
      function: { name: string };
    }>;
    const openrouter = toProviderTools("openrouter", [sample]) as Array<{
      type: string;
      function: { name: string };
    }>;
    expect(groq[0]?.type).toBe("function");
    expect(groq[0]?.function.name).toBe("add_flashcard");
    expect(openrouter[0]?.type).toBe("function");
    expect(openrouter[0]?.function.name).toBe("add_flashcard");
  });
});

describe("toProviderToolUse", () => {
  const block: ToolUseBlock = {
    type: "tool_use",
    id: "toolu_1",
    name: "add",
    input: { q: "hi" },
  };

  it("round-trips through openai shape", () => {
    const out = toProviderToolUse("openai", block) as {
      id: string;
      type: string;
      function: { name: string; arguments: string };
    };
    expect(out).toEqual({
      id: "toolu_1",
      type: "function",
      function: { name: "add", arguments: '{"q":"hi"}' },
    });
    const back = fromProviderToolUse("openai", out);
    expect(back).toEqual({ id: "toolu_1", name: "add", input: { q: "hi" } });
  });

  it("round-trips through gemini shape with synthesized id on parse-back", () => {
    const out = toProviderToolUse("google-gemini", block) as {
      functionCall: { name: string; args: Record<string, unknown> };
    };
    expect(out).toEqual({ functionCall: { name: "add", args: { q: "hi" } } });
    const back = fromProviderToolUse("google-gemini", out);
    expect(back?.name).toBe("add");
    expect(back?.input).toEqual({ q: "hi" });
    expect(back?.id.startsWith("gemini-")).toBe(true);
  });

  it("throws ProviderError 400/invalid_tool_input for non-object input", () => {
    const bad = { ...block, input: null as unknown as Record<string, unknown> };
    try {
      toProviderToolUse("openai", bad);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderError);
      const pe = err as ProviderError;
      expect(pe.status).toBe(400);
      expect(pe.code).toBe("invalid_tool_input");
    }
  });
});

describe("toProviderToolResult", () => {
  const result: ToolResultBlock = {
    type: "tool_result",
    tool_use_id: "toolu_1",
    content: "42",
  };

  it("converts to openai tool message", () => {
    const out = toProviderToolResult("openai", result) as {
      role: string;
      tool_call_id: string;
      content: string;
    };
    expect(out).toEqual({ role: "tool", tool_call_id: "toolu_1", content: "42" });
  });

  it("prefixes content with [error] when is_error true (openai)", () => {
    const out = toProviderToolResult("openai", { ...result, is_error: true }) as {
      content: string;
    };
    expect(out.content).toBe("[error] 42");
  });

  it("converts to gemini functionResponse with provided name", () => {
    const out = toProviderToolResult("google-gemini", result, { name: "add" }) as {
      functionResponse: { name: string; response: { content: string } };
    };
    expect(out).toEqual({
      functionResponse: { name: "add", response: { content: "42" } },
    });
  });
});

describe("fromProviderToolUse openai edge cases", () => {
  it("treats empty arguments string as empty object", () => {
    const out = fromProviderToolUse("openai", {
      id: "call_x",
      type: "function",
      function: { name: "add", arguments: "" },
    });
    expect(out).toEqual({ id: "call_x", name: "add", input: {} });
  });

  it("treats null/missing arguments as empty object", () => {
    const out = fromProviderToolUse("openai", {
      id: "call_x",
      type: "function",
      function: { name: "add", arguments: null },
    });
    expect(out).toEqual({ id: "call_x", name: "add", input: {} });
  });
});

describe("fromProviderToolUse", () => {
  it("parses well-formed anthropic tool_use into canonical shape", () => {
    const raw = {
      id: "t1",
      name: "add_flashcard",
      input: { question: "Q", answer: "A" },
    };
    const out = fromProviderToolUse("anthropic", raw);
    expect(out).toEqual({
      id: "t1",
      name: "add_flashcard",
      input: { question: "Q", answer: "A" },
    });
  });

  it("returns null when raw is null (anthropic)", () => {
    expect(fromProviderToolUse("anthropic", null)).toBeNull();
  });

  it("returns null when id is not a string (anthropic)", () => {
    const raw = { id: 1, name: "x", input: {} };
    expect(fromProviderToolUse("anthropic", raw)).toBeNull();
  });

  it("returns null when input is missing (anthropic)", () => {
    const raw = { id: "t1", name: "x" };
    expect(fromProviderToolUse("anthropic", raw)).toBeNull();
  });

  it("parses OpenAI tool_call into canonical shape", () => {
    const raw = {
      id: "call_abc",
      type: "function",
      function: { name: "add_flashcard", arguments: '{"q":"hello"}' },
    };
    const out = fromProviderToolUse("openai", raw);
    expect(out).toEqual({
      id: "call_abc",
      name: "add_flashcard",
      input: { q: "hello" },
    });
  });

  it("throws ProviderError 502/tool_args_parse for malformed openai arguments", () => {
    const raw = {
      id: "call_bad",
      type: "function",
      function: { name: "x", arguments: "not-json{" },
    };
    try {
      fromProviderToolUse("openai", raw);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderError);
      const pe = err as ProviderError;
      expect(pe.status).toBe(502);
      expect(pe.code).toBe("tool_args_parse");
    }
  });
});

describe("buildJsonToolPrompt", () => {
  it("returns empty string when there are no tools", () => {
    expect(buildJsonToolPrompt([])).toBe("");
  });

  it("includes tool name, description, and required arg markers", () => {
    const out = buildJsonToolPrompt([sample]);
    expect(out).toContain("add_flashcard");
    expect(out).toContain("test"); // sample description
    expect(out).toContain("\"q\"");
    expect(out).toContain("(required)");
    // Always includes the JSON protocol envelope so the model knows the shape.
    expect(out).toContain("```json");
    expect(out).toContain("\"tool\":");
    expect(out).toContain("\"args\":");
  });

  it("does not include (required) tag for optional args", () => {
    const optionalOnly: AnthropicTool = {
      name: "noop",
      description: "no required args",
      input_schema: {
        type: "object",
        properties: { hint: { type: "string", description: "optional hint" } },
        additionalProperties: false,
      },
    };
    const out = buildJsonToolPrompt([optionalOnly]);
    expect(out).toContain("\"hint\"");
    expect(out).not.toContain("(required)");
  });
});

describe("parseJsonToolUseFromText", () => {
  it("extracts a single well-formed tool block and strips it from text", () => {
    const text =
      "Sure, adding a card now.\n\n```json\n{\"tool\": \"add_flashcard\", \"args\": {\"q\": \"hi\", \"a\": \"there\"}}\n```\n\nDone.";
    const out = parseJsonToolUseFromText(text);
    expect(out.toolUses).toHaveLength(1);
    expect(out.toolUses[0]?.name).toBe("add_flashcard");
    expect(out.toolUses[0]?.input).toEqual({ q: "hi", a: "there" });
    expect(out.toolUses[0]?.id.startsWith("json-")).toBe(true);
    expect(out.cleanText).toContain("Sure, adding a card now.");
    expect(out.cleanText).toContain("Done.");
    expect(out.cleanText).not.toContain("```json");
  });

  it("extracts multiple sequential blocks", () => {
    const text =
      "```json\n{\"tool\": \"a\", \"args\": {}}\n```\n\n```json\n{\"tool\": \"b\", \"args\": {\"x\": 1}}\n```";
    const out = parseJsonToolUseFromText(text);
    expect(out.toolUses).toHaveLength(2);
    expect(out.toolUses[0]?.name).toBe("a");
    expect(out.toolUses[1]?.name).toBe("b");
    expect(out.toolUses[1]?.input).toEqual({ x: 1 });
    expect(out.cleanText).toBe("");
  });

  it("preserves malformed JSON in cleanText (no tool extracted)", () => {
    const text = "Hmm: ```json\n{not valid json,,,}\n``` end";
    const out = parseJsonToolUseFromText(text);
    expect(out.toolUses).toHaveLength(0);
    expect(out.cleanText).toContain("```json");
    expect(out.cleanText).toContain("not valid json");
  });

  it("ignores valid JSON missing tool field", () => {
    const text = "```json\n{\"foo\": \"bar\"}\n```";
    const out = parseJsonToolUseFromText(text);
    expect(out.toolUses).toHaveLength(0);
    expect(out.cleanText).toContain("```json");
  });

  it("ignores valid JSON missing args object", () => {
    const text = "```json\n{\"tool\": \"x\", \"args\": \"not-an-object\"}\n```";
    const out = parseJsonToolUseFromText(text);
    expect(out.toolUses).toHaveLength(0);
  });

  it("returns empty toolUses and identical text when no fenced block exists", () => {
    const text = "Just a plain answer with no tool call.";
    const out = parseJsonToolUseFromText(text);
    expect(out.toolUses).toHaveLength(0);
    expect(out.cleanText).toBe(text);
  });
});

describe("renderBlocksAsJsonProtocolText", () => {
  it("renders a tool_use block as a fenced JSON block", () => {
    const out = renderBlocksAsJsonProtocolText([
      {
        type: "tool_use",
        id: "t1",
        name: "add_flashcard",
        input: { q: "hi" },
      },
    ]);
    expect(out).toContain("```json");
    expect(out).toContain("\"tool\":\"add_flashcard\"");
    expect(out).toContain("\"args\":{\"q\":\"hi\"}");
  });

  it("renders a tool_result block as a [Tool result] line", () => {
    const out = renderBlocksAsJsonProtocolText([
      { type: "tool_result", tool_use_id: "t1", content: "card #5 added" },
    ]);
    expect(out).toBe("[Tool result]: card #5 added");
  });

  it("flags errors with (error) tag", () => {
    const out = renderBlocksAsJsonProtocolText([
      { type: "tool_result", tool_use_id: "t1", content: "deck not found", is_error: true },
    ]);
    expect(out).toContain("(error)");
    expect(out).toContain("deck not found");
  });

  it("round-trips text + tool_use through parseJsonToolUseFromText", () => {
    const rendered = renderBlocksAsJsonProtocolText([
      { type: "text", text: "I will add a card." },
      {
        type: "tool_use",
        id: "ignored",
        name: "add_flashcard",
        input: { q: "Q?", a: "A!" },
      },
    ]);
    const parsed = parseJsonToolUseFromText(rendered);
    expect(parsed.toolUses).toHaveLength(1);
    expect(parsed.toolUses[0]?.name).toBe("add_flashcard");
    expect(parsed.toolUses[0]?.input).toEqual({ q: "Q?", a: "A!" });
    expect(parsed.cleanText).toBe("I will add a card.");
  });
});
