import { buildChatGuidance } from "./chat-guidance";
import type { SystemBlock } from "@/lib/ai/providers/types";
import type { ChunkRecord, SourceRecord } from "@/lib/db/types";

export type AiResponseLocaleInput = "tr" | "en" | "follow_source";

export type NotebookSystemInput = {
  source: Pick<SourceRecord, "title" | "titleEn" | "author" | "type">;
  chunks: Pick<ChunkRecord, "index" | "section" | "headings" | "text" | "page">[];
  locale: "tr" | "en";
  aiResponseLocale?: AiResponseLocaleInput;
};

export function buildNotebookSystem(input: NotebookSystemInput): SystemBlock[] {
  const rules = buildChatGuidance("reader", input.locale, input.aiResponseLocale);

  const title =
    input.locale === "en"
      ? (input.source.titleEn ?? input.source.title)
      : input.source.title;
  const authorAttr = input.source.author
    ? ` author=${JSON.stringify(input.source.author)}`
    : "";
  const typeAttr = ` type=${JSON.stringify(input.source.type)}`;

  const chunkBlocks = input.chunks.map((c) => {
    const headerBits: string[] = [`#${c.index}`];
    if (c.section) headerBits.push(`section: ${c.section}`);
    else if (c.headings?.[0]) headerBits.push(`section: ${c.headings[0]}`);
    if (typeof c.page === "number") headerBits.push(`page: ${c.page}`);
    return `---chunk ${headerBits.join(" · ")}---\n${c.text}`;
  });

  const sourcePayload = [
    `<source title=${JSON.stringify(title)}${authorAttr}${typeAttr}>`,
    ...chunkBlocks,
    "</source>",
  ].join("\n\n");

  return [
    { type: "text", text: rules },
    {
      type: "text",
      text: sourcePayload,
      cache_control: { type: "ephemeral" },
    },
  ];
}
