"use client";

import {
  BookOpen,
  Check,
  ExternalLink,
  GitBranchPlus,
  GraduationCap,
  Layers,
  Link2,
  Loader2,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useLiveQuery } from "dexie-react-hooks";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Switch } from "@/components/ui/Switch";
import { useToast } from "@/components/ui/Toast";
import { useLocalePick } from "@/i18n/IntlProvider";
import { runRoadmapSubtask, RoadmapGenError } from "@/lib/ai/roadmap-gen";
import { FlashcardGenError, runFlashcardGen } from "@/lib/ai/flashcard-gen";
import { findChatOption } from "@/lib/ai/model-options";
import { resolveChatCredentialForPreset } from "@/lib/ai/anthropic-credential";
import { isLocalUrl } from "@/lib/ai/providers/local-bypass";
import { getPreset } from "@/lib/ai/providers/presets";
import { getApiKey } from "@/lib/db/api-keys-repo";
import { createDeck, createFlashcard } from "@/lib/db/flashcards";
import { createNote, updateNote } from "@/lib/db/notes";
import { useSources } from "@/lib/db/hooks";
import { db } from "@/lib/db/schema";
import {
  addSubnodes,
  deleteRoadmapNode,
  setNodeStatus,
  updateRoadmapNode,
} from "@/lib/db/roadmaps";
import {
  distinctSourcesFromChunks,
  retrieveRelatedChunks,
  type RelatedReason,
  type RelatedSource,
} from "@/lib/roadmap/related";
import {
  composeLessonNote,
  RoadmapLessonError,
  runRoadmapLesson,
} from "@/lib/roadmap/lesson-gen";
import {
  MAX_ROADMAP_DEPTH,
  type RoadmapNodeDepth,
  type RoadmapNodeRecord,
  type RoadmapRecord,
} from "@/lib/roadmap/types";
import { findCustomEndpoint, usePrefs } from "@/stores/prefs";
import { cn } from "@/lib/utils/cn";

type Props = {
  roadmap: RoadmapRecord;
  node: RoadmapNodeRecord;
  hasChildren: boolean;
  onClose: () => void;
};

