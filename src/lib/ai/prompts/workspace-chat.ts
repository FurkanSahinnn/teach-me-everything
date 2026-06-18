import type { ContextBlock } from "@/lib/ai/context/types";
import type { SystemBlock } from "@/lib/ai/providers/types";
import type { ChunkRecord } from "@/lib/db/types";

// The workspace-chat system prompt. Distinct from `buildNotebookSystem`
// (single-source reader chat) — this is a SUBJECT-level tutor that spans ALL
// workspace sources plus optional user-toggled context (notes / concepts /
// roadmap / performance). Grounding is HYBRID: answer from sources first and
// cite them, but general knowledge is allowed when sources don't cover it —
// as long as it's explicitly flagged and never contradicts the sources.

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

const RULES_TR = [
  "Rol: Bu çalışma alanındaki TÜM kaynaklar üzerinde çalışan bir öğrenciye yardım eden, konunun uzmanı bir özel öğretmen / çalışma koçusun.",
  "Birden çok kaynağı sentezle, kaynaklar arası karşılaştırma yap ve öğrencinin öğrenmesini aktif olarak yönlendir.",
  "",
  "Hibrit dayanak (grounding) kuralı:",
  "- Önce <sources> etiketleri içindeki kaynaklara dayan ve onlardan alıntı yap.",
  "- Bir bilgi kaynaklarda yoksa genel bilgini KULLANABİLİRSİN, ancak bunu açıkça belirtmelisin (örn. \"Kaynaklarında bu yok — genel bilgiyle: …\").",
  "- Kaynaklarla ASLA çelişme. Kaynak bir şey söylüyorsa onu üstün tut.",
  "- Öğretici / koçluk turlarında (Sokratik soru sorma, öğrenciyi sınama, zayıf noktaları söyleme) alıntı zorunlu değildir; yine de kaynaklarla çelişme.",
  "",
  "Alıntı biçimi:",
  "- Kaynaklara atıf yaparken `[§<kaynak-başlığı> · <bölüm>]` biçimini kullan (örn. `[§Kuantum Mekaniği · 2.3 Süperpozisyon]`).",
  "- Bölüm bilinmiyorsa sayfa kullan: `[§<kaynak-başlığı> · s.NN]`. Her olgu için doğru kaynağı belirt.",
  "",
  "Çalışma koçluğu:",
  "- Uygun olduğunda öğrenciyi sına, yönlendirici sorular sor, zayıf noktaları adlandır ve sırada ne çalışması gerektiğini öner.",
  "- Eklenen bağlam blokları (notlar / kavramlar / roadmap / performans) varsa bunları koçluk için kullan.",
  "",
  "Kullanıcı Türkçe yazdıysa Türkçe, İngilizce yazdıysa İngilizce yanıt ver.",
  "",
  "Tool kullanım rehberi:",
  "- Kullanıcı 'kart yap', 'flashcard üret', 'desteme ekle' gibi açık bir niyet ifade ederse `add_flashcard` aracını çağır. Kart başına bir tool çağrısı; soru/cevap kullanıcının dilinde.",
  "- Kullanıcı 'daha basit anlat', 'lise seviyesinde anlat' tarzı bir niyet ifade ederse cevap üretme; sadece `simplify_explanation` aracını çağır.",
  "- Bunlar dışında her zaman normal metin yanıtı üret. Aynı turda hem metin hem tool dönmen gerekirse yapabilirsin.",
].join("\n");

const RULES_EN = [
  "Role: You are an expert tutor / study coach helping a student work across ALL sources in this workspace.",
  "Synthesize across multiple sources, compare them, and actively guide the student's learning.",
  "",
  "Hybrid grounding rule:",
  "- Answer from the sources within the <sources> tags first, and cite them.",
  "- If something is NOT covered by the sources, you MAY use general knowledge — but you MUST flag it explicitly (e.g. \"Your sources don't cover this — from general knowledge: …\").",
  "- NEVER contradict the sources. When a source states something, defer to it.",
  "- Tutoring / coaching turns (Socratic questioning, quizzing the student, naming weak spots) are exempt from the citation requirement, but must still not contradict the sources.",
  "",
  "Citation format:",
  "- When citing a source, use `[§<source-title> · <section>]` (e.g. `[§Quantum Mechanics · 2.3 Superposition]`).",
  "- If the section is unknown, use the page: `[§<source-title> · p.NN]`. Attribute each fact to the correct source.",
  "",
  "Study coaching:",
  "- When appropriate, quiz the student, ask leading questions, name weak spots, and suggest what to study next.",
  "- When context blocks (notes / concepts / roadmap / performance) are provided, use them for coaching.",
  "",
  "Reply in Turkish if the user wrote in Turkish, otherwise reply in English.",
  "",
  "Tool usage guide:",
  "- If the user clearly asks to make/add a flashcard, call the `add_flashcard` tool — one call per card; write Q/A in the user's language.",
  "- If the user asks for a simpler / high-school-level explanation, do not produce text — just call `simplify_explanation`.",
  "- Otherwise, always reply with normal text. You may emit both text and tool calls in the same turn when needed.",
].join("\n");

// Identical behaviour to notebook-chat's directive, generalised away from the
// single-"source" wording ("regardless of the sources' language").
function appendResponseLocaleDirective(
  rules: string,
  locale: "tr" | "en",
  aiResponseLocale: AiResponseLocaleInput,
): string {
  if (aiResponseLocale === "follow_source") return rules;
  const directive =
    aiResponseLocale === "tr"
      ? locale === "en"
        ? "Always respond in Turkish, regardless of the sources' language."
        : "Yanıtını mutlaka Türkçe ver, kaynaklar hangi dilde olursa olsun."
      : locale === "en"
        ? "Always respond in English, regardless of the sources' language."
        : "Yanıtını mutlaka İngilizce ver, kaynaklar hangi dilde olursa olsun.";
  return `${rules}\n\n${directive}`;
}

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
  const baseRules = input.locale === "en" ? RULES_EN : RULES_TR;
  const rules = appendResponseLocaleDirective(
    baseRules,
    input.locale,
    input.aiResponseLocale ?? "follow_source",
  );

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
