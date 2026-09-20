import { buildChatGuidance } from "./chat-guidance";
import type { ContextBlock } from "@/lib/ai/context/types";
import type { SystemBlock } from "@/lib/ai/providers/types";
import type { ChunkRecord } from "@/lib/db/types";

// The workspace-chat system prompt. Distinct from `buildNotebookSystem`
// (single-source reader chat) — this is a SUBJECT-level tutor that spans ALL
// workspace sources plus optional user-toggled context (notes / concepts /
// roadmap / performance). Grounding is HYBRID: answer from sources first and
// cite them, but general knowledge is allowed when sources don't cover it —
// while separating source claims, interpretation, and background knowledge.

// Mirrors `AiResponseLocaleInput` from notebook-chat.ts (kept local so this
// module owns its own contract surface and doesn't import a sibling prompt).
export type AiResponseLocaleInput = "tr" | "en" | "follow_source";

// One workspace source plus the chunks retrieved for it this turn. The runner
// gathers retrieved chunks back into per-source groups before calling this.
export type WorkspaceSource = {
  id: string;
  title: string;
  titleEn?: string | undefined;
  author?: string | undefined;
  type: string;
  chunks: Pick<ChunkRecord, "index" | "section" | "headings" | "text" | "page">[];
};

export type WorkspaceChatSystemInput = {
  sources: WorkspaceSource[];
  contextBlocks: ContextBlock[];
  locale: "tr" | "en";
  aiResponseLocale?: AiResponseLocaleInput | undefined;
};

// Human-readable label for a context block kind, in the active UI locale. Used
// only as the header of each appended context block so the model knows what it
// is reading. (UI chip labels live in i18n; these are model-facing.)
function contextBlockHeading(
  kind: ContextBlock["kind"],
  locale: "tr" | "en",
): string {
  if (locale === "en") {
    switch (kind) {
      case "notes":
        return "WORKSPACE NOTES";
      case "concepts":
        return "CONCEPT MAP";
      case "roadmap":
        return "ROADMAP";
      case "performance":
        return "LEARNING PERFORMANCE";
    }
  }
  switch (kind) {
    case "notes":
      return "ÇALIŞMA ALANI NOTLARI";
    case "concepts":
      return "KAVRAM HARİTASI";
    case "roadmap":
      return "ROADMAP";
    case "performance":
      return "ÖĞRENME PERFORMANSI";
  }
}

function buildSourceWrapper(
  source: WorkspaceSource,
  locale: "tr" | "en",
): string {
  const title =
    locale === "en" ? (source.titleEn ?? source.title) : source.title;
  const idAttr = ` id=${JSON.stringify(source.id)}`;
  const titleAttr = ` title=${JSON.stringify(title)}`;
  const authorAttr = source.author
    ? ` author=${JSON.stringify(source.author)}`
    : "";
  const typeAttr = ` type=${JSON.stringify(source.type)}`;

  const chunkBlocks = source.chunks.map((c) => {
    const headerBits: string[] = [`src: ${source.id}`, `#${c.index}`];
    if (c.section) headerBits.push(`section: ${c.section}`);
    else if (c.headings?.[0]) headerBits.push(`section: ${c.headings[0]}`);
    if (typeof c.page === "number") headerBits.push(`page: ${c.page}`);
    return `---chunk ${headerBits.join(" · ")}---\n${c.text}`;
  });

  return [
    `<source${idAttr}${titleAttr}${authorAttr}${typeAttr}>`,
    ...chunkBlocks,
    "</source>",
  ].join("\n\n");
}

export function buildWorkspaceChatSystem(
  input: WorkspaceChatSystemInput,
): SystemBlock[] {
  const rules = buildChatGuidance("workspace", input.locale, input.aiResponseLocale);

  const sourceWrappers = input.sources.map((s) =>
    buildSourceWrapper(s, input.locale),
  );

  // One <sources> block concatenating every per-source <source> wrapper. This
  // is the single large, stable payload — it carries the ephemeral cache
  // breakpoint so the same workspace corpus is cached across turns.
  const sourcesPayload =
    sourceWrappers.length > 0
      ? ["<sources>", ...sourceWrappers, "</sources>"].join("\n\n")
      : "<sources></sources>";

  const blocks: SystemBlock[] = [
    { type: "text", text: rules },
    { type: "text", text: sourcesPayload, cache_control: { type: "ephemeral" } },
  ];

  // Context blocks (notes / concepts / roadmap / performance) appended AFTER
  // the cached sources block as plain text, ordered for cache stability — they
  // change more often than the corpus so they must not sit before the
  // breakpoint. Each gets a model-facing locale heading.
  for (const block of input.contextBlocks) {
    const heading = contextBlockHeading(block.kind, input.locale);
    blocks.push({ type: "text", text: `### ${heading}\n${block.text}` });
  }

  return blocks;
}