export function NodeInspector({ roadmap, node, hasChildren, onClose }: Props) {
  const pick = useLocalePick();
  const locale = usePrefs((s) => s.locale);
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const depthCapped = node.depth >= MAX_ROADMAP_DEPTH;
  const isDone = node.status === "done";
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  // Abort any in-flight subtask generation when the inspector unmounts (the
  // user closed it or selected another node) so the stream doesn't keep
  // running and setState can't fire on a dead component.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, []);

  const router = useRouter();
  const sources = useSources(roadmap.workspaceId) ?? [];
  const sourceTitleById = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of sources) map.set(s.id, pick(s.title, s.titleEn ?? s.title));
    return map;
  }, [sources, pick]);
  const [noteBusy, setNoteBusy] = useState(false);
  const [related, setRelated] = useState<
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "done"; sources: RelatedSource[] }
    | { kind: "error"; reason: RelatedReason; detail?: string }
  >({ kind: "idle" });
  const [cardsBusy, setCardsBusy] = useState(false);
  const flashcardModelId = usePrefs((s) => s.modelBindings.flashcardGen);
  const [lessonBusy, setLessonBusy] = useState(false);
  const lessonModelId = usePrefs((s) => s.modelBindings.summary);

  // Live deck-mastery readout for the linked deck: how many of its cards have
  // passed at least one SM-2 repetition. Drives the node's "progress from
  // activity" chip and re-renders as the user reviews.
  const deckProgress = useLiveQuery(async () => {
    if (!node.deckId) return null;
    const cards = await db.flashcards
      .where("deckId")
      .equals(node.deckId)
      .toArray();
    const learned = cards.filter((c) => c.repetitions >= 1).length;
    return { total: cards.length, learned };
  }, [node.deckId]);

  // "Study this" — turn the dead-end node into an editable, chat-able,
  // embeddable Note (title + description seeded). Linked back via node.noteId
  // so a second click just re-opens it instead of creating duplicates.
  async function handleStudyAsNote(): Promise<void> {
    if (noteBusy) return;
    setNoteBusy(true);
    try {
      if (!node.noteId) {
        const note = await createNote({
          workspaceId: roadmap.workspaceId,
          title: node.title,
          content: `# ${node.title}\n\n${node.description}\n`,
        });
        await updateRoadmapNode(node.id, { noteId: note.id });
      }
      toast({
        variant: "success",
        title: node.noteId
          ? pick("Not açılıyor", "Opening note")
          : pick("Not oluşturuldu", "Note created"),
        description: node.title,
      });
      router.push(`/w/${roadmap.workspaceId}/notes`);
      onClose();
    } finally {
      if (mountedRef.current) setNoteBusy(false);
    }
  }

  // "Related sources" — embed the node topic + retrieve the workspace's most
  // similar chunks, collapsed to distinct sources the learner can jump into.
  async function handleRelated(): Promise<void> {
    setRelated({ kind: "loading" });
    const query = `${node.title}. ${node.description}`.trim();
    const res = await retrieveRelatedChunks(roadmap.workspaceId, query, { k: 8 });
    if (!mountedRef.current) return;
    if (res.reason) {
      setRelated({
        kind: "error",
        reason: res.reason,
        ...(res.detail ? { detail: res.detail } : {}),
      });
      return;
    }
    setRelated({
      kind: "done",
      sources: distinctSourcesFromChunks(res.chunks).slice(0, 5),
    });
  }

  // "Make flashcards" — ground in the workspace's most-related chunks (falls
  // back to the node description when nothing is embedded), generate cards
  // with the user's flashcard model, persist them into a new deck, and link
  // it back via node.deckId so progress can flow from the deck's SRS state.
  async function handleMakeFlashcards(): Promise<void> {
    if (cardsBusy) return;
    setCardsBusy(true);
    setError(null);
    try {
      const option = findChatOption(flashcardModelId);
      if (!option) {
        throw new Error(
          pick("Flashcard modeli kayıtlı değil.", "Flashcard model not registered."),
        );
      }
      const preset = getPreset(option.presetId);
      const custom = findCustomEndpoint(option.presetId);
      const baseUrl = preset?.baseUrl ?? custom?.baseUrl ?? "";
      const isLocal = isLocalUrl(baseUrl);
      let apiKey = "";
      let authKind: "oauth" | "api-key" | undefined;
      if (!isLocal) {
        const cred = await resolveChatCredentialForPreset(option.presetId);
        if (!cred) {
          throw new Error(
            pick(`${option.label} için anahtar yok.`, `No API key for ${option.label}.`),
          );
        }
        apiKey = cred.apiKey;
        if (cred.authKind) authKind = cred.authKind;
      }
      const related = await retrieveRelatedChunks(
        roadmap.workspaceId,
        `${node.title}. ${node.description}`,
        { k: 6 },
      );
      const groundedChunks = related.chunks.map((r) => r.chunk);
      const chunks: Parameters<typeof runFlashcardGen>[0]["chunks"] =
        groundedChunks.length > 0
          ? groundedChunks
          : [
              {
                index: 0,
                section: node.title,
                headings: [node.title],
                text: node.description,
              },
            ];
      const result = await runFlashcardGen({
        modelId: flashcardModelId,
        apiKey,
        ...(authKind ? { authKind } : {}),
        source: { title: node.title, type: "note" },
        chunks,
        locale,
        count: 8,
        mode: "batch",
      });
      if (!mountedRef.current) return;
      if (result.cards.length === 0) {
        throw new Error(pick("Model kart üretmedi.", "Model produced no cards."));
      }
      const deck = await createDeck({
        workspaceId: roadmap.workspaceId,
        name: node.title,
        color: "#6E8BFF",
      });
      const chunkIds = groundedChunks.map((c) => c.id);
      const generatedAt = Date.now();
      for (const card of result.cards) {
        await createFlashcard({
          workspaceId: roadmap.workspaceId,
          deckId: deck.id,
          question: card.question,
          answer: card.answer,
          ...(card.tags ? { tags: card.tags } : {}),
          generatedFrom: {
            kind: "batch",
            model: result.model,
            ...(chunkIds.length > 0 ? { chunkIds } : {}),
            generatedAt,
          },
        });
      }
      await updateRoadmapNode(node.id, { deckId: deck.id });
      toast({
        variant: "success",
        title: pick(
          `${result.cards.length} kart üretildi`,
          `${result.cards.length} cards created`,
        ),
        description:
          result.estimatedCostUsd > 0
            ? `~$${result.estimatedCostUsd.toFixed(3)}`
            : pick("ücretsiz", "free"),
      });
      router.push(`/w/${roadmap.workspaceId}/cards`);
      onClose();
    } catch (err) {
      if (!mountedRef.current) return;
      setError(
        err instanceof FlashcardGenError
          ? `${err.code}: ${err.message}`
          : err instanceof Error
            ? err.message
            : String(err),
      );
    } finally {
      if (mountedRef.current) setCardsBusy(false);
    }
  }

  // "Generate lesson" — write a source-grounded (or general-knowledge) study
  // lesson in Markdown and save it as the node's Note (enriching the existing
  // one when present so node ↔ note stays 1:1).
  async function handleGenerateLesson(): Promise<void> {
    if (lessonBusy) return;
    setLessonBusy(true);
    setError(null);
    try {
      const option = findChatOption(lessonModelId);
      if (!option) {
        throw new Error(
          pick("Ders modeli kayıtlı değil.", "Lesson model not registered."),
        );
      }
      const preset = getPreset(option.presetId);
      const custom = findCustomEndpoint(option.presetId);
      const baseUrl = preset?.baseUrl ?? custom?.baseUrl ?? "";
      const isLocal = isLocalUrl(baseUrl);
      let apiKey = "";
      let authKind: "oauth" | "api-key" | undefined;
      if (!isLocal) {
        const cred = await resolveChatCredentialForPreset(option.presetId);
        if (!cred) {
          throw new Error(
            pick(`${option.label} için anahtar yok.`, `No API key for ${option.label}.`),
          );
        }
        apiKey = cred.apiKey;
        if (cred.authKind) authKind = cred.authKind;
      }
      const related = await retrieveRelatedChunks(
        roadmap.workspaceId,
        `${node.title}. ${node.description}`,
        { k: 6 },
      );
      const excerpts = related.chunks
        .map((r) => `- ${r.chunk.text.slice(0, 500)}`)
        .join("\n");
      const result = await runRoadmapLesson({
        topic: node.title,
        description: node.description,
        roadmapTitle: roadmap.title,
        level: roadmap.level,
        locale,
        ...(excerpts ? { sourceExcerpts: excerpts } : {}),
        modelId: lessonModelId,
        apiKey,
        ...(authKind ? { authKind } : {}),
      });
      if (!mountedRef.current) return;
      const content = composeLessonNote(node.title, result.body);
      if (node.noteId) {
        await updateNote(node.noteId, { content });
      } else {
        const note = await createNote({
          workspaceId: roadmap.workspaceId,
          title: node.title,
          content,
        });
        await updateRoadmapNode(node.id, { noteId: note.id });
      }
      toast({
        variant: "success",
        title: pick("Ders oluşturuldu", "Lesson created"),
        description:
          result.estimatedCostUsd > 0
            ? `~$${result.estimatedCostUsd.toFixed(3)}`
            : pick("ücretsiz", "free"),
      });
      router.push(`/w/${roadmap.workspaceId}/notes`);
      onClose();
    } catch (err) {
      if (!mountedRef.current) return;
      setError(
        err instanceof RoadmapLessonError
          ? `${err.code}: ${err.message}`
          : err instanceof Error
            ? err.message
            : String(err),
      );
    } finally {
      if (mountedRef.current) setLessonBusy(false);
    }
  }

  async function handleCreateSubtasks(): Promise<void> {
    if (depthCapped || busy) return;
    setBusy(true);
    setError(null);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const option = findChatOption(roadmap.model);
      if (!option) {
        throw new RoadmapGenError(
          "unknown_model",
          `Model not registered: ${roadmap.model}`,
        );
      }
      const apiKey = await getApiKey(
        option.presetId as Parameters<typeof getApiKey>[0],
      );
      if (!apiKey || apiKey.length === 0) {
        throw new Error(
          pick(
            "API anahtarı bulunamadı.",
            "No API key found.",
          ),
        );
      }
      const result = await runRoadmapSubtask({
        parentTitle: node.title,
        parentDescription: node.description,
        roadmapTitle: roadmap.title,
        roadmapTimeframe: roadmap.timeframe,
        roadmapLevel: roadmap.level,
        locale,
        modelId: roadmap.model,
        apiKey,
        signal: controller.signal,
      });
      const childDepth = (node.depth + 1) as RoadmapNodeDepth;
      await addSubnodes(
        roadmap.id,
        node.id,
        childDepth,
        result.response.children.map((c) => ({
          tempId: c.id,
          parentId: node.id,
          depth: childDepth,
          title: c.title,
          description: c.description,
        })),
        result.response.edges.map((e) => ({
          fromTempId: e.from,
          toTempId: e.to,
        })),
      );
      toast({
        variant: "success",
        title: pick("Alt konular eklendi", "Subtasks added"),
        description: pick(
          `${result.response.children.length} adet yeni node`,
          `${result.response.children.length} new nodes`,
        ),
      });
    } catch (err) {
      // Aborted (inspector closed mid-stream) is a silent no-op; the
      // component is likely unmounting so don't touch state.
      if (err instanceof RoadmapGenError && err.code === "aborted") return;
      if (!mountedRef.current) return;
      const msg =
        err instanceof RoadmapGenError
          ? err.code === "content_filter"
            ? pick(
                "Model kendi çıktısını engelledi (güvenlik/RECITATION filtresi — Gemini'de müfredat metinlerinde sık). Farklı bir model dene (Claude/OpenAI) ya da konuyu yeniden ifade et.",
                "The model blocked its own output (safety / recitation filter — common on Gemini for curriculum text). Try a different model (Claude/OpenAI) or rephrase.",
              )
            : err.code === "empty_response"
              ? pick(
                  "Model boş yanıt döndü. Tekrar dene veya farklı bir model seç.",
                  "Model returned no content. Retry or pick a different model.",
                )
              : err.code === "parse_error"
                ? pick(
                    "Model geçerli JSON döndürmedi. Tekrar dene ya da daha güvenilir bir model seç (ör. Claude).",
                    "The model didn't return valid JSON. Retry or pick a more reliable model (e.g. Claude).",
                  )
                : `${err.code}: ${err.message}`
          : err instanceof Error
            ? err.message
            : String(err);
      setError(msg);
    } finally {
      abortRef.current = null;
      if (mountedRef.current) setBusy(false);
    }
  }

  async function handleToggleDone(checked: boolean): Promise<void> {
    await setNodeStatus(node.id, checked ? "done" : "todo");
  }

  async function handleDelete(): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      await deleteRoadmapNode(node.id);
      toast({
        variant: "info",
        title: pick("Node silindi", "Node deleted"),
      });
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside
      className={cn(
        "absolute right-0 top-0 z-30 flex h-full w-full max-w-[360px] flex-col",
        "border-l border-rule bg-paper shadow-[var(--shadow-deep)]",
      )}
      aria-label={pick("Node detayları", "Node details")}
    >
      <header className="flex items-start justify-between gap-2 border-b border-rule-soft px-4 py-3">
        <div className="min-w-0">
          <div className="text-[11px] font-mono uppercase tracking-[0.06em] text-ink-4">
            {pick("Node", "Node")} · {pick(
              `Derinlik ${node.depth}`,
              `Depth ${node.depth}`,
            )}
          </div>
          <h2 className="mt-0.5 font-serif text-[16px] font-medium text-ink leading-snug">
            {node.title}
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={pick("Kapat", "Close")}
          className="-m-1 grid h-7 w-7 place-items-center rounded-[8px] text-ink-3 hover:bg-paper-3 hover:text-ink"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </header>
      <div className="flex-1 overflow-auto px-4 py-3">
        <p className="text-[13px] leading-relaxed text-ink-2 whitespace-pre-wrap">
          {node.description}
        </p>
        {node.deckId && deckProgress ? (
          <div className="mt-3 flex items-center gap-2 text-[11.5px] text-ink-4">
            <Layers className="h-3 w-3" aria-hidden />
            <span>
              {pick(
                `${deckProgress.learned}/${deckProgress.total} kart öğrenildi`,
                `${deckProgress.learned}/${deckProgress.total} cards learned`,
              )}
            </span>
            <div className="ml-auto h-1.5 w-20 overflow-hidden rounded-full bg-paper-3">
              <div
                className="h-full bg-ok"
                style={{
                  width: `${
                    deckProgress.total > 0
                      ? Math.round(
                          (deckProgress.learned / deckProgress.total) * 100,
                        )
                      : 0
                  }%`,
                }}
                aria-hidden
              />
            </div>
          </div>
        ) : null}
        <div className="mt-5 flex items-center justify-between gap-3 rounded-[10px] border border-rule-soft bg-paper-2 px-3 py-2.5">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "grid h-7 w-7 place-items-center rounded-full border",
                isDone ? "border-ok bg-ok/15 text-ok" : "border-rule-strong text-ink-3",
              )}
            >
              <Check className="h-3.5 w-3.5" aria-hidden />
            </span>
            <div>
              <div className="text-[13px] font-medium text-ink">
                {pick("Tamamlandı", "Completed")}
              </div>
              <div className="text-[11.5px] text-ink-4">
                {isDone
                  ? pick("Bu konu kapatıldı.", "This topic is marked done.")
                  : pick(
                      "İlerlemeni işaretlemek için aç.",
                      "Flip on to mark progress.",
                    )}
              </div>
            </div>
          </div>
          <Switch
            checked={isDone}
            onCheckedChange={handleToggleDone}
            size="sm"
            ariaLabel={pick("Tamamlandı", "Completed")}
          />
        </div>
        <div className="mt-5 flex flex-col gap-2">
          <Button
            variant="default"
            size="sm"
            onClick={() => void handleStudyAsNote()}
            disabled={noteBusy}
          >
            {noteBusy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <BookOpen className="h-3.5 w-3.5" aria-hidden />
            )}
            {node.noteId
              ? pick("Notu aç", "Open note")
              : pick("Bu konuyu çalış (not)", "Study this (note)")}
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={() => void handleRelated()}
            disabled={related.kind === "loading"}
          >
            {related.kind === "loading" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <Link2 className="h-3.5 w-3.5" aria-hidden />
            )}
            {pick("İlgili kaynaklar", "Related sources")}
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={() => void handleMakeFlashcards()}
            disabled={cardsBusy}
            title={pick(
              "Bu konu için flashcard üret (token harcar)",
              "Generate flashcards for this topic (spends tokens)",
            )}
          >
            {cardsBusy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <Layers className="h-3.5 w-3.5" aria-hidden />
            )}
            {node.deckId
              ? pick("Yeni kartlar üret", "Generate more cards")
              : pick("Flashcard üret", "Make flashcards")}
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={() => void handleGenerateLesson()}
            disabled={lessonBusy}
            title={pick(
              "Bu konu için kaynak-temelli bir ders üret (token harcar)",
              "Generate a source-grounded lesson for this topic (spends tokens)",
            )}
          >
            {lessonBusy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <GraduationCap className="h-3.5 w-3.5" aria-hidden />
            )}
            {node.noteId
              ? pick("Dersi yenile", "Regenerate lesson")
              : pick("Ders üret", "Generate lesson")}
          </Button>
          {related.kind === "done" && related.sources.length > 0 ? (
            <ul className="flex flex-col gap-1 pl-1">
              {related.sources.map((s) => (
                <li key={s.sourceId}>
                  <Link
                    href={`/w/${roadmap.workspaceId}/read/${s.sourceId}`}
                    onClick={onClose}
                    className="flex items-center gap-1.5 text-[12px] text-accent hover:underline"
                  >
                    <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
                    <span className="truncate">
                      {sourceTitleById.get(s.sourceId) ??
                        pick("Kaynak", "Source")}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
          {related.kind === "done" && related.sources.length === 0 ? (
            <p className="text-[11.5px] text-ink-4">
              {pick("İlgili kaynak bulunamadı.", "No related sources found.")}
            </p>
          ) : null}
          {related.kind === "error" ? (
            <p className="text-[11.5px] text-warn">
              {relatedReasonText(related.reason, pick)}
              {related.detail ? (
                <span className="mt-0.5 block break-words font-mono text-[10.5px] text-ink-4">
                  {related.detail}
                </span>
              ) : null}
            </p>
          ) : null}
        </div>
        <div className="mt-5 flex flex-col gap-2">
          <Button
            variant="primary"
            size="sm"
            onClick={handleCreateSubtasks}
            disabled={busy || depthCapped}
            title={
              depthCapped
                ? pick(
                    "Maksimum derinliğe ulaşıldı.",
                    "Maximum depth reached.",
                  )
                : undefined
            }
          >
            {busy ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                {pick("Üretiliyor…", "Generating…")}
              </>
            ) : (
              <>
                <Sparkles className="h-3.5 w-3.5" aria-hidden />
                {pick("Alt konuları üret", "Create subtasks")}
              </>
            )}
          </Button>
          {depthCapped ? (
            <p className="text-[11.5px] text-ink-4">
              {pick(
                "Bu node maksimum derinlikte. Daha fazla alt konu eklenemez.",
                "This node is at max depth. Cannot expand further.",
              )}
            </p>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDelete}
            disabled={busy}
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
            {hasChildren
              ? pick(
                  "Node'u ve alt node'ları sil",
                  "Delete node & subtree",
                )
              : pick("Node'u sil", "Delete node")}
          </Button>
        </div>
        {error ? (
          <div className="mt-4 rounded-[10px] border border-err/30 bg-err/10 px-3 py-2 text-[12px] text-err">
            <div className="flex items-center gap-1.5 font-medium">
              <GitBranchPlus className="h-3 w-3" aria-hidden />
              {pick("Üretim başarısız", "Generation failed")}
            </div>
            <div className="mt-0.5">{error}</div>
          </div>
        ) : null}
      </div>
    </aside>
  );
}

function relatedReasonText(
  reason: RelatedReason,
  pick: (tr: string, en: string) => string,
): string {
  switch (reason) {
    case "no_chunks":
    case "no_embeddings":
      return pick(
        "Bu çalışma alanında henüz gömülü kaynak yok.",
        "No embedded sources in this workspace yet.",
      );
    case "no_key":
      return pick(
        "Embedding API anahtarı bulunamadı.",
        "No embedding API key found.",
      );
    case "embed_failed":
      return pick("Kaynak araması başarısız oldu.", "Source search failed.");
    case "empty":
      return pick("İlgili kaynak bulunamadı.", "No related sources found.");
    default:
      return pick("Kaynak bulunamadı.", "No sources found.");
  }
}
