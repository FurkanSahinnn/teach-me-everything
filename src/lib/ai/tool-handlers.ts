import { findChunkForRef } from "@/components/notebook/CitationChip";
import {
  createDeck,
  createFlashcard,
  listDecksByWorkspace,
} from "@/lib/db/flashcards";
import type { ChunkRecord, FlashcardRecord } from "@/lib/db/types";

const DEFAULT_DECK_NAME_TR = "Notebook";
const DEFAULT_DECK_NAME_EN = "Notebook";
const DEFAULT_DECK_COLOR = "#B86E00";

export type ToolHandlerContext = {
  workspaceId: string;
  sourceId: string;
  chunks: ChunkRecord[];
  locale: "tr" | "en";
};

export type AddFlashcardArgs = {
  question?: unknown;
  answer?: unknown;
  sourceSection?: unknown;
  sourceChunkId?: unknown;
};

export type AddFlashcardResult =
  | {
      ok: true;
      flashcardId: string;
      deckName: string;
      record: FlashcardRecord;
    }
  | { ok: false; error: string };

export async function runAddFlashcard(
  args: AddFlashcardArgs,
  ctx: ToolHandlerContext,
): Promise<AddFlashcardResult> {
  const question =
    typeof args.question === "string" ? args.question.trim() : "";
  const answer = typeof args.answer === "string" ? args.answer.trim() : "";
  if (!question || !answer) {
    return { ok: false, error: "missing_fields" };
  }
  const sourceSection =
    typeof args.sourceSection === "string" && args.sourceSection.trim()
      ? args.sourceSection.trim()
      : undefined;
  const linkedChunk =
    typeof args.sourceChunkId === "string"
      ? ctx.chunks.find((c) => c.id === args.sourceChunkId)
      : sourceSection
        ? (findChunkForRef(sourceSection, ctx.chunks) ?? undefined)
        : undefined;

  const decks = await listDecksByWorkspace(ctx.workspaceId);
  const deckName =
    ctx.locale === "tr" ? DEFAULT_DECK_NAME_TR : DEFAULT_DECK_NAME_EN;
  let deck =
    decks.find((d) => d.name === DEFAULT_DECK_NAME_TR) ??
    decks.find((d) => d.name === DEFAULT_DECK_NAME_EN);
  if (!deck) {
    deck = await createDeck({
      workspaceId: ctx.workspaceId,
      name: deckName,
      nameEn: DEFAULT_DECK_NAME_EN,
      color: DEFAULT_DECK_COLOR,
    });
  }

  const citations = sourceSection
    ? [
        {
          sourceId: ctx.sourceId,
          ...(sourceSection ? { section: sourceSection } : {}),
        },
      ]
    : undefined;

  const record = await createFlashcard({
    workspaceId: ctx.workspaceId,
    deckId: deck.id,
    sourceId: ctx.sourceId,
    ...(linkedChunk ? { chunkId: linkedChunk.id } : {}),
    question,
    answer,
    ...(citations ? { citations } : {}),
  });

  return { ok: true, flashcardId: record.id, deckName: deck.name, record };
}

export type OpenCitationArgs = {
  sectionRef?: unknown;
};

export type OpenCitationResult =
  | { ok: true; chunkId: string; section: string }
  | { ok: false; error: string };

export function runOpenCitation(
  args: OpenCitationArgs,
  ctx: ToolHandlerContext,
  jumpToChunk: (chunk: ChunkRecord) => void,
): OpenCitationResult {
  const ref =
    typeof args.sectionRef === "string" ? args.sectionRef.trim() : "";
  if (!ref) return { ok: false, error: "missing_ref" };
  const chunk = findChunkForRef(ref, ctx.chunks);
  if (!chunk) return { ok: false, error: "not_found" };
  jumpToChunk(chunk);
  return { ok: true, chunkId: chunk.id, section: chunk.section ?? ref };
}

export type SimplifyArgs = {
  reason?: unknown;
};

export type SimplifyResult = {
  ok: true;
  requeue: string;
};

export function runSimplifyExplanation(
  _args: SimplifyArgs,
  lastUserMessage: string,
  locale: "tr" | "en",
): SimplifyResult {
  const prefix =
    locale === "tr"
      ? "Bunu çok daha basit, lise seviyesinde anlat: "
      : "Explain this much more simply, at a high-school level: ";
  return { ok: true, requeue: `${prefix}${lastUserMessage}` };
}

export function summarizeToolResult(
  name: string,
  result:
    | AddFlashcardResult
    | OpenCitationResult
    | SimplifyResult
    | { ok: false; error: string },
): string {
  if (result.ok) {
    if (name === "add_flashcard" && "flashcardId" in result) {
      return JSON.stringify({
        ok: true,
        flashcardId: result.flashcardId,
        deckName: result.deckName,
      });
    }
    if (name === "open_citation" && "chunkId" in result) {
      return JSON.stringify({
        ok: true,
        chunkId: result.chunkId,
        section: result.section,
      });
    }
    if (name === "simplify_explanation" && "requeue" in result) {
      return JSON.stringify({ ok: true, queued: true });
    }
    return JSON.stringify({ ok: true });
  }
  return JSON.stringify({ ok: false, error: result.error });
}
