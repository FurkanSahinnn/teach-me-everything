// Phase 6.A — Research synthesis runner.
//
// Drives a chat provider through a "compare these N web sources" prompt and
// parses a structured JSON response of comparison rows + cross-cutting
// insight. Mirrors `runQuizEval` / `runFlashcardGen`: pure module, provider
// injection point for tests, never reaches the network on its own.
//
// Input is the canonical `SearchResultItem[]` produced by the 5.5.G search
// dispatcher — title + description + URL. We deliberately do NOT fetch the
// full article text here; the page-level call site decides whether to
// enrich (and pay for it) by ingesting first.

import { findChatOption } from "@/lib/ai/model-options";
import { PRICING } from "@/lib/ai/pricing";
import { getChatProvider } from "@/lib/ai/providers/registry";
import type {
  ChatProvider,
  ChatRequest,
  ProviderId,
  SystemBlock,
  Usage,
} from "@/lib/ai/providers/types";

import type { SearchResultItem } from "./search/types";

export type SynthesisInput = {
  /** Selected search results to compare. Must be in [MIN_RESULTS, MAX_RESULTS]. */
  results: SearchResultItem[];
  /** Vault-decrypted API key. Empty string only allowed for local providers. */
  apiKey: string;
  /** Stored `prefs.modelBindings.chat` value — e.g. `"anthropic::claude-sonnet-4-6"`. */
  modelId: string;
  /** Anthropic only: "oauth" routes through /api/ai/chat-oauth. */
  authKind?: "oauth" | "api-key";
  signal?: AbortSignal;
};

export type SynthesisRow = {
  /** TR axis label (e.g. "Ana yöntem"). */
  metric: string;
  /** EN axis label (e.g. "Core method"). */
  metricEn: string;
  /** Parallel to `results`; one cell per source. "—" when unknown. */
  values: string[];
};

export type SynthesisResult = {
  rows: SynthesisRow[];
  /** TR cross-cutting paragraph. */
  insight: string;
  /** EN cross-cutting paragraph. */
  insightEn: string;
  usage: Usage;
  estimatedCostUsd: number;
  /** Resolved upstream model id (usually identical to the decoded binding). */
  model: string;
};

export type SynthesisErrorCode =
  | "unknown_model"
  | "too_few_results"
  | "too_many_results"
  | "stream_error"
  | "parse_error"
  | "shape_error"
  | "aborted";

export class SynthesisError extends Error {
  readonly code: SynthesisErrorCode;
  constructor(code: SynthesisErrorCode, message: string) {
    super(message);
    this.name = "SynthesisError";
    this.code = code;
  }
}

export const MIN_RESULTS = 2;
export const MAX_RESULTS = 8;
const MAX_TOKENS = 1500;

function buildSystemText(count: number): string {
  return `You are a research analyst. You will receive ${count} web sources (title + short description + URL) and produce a side-by-side comparison.

Steps:
1. Pick 4–6 comparison axes that are genuinely informative given the topic and the sources. Common examples: core method, scope, scale, strength, limitation, evidence type, audience. Pick what fits this set of sources — do not fabricate axes the descriptions don't support.
2. For every axis, fill one cell per source as a short phrase (max 14 words). If a description doesn't address an axis, write "—" (em dash). Never invent specifics.
3. After the matrix, write a single "insight" paragraph (2–4 sentences): where the sources agree, where they diverge, and one concrete recommendation. Avoid filler and hedging.
4. Produce BOTH Turkish and English versions of every label and paragraph. Keep technical terms intact across the two languages.

Output rules (MUST follow exactly):
- Return ONLY one JSON object. No prose before or after. No code fences. No commentary.
- Use this shape exactly:
{
  "rows": [
    { "metric": "<TR axis>", "metricEn": "<EN axis>", "values": ["<cell 1>", "<cell 2>"] }
  ],
  "insight": "<TR paragraph>",
  "insightEn": "<EN paragraph>"
}
- Every "values" array MUST have exactly ${count} entries, in the same order as the sources listed in the user message.
- 4 ≤ rows.length ≤ 6.`;
}

function buildUserContent(results: SearchResultItem[]): string {
  const lines = results.map((r, i) => {
    const title = r.title.trim() || "(untitled)";
    const desc = (r.description ?? "").trim() || "(no description)";
    return `Source ${i + 1}:\n  Title: ${title}\n  URL: ${r.url}\n  Description: ${desc}`;
  });
  return `Compare the following ${results.length} sources:\n\n${lines.join("\n\n")}`;
}

/**
 * Extract the first balanced top-level JSON object from a text buffer.
 * Tolerant of leading prose ("Here is your output:"), trailing prose, and
 * inline punctuation inside string literals. Returns the JSON substring or
 * null if no balanced object is found.
 */
export function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Pure parser exported for tests. Strict shape validation — fewer ways for
 * the model to silently degrade the UX with a missing field.
 */
