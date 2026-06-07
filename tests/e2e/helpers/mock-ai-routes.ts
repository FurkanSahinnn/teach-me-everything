import type { Page, Request, Route } from "@playwright/test";

// We mock at the HTTP boundary (`/api/ai/embed` + `/api/ai/chat`) instead of
// stubbing the provider classes directly. Mocking at the provider level would
// skip the most fragile parsing code in the entire stack: the SSE event
// reader in src/lib/ai/providers/anthropic.ts, the citation regex in
// CitationChip.tsx, the embed worker batching in src/lib/ingest/embed.ts.
// Those are the regression risks the happy-path test is supposed to catch.

export type MockChatOptions = {
  textChunks?: string[];
  inputTokens?: number;
  outputTokens?: number;
  model?: string;
};

export type MockEmbedOptions = {
  dim?: number;
};

// Lets a single chat-route mock branch by request shape so curriculum,
// lesson-note, study-journal, and notebook-chat envelopes can all coexist
// in one test without each helper duplicating SSE plumbing. The first
// responder whose `match` returns true wins; falling through to the
// default keeps the simple "one stream of plain text" behavior unchanged.
export type ChatRequestBody = {
  system?: unknown;
  messages?: unknown;
  tools?: unknown;
};

export type ChatResponder = {
  label: string;
  match: (body: ChatRequestBody) => boolean;
  textChunks: string[];
  inputTokens?: number;
  outputTokens?: number;
};

export type AiMocks = {
  chatHits: () => number;
  embedHits: () => number;
  responderHits: (label: string) => number;
};

const DEFAULT_TEXT_CHUNKS = [
  "This document is about quantum mechanics ",
  "[§ref:test-chunk-1].",
];
const DEFAULT_DIM = 1536;
const DEFAULT_MODEL = "claude-sonnet-4-6";
const DEFAULT_INPUT_TOKENS = 120;
const DEFAULT_OUTPUT_TOKENS = 18;

function deterministicEmbedding(dim: number, seed: number): number[] {
  // Non-uniform vector so cosine similarity in the retrieval path doesn't
  // degenerate to NaN/0. Exact values are arbitrary; what matters is that
  // distinct inputs receive distinct vectors with non-zero variance.
  const out = new Array<number>(dim);
  for (let i = 0; i < dim; i++) {
    out[i] = Math.sin(i + seed * 0.31);
  }
  return out;
}

