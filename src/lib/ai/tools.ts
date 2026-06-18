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

// === Workspace Chat tools ===
//
// The workspace chat is a cross-source tutor. It reuses `add_flashcard` and
// `simplify_explanation` verbatim (same handlers as the notebook reader chat —
// `add_flashcard` simply anchors to whichever source the cited chunk came
// from) and adds two workspace-level generators behind an explicit opt-in.
//
// `generate_flashcards` / `generate_quiz` are emitted to the model ONLY when
// the runner passes `{ withGenerators: true }`, which it should do solely once
// it has wired real handlers (lib/ai/flashcard-gen + quiz-gen) for the round
// trip. They are never stubbed: with the flag off (the default) the model
// never sees them, so it can never call a handler that does not exist.
export type WorkspaceToolName =
  | "add_flashcard"
  | "simplify_explanation"
  | "generate_flashcards"
  | "generate_quiz";

const WORKSPACE_DESCRIPTIONS: Record<
  Exclude<WorkspaceToolName, NotebookToolName>,
  { tr: string; en: string }
> = {
  generate_flashcards: {
    tr: "Çalışma alanındaki kaynaklardan SM-2 destesine bir grup yeni soru-cevap kartı üretir. Belirli bir konuya odaklanmak için `topic` ver; kart sayısını `count` ile sınırla. Kullanıcı 'bana kart üret', 'bu konudan kart çıkar' gibi bir niyet belirttiğinde çağır.",
    en: "Generate a batch of new question/answer flashcards into the user's SM-2 deck from the workspace sources. Pass `topic` to focus on a subject and `count` to bound how many. Call when the user asks to create or generate flashcards.",
  },
  generate_quiz: {
    tr: "Çalışma alanındaki kaynaklardan kısa bir quiz oturumu hazırlar. Belirli bir konuya odaklanmak için `topic`, soru sayısı için `count` ver. Kullanıcı 'beni sına', 'quiz yap' gibi bir niyet belirttiğinde çağır.",
    en: "Prepare a short quiz session from the workspace sources. Pass `topic` to focus on a subject and `count` for the number of questions. Call when the user asks to be quizzed or to make a quiz.",
  },
};

// Workspace chat tool set. By default returns the two always-safe tools
// (`add_flashcard`, `simplify_explanation`). Pass `{ withGenerators: true }`
// to also expose `generate_flashcards` / `generate_quiz` — only once their
// handlers are wired in the runner (no stubs).
export function buildWorkspaceTools(
  locale: "tr" | "en",
  opts?: { withGenerators?: boolean },
): AnthropicTool[] {
  const notebook = buildNotebookTools(locale);
  const addFlashcard = notebook.find((t) => t.name === "add_flashcard");
  const simplify = notebook.find((t) => t.name === "simplify_explanation");
  const tools: AnthropicTool[] = [];
  // `find` is statically nullable; both names are present in buildNotebookTools
  // above, so this only guards against future renames.
  if (addFlashcard) tools.push(addFlashcard);
  if (simplify) tools.push(simplify);

  if (opts?.withGenerators) {
    const topicProp = {
      type: "string",
      description:
        locale === "tr"
          ? "Odaklanılacak konu (opsiyonel). Boşsa kaynakların genelinden seç."
          : "Topic to focus on (optional). If empty, draw from across the sources.",
    };
    const countProp = {
      type: "integer",
      description:
        locale === "tr"
          ? "Üretilecek öğe sayısı (opsiyonel, makul bir aralıkta)."
          : "How many items to generate (optional, within a reasonable range).",
    };
    tools.push(
      {
        name: "generate_flashcards",
        description: WORKSPACE_DESCRIPTIONS.generate_flashcards[locale],
        input_schema: {
          type: "object",
          properties: { topic: topicProp, count: countProp },
          additionalProperties: false,
        },
      },
      {
        name: "generate_quiz",
        description: WORKSPACE_DESCRIPTIONS.generate_quiz[locale],
        input_schema: {
          type: "object",
          properties: { topic: topicProp, count: countProp },
          additionalProperties: false,
        },
      },
    );
  }

  return tools;
}

export const WORKSPACE_TOOL_NAMES: ReadonlyArray<WorkspaceToolName> = [
  "add_flashcard",
  "simplify_explanation",
  "generate_flashcards",
  "generate_quiz",
];

export function isWorkspaceToolName(value: string): value is WorkspaceToolName {
  return (WORKSPACE_TOOL_NAMES as readonly string[]).includes(value);
}
