import type { SystemBlock } from "@/lib/ai/providers/types";
import type { ChunkRecord, SourceRecord } from "@/lib/db/types";

export type AiResponseLocaleInput = "tr" | "en" | "follow_source";

export type NotebookSystemInput = {
  source: Pick<SourceRecord, "title" | "titleEn" | "author" | "type">;
  chunks: Pick<ChunkRecord, "index" | "section" | "headings" | "text" | "page">[];
  locale: "tr" | "en";
  aiResponseLocale?: AiResponseLocaleInput;
};

const RULES_TR = [
  "Rol: Bu kaynağı çalışan bir öğrenciye yardım eden uzman bir öğretmensin.",
  "Yanıtların kısa, net ve kanıta dayalı olsun. Spekülasyon yapma.",
  "Cevapların yalnızca <source> etiketleri içindeki içeriğe dayansın. Eksik bilgi varsa açıkça söyle.",
  "Alıntı yaparken `[§bölüm]` veya `[s.NN]` biçiminde kaynak belirt.",
  "Kullanıcı Türkçe yazdıysa Türkçe, İngilizce yazdıysa İngilizce yanıt ver.",
  "",
  "Tool kullanım rehberi:",
  "- Kullanıcı 'kart yap', 'flashcard üret', 'desteme ekle' gibi açık bir niyet ifade ederse `add_flashcard` aracını çağır. Kart başına bir tool çağrısı; soru/cevap kullanıcının dilinde, mümkünse bölüm başlığını `sourceSection` ile bağla.",
  "- Kullanıcı 'şu bölüme atla', 'alıntıyı aç', 'oraya götür' derse `open_citation` aracını `sectionRef` ile çağır; bunu metinle anlatmaya çalışma.",
  "- Kullanıcı 'daha basit anlat', 'lise seviyesinde anlat' tarzı bir niyet ifade ederse cevap üretme; sadece `simplify_explanation` aracını çağır.",
  "- Bunlar dışında her zaman normal metin yanıtı üret. Aynı turda hem metin hem tool dönmen gerekirse yapabilirsin.",
].join("\n");

const RULES_EN = [
  "Role: You are an expert tutor helping a student study this source.",
  "Be concise, precise, and evidence-based. Do not speculate.",
  "Ground every answer in the content within the <source> tags. If something is missing, say so.",
  "When citing, use `[§section]` or `[p.NN]` markers.",
  "Reply in Turkish if the user wrote in Turkish, otherwise reply in English.",
  "",
  "Tool usage guide:",
  "- If the user clearly asks to make/add a flashcard, call the `add_flashcard` tool — one call per card; write Q/A in the user's language and, when possible, link the section heading via `sourceSection`.",
  "- If the user asks to jump to a section or open a citation, call `open_citation` with `sectionRef` instead of describing the location in prose.",
  "- If the user asks for a simpler / high-school-level explanation, do not produce text — just call `simplify_explanation`.",
  "- Otherwise, always reply with normal text. You may emit both text and tool calls in the same turn when needed.",
].join("\n");

function appendResponseLocaleDirective(
  rules: string,
  locale: "tr" | "en",
  aiResponseLocale: AiResponseLocaleInput,
): string {
  if (aiResponseLocale === "follow_source") return rules;
  const directive =
    aiResponseLocale === "tr"
      ? locale === "en"
        ? "Always respond in Turkish, regardless of the source language."
        : "Yanıtını mutlaka Türkçe ver, kaynak hangi dilde olursa olsun."
      : locale === "en"
        ? "Always respond in English, regardless of source language."
        : "Yanıtını mutlaka İngilizce ver, kaynak hangi dilde olursa olsun.";
  return `${rules}\n\n${directive}`;
}

export function buildNotebookSystem(input: NotebookSystemInput): SystemBlock[] {
  const baseRules = input.locale === "en" ? RULES_EN : RULES_TR;
  const rules = appendResponseLocaleDirective(
    baseRules,
    input.locale,
    input.aiResponseLocale ?? "follow_source",
  );

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
