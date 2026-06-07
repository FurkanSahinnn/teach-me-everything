// Per-node "Generate lesson" — produces a self-contained study lesson as
// Markdown for a roadmap node. Unlike the curriculum lesson-note generator
// (which is bound to a curriculumItemId and hard-fails without matching
// sources), this works with OR without workspace sources: it grounds in
// retrieved excerpts when present, otherwise writes from general knowledge.
// Output is plain Markdown saved as a Note, so the lesson is editable,
// chat-able and embeddable like any other note.

import { findChatOption } from "@/lib/ai/model-options";
import { PRICING } from "@/lib/ai/pricing";
import { getChatProvider } from "@/lib/ai/providers/registry";
import type {
  ChatRequest,
  SystemBlock,
  Usage,
} from "@/lib/ai/providers/types";

export class RoadmapLessonError extends Error {
  constructor(
    public readonly code:
      | "unknown_model"
      | "stream_error"
      | "aborted"
      | "empty_response",
    message: string,
  ) {
    super(message);
    this.name = "RoadmapLessonError";
  }
}

export type RunRoadmapLessonArgs = {
  topic: string;
  description: string;
  roadmapTitle: string;
  level: string;
  locale: "tr" | "en";
  /** Optional grounding — concatenated source excerpts. Empty/undefined ⇒
   *  the lesson is written from the model's general knowledge. */
  sourceExcerpts?: string | undefined;
  modelId: string;
  apiKey: string;
  authKind?: "oauth" | "api-key" | undefined;
  signal?: AbortSignal | undefined;
};

export type RunRoadmapLessonResult = {
  /** Lesson body (`##` sections, no top-level H1 — the caller prepends one
   *  via composeLessonNote so the note title stays canonical). */
  body: string;
  usage: Usage;
  estimatedCostUsd: number;
  model: string;
};

function estimateCost(model: string, usage: Usage): number {
  const p = PRICING[model];
  if (!p) return 0;
  return (
    ((usage.input_tokens ?? 0) * p.input +
      (usage.output_tokens ?? 0) * p.output +
      (usage.cache_read_input_tokens ?? 0) * p.cacheRead +
      (usage.cache_creation_input_tokens ?? 0) * p.cacheCreation) /
    1_000_000
  );
}

function buildSystem(locale: "tr" | "en"): SystemBlock[] {
  const text =
    locale === "tr"
      ? [
          "Rol: Net, iyi yapılandırılmış çalışma dersleri yazan bir öğretmensin.",
          "Görev: Verilen konu için özlü bir Markdown ders yaz.",
          "Kurallar:",
          "- ÜST düzey `#` başlık KULLANMA — doğrudan `##` bölümlerle başla. (Başlığı sistem ekleyecek.)",
          "- Şu bölümleri kullan: Genel bakış, Temel fikirler, Örnek(ler), Sık yapılan hatalar, Özet / hızlı tekrar.",
          "- Kısa tut: toplam ~250-500 kelime. Madde işaretleri ve kısa paragraflar tercih et.",
          "- Kaynak alıntıları verilmişse derinliği onlara dayandır; yoksa genel bilgiyle yaz.",
          "- SADECE Markdown döndür. Kod bloğu çiti (```), JSON veya ek açıklama ekleme.",
        ].join("\n")
      : [
          "Role: You are a tutor who writes clear, well-structured study lessons.",
          "Task: Write a concise Markdown lesson for the given topic.",
          "Rules:",
          "- Do NOT include a top-level `#` heading — start directly with `##` sections. (The title is added by the system.)",
          "- Use these sections: Overview, Key ideas, Example(s), Common pitfalls, Recap / quick review.",
          "- Keep it tight: ~250-500 words total. Prefer bullet points and short paragraphs.",
          "- If source excerpts are provided, ground the depth in them; otherwise write from general knowledge.",
          "- Output Markdown ONLY. No code-fence wrapper (```), no JSON, no commentary.",
        ].join("\n");
  return [{ type: "text", text }];
}

function buildUser(args: RunRoadmapLessonArgs): string {
  const lines = [
    `Topic: ${args.topic}`,
    `Context: part of the roadmap "${args.roadmapTitle}" (level: ${args.level}).`,
  ];
  if (args.description.trim()) lines.push(`What the learner gains: ${args.description}`);
  if (args.sourceExcerpts && args.sourceExcerpts.trim()) {
    lines.push("", "Source excerpts to ground the lesson:", args.sourceExcerpts);
  }
  lines.push(
    "",
    args.locale === "tr"
      ? "Yukarıdaki konu için dersi yaz."
      : "Write the lesson for the topic above.",
  );
  return lines.join("\n");
}

// Strip a wrapping code fence and any leading H1 the model emitted, then
// prepend the canonical title so the note's H1 (and thus its derived title)
// always matches the roadmap node. Pure — unit-tested.
export function composeLessonNote(title: string, body: string): string {
  let b = body.trim();
  if (b.startsWith("```")) {
    b = b
      .replace(/^```(?:markdown|md)?\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();
  }
  // Drop a leading H1 (model occasionally adds one despite instructions).
  b = b.replace(/^#\s+[^\n]*\n+/, "");
  return `# ${title}\n\n${b}`.trim() + "\n";
}

export async function runRoadmapLesson(
  args: RunRoadmapLessonArgs,
): Promise<RunRoadmapLessonResult> {
  const option = findChatOption(args.modelId);
  if (!option) {
    throw new RoadmapLessonError(
      "unknown_model",
      `Model not in registry: ${args.modelId}`,
    );
  }
  const provider = getChatProvider(option.presetId, {
    ...(args.authKind ? { authKind: args.authKind } : {}),
  });
  const request: ChatRequest = {
    apiKey: args.apiKey,
    ...(args.authKind ? { authKind: args.authKind } : {}),
    model: option.modelId,
    system: buildSystem(args.locale),
    messages: [{ role: "user", content: buildUser(args) }],
    maxTokens: 1400,
    ...(args.signal ? { signal: args.signal } : {}),
  };

  const handle = provider.streamChat(request);
  let buffer = "";
  let model = option.modelId;
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
        throw new RoadmapLessonError(
          "stream_error",
          `Provider error ${event.status}: ${event.message}`,
        );
      } else if (event.kind === "abort") {
        throw new RoadmapLessonError("aborted", "Lesson generation aborted");
      }
    }
  } catch (err) {
    if (err instanceof RoadmapLessonError) throw err;
    throw new RoadmapLessonError(
      "stream_error",
      err instanceof Error ? err.message : String(err),
    );
  }

  if (buffer.trim().length === 0) {
    throw new RoadmapLessonError("empty_response", "Model returned no text");
  }
  return {
    body: buffer,
    usage,
    estimatedCostUsd: estimateCost(model, usage),
    model,
  };
}