export function parseSynthesisOutput(
  buffer: string,
  expectedCount: number,
): { rows: SynthesisRow[]; insight: string; insightEn: string } {
  const jsonStr = extractFirstJsonObject(buffer);
  if (!jsonStr) {
    throw new SynthesisError(
      "parse_error",
      "No JSON object found in model output",
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(jsonStr);
  } catch (err) {
    throw new SynthesisError(
      "parse_error",
      err instanceof Error ? err.message : String(err),
    );
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new SynthesisError("shape_error", "Top-level value is not an object");
  }
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.rows)) {
    throw new SynthesisError("shape_error", "Field `rows` is not an array");
  }
  if (typeof obj.insight !== "string" || typeof obj.insightEn !== "string") {
    throw new SynthesisError(
      "shape_error",
      "Missing `insight` / `insightEn`",
    );
  }
  const rows: SynthesisRow[] = [];
  for (const r of obj.rows) {
    if (!r || typeof r !== "object" || Array.isArray(r)) {
      throw new SynthesisError("shape_error", "Row is not an object");
    }
    const row = r as Record<string, unknown>;
    if (
      typeof row.metric !== "string" ||
      typeof row.metricEn !== "string" ||
      !Array.isArray(row.values)
    ) {
      throw new SynthesisError("shape_error", "Row missing fields");
    }
    if (row.values.length !== expectedCount) {
      throw new SynthesisError(
        "shape_error",
        `Row "${row.metric}" has ${row.values.length} values, expected ${expectedCount}`,
      );
    }
    const values: string[] = [];
    for (const v of row.values) {
      values.push(typeof v === "string" ? v : String(v ?? "—"));
    }
    rows.push({ metric: row.metric, metricEn: row.metricEn, values });
  }
  if (rows.length === 0) {
    throw new SynthesisError("shape_error", "No rows produced");
  }
  return { rows, insight: obj.insight, insightEn: obj.insightEn };
}

function estimateSynthesisCost(model: string, usage: Usage): number {
  const p = PRICING[model];
  if (!p) return 0;
  const inputTokens = usage.input_tokens ?? 0;
  const outputTokens = usage.output_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheCreate = usage.cache_creation_input_tokens ?? 0;
  return (
    (inputTokens * p.input +
      outputTokens * p.output +
      cacheRead * p.cacheRead +
      cacheCreate * p.cacheCreation) /
    1_000_000
  );
}

export type RunSynthesisOpts = {
  /** Test injection point. Defaults to `getChatProvider`. */
  getProvider?: (
    presetId: ProviderId,
    opts?: { authKind?: "oauth" | "api-key" },
  ) => ChatProvider;
};

export async function runSynthesis(
  args: SynthesisInput,
  opts: RunSynthesisOpts = {},
): Promise<SynthesisResult> {
  if (args.results.length < MIN_RESULTS) {
    throw new SynthesisError(
      "too_few_results",
      `Need at least ${MIN_RESULTS} results, got ${args.results.length}`,
    );
  }
  if (args.results.length > MAX_RESULTS) {
    throw new SynthesisError(
      "too_many_results",
      `Got ${args.results.length} results, cap is ${MAX_RESULTS}`,
    );
  }

  const option = findChatOption(args.modelId);
  if (!option) {
    throw new SynthesisError(
      "unknown_model",
      `Model not in registry: ${args.modelId}`,
    );
  }

  const providerOpts: { authKind?: "oauth" | "api-key" } = {};
  if (args.authKind) providerOpts.authKind = args.authKind;
  const getProvider = opts.getProvider ?? getChatProvider;
  const provider = getProvider(option.presetId, providerOpts);
  const upstreamModel = option.modelId;

  const system: SystemBlock[] = [
    { type: "text", text: buildSystemText(args.results.length) },
  ];

  const request: ChatRequest = {
    apiKey: args.apiKey,
    model: upstreamModel,
    system,
    messages: [
      { role: "user", content: buildUserContent(args.results) },
    ],
    maxTokens: MAX_TOKENS,
  };
  if (args.authKind) request.authKind = args.authKind;
  if (args.signal) request.signal = args.signal;

  const handle = provider.streamChat(request);
  let buffer = "";
  let model = upstreamModel;
  let usage: Usage = {};
  try {
    for await (const event of handle.events) {
      if (event.kind === "text") {
        buffer += event.delta;
      } else if (event.kind === "start") {
        model = event.model || model;
        usage = event.usage ?? usage;
      } else if (event.kind === "delta") {
        usage = { ...usage, ...event.usage };
      } else if (event.kind === "error") {
        throw new SynthesisError(
          "stream_error",
          `Provider error ${event.status}: ${event.message}`,
        );
      } else if (event.kind === "abort") {
        throw new SynthesisError("aborted", "Synthesis aborted");
      }
    }
  } catch (err) {
    if (err instanceof SynthesisError) throw err;
    throw new SynthesisError(
      "stream_error",
      err instanceof Error ? err.message : String(err),
    );
  }

  const parsed = parseSynthesisOutput(buffer, args.results.length);
  return {
    rows: parsed.rows,
    insight: parsed.insight,
    insightEn: parsed.insightEn,
    usage,
    estimatedCostUsd: estimateSynthesisCost(model, usage),
    model,
  };
}