function sseEvent(name: string, data: unknown): string {
  return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function installAiMocks(
  page: Page,
  opts?: {
    chat?: MockChatOptions;
    embed?: MockEmbedOptions;
    chatResponders?: ChatResponder[];
  },
): Promise<AiMocks> {
  let chatHits = 0;
  let embedHits = 0;
  const responderHitCounts: Record<string, number> = {};

  const embedDim = opts?.embed?.dim ?? DEFAULT_DIM;
  const chatChunks = opts?.chat?.textChunks ?? DEFAULT_TEXT_CHUNKS;
  const chatModel = opts?.chat?.model ?? DEFAULT_MODEL;
  const inputTokens = opts?.chat?.inputTokens ?? DEFAULT_INPUT_TOKENS;
  const outputTokens = opts?.chat?.outputTokens ?? DEFAULT_OUTPUT_TOKENS;
  const responders = opts?.chatResponders ?? [];

  await page.route("**/api/ai/embed", async (route: Route, req: Request) => {
    embedHits += 1;
    let inputs: string[] = [];
    try {
      const body = req.postDataJSON() as { input?: unknown };
      if (Array.isArray(body.input)) {
        inputs = body.input.map((v) => String(v));
      } else if (typeof body.input === "string") {
        inputs = [body.input];
      }
    } catch {
      inputs = [""];
    }
    if (inputs.length === 0) inputs = [""];
    const data = inputs.map((_, i) => ({
      embedding: deterministicEmbedding(embedDim, i),
    }));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data }),
    });
  });

  await page.route("**/api/ai/chat", async (route: Route, req: Request) => {
    chatHits += 1;

    let parsedBody: ChatRequestBody = {};
    try {
      parsedBody = (req.postDataJSON() ?? {}) as ChatRequestBody;
    } catch {
      parsedBody = {};
    }

    const matched = responders.find((r) => {
      try {
        return r.match(parsedBody);
      } catch {
        return false;
      }
    });

    const textChunks = matched?.textChunks ?? chatChunks;
    const inTokens = matched?.inputTokens ?? inputTokens;
    const outTokens = matched?.outputTokens ?? outputTokens;
    if (matched) {
      responderHitCounts[matched.label] =
        (responderHitCounts[matched.label] ?? 0) + 1;
    }

    const events: string[] = [];

    events.push(
      sseEvent("message_start", {
        type: "message_start",
        message: {
          id: "msg_e2e",
          type: "message",
          role: "assistant",
          model: chatModel,
          content: [],
          usage: { input_tokens: 0, output_tokens: 0 },
        },
      }),
    );
    events.push(
      sseEvent("content_block_start", {
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "" },
      }),
    );
    for (const chunk of textChunks) {
      events.push(
        sseEvent("content_block_delta", {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: chunk },
        }),
      );
    }
    events.push(
      sseEvent("content_block_stop", { type: "content_block_stop", index: 0 }),
    );
    events.push(
      sseEvent("message_delta", {
        type: "message_delta",
        delta: { stop_reason: "end_turn" },
        usage: { input_tokens: inTokens, output_tokens: outTokens },
      }),
    );
    events.push(sseEvent("message_stop", { type: "message_stop" }));

    await route.fulfill({
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
      },
      body: events.join(""),
    });
  });

  return {
    chatHits: () => chatHits,
    embedHits: () => embedHits,
    responderHits: (label: string) => responderHitCounts[label] ?? 0,
  };
}

// Splits a long JSON string into ~N pieces so the SSE stream looks more
// like a real model emitting tokens. The Anthropic parser concatenates
// text_delta payloads back into one string before we hand it off to the
// curriculum / lesson-note JSON parser, so the chunk boundaries don't
// have to fall on syntax-significant characters.
export function chunkifyText(text: string, pieces = 6): string[] {
  if (pieces <= 1 || text.length <= pieces) return [text];
  const size = Math.ceil(text.length / pieces);
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) {
    out.push(text.slice(i, i + size));
  }
  return out;
}

// System-prompt fingerprints for runner branching. The curriculum prompt
// includes the literal string `"items": [` in its JSON schema; the
// lesson-note prompt uses `"contentMarkdown"`. Matching on those keeps
// us decoupled from the prose around them, which the project edits often.
//
// We extract the raw text out of the system blocks before substring
// matching — JSON.stringify on the whole array escapes inner quotes
// (`"items":` → `\"items\":`), which silently breaks the match.
function extractSystemText(body: ChatRequestBody): string {
  const sys = body.system;
  if (Array.isArray(sys)) {
    return sys
      .map((b) => {
        if (b && typeof b === "object" && "text" in b) {
          const t = (b as { text?: unknown }).text;
          return typeof t === "string" ? t : "";
        }
        return "";
      })
      .join("\n");
  }
  if (typeof sys === "string") return sys;
  return "";
}

export function isCurriculumRequest(body: ChatRequestBody): boolean {
  return extractSystemText(body).includes('"items":');
}

export function isLessonNoteRequest(body: ChatRequestBody): boolean {
  return extractSystemText(body).includes('"contentMarkdown"');
}

// The podcast-script prompt always includes the schema fragment
// `"segments":` (a key that doesn't appear in the curriculum,
// lesson-note, or study-journal envelopes). Matching on that raw
// substring stays decoupled from the prose around it, which the
// project edits often.
export function isPodcastScriptRequest(body: ChatRequestBody): boolean {
  return extractSystemText(body).includes('"segments":');
}
