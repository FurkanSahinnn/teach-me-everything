export type AnthropicToolInputSchema = {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
};

export type AnthropicTool = {
  name: string;
  description: string;
  input_schema: AnthropicToolInputSchema;
};

export type AnthropicToolChoice =
  | { type: "auto" }
  | { type: "any" }
  | { type: "tool"; name: string };

export type NotebookToolName =
  | "add_flashcard"
  | "open_citation"
  | "simplify_explanation";

const DESCRIPTIONS: Record<
  NotebookToolName,
  { tr: string; en: string }
> = {
  add_flashcard: {
    tr: "Kullanıcının çalıştığı kaynaktan SM-2 destesine yeni bir soru-cevap kartı ekler. Soru ve cevabı kullanıcının diliyle yaz; mümkünse bölüm başlığı ile kaynağı bağla.",
    en: "Add a new question/answer flashcard to the user's SM-2 deck for this source. Write Q/A in the user's language and, when possible, anchor it to a section heading.",
  },
  open_citation: {
    tr: "Kaynaktaki belirli bir bölüme veya başlığa kaydırır ve görsel vurgu yapar. Sadece kullanıcı 'şu kısma git' / 'alıntıyı aç' tarzı bir niyet ifade ettiğinde çağır.",
    en: "Scroll the reader to a specific section or heading in the source and visually highlight it. Only call when the user explicitly asks to jump to or open a citation.",
  },
  simplify_explanation: {
    tr: "Önceki kullanıcı sorusunu çok daha sade, lise seviyesinde bir dille yeniden cevaplamak için sinyal verir. Cevap üretme; sadece bu aracı çağır.",
    en: "Signal that the previous user question should be re-answered in much simpler, high-school-level language. Do not produce text yourself; just invoke this tool.",
  },
};

export function buildNotebookTools(locale: "tr" | "en"): AnthropicTool[] {
  const pick = (k: NotebookToolName) => DESCRIPTIONS[k][locale];
  return [
    {
      name: "add_flashcard",
      description: pick("add_flashcard"),
      input_schema: {
        type: "object",
        properties: {
          question: {
            type: "string",
            description:
              locale === "tr"
                ? "Kart önyüzü — net bir soru cümlesi."
                : "Card front — a single, clear question.",
          },
          answer: {
            type: "string",
            description:
              locale === "tr"
                ? "Kart arkayüzü — kısa, doğru cevap."
                : "Card back — a concise, correct answer.",
          },
          sourceSection: {
            type: "string",
            description:
              locale === "tr"
                ? "Bağlanılan bölüm başlığı (varsa). Örn: '12.1 Ölçek dönüşümleri'."
                : "Section heading the card cites (optional).",
          },
          sourceChunkId: {
            type: "string",
            description:
              locale === "tr"
                ? "Source block içinde geçen `#index` chunk numarası karşılığı (opsiyonel)."
                : "Optional chunk id seen in the source block.",
          },
        },
        required: ["question", "answer"],
        additionalProperties: false,
      },
    },
    {
      name: "open_citation",
      description: pick("open_citation"),
      input_schema: {
        type: "object",
        properties: {
          sectionRef: {
            type: "string",
            description:
              locale === "tr"
                ? "Bölüm/başlık referansı — `[§...]` içindeki metinle eşleşir."
                : "Section/heading reference matching the `[§...]` text.",
          },
        },
        required: ["sectionRef"],
        additionalProperties: false,
      },
    },
    {
      name: "simplify_explanation",
      description: pick("simplify_explanation"),
      input_schema: {
        type: "object",
        properties: {
          reason: {
            type: "string",
            description:
              locale === "tr"
                ? "Neden basitleştiriliyor? (opsiyonel kısa not)"
                : "Why simplify? (optional short note)",
          },
        },
        additionalProperties: false,
      },
    },
  ];
}

export const NOTEBOOK_TOOL_NAMES: ReadonlyArray<NotebookToolName> = [
  "add_flashcard",
  "open_citation",
  "simplify_explanation",
];

export function isNotebookToolName(value: string): value is NotebookToolName {
  return (NOTEBOOK_TOOL_NAMES as readonly string[]).includes(value);
}
