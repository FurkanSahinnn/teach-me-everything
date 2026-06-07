"use client";

import {
  AlertCircle,
  ArrowLeft,
  BookText,
  ChevronDown,
  ChevronsLeft,
  Check,
  CircleStop,
  CornerUpLeft,
  FileImage,
  Globe,
  Highlighter,
  KeyRound,
  Languages,
  List,
  Loader2,
  Lock,
  NotebookPen,
  PencilLine,
  Send,
  Settings2,
  Sparkles,
  SquareStack,
  Wrench,
  X,
} from "lucide-react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EmptyState } from "@/components/ui/EmptyState";
import { MarkdownPreview } from "@/components/markdown/MarkdownPreview";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { AppShell } from "@/components/shell/AppShell";
import { TweaksPanel } from "@/components/shell/TweaksPanel";
import { Button } from "@/components/ui/Button";
import { Kbd } from "@/components/ui/Kbd";
import { Skeleton } from "@/components/ui/Skeleton";
import {
  CitationChip,
  findChunkForRef,
  parseCitations,
} from "@/components/notebook/CitationChip";
import { ChatBubble as ChatBubbleStandalone } from "@/components/notebook/ChatBubble";
import { ChatThreadSidebar } from "@/components/notebook/ChatThreadSidebar";
import { WebCitationPeekModal } from "@/components/notebook/WebCitationPeekModal";
import { GenerateBatchModal } from "@/components/flashcards/GenerateBatchModal";
import { useLocalePick } from "@/i18n/IntlProvider";
import { getChatProvider, getEmbedProvider } from "@/lib/ai/providers/registry";
import { getAnthropicOAuthChatProvider } from "@/lib/ai/providers/anthropic-oauth";
import { DEFAULT_EMBED_MODEL } from "@/lib/ai/providers/embed-openai";
import { ProviderError, type ProviderId } from "@/lib/ai/providers/types";
import { getPreset } from "@/lib/ai/providers/presets";
import { isLocalUrl } from "@/lib/ai/providers/local-bypass";
import { findChatOption } from "@/lib/ai/model-options";
import { getWebSearchAdapter } from "@/lib/ai/web-search/adapter";
import type { WebCitation, WebSearchUsage } from "@/lib/ai/web-search/types";
import { resolveAnthropicCredential } from "@/lib/ai/anthropic-credential";
import { buildNotebookSystem } from "@/lib/ai/prompts/notebook-chat";
import { buildNotebookTools, type AnthropicTool } from "@/lib/ai/tools";
import { ingestResearchUrl } from "@/lib/research/ingest";
import type { ResearchProviderId } from "@/lib/research/providers/types";
import { resolveResearchCredential } from "@/lib/research/credential";
import {
  runAddFlashcard,
  runOpenCitation,
  runSimplifyExplanation,
  summarizeToolResult,
} from "@/lib/ai/tool-handlers";
import { topKChunks } from "@/lib/ai/retrieval";
import type {
  ContentBlock as AnthropicContentBlock,
  ChatMessage as AnthropicMessage,
} from "@/lib/ai/providers/types";
import { getApiKey } from "@/lib/db/api-keys-repo";
import {
  addMessage,
  addToolResult,
  deleteMessage,
  findOrCreateSourceThread,
  forkThread,
  patchMessageUsage,
  setMessageContent,
  setMessageWebCitations,
  setToolStatus,
} from "@/lib/db/chats";
import { deleteFlashcard } from "@/lib/db/flashcards";
import { createNote } from "@/lib/db/notes";
import { buildHighlightExtractContent } from "@/lib/notes/daily";
import {
  SaveJournalEntryModal,
  type SaveJournalEntryDraft,
} from "@/components/study/SaveJournalEntryModal";
import type { StudySourceRef } from "@/lib/study/types";
import { useToast } from "@/components/ui/Toast";
import {
  useChunksBySource,
  useHighlightsBySource,
  useMessages,
  useSource,
  useSourceBlob,
  useSources,
  useThreadsBySource,
  useWorkspace,
} from "@/lib/db/hooks";
import type {
  ChatMessageRecord,
  ChunkRecord,
  EmbeddingStatus,
  HighlightRecord,
  IngestStatus,
  SourceRecord,
} from "@/lib/db/types";
import type { AiResponseLocale } from "@/stores/prefs";
import { usePrefs, webSearchPrefsToOptions } from "@/stores/prefs";
import { useSelection } from "@/stores/selection";
import { useVault } from "@/stores/vault";
import { cn } from "@/lib/utils/cn";
import type { Provider } from "@/lib/db/schema";
import {
  stripMarkdownHeading,
} from "@/lib/reader/markdown";
import {
  buildReaderOutline,
  splitChunkIntoMarkdownSegments,
} from "@/lib/reader/outline";

// pdfjs-dist is large (~2MB) — only load when the user actually opens
// "Original PDF" mode. ssr:false avoids attempting to import the worker
// during server render where window/document are absent.
const PdfViewer = dynamic(
  () => import("@/components/sources/PdfViewer").then((m) => m.PdfViewer),
  { ssr: false },
);


const RETRIEVAL_TOP_K = 10;
const RETRIEVAL_MAX_TOKENS = 6000;
const RETRIEVAL_FALLBACK_LIMIT = 12;
const MAX_TOOL_ROUNDS = 3;
const FLASHCARD_UNDO_MS = 5000;

type ReaderPanelMode = "closed" | "narrow" | "default" | "wide";

const CHAT_WIDTH_PX: Record<ReaderPanelMode, number> = {
  closed: 52,
  narrow: 320,
  default: 390,
  wide: 520,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function chatModeFromWidth(width: number): ReaderPanelMode {
  if (width <= 72) return "closed";
  if (width < 360) return "narrow";
  if (width < 470) return "default";
  return "wide";
}

const STATUS_COPY: Record<IngestStatus, { tr: string; en: string; tone: "info" | "warn" | "err" | "ok" }> = {
  pending: { tr: "Yükleme sırasında", en: "Awaiting parse", tone: "info" },
  parsing: { tr: "PDF ayrıştırılıyor", en: "Parsing PDF", tone: "info" },
  chunking: { tr: "Bölümlere ayrılıyor", en: "Chunking", tone: "info" },
  ready: { tr: "Hazır", en: "Ready", tone: "ok" },
  error: { tr: "Ayrıştırma başarısız", en: "Parse failed", tone: "err" },
};

const EMBEDDING_COPY: Record<
  EmbeddingStatus,
  { tr: string; en: string; tone: "info" | "warn" | "err" | "ok" }
> = {
  missing: { tr: "Embedding yok", en: "No embeddings", tone: "warn" },
  queued: { tr: "Embedding bekliyor", en: "Embedding queued", tone: "info" },
  embedding: { tr: "Embedding üretiliyor", en: "Generating embeddings", tone: "info" },
  ready: { tr: "AI arama hazır", en: "AI search ready", tone: "ok" },
  skipped: { tr: "Embedding atlandı", en: "Embedding skipped", tone: "warn" },
  error: { tr: "Embedding hatası", en: "Embedding failed", tone: "err" },
};

type ChatStatus =
  | { kind: "idle" }
  | { kind: "preparing" }
  | { kind: "streaming"; messageId: string }
  | { kind: "error"; code: string; message: string };

type MobileTab = "source" | "chat";

// The proxy + provider wrap upstream errors as `${code}: ${message}` because
// the legacy StreamEvent error shape has no separate code field. Pull the code
// back out so the UI can pick a friendly localized message and the right icon.
function parseEventCode(message: string): { code: string | null; clean: string } {
  const match = /^([a-z_][a-z0-9_]*):\s*(.+)$/i.exec(message);
  if (match && match[1] && match[2]) {
    return { code: match[1], clean: match[2] };
  }
  return { code: null, clean: message };
}

function friendlyChatError(
  code: string,
  fallback: string,
  pick: (tr: string, en: string) => string,
  context?: {
    presetLabel?: string;
    modelId?: string;
    // Anthropic-only: which credential actually carried the request. When
    // present we can tell the user OAuth-vs-API-key specifically, instead
    // of the generic "API key was rejected" — confusing when they thought
    // they were on OAuth.
    authKind?: "oauth" | "api-key";
    // True when OAuth was preferred but no OAuth token was on file, so the
    // request silently fell back to the Anthropic API key (which also failed).
    fellBackFromOAuth?: boolean;
    // Raw upstream error text (e.g. Anthropic's `{error.message}`) so the
    // user can tell apart "invalid bearer token" from "direct browser
    // access disabled for this organisation" from rate-limit specifics.
    upstreamDetail?: string;
  },
): string {
  // Surface the resolved provider/model so users can tell at a glance which
  // surface actually failed — without this they assume "the chat broke" when
  // really it was the specific upstream they picked in Settings → Models.
  const tag = context?.presetLabel
    ? context.modelId
      ? ` (${context.presetLabel} · ${context.modelId})`
      : ` (${context.presetLabel})`
    : "";
  const detail =
    context?.upstreamDetail && context.upstreamDetail.trim().length > 0
      ? ` — ${context.upstreamDetail.trim()}`
      : "";
  switch (code) {
    case "rate_limited":
      return pick(
        `Sağlayıcı oran sınırına ulaştı${tag}${detail}. Birkaç dakika bekle ya da Ayarlar → Models'tan farklı bir model seç.`,
        `Provider rate limit reached${tag}${detail}. Wait a few minutes or pick a different model in Settings → Models.`,
      );
    case "unauthorized":
      if (context?.authKind === "oauth") {
        return pick(
          `Claude Code OAuth token reddedildi${tag}${detail}. Terminalde \`claude setup-token\` ile yenisini üret, sonra Ayarlar → API anahtarlarından güncelle. Eğer Anthropic "direct browser access" engellemesi söylüyorsa Anthropic konsolunda "Direct browser access" izinini aç.`,
          `Claude Code OAuth token was rejected${tag}${detail}. Generate a new one with \`claude setup-token\` in your terminal, then update Settings → API keys. If Anthropic says "direct browser access" is blocked, enable that toggle in your Anthropic console.`,
        );
      }
      if (context?.fellBackFromOAuth) {
        return pick(
          `OAuth tercih ettin ama Claude Code OAuth token yok — yedek olarak API anahtarı denendi, o da reddedildi${tag}${detail}. Ayarlar → API anahtarlarından OAuth token ekle ya da geçerli bir API key gir.`,
          `OAuth was preferred but no Claude Code OAuth token is set — fell back to the Anthropic API key, which was also rejected${tag}${detail}. Add an OAuth token or a valid API key in Settings → API keys.`,
        );
      }
      return pick(
        `API anahtarı reddedildi${tag}${detail}. Ayarlar → API anahtarlarından kontrol et.`,
        `API key was rejected${tag}${detail}. Check Settings → API keys.`,
      );
    case "missing_key":
      return pick(
        `API anahtarı yok${tag}. Ayarlar → API anahtarlarından ekle.`,
        `No API key configured${tag}. Add one in Settings → API keys.`,
      );
    case "network":
      return pick(
        `Ağ hatası${tag}. Bağlantını kontrol edip tekrar dene.`,
        `Network error${tag}. Check your connection and try again.`,
      );
    case "upstream_error":
      return pick(
        `Sağlayıcı geçici bir hata döndürdü${tag}. Tekrar dene.`,
        `Provider returned a transient error${tag}. Try again.`,
      );
    default:
      return fallback;
  }
}

export default function NotebookReaderPage() {
  const params = useParams<{ id: string; sourceId: string }>();
  const workspaceId = params.id;
  const sourceId = params.sourceId;
  const t = useTranslations("reader");
  const pick = useLocalePick();
  const locale = usePrefs((s) => s.locale);
  const aiResponseLocale = usePrefs((s) => s.aiResponseLocale);
  const setAiResponseLocale = usePrefs((s) => s.setAiResponseLocale);
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const activeTab: MobileTab = tabParam === "chat" ? "chat" : "source";
  const [chatWidth, setChatWidth] = useState(CHAT_WIDTH_PX.default);
  const chatMode = chatModeFromWidth(chatWidth);

  const setActiveTab = useCallback(
    (next: MobileTab) => {
      if (next === activeTab) return;
      const sp = new URLSearchParams(searchParams.toString());
      if (next === "source") sp.delete("tab");
      else sp.set("tab", next);
      const qs = sp.toString();
      router.replace(qs ? `?${qs}` : "?", { scroll: false });
    },
    [activeTab, router, searchParams],
  );

  const desktopGridColumns = useMemo(
    () => `minmax(0,1fr) 6px ${chatWidth}px`,
    [chatWidth],
  );

  function setChatMode(next: ReaderPanelMode): void {
    setChatWidth(CHAT_WIDTH_PX[next]);
  }

  const desktopGridRef = useRef<HTMLDivElement | null>(null);

  function startChatResize(event: React.MouseEvent<HTMLDivElement>): void {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = chatWidth;
    let nextWidth = startWidth;
    let frameQueued = false;
    const applyToDom = (): void => {
      frameQueued = false;
      if (desktopGridRef.current) {
        // Bypass React entirely during the drag — writing the grid track
        // straight to the DOM avoids re-rendering the reader subtree on
        // every mousemove. setState only happens once on mouseup.
        desktopGridRef.current.style.gridTemplateColumns = `minmax(0,1fr) 6px ${nextWidth}px`;
      }
    };
    const onMove = (moveEvent: MouseEvent): void => {
      nextWidth = clamp(startWidth - (moveEvent.clientX - startX), 52, 560);
      if (!frameQueued) {
        frameQueued = true;
        window.requestAnimationFrame(applyToDom);
      }
    };
    const onUp = (): void => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      // Commit final width once — chatMode (narrow/default/wide) reflows
      // ChatPanel only at the end of the drag instead of every frame.
      setChatWidth(nextWidth);
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  const ws = useWorkspace(workspaceId);
  const source = useSource(sourceId);
  const chunks = useChunksBySource(sourceId) ?? [];
  const highlights = useHighlightsBySource(sourceId) ?? [];
  // Phase 6.9.7 — surface note-sources in chat citations. Workspace-scoped
  // list so the emerald NotebookPen chip can fire for ANY citation whose
  // chunk resolves to a note-source (cross-source retrieval is forward-
  // looking, but the lookup is correct today). Memoize the Set + Map so the
  // ChatBubble useMemo dep doesn't churn on every re-render.
  const allWorkspaceSources = useSources(workspaceId) ?? [];
  const noteSourceById = useMemo(() => {
    const m = new Map<string, { noteId: string | undefined }>();
    for (const s of allWorkspaceSources) {
      if (s.type === "note") {
        m.set(s.id, { noteId: s.noteId });
      }
    }
    return m;
  }, [allWorkspaceSources]);
  const noteSourceIds = useMemo(
    () => new Set(noteSourceById.keys()),
    [noteSourceById],
  );

  const isVaultUnlocked = useVault((s) => s.isUnlocked);
  const masterKey = useVault((s) => s.masterKey);
  const { toast } = useToast();

  const threadsForSource = useThreadsBySource(sourceId) ?? [];
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  // Sort pinned-first then newest. Default to first sorted thread when no
  // explicit selection has been made yet.
  const sortedThreads = useMemo(
    () =>
      [...threadsForSource].sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return b.updatedAt - a.updatedAt;
      }),
    [threadsForSource],
  );
  const threadId =
    activeThreadId && sortedThreads.some((t) => t.id === activeThreadId)
      ? activeThreadId
      : sortedThreads[0]?.id;
  const messages = useMessages(threadId) ?? [];

  // Draft text lives INSIDE ChatPanel — keeping it here would re-render
  // the entire ReaderPanel (Reading article + PdfViewer if mounted +
  // chunks list + sidebars) on every keystroke, which causes visible
  // typing lag on long sources.
  // When the user clicks "Sor" on a selection popover, we don't auto-send a
  // canned "explain this" prompt anymore — the selected passage shows up as
  // a quote chip above the input so the user can write their own question.
  // Cleared on send (the chip's text is prepended to the final message) or
  // via the explicit X button on the chip.
  const [quotedText, setQuotedText] = useState<string | null>(null);
  const [chatStatus, setChatStatus] = useState<ChatStatus>({ kind: "idle" });
  const [vaultModalOpen, setVaultModalOpen] = useState(false);
  const [genCardsOpen, setGenCardsOpen] = useState(false);
  // When the user clicks "Karta çevir" on a chat bubble, we capture the
  // exchange into single-mode state and let the modal forward the chat
  // context to runFlashcardGen. Cleared on close so the source-wide CTA
  // re-opens in batch mode.
  const [singleCardsCtx, setSingleCardsCtx] = useState<
    { chatContext: string; threadId?: string } | null
  >(null);

  // Phase 5.5.C.B — web-search peek modal target. ChatBubble forwards
  // chip clicks here; `WebCitationPeekModal` reads + renders + offers
  // "Make a source" against `ingestResearchUrl`.
  const [peekCitation, setPeekCitation] = useState<WebCitation | null>(null);
  // Sticky-in-session toggle. Initialized from the user's stored default
  // in Settings → Preferences (`prefs.webSearchPrefs.enabled`) but the
  // user can flip it per-message; we don't write the per-message state
  // back to prefs because the Settings value is "what to start with",
  // not "what's currently active".
  const webSearchDefault = usePrefs((s) => s.webSearchPrefs.enabled);
  const [webSearchEnabled, setWebSearchEnabled] = useState<boolean>(webSearchDefault);
  // Re-sync once if the user changes the default in Settings while this
  // page is mounted but BEFORE they've toggled per-message. After the
  // first toggle the per-message state owns the value.
  const userHasToggledRef = useRef(false);
  useEffect(() => {
    if (!userHasToggledRef.current) setWebSearchEnabled(webSearchDefault);
  }, [webSearchDefault]);
  const handleWebSearchToggle = useCallback((next: boolean) => {
    userHasToggledRef.current = true;
    setWebSearchEnabled(next);
  }, []);

  // Build chatContext from the assistant message + its preceding user turn
  // so the prompt has both Q and A. Truncate each side to ~600 chars to
  // keep the system block compact and preserve cache hits.
  const handleProposeCardsFromMessage = useCallback(
    (messageId: string) => {
      const idx = messages.findIndex((m) => m.id === messageId);
      if (idx === -1) return;
      const assistant = messages[idx];
      if (!assistant || assistant.role !== "assistant") return;
      let userTurn = "";
      for (let i = idx - 1; i >= 0; i -= 1) {
        const m = messages[i];
        if (m && m.role === "user") {
          userTurn = m.content ?? "";
          break;
        }
      }
      const trim = (s: string, max = 600): string =>
        s.length <= max ? s : `${s.slice(0, max).trim()}…`;
      const userLabel = pick("Kullanıcı", "User");
      const assistantLabel = pick("Asistan", "Assistant");
      const ctxParts: string[] = [];
      if (userTurn) ctxParts.push(`${userLabel}: ${trim(userTurn)}`);
      if (assistant.content) {
        ctxParts.push(`${assistantLabel}: ${trim(assistant.content)}`);
      }
      if (ctxParts.length === 0) return;
      setSingleCardsCtx({
        chatContext: ctxParts.join("\n\n"),
        ...(threadId ? { threadId } : {}),
      });
    },
    [messages, pick, threadId],
  );

  // Draft surfaced to SaveJournalEntryModal. The reader extracts the Q&A
  // pair + citation refs; the modal handles AI-suggested title/tags and
  // the actual createStudyJournalEntry write so the user can review and
  // edit metadata before persisting.
  const [journalDraft, setJournalDraft] =
    useState<SaveJournalEntryDraft | null>(null);

  // Build a SaveJournalEntryDraft from the assistant turn (paired with its
  // preceding user question) and open SaveJournalEntryModal. We extract
  // `[§ref]` citations from the assistant text and resolve them back to
  // chunk ids so the journal entry can deep-link into the right source
  // passages later. When no citations were emitted (model answered without
  // grounding), fall back to a single sourceId-only ref so the entry still
  // routes back to this source.
  const handleSaveJournalEntry = useCallback(
    (messageId: string) => {
      const idx = messages.findIndex((m) => m.id === messageId);
      if (idx === -1) return;
      const assistant = messages[idx];
      if (!assistant || assistant.role !== "assistant" || !assistant.content) return;
      let userTurn = "";
      for (let i = idx - 1; i >= 0; i -= 1) {
        const m = messages[i];
        if (m && m.role === "user") {
          userTurn = m.content ?? "";
          break;
        }
      }
      if (!userTurn || !source) return;

      const citationRefs = parseCitations(assistant.content)
        .filter((tok) => tok.kind === "citation")
        .map((tok) => (tok.kind === "citation" ? tok.ref : ""));
      const citedById = new Map<string, ChunkRecord>();
      for (const ref of citationRefs) {
        const chunk = findChunkForRef(ref, chunks);
        if (chunk && !citedById.has(chunk.id)) citedById.set(chunk.id, chunk);
      }
      const refsBySource = new Map<string, string[]>();
      const citedSectionsSet = new Set<string>();
      for (const chunk of citedById.values()) {
        const arr = refsBySource.get(chunk.sourceId) ?? [];
        arr.push(chunk.id);
        refsBySource.set(chunk.sourceId, arr);
        const section = chunk.section ?? chunk.headings?.[0];
        if (section) citedSectionsSet.add(section);
      }
      const sourceRefs: StudySourceRef[] = [...refsBySource.entries()].map(
        ([sId, chunkIds]) => ({ sourceId: sId, chunkIds }),
      );
      if (sourceRefs.length === 0) sourceRefs.push({ sourceId });

      const trimmedQuestion =
        userTurn.length > 500 ? `${userTurn.slice(0, 500).trim()}…` : userTurn;

      const draftSource: SaveJournalEntryDraft["source"] = { id: sourceId };
      if (source.title !== undefined) draftSource.title = source.title;
      if (source.titleEn !== undefined) draftSource.titleEn = source.titleEn;
      if (source.author !== undefined) draftSource.author = source.author;

      const draft: SaveJournalEntryDraft = {
        workspaceId,
        workspace: {
          name: ws?.name ?? "",
          ...(ws?.goal !== undefined ? { goal: ws.goal } : {}),
        },
        source: draftSource,
        question: trimmedQuestion,
        answerMarkdown: assistant.content,
        sourceRefs,
        ...(citedSectionsSet.size > 0
          ? { citedSections: [...citedSectionsSet] }
          : {}),
      };
      setJournalDraft(draft);
    },
    [chunks, messages, source, sourceId, workspaceId, ws?.name, ws?.goal],
  );
  // Surfaced to ChatPanel so the dim-mismatch banner can offer a Settings deep
  // link when the most recent retrieval silently skipped chunks (3.3.D guard).
  const [lastSkippedCount, setLastSkippedCount] = useState(0);

  const streamControllerRef = useRef<{ abort: () => void } | null>(null);
  const pendingMessageRef = useRef<string | null>(null);

  useEffect(() => {
    // selectionchange fires constantly during drag. We only need to clear
    // the popover when the selection collapses — `sel.isCollapsed` is a
    // free check; calling `.toString()` here would materialize the entire
    // selected text on every fire and freeze the UI on long selections.
    // Selection state lives in a tiny Zustand store so this listener does
    // NOT trigger a re-render of the page (and therefore ReaderPanel /
    // MarkdownPreview).
    function onSelectionChange() {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) useSelection.getState().setSelection(null);
    }
    document.addEventListener("selectionchange", onSelectionChange);
    return () => document.removeEventListener("selectionchange", onSelectionChange);
  }, []);

  useEffect(() => {
    return () => {
      streamControllerRef.current?.abort();
    };
  }, []);

  // chatStatus is sticky — once a `vault_locked` error is set the banner
  // stays visible until something explicitly resets it. We watch `masterKey`
  // (the CryptoKey reference, which is freshly derived per unlock) instead of
  // the `isUnlocked` boolean so that re-unlocking while already unlocked
  // (e.g. clicking the banner's Unlock link after a stale vault_locked toast)
  // still re-fires this effect and clears the banner.
  useEffect(() => {
    if (!masterKey) return;
    setChatStatus((prev) => {
      if (prev.kind === "error" && prev.code === "vault_locked") {
        return { kind: "idle" };
      }
      return prev;
    });
  }, [masterKey]);

  const runChat = useCallback(
    async (
      userMessage: string,
      sourceRec: SourceRecord,
      sourceChunks: ChunkRecord[],
      opts?: {
        webSearchEnabled?: boolean;
        // Retry path: supply a truncated message list to use as API history.
        // Without this, runChat reads `messages` from its closure, which on
        // retry still contains the failed assistant turn — producing both a
        // duplicate "..." bubble and a duplicate user turn in the request.
        historyOverride?: ChatMessageRecord[];
      },
    ) => {
      const useWebSearch = opts?.webSearchEnabled === true;
      // Read fresh from the store — when this fires from MasterPasswordModal's
      // onSuccess via queueMicrotask, the captured `masterKey` from useCallback
      // closure is still the pre-unlock null because React hasn't re-rendered
      // yet. Reading via getState() always sees the just-set CryptoKey.
      const currentMasterKey = useVault.getState().masterKey;
      if (!currentMasterKey) {
        setChatStatus({
          kind: "error",
          code: "vault_locked",
          message: pick("Anahtar kilitli.", "Vault is locked."),
        });
        return;
      }

      // Resolve the user's Settings → Models selection. We deliberately do
      // NOT fall back to a hardcoded model: the picker is the authoritative
      // selection, so silently routing to Anthropic when the user picked
      // Groq is the exact bug we're fixing here. If the stored binding no
      // longer maps to a registered preset (e.g. preset removed across an
      // update) we surface that explicitly.
      const chatBinding = usePrefs.getState().modelBindings.chat;
      const chosen = findChatOption(chatBinding);
      if (!chosen) {
        setChatStatus({
          kind: "error",
          code: "model_unknown",
          message: pick(
            "Seçili model artık kayıtlı değil. Ayarlar → Models'tan başka bir model seç.",
            "Selected model is no longer registered. Pick another in Settings → Models.",
          ),
        });
        return;
      }
      const chatPresetId: ProviderId = chosen.presetId;
      const chatModelId = chosen.modelId;
      const chatPreset = getPreset(chatPresetId);
      const chatPresetLabel = chatPreset?.label ?? String(chatPresetId);
      const chatIsLocal = chatPreset ? isLocalUrl(chatPreset.baseUrl) : false;

      let apiKey = "";
      let authKind: "oauth" | "api-key" | undefined;

      if (chatPresetId === "anthropic") {
        // Honour the OAuth ↔ API-key preference exactly as before. This is
        // the only family where we have two credential kinds.
        let credential: Awaited<
          ReturnType<typeof resolveAnthropicCredential>
        > = null;
        try {
          credential = await resolveAnthropicCredential();
        } catch {
          setChatStatus({
            kind: "error",
            code: "key_decrypt",
            message: pick(
              "Anahtar çözülemedi. Vault'u tekrar aç.",
              "Could not decrypt key. Re-open the vault.",
            ),
          });
          return;
        }
        if (!credential) {
          setChatStatus({
            kind: "error",
            code: "key_missing",
            message: pick(
              "Anthropic kimliği yok. Ayarlar → API anahtarları.",
              "No Anthropic credential. Settings → API keys.",
            ),
          });
          return;
        }
        apiKey = credential.key;
        authKind = credential.kind;
      } else if (chatIsLocal) {
        // Local self-hosted endpoints (Ollama / LM Studio / llama.cpp) skip
        // the proxy entirely and accept an empty bearer.
        apiKey = "";
      } else {
        let key: string | null = null;
        try {
          key = await getApiKey(chatPresetId as Provider);
        } catch {
          setChatStatus({
            kind: "error",
            code: "key_decrypt",
            message: pick(
              "Anahtar çözülemedi. Vault'u tekrar aç.",
              "Could not decrypt key. Re-open the vault.",
            ),
          });
          return;
        }
        if (!key) {
          setChatStatus({
            kind: "error",
            code: "key_missing",
            message: pick(
              `${chatPresetLabel} için API anahtarı yok. Ayarlar → API anahtarları.`,
              `No API key for ${chatPresetLabel}. Settings → API keys.`,
            ),
          });
          return;
        }
        apiKey = key;
      }

      setChatStatus({ kind: "preparing" });

      const thread = await findOrCreateSourceThread(
        workspaceId,
        sourceId,
        sourceRec.title,
      );

      await addMessage({
        threadId: thread.id,
        workspaceId,
        role: "user",
        content: userMessage,
      });

      // Retrieval. If we have any embedded chunks, embed the query via OpenAI
      // and pick top-K. If no embeddings exist yet (e.g. user never added an
      // OpenAI key), fall back to the first N chunks so the chat still
      // functions — degraded but not broken.
      const chunksWithEmbeddings = sourceChunks.filter((c) => c.embedding);
      let promptChunks = sourceChunks.slice(0, RETRIEVAL_FALLBACK_LIMIT);
      let retrievalEmpty = false;

      if (chunksWithEmbeddings.length > 0) {
        const embeddingProvider =
          chunksWithEmbeddings.find((c) => c.embeddingProvider)?.embeddingProvider ??
          "openai";
        const embeddingModel =
          chunksWithEmbeddings.find((c) => c.embeddingModel)?.embeddingModel ??
          DEFAULT_EMBED_MODEL;
        let embedKey: string | null = null;
        try {
          embedKey =
            embeddingProvider === "ollama"
              ? ""
              : await getApiKey(embeddingProvider as Provider);
        } catch {
          embedKey = null;
        }

        if (embedKey != null) {
          try {
            const queryEmbed = await getEmbedProvider(embeddingProvider as ProviderId).embed({
              apiKey: embedKey,
              model: embeddingModel,
              inputs: [userMessage],
            });
            const queryVec = queryEmbed.vectors[0];
            if (queryVec) {
              const retrieved = topKChunks({
                queryEmbedding: queryVec,
                chunks: chunksWithEmbeddings,
                k: RETRIEVAL_TOP_K,
                maxTokens: RETRIEVAL_MAX_TOKENS,
              });
              setLastSkippedCount(retrieved.skippedCount);
              if (retrieved.chunks.length === 0) {
                retrievalEmpty = true;
              } else {
                promptChunks = retrieved.chunks.map((r) => r.chunk);
              }
            }
          } catch (err) {
            const code =
              err instanceof ProviderError ? err.code : "embed_failed";
            const rawMessage =
              err instanceof Error
                ? err.message
                : pick("Embedding hatası.", "Embedding error.");
            setChatStatus({
              kind: "error",
              code,
              message: friendlyChatError(code, rawMessage, pick),
            });
            return;
          }
        }
      }

      const system = buildNotebookSystem({
        source: sourceRec,
        chunks: promptChunks,
        locale,
        aiResponseLocale,
      });
      const tools: AnthropicTool[] = [...buildNotebookTools(locale)];

      // Phase 5.5.C.B — splice the provider's native web-search tool block
      // into `tools[]` when the per-message toggle is on AND the resolved
      // chat provider has a registered adapter. The adapter returns a
      // provider-specific shape (Anthropic's `web_search_20260209` lacks
      // `input_schema`); we cast to AnthropicTool because the API accepts
      // both classic tools and server tools in the same `tools` array.
      const webSearchAdapter = useWebSearch
        ? getWebSearchAdapter(chatPresetId)
        : null;
      if (webSearchAdapter) {
        const opts = webSearchPrefsToOptions(usePrefs.getState().webSearchPrefs);
        const toolBlock = webSearchAdapter.buildToolBlock(opts);
        tools.push(toolBlock as unknown as AnthropicTool);
      }

      const apiMessages: AnthropicMessage[] = [
        ...(opts?.historyOverride ?? messages)
          .filter(
            (m) =>
              (m.role === "user" || m.role === "assistant") &&
              !m.toolName &&
              m.content.trim().length > 0,
          )
          .map((m) => ({
            role: m.role as "user" | "assistant",
            content: m.content,
          })),
        { role: "user", content: userMessage },
      ];

      let streamError: { code: string; message: string } | undefined;
      let interrupted = false;

      // OAuth chat is handled server-side by claude-agent-sdk: it spawns the
      // Claude Code CLI with the user's OAuth token, runs the tool round-trip
      // internally, and streams the resulting Anthropic SSE back. From this
      // loop's POV that means a single round (no follow-up call needed) and
      // tool side effects must be mirrored on the client even when the final
      // stopReason is "end_turn" rather than "tool_use".
      const isOAuth = chatPresetId === "anthropic" && authKind === "oauth";

      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const initialAssistantContent =
          round === 0 && retrievalEmpty
            ? pick(
                "Bu kaynakta soruyla doğrudan eşleşen pasaj bulunamadı.\n\n",
                "No passage in this source matched the query.\n\n",
              )
            : "";
        const assistant = await addMessage({
          threadId: thread.id,
          workspaceId,
          role: "assistant",
          content: initialAssistantContent,
          model: chatModelId,
        });

        setChatStatus({ kind: "streaming", messageId: assistant.id });

        const provider = isOAuth
          ? getAnthropicOAuthChatProvider()
          : getChatProvider(chatPresetId);
        const handle = provider.streamChat({
          apiKey,
          ...(authKind ? { authKind } : {}),
          model: chatModelId,
          system,
          messages: apiMessages,
          maxTokens: 1024,
          tools,
          tool_choice: { type: "auto" },
        });
        streamControllerRef.current = { abort: handle.abort };

        let buffer = initialAssistantContent;
        let tokensIn = 0;
        let tokensOut = 0;
        let cacheRead = 0;
        let cacheCreation = 0;
        let stopReason: string | undefined;
        const toolCalls: { id: string; name: string; input: string }[] = [];
        // Phase 5.5.C.B — per-message web-search accumulators. We persist
        // these at message-flush time so ChatBubble's "Kaynaklar (N)" footer
        // shows up as soon as the model emits citations, not just on stream
        // end. The adapter is queried per raw event and dedup'd by URL.
        const webCitations: WebCitation[] = [];
        const webCitationUrls = new Set<string>();
        let webSearchUsage: WebSearchUsage | undefined;

        const flush = async () => {
          await setMessageContent(assistant.id, buffer);
        };
        // Non-blocking throttled flush: previously every text delta did
        // `await setMessageContent(...)` inside the SSE for-await loop, which
        // gated each upstream chunk on a Dexie commit + useLiveQuery + full
        // React re-render (markdown re-parse of the growing string). On Tauri
        // WebView the cumulative jank froze the whole UI until stream end.
        // Now: at most one write in flight, the latest buffer always wins,
        // and the SSE loop never awaits a write — chunks arrive as fast as
        // the wire allows. Final `await flush()` after the loop still
        // guarantees the last bytes land before usage/stopReason is written.
        let flushTimer: ReturnType<typeof setTimeout> | null = null;
        let flushInFlight = false;
        let pendingFlush = false;
        const runFlush = async (): Promise<void> => {
          if (flushInFlight) {
            pendingFlush = true;
            return;
          }
          flushInFlight = true;
          try {
            await flush();
          } finally {
            flushInFlight = false;
            if (pendingFlush) {
              pendingFlush = false;
              void runFlush();
            }
          }
        };
        const scheduleFlush = (): void => {
          if (flushTimer) return;
          flushTimer = setTimeout(() => {
            flushTimer = null;
            void runFlush();
          }, 80);
        };

        try {
          for await (const event of handle.events) {
            if (event.kind === "start") {
              tokensIn = event.usage.input_tokens ?? tokensIn;
              cacheRead = event.usage.cache_read_input_tokens ?? cacheRead;
              cacheCreation =
                event.usage.cache_creation_input_tokens ?? cacheCreation;
            } else if (event.kind === "text") {
              buffer += event.delta;
              scheduleFlush();
            } else if (event.kind === "tool_start") {
              toolCalls[event.index] = {
                id: event.id,
                name: event.name,
                input: "",
              };
            } else if (event.kind === "tool_input_delta") {
              const slot = toolCalls[event.index];
              if (slot) slot.input += event.partial;
            } else if (event.kind === "tool_stop") {
              // boundary marker; nothing to do
            } else if (event.kind === "delta") {
              tokensOut = event.usage.output_tokens ?? tokensOut;
              tokensIn = event.usage.input_tokens ?? tokensIn;
              cacheRead = event.usage.cache_read_input_tokens ?? cacheRead;
              cacheCreation =
                event.usage.cache_creation_input_tokens ?? cacheCreation;
              stopReason = event.stopReason ?? stopReason;
            } else if (event.kind === "stop") {
              // final flush handled below
            } else if (event.kind === "abort") {
              interrupted = true;
              break;
            } else if (event.kind === "error") {
              streamError = {
                code: event.status === 401 ? "unauthorized" : "stream",
                message: event.message,
              };
              break;
            } else if (event.kind === "raw" && webSearchAdapter) {
              const parsed = webSearchAdapter.parseStreamEvent(event.payload);
              if (parsed) {
                let appended = false;
                for (const c of parsed.citations) {
                  if (!webCitationUrls.has(c.result.url)) {
                    webCitationUrls.add(c.result.url);
                    webCitations.push(c);
                    appended = true;
                  }
                }
                if (parsed.usage) webSearchUsage = parsed.usage;
                // Persist incrementally so the bubble's "Sources (N)" footer
                // counts up live alongside the streamed text. Cheap because
                // it's a single Dexie row update with a few KB of JSON.
                if (appended) {
                  await setMessageWebCitations(assistant.id, {
                    webSearchUsed: true,
                    webCitations: [...webCitations],
                  });
                }
              }
            }
          }
        } catch (err) {
          streamError = {
            code: "stream",
            message: err instanceof Error ? err.message : "Stream failed",
          };
        }

        if (flushTimer) {
          clearTimeout(flushTimer);
          flushTimer = null;
        }
        await flush();
        await patchMessageUsage(assistant.id, {
          tokensIn: tokensIn || undefined,
          tokensOut: tokensOut || undefined,
          cacheReadTokens: cacheRead || undefined,
          cacheCreationTokens: cacheCreation || undefined,
          stopReason,
          interrupted: interrupted ? true : undefined,
        });
        // Final flush: webSearchUsed flag is set even when zero citations
        // came back (model called the tool but every result was filtered
        // out) so the bubble shows "web search" badge. Usage tick is kept
        // in memory only for now — Phase 5.5.E will surface cost in UI.
        if (webSearchAdapter && (webCitations.length > 0 || webSearchUsage)) {
          await setMessageWebCitations(assistant.id, {
            webSearchUsed: true,
            webCitations: [...webCitations],
          });
        }

        streamControllerRef.current = null;

        if (streamError || interrupted) break;

        const realToolCalls = toolCalls.filter(
          (t): t is { id: string; name: string; input: string } => Boolean(t),
        );
        // OAuth: SDK already gave the model the tool result, so stopReason
        // is typically "end_turn". We still want to execute side effects
        // (Dexie write, toast, citation jump) for any tool calls observed.
        // Other paths only enter the side-effect block when the model
        // explicitly stopped to wait for a tool result.
        const hasToolWork = realToolCalls.length > 0;
        const shouldExecuteTools = isOAuth
          ? hasToolWork
          : stopReason === "tool_use" && hasToolWork;
        if (!shouldExecuteTools) break;

        const assistantBlocks: AnthropicContentBlock[] = [];
        if (buffer) assistantBlocks.push({ type: "text", text: buffer });
        const parsedCalls = realToolCalls.map((tc) => {
          let input: Record<string, unknown> = {};
          try {
            input = tc.input ? (JSON.parse(tc.input) as Record<string, unknown>) : {};
          } catch {
            input = {};
          }
          return { ...tc, parsed: input };
        });
        for (const tc of parsedCalls) {
          assistantBlocks.push({
            type: "tool_use",
            id: tc.id,
            name: tc.name,
            input: tc.parsed,
          });
        }
        apiMessages.push({ role: "assistant", content: assistantBlocks });

        const resultBlocks: AnthropicContentBlock[] = [];
        let simplifyExtraText: string | null = null;

        for (const tc of parsedCalls) {
          const toolUseRecord = await addMessage({
            threadId: thread.id,
            workspaceId,
            role: "assistant",
            content: "",
            toolName: tc.name,
            toolArgs: tc.parsed,
            toolUseId: tc.id,
            toolStatus: "pending",
          });

          let resultStr = "";
          let status: "ok" | "error" = "ok";
          const handlerCtx = {
            workspaceId,
            sourceId,
            chunks: sourceChunks,
            locale,
          };

          if (tc.name === "add_flashcard") {
            const r = await runAddFlashcard(tc.parsed, handlerCtx);
            resultStr = summarizeToolResult(tc.name, r);
            status = r.ok ? "ok" : "error";
            if (r.ok) {
              const flashcardId = r.flashcardId;
              toast({
                variant: "success",
                title: pick("Kart eklendi", "Card added"),
                description: pick(
                  `${tc.parsed.question as string}`.slice(0, 80),
                  `${tc.parsed.question as string}`.slice(0, 80),
                ),
                duration: FLASHCARD_UNDO_MS,
                action: {
                  label: pick("Geri al", "Undo"),
                  onClick: () => {
                    void deleteFlashcard(flashcardId).then(() => {
                      toast({
                        variant: "info",
                        title: pick(
                          "Kart geri alındı",
                          "Card removed",
                        ),
                      });
                    });
                  },
                },
              });
            } else {
              toast({
                variant: "error",
                title: pick(
                  "Kart eklenemedi",
                  "Could not add card",
                ),
                description: r.error,
              });
            }
          } else if (tc.name === "open_citation") {
            const r = runOpenCitation(tc.parsed, handlerCtx, jumpToChunk);
            resultStr = summarizeToolResult(tc.name, r);
            status = r.ok ? "ok" : "error";
            if (!r.ok) {
              toast({
                variant: "warn",
                title: pick(
                  "Alıntı bulunamadı",
                  "Citation not found",
                ),
              });
            }
          } else if (tc.name === "simplify_explanation") {
            const r = runSimplifyExplanation(tc.parsed, userMessage, locale);
            resultStr = summarizeToolResult(tc.name, r);
            simplifyExtraText = r.requeue;
            await addMessage({
              threadId: thread.id,
              workspaceId,
              role: "user",
              content: r.requeue,
            });
          } else {
            resultStr = JSON.stringify({ ok: false, error: "unknown_tool" });
            status = "error";
          }

          await addToolResult({
            threadId: thread.id,
            workspaceId,
            toolUseId: tc.id,
            toolName: tc.name,
            content: resultStr,
            status,
          });
          await setToolStatus(toolUseRecord.id, status);
          resultBlocks.push({
            type: "tool_result",
            tool_use_id: tc.id,
            content: resultStr,
            ...(status === "error" ? { is_error: true } : {}),
          });
        }

        // OAuth: tool round-trip already happened server-side inside the
        // SDK; the model has seen the (stub) result and has nothing more
        // to add here. Skip the follow-up turn entirely.
        if (isOAuth) break;

        const userBlocks: AnthropicContentBlock[] = [...resultBlocks];
        if (simplifyExtraText) {
          userBlocks.push({ type: "text", text: simplifyExtraText });
        }
        apiMessages.push({ role: "user", content: userBlocks });
      }

      streamControllerRef.current = null;

      if (streamError) {
        const parsed = parseEventCode(streamError.message);
        // streamError.code is the HTTP-mapped category we set on the
        // upstream call (e.g. "unauthorized" for 401). parsed.code is the
        // upstream provider's taxonomy (e.g. Anthropic's
        // "authentication_error") — which won't match any case in
        // friendlyChatError's switch and would silently drop user-facing
        // guidance. For HTTP-level categories prefer streamError.code so
        // OAuth/API-key hint copy actually fires.
        const finalCode =
          streamError.code === "unauthorized" ||
          streamError.code === "rate_limited" ||
          streamError.code === "network"
            ? streamError.code
            : parsed.code ?? streamError.code;
        // For Anthropic specifically: if the user preferred OAuth but no
        // OAuth token was on file, resolveAnthropicCredential silently fell
        // back to the API key. The default "API key was rejected" copy is
        // misleading in that case — friendlyChatError uses these flags to
        // pick the right wording.
        const preferredAuth = usePrefs.getState().preferredAnthropicAuth;
        const fellBackFromOAuth =
          chatPresetId === "anthropic" &&
          authKind === "api-key" &&
          preferredAuth === "oauth";
        setChatStatus({
          kind: "error",
          code: finalCode,
          message: friendlyChatError(finalCode, parsed.clean, pick, {
            presetLabel: chatPresetLabel,
            modelId: chatModelId,
            ...(authKind ? { authKind } : {}),
            ...(fellBackFromOAuth ? { fellBackFromOAuth: true } : {}),
            // parsed.clean already strips the "code: " prefix off
            // streamError.message, so it's the upstream's human-readable
            // reason verbatim. Surface it so the user can distinguish
            // "invalid bearer" from "direct browser access disabled".
            ...(parsed.clean && parsed.clean !== streamError.message
              ? { upstreamDetail: parsed.clean }
              : { upstreamDetail: streamError.message }),
          }),
        });
        return;
      }

      setChatStatus({ kind: "idle" });
    },
    [locale, aiResponseLocale, masterKey, messages, pick, sourceId, toast, workspaceId],
  );

  const sendMessage = useCallback(
    (raw: string) => {
      const message = raw.trim();
      if (!message) return;
      if (chatStatus.kind === "preparing" || chatStatus.kind === "streaming") {
        return;
      }
      if (!source || source.workspaceId !== workspaceId) return;
      // Draft is owned by ChatPanel and cleared there after onSend.

      if (!isVaultUnlocked || !masterKey) {
        pendingMessageRef.current = message;
        setVaultModalOpen(true);
        return;
      }

      void runChat(message, source, chunks, { webSearchEnabled });
    },
    [chatStatus.kind, chunks, isVaultUnlocked, masterKey, runChat, source, webSearchEnabled, workspaceId],
  );

  const cancelStream = useCallback(() => {
    streamControllerRef.current?.abort();
  }, []);

  const handleRetry = useCallback(
    async (messageId: string) => {
      // Don't kick off a retry while a chat is already in flight — otherwise
      // the page renders a second "..." placeholder for the new attempt while
      // the previous one is still streaming/preparing.
      if (chatStatus.kind === "preparing" || chatStatus.kind === "streaming") {
        return;
      }
      // Find the message and walk back to the most recent preceding user msg.
      const idx = messages.findIndex((m) => m.id === messageId);
      if (idx < 0) return;
      let userIdx = -1;
      for (let i = idx; i >= 0; i--) {
        const cand = messages[i];
        if (cand && cand.role === "user" && !cand.toolName) {
          userIdx = i;
          break;
        }
      }
      if (userIdx < 0) return;
      const userMsg = messages[userIdx];
      if (!userMsg || !source) return;
      // Drop the failed turn (the user message we're retrying + anything
      // after it: empty assistant placeholder, tool results) from Dexie so
      // the chat thread shows a clean re-run instead of stacking bubbles.
      // We pass the pre-user-msg slice to runChat as historyOverride because
      // the closure's `messages` won't reflect the deletes synchronously.
      const historyOverride = messages.slice(0, userIdx);
      const toDelete = messages.slice(userIdx);
      await Promise.all(toDelete.map((m) => deleteMessage(m.id)));
      void runChat(userMsg.content, source, chunks, {
        webSearchEnabled,
        historyOverride,
      });
    },
    [chatStatus.kind, chunks, messages, runChat, source, webSearchEnabled],
  );

  const handleFork = useCallback(
    async (messageId: string) => {
      if (!threadId) return;
      try {
        const { newThreadId } = await forkThread(threadId, messageId);
        setActiveThreadId(newThreadId);
        toast({
          variant: "success",
          title: pick("Yeni sohbet açıldı", "Forked into new chat"),
        });
      } catch (err) {
        toast({
          variant: "error",
          title: pick("Çatallanamadı", "Fork failed"),
          description: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [pick, threadId, toast],
  );

  if (ws === undefined || source === undefined) {
    return (
      <AppShell workspaceId={workspaceId} breadcrumb={[t("dashboard"), pick("Yükleniyor…", "Loading…")]}>
        <div className="page-container">
          <Skeleton variant="rect" height={48} />
          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[220px_1fr_360px]">
            <Skeleton variant="rect" height={420} />
            <Skeleton variant="rect" height={420} />
            <Skeleton variant="rect" height={420} />
          </div>
        </div>
      </AppShell>
    );
  }

  if (ws === null || !source || source.workspaceId !== workspaceId) {
    return (
      <AppShell
        workspaceId={workspaceId}
        breadcrumb={[t("dashboard"), pick("Kaynak bulunamadı", "Source not found")]}
      >
        <div className="page-container">
          <EmptyState
            icon={<AlertCircle />}
            title={pick("Kaynak bulunamadı", "Source not found")}
            description={pick(
              "Bu kaynak silinmiş, taşınmış veya bu çalışma alanına ait değil. Çalışma alanına dönüp mevcut kaynaklardan birini açabilirsin.",
              "This source was deleted, moved, or does not belong to this workspace. Return to the workspace and open one of the available sources.",
            )}
            action={{
              label: pick("Çalışma alanına dön", "Back to workspace"),
              href: `/w/${workspaceId}`,
            }}
          />
        </div>
      </AppShell>
    );
  }

  function handleMouseUp(e: React.MouseEvent<HTMLDivElement>) {
    const sel = window.getSelection();
    const setSelection = useSelection.getState().setSelection;
    if (!sel || sel.isCollapsed) {
      setSelection(null);
      return;
    }
    const text = sel.toString().trim();
    if (!text) {
      setSelection(null);
      return;
    }
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;
    setSelection({ text, x: rect.left + rect.width / 2, y: rect.top - 8 });
    e.stopPropagation();
  }

  function jumpToChunk(chunk: ChunkRecord) {
    // Phase 6.9.7 — citations resolving to a note-source chunk route to the
    // notes editor instead of trying to scroll the PDF/article pane. The
    // chunk lives in chunks table (RAG layer) but its canonical surface is
    // the markdown vault. Defensive: if noteId is missing (post-cascade
    // window), fall back to the standard scroll path so the user still sees
    // *something*.
    const noteRef = noteSourceById.get(chunk.sourceId);
    if (noteRef && noteRef.noteId) {
      router.push(`/w/${workspaceId}/notes?id=${noteRef.noteId}`);
      return;
    }
    // On mobile we may currently be on the chat tab — flip to source first so
    // the chunk node is mounted before we try to scroll it into view.
    if (activeTab !== "source") setActiveTab("source");
    const doScroll = () => {
      const el = document.getElementById(`chunk-${chunk.id}`);
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      el.classList.remove("citation-pulse");
      void el.offsetWidth;
      el.classList.add("citation-pulse");
      window.setTimeout(() => {
        el.classList.remove("citation-pulse");
      }, 1400);
    };
    // If we just switched tabs the source pane mounts on the next frame.
    if (activeTab !== "source") {
      window.requestAnimationFrame(() => window.requestAnimationFrame(doScroll));
    } else {
      doScroll();
    }
  }

  return (
    <AppShell
      workspaceId={workspaceId}
      breadcrumb={[t("dashboard"), pick(ws.name, ws.nameEn ?? ws.name), t("okuma")]}
    >
      {/* Mobile (<md): single-pane Source/Chat tabs */}
      <div className="flex h-full min-h-0 flex-col md:hidden">
        <div className="border-b border-rule bg-paper px-3 py-2">
          <SegmentedControl<MobileTab>
            size="sm"
            value={activeTab}
            onChange={setActiveTab}
            options={[
              { value: "source", label: pick("Kaynak", "Source") },
              { value: "chat", label: pick("Sohbet", "Chat") },
            ]}
            ariaLabel={pick("Sekme", "Tab")}
            className="w-full"
          />
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          {activeTab === "source" ? (
            <ReaderPanel
              source={source}
              chunks={chunks}
              highlights={highlights}
              workspaceId={workspaceId}
              onMouseUp={handleMouseUp}
              pick={pick}
            />
          ) : (
            <ChatPanel
              messages={messages}
              chunks={chunks}
              chatStatus={chatStatus}
              chunkCount={chunks.length}
              sourceReady={source.ingestStatus === "ready"}
              onSend={sendMessage}
              onCancel={cancelStream}
              onUnlock={() => setVaultModalOpen(true)}
              onJumpCitation={jumpToChunk}
              onRetry={handleRetry}
              onFork={handleFork}
              onGenerateCards={() => setGenCardsOpen(true)}
              onProposeCardsFromMessage={handleProposeCardsFromMessage}
              onSaveJournalEntry={handleSaveJournalEntry}
              noteSourceIds={noteSourceIds}
              sourceTitle={pick(source.title, source.titleEn ?? source.title)}
              pick={pick}
              variant="mobile"
              aiResponseLocale={aiResponseLocale}
              onAiResponseLocaleChange={setAiResponseLocale}
              skippedCount={lastSkippedCount}
              quotedText={quotedText}
              onClearQuote={() => setQuotedText(null)}
              webSearchEnabled={webSearchEnabled}
              onWebSearchToggle={handleWebSearchToggle}
              onWebCitationClick={setPeekCitation}
            />
          )}
        </div>
      </div>

      {/* Desktop (md+): reader + chat. Outline lives in reader topbar as a flyout. */}
      <div
        ref={desktopGridRef}
        className="hidden h-full min-h-0 md:grid"
        style={{ gridTemplateColumns: desktopGridColumns }}
      >
        <ReaderPanel
          source={source}
          chunks={chunks}
          highlights={highlights}
          workspaceId={workspaceId}
          onMouseUp={handleMouseUp}
          pick={pick}
        />

        <PanelResizeHandle
          label={pick("Sohbet paneli genişliğini ayarla", "Resize chat panel")}
          onMouseDown={startChatResize}
        />

        <ChatPanel
          messages={messages}
          chunks={chunks}
          chatStatus={chatStatus}
          chunkCount={chunks.length}
          sourceReady={source.ingestStatus === "ready"}
          onSend={sendMessage}
          onCancel={cancelStream}
          onUnlock={() => setVaultModalOpen(true)}
          onJumpCitation={jumpToChunk}
          onRetry={handleRetry}
          onFork={handleFork}
          onGenerateCards={() => setGenCardsOpen(true)}
          onProposeCardsFromMessage={handleProposeCardsFromMessage}
          onSaveJournalEntry={handleSaveJournalEntry}
          noteSourceIds={noteSourceIds}
          sourceTitle={pick(source.title, source.titleEn ?? source.title)}
          pick={pick}
          aiResponseLocale={aiResponseLocale}
          onAiResponseLocaleChange={setAiResponseLocale}
          skippedCount={lastSkippedCount}
          quotedText={quotedText}
          onClearQuote={() => setQuotedText(null)}
          mode={chatMode}
          onModeChange={setChatMode}
          webSearchEnabled={webSearchEnabled}
          onWebSearchToggle={handleWebSearchToggle}
          onWebCitationClick={setPeekCitation}
          threadList={
            <ChatThreadSidebar
              workspaceId={workspaceId}
              sourceId={sourceId}
              sourceTitle={pick(source.title, source.titleEn ?? source.title)}
              activeThreadId={threadId ?? null}
              onSelect={setActiveThreadId}
              variant="popover"
            />
          }
        />
      </div>

      <SelectionPopoverHost
        onAsk={(text) => {
          setQuotedText(text);
          window.getSelection()?.removeAllRanges();
        }}
        pick={pick}
      />

      
      <WebCitationPeekModal
        open={peekCitation !== null}
        citation={peekCitation}
        onClose={() => setPeekCitation(null)}
        onMakeSource={async (citation) => {
          // Resolve the user's research provider + key (if any) and run
          // the ingest pipeline. Returns the new sourceId so the modal
          // flips to "done" and the bubble shows the source-was-added
          // confirmation. Surfacing a toast separately so the modal can
          // stay open with the "Eklendi" badge while the user moves on.
          const currentMasterKey = useVault.getState().masterKey;
          const providerId = (usePrefs.getState().modelBindings.researchProvider as
            ResearchProviderId | string);
          const knownProviders: ResearchProviderId[] = [
            "readability",
            "firecrawl",
            "exa",
            "jina-reader",
            "tavily",
            "diffbot",
            "brightdata",
          ];
          const safeProvider: ResearchProviderId = knownProviders.includes(
            providerId as ResearchProviderId,
          )
            ? (providerId as ResearchProviderId)
            : "readability";
          const apiKey = await resolveResearchCredential(safeProvider);
          const result = await ingestResearchUrl({
            workspaceId,
            rawInput: citation.result.url,
            webProvider: safeProvider,
            ...(apiKey ? { apiKey } : {}),
          });
          toast({
            variant: "success",
            title: pick("Kaynak eklendi", "Source added"),
            description: result.source.title,
          });
          return result.source.id;
        }}
      />
      <GenerateBatchModal
        open={genCardsOpen}
        onClose={() => setGenCardsOpen(false)}
        workspaceId={workspaceId}
        initialSourceId={sourceId}
      />
      <GenerateBatchModal
        open={singleCardsCtx !== null}
        onClose={() => setSingleCardsCtx(null)}
        workspaceId={workspaceId}
        initialSourceId={sourceId}
        mode="single"
        {...(singleCardsCtx?.chatContext
          ? { chatContext: singleCardsCtx.chatContext }
          : {})}
        {...(singleCardsCtx?.threadId
          ? { threadId: singleCardsCtx.threadId }
          : {})}
      />
      <SaveJournalEntryModal
        open={journalDraft !== null}
        onClose={() => setJournalDraft(null)}
        draft={journalDraft}
      />
    </AppShell>
  );
}

function StatusBanner({
  status,
  errorMessage,
  pick,
}: {
  status: IngestStatus;
  errorMessage: string | undefined;
  pick: (tr: string, en: string) => string;
}) {
  const meta = STATUS_COPY[status];
  const tone =
    meta.tone === "err"
      ? "border-err/40 bg-err/10 text-err"
      : meta.tone === "ok"
        ? "border-ok/40 bg-ok/10 text-ok"
        : "border-rule bg-paper-2 text-ink-3";
  const Icon = meta.tone === "err" ? AlertCircle : Loader2;
  const isAnimating = meta.tone === "info";
  return (
    <div
      className={cn(
        "mx-auto mb-6 flex max-w-[680px] items-start gap-3 rounded-[10px] border px-4 py-3 text-[13px]",
        tone,
      )}
      role={meta.tone === "err" ? "alert" : "status"}
    >
      <Icon
        className={cn("mt-0.5 h-4 w-4 shrink-0", isAnimating && "animate-spin")}
        aria-hidden
      />
      <div>
        <div className="font-medium">{pick(meta.tr, meta.en)}</div>
        {status !== "ready" ? (
          <div className="mt-0.5 text-[12.5px] opacity-80">
            {errorMessage ??
              pick(
                "PDF parse pipeline Phase 2 sıradaki dilimi — chunks henüz üretilmedi.",
                "PDF parse pipeline is the next slice of Phase 2 — chunks aren't generated yet.",
              )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function EmbeddingBanner({
  source,
  pick,
}: {
  source: SourceRecord;
  pick: (tr: string, en: string) => string;
}) {
  const status = source.embeddingStatus ?? "missing";
  if (status === "ready") return null;
  const meta = EMBEDDING_COPY[status];
  const tone =
    meta.tone === "err"
      ? "border-err/40 bg-err/10 text-err"
      : meta.tone === "ok"
        ? "border-ok/40 bg-ok/10 text-ok"
        : meta.tone === "warn"
          ? "border-accent-soft bg-accent-wash text-accent-ink"
          : "border-rule bg-paper-2 text-ink-3";
  const Icon = meta.tone === "err" ? AlertCircle : meta.tone === "info" ? Loader2 : KeyRound;
  return (
    <div
      className={cn(
        "mx-auto mb-6 flex max-w-[680px] items-start gap-3 rounded-[10px] border px-4 py-3 text-[13px]",
        tone,
      )}
      role={meta.tone === "err" ? "alert" : "status"}
    >
      <Icon
        className={cn("mt-0.5 h-4 w-4 shrink-0", meta.tone === "info" && "animate-spin")}
        aria-hidden
      />
      <div>
        <div className="font-medium">{pick(meta.tr, meta.en)}</div>
        <div className="mt-0.5 text-[12.5px] opacity-85">
          {source.embeddingError ??
            pick(
              "Kaynak okunabilir; yalnızca AI arama/citation retrieval sınırlı çalışır. API key ekledikten sonra Ayarlar > Embedding bölümünden yeniden göm.",
              "The source is readable; only AI search/citation retrieval is limited. After adding an API key, reembed from Settings > Embedding.",
            )}
        </div>
      </div>
    </div>
  );
}

function PanelResizeHandle({
  label,
  onMouseDown,
}: {
  label: string;
  onMouseDown: (event: React.MouseEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      title={label}
      onMouseDown={onMouseDown}
      className="group flex min-h-0 cursor-col-resize items-stretch justify-center bg-paper"
    >
      <div className="h-full w-px bg-rule transition-colors group-hover:bg-accent" />
    </div>
  );
}

// Outline lives in a topbar flyout (Tailwind UI flyout-menu pattern).
// Trigger button toggles a fade/slide panel; click-outside or Escape closes.
// Click-outside uses mousedown so it fires before any selection-clearing
// reactive logic on the doc — the panel always closes cleanly.
function FlyoutOutline({
  chunks,
  highlights,
  workspaceId,
  sourceId,
  pick,
}: {
  chunks: ChunkRecord[];
  highlights: HighlightRecord[];
  workspaceId: string;
  sourceId: string;
  pick: (tr: string, en: string) => string;
}) {
  const t = useTranslations("reader");
  const tExtract = useTranslations("notes.highlight_extract");
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [extractingId, setExtractingId] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const sections = useMemo(() => buildReaderOutline(chunks), [chunks]);

  const handleExtract = useCallback(
    async (highlight: HighlightRecord) => {
      if (extractingId !== null) return;
      setExtractingId(highlight.id);
      try {
        const fallbackTitle = tExtract("fallback_title");
        const content = buildHighlightExtractContent({
          excerpt: highlight.text,
          sourceId,
          fallbackTitle,
        });
        const note = await createNote({ workspaceId, content });
        toast({
          title: tExtract("toast_created"),
          variant: "success",
        });
        // Route added in Phase 6.8 (`/w/[id]/notes`); link is the contract
        // even though the page lands a build later.
        router.push(`/w/${workspaceId}/notes?id=${note.id}`);
      } finally {
        setExtractingId(null);
      }
    },
    [extractingId, workspaceId, sourceId, router, toast, tExtract],
  );

  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e: MouseEvent): void {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="inline-flex items-center gap-1.5 rounded-md border border-rule bg-paper px-2.5 py-1.5 text-[12px] text-ink-2 transition-colors hover:bg-paper-2 hover:text-ink"
      >
        <List className="h-3.5 w-3.5" aria-hidden />
        <span className="font-mono uppercase tracking-[0.08em] text-[10.5px]">
          {t("icindekiler")}
        </span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 text-ink-4 transition-transform duration-150",
            open && "rotate-180",
          )}
          aria-hidden
        />
      </button>
      {open ? (
        <div
          ref={panelRef}
          role="menu"
          className="absolute right-0 z-30 mt-2 w-[340px] origin-top-right rounded-xl border border-rule bg-paper p-1 shadow-[0_18px_44px_-14px_rgba(0,0,0,0.4)]"
        >
          <div className="px-3 pt-2 pb-1.5">
            <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-3">
              {t("icindekiler")}
            </span>
          </div>
          <nav className="max-h-[320px] overflow-y-auto px-1 pb-1 text-[13px]">
            {sections.length === 0 ? (
              <p className="px-3 py-3 text-[12px] text-ink-4">
                {pick(
                  "Henüz işlenmedi — outline ingest sonrası üretilir.",
                  "Not yet processed — outline appears after ingest.",
                )}
              </p>
            ) : (
              sections.map((o) => (
                <div
                  key={o.key}
                  className={cn(
                    "block w-full rounded py-1.5 text-left text-[12.5px] text-ink-2",
                    o.level === 1
                      ? "px-2 font-medium"
                      : o.level === 2
                        ? "px-3"
                        : "px-5 text-ink-3",
                  )}
                >
                  {o.label}
                </div>
              ))
            )}
          </nav>
          <div className="border-t border-rule px-3 py-2.5">
            <div className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-3">
              {pick("Vurgular", "Highlights")} · {highlights.length}
            </div>
            {highlights.length === 0 ? (
              <p className="mt-2 text-[12px] text-ink-4">
                {pick("Metin seç → vurgu ekle.", "Select text → add highlight.")}
              </p>
            ) : (
              <ul className="mt-2 space-y-2 text-[12px]">
                {highlights.slice(0, 5).map((h) => (
                  <li
                    key={h.id}
                    className="group flex items-start justify-between gap-1.5 border-l-2 pl-2 text-ink-3"
                    style={{ borderColor: h.color }}
                  >
                    <span className="min-w-0 flex-1">
                      {h.text.length > 60 ? `${h.text.slice(0, 60)}…` : h.text}
                    </span>
                    <button
                      type="button"
                      onClick={() => void handleExtract(h)}
                      disabled={extractingId !== null}
                      aria-label={tExtract("button")}
                      title={tExtract("tooltip")}
                      data-testid="highlight-extract-note"
                      className="grid h-5 w-5 shrink-0 place-items-center rounded-[4px] text-ink-4 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-paper-3 hover:text-accent focus-visible:opacity-100 disabled:cursor-progress disabled:opacity-60"
                    >
                      <PencilLine className="h-3 w-3" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ReaderPanel({
  source,
  chunks,
  highlights,
  workspaceId,
  onMouseUp,
  pick,
}: {
  source: SourceRecord;
  chunks: ChunkRecord[];
  highlights: HighlightRecord[];
  workspaceId: string;
  onMouseUp: (e: React.MouseEvent<HTMLDivElement>) => void;
  pick: (tr: string, en: string) => string;
}) {
  const readerWidth = usePrefs((s) => s.readerWidth);
  // Only PDFs benefit from the canvas+textLayer viewer. DOCX blobs are
  // stored too but a Word renderer is out of scope for now; the toggle
  // simply doesn't appear for non-PDF sources.
  const blobAvailable = source.type === "pdf";
  const blob = useSourceBlob(blobAvailable ? source.id : undefined);
  const [viewMode, setViewMode] = useState<"reading" | "pdf">("reading");
  // PdfViewer is heavy (loads pdfjs ~2MB) and we want to preserve its scroll
  // position when the user toggles back to Reading. Once the user opens it,
  // we mount it and hide via display:none on subsequent toggles instead of
  // unmounting — both modes' scroll positions are then preserved naturally
  // across switches because the browser keeps scrollTop on hidden elements.
  const [pdfEverOpened, setPdfEverOpened] = useState(false);
  // If the user uploaded the source before sourceBlobs existed, the toggle
  // shows a placeholder banner instead of trying to render an empty viewer.
  const blobMissing = blobAvailable && blob === null;

  return (
    <section className="flex min-h-0 min-w-0 flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-rule bg-paper px-6 py-3 sm:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            href={`/w/${workspaceId}`}
            aria-label={pick("Kaynaklara dön", "Back to sources")}
            title={pick("Kaynaklara dön", "Back to sources")}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-rule text-ink-3 transition-colors hover:border-accent hover:text-ink"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
          </Link>
          <div className="min-w-0">
            <div className="flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-4">
              <span>{source.author ?? pick("Yazar bilinmiyor", "Unknown author")}</span>
              {source.pageCount ? (
                <>
                  <span>·</span>
                  <span>
                    {pick(`${source.pageCount} sayfa`, `${source.pageCount} pages`)}
                  </span>
                </>
              ) : null}
            </div>
            <h2 className="mt-0.5 truncate font-serif text-[17px] font-medium leading-tight">
              {pick(source.title, source.titleEn ?? source.title)}
            </h2>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {blobAvailable ? (
            <SegmentedControl
              value={viewMode}
              onChange={(v) => {
                if (v === "pdf") setPdfEverOpened(true);
                setViewMode(v);
              }}
              options={[
                {
                  value: "reading" as const,
                  label: (
                    <span className="inline-flex items-center gap-1.5">
                      <BookText className="h-3.5 w-3.5" aria-hidden />
                      {pick("Okuma", "Reading")}
                    </span>
                  ),
                },
                {
                  value: "pdf" as const,
                  label: (
                    <span className="inline-flex items-center gap-1.5">
                      <FileImage className="h-3.5 w-3.5" aria-hidden />
                      {pick("Orijinal PDF", "Original PDF")}
                    </span>
                  ),
                },
              ]}
              size="sm"
              ariaLabel={pick("Görüntüleme modu", "View mode")}
            />
          ) : null}
          <TweaksPanel />
          <FlyoutOutline
            chunks={chunks}
            highlights={highlights}
            workspaceId={workspaceId}
            sourceId={source.id}
            pick={pick}
          />
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col">
        {/* Reading mode is always mounted. Hidden via display:none on
            mode switch — the browser keeps scrollTop on hidden elements,
            so the user lands back exactly where they were when they
            return. */}
        <div
          data-reader-scroll
          className={cn(
            "flex-1 overflow-y-auto px-6 py-8 sm:px-8",
            viewMode !== "reading" && "hidden",
          )}
          onMouseUp={onMouseUp}
        >
          <div
            className={cn(
              "mx-auto",
              readerWidth === "narrow" && "max-w-[680px]",
            )}
          >
            {source.ingestStatus !== "ready" ? (
              <StatusBanner
                status={source.ingestStatus}
                errorMessage={source.errorMessage}
                pick={pick}
              />
            ) : null}
            {source.ingestStatus === "ready" ? (
              <EmbeddingBanner source={source} pick={pick} />
            ) : null}

            {chunks.length === 0 ? (
              <EmptyChunks status={source.ingestStatus} pick={pick} />
            ) : (
              <article>
                {chunks.map((chunk) => (
                  <section
                    key={chunk.id}
                    id={`chunk-${chunk.id}`}
                    className="mb-12 flex scroll-mt-24 flex-col"
                  >
                    {chunk.section ? (
                      <h3 className="mb-3 font-mono text-[10.5px] uppercase tracking-[0.12em] text-accent-ink">
                        {stripMarkdownHeading(chunk.section)}
                      </h3>
                    ) : null}
                    <ReaderChunkMarkdown chunk={chunk} />
                  </section>
                ))}
              </article>
            )}
          </div>
        </div>

        {/* PdfViewer is lazy-mounted on the user's first switch to PDF
            mode and then KEPT mounted. Subsequent toggles flip CSS
            visibility instead of re-creating the viewer, so pdfjs
            doesn't reload, the canvases stay rendered, and (most
            importantly) scrollTop on the page list is preserved. */}
        {pdfEverOpened ? (
          blobMissing ? (
            <div
              className={cn(
                "flex flex-1 items-center justify-center px-6 py-8",
                viewMode !== "pdf" && "hidden",
              )}
            >
              <div className="flex max-w-[480px] flex-col items-center gap-3 rounded-lg border border-dashed border-rule bg-paper-2 px-6 py-10 text-center text-[13px] text-ink-3">
                <FileImage className="h-6 w-6 text-ink-4" aria-hidden />
                <div className="font-serif text-[18px] text-ink">
                  {pick(
                    "Bu kaynağın orijinali saklanmamış",
                    "Original file isn't stored for this source",
                  )}
                </div>
                <p className="leading-[1.6]">
                  {pick(
                    "Bu kaynak orijinal PDF saklama özelliği eklenmeden önce yüklendi. Görsel modu kullanmak için kaynağı silip yeniden yükleyebilirsin.",
                    "This source was uploaded before original-file storage was added. Delete it and re-upload to enable the visual mode.",
                  )}
                </p>
              </div>
            </div>
          ) : !blob ? (
            <div
              className={cn(
                "flex flex-1 items-center justify-center gap-2 py-12 text-[13px] text-ink-3",
                viewMode !== "pdf" && "hidden",
              )}
            >
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              {pick("PDF yükleniyor…", "Loading PDF…")}
            </div>
          ) : (
            <PdfViewer
              blob={blob}
              pick={pick}
              className={cn("flex-1 min-h-0", viewMode !== "pdf" && "hidden")}
            />
          )
        ) : null}
      </div>
    </section>
  );
}

function ReaderChunkMarkdown({ chunk }: { chunk: ChunkRecord }) {
  const segments = useMemo(() => splitChunkIntoMarkdownSegments(chunk), [chunk]);
  return (
    <>
      {segments.map((segment) => (
        <div
          key={segment.key}
          id={segment.anchorId}
          className={segment.anchorId ? "scroll-mt-24" : undefined}
        >
          <MarkdownPreview text={segment.text} className="text-[15.5px] leading-[1.78]" />
        </div>
      ))}
    </>
  );
}

function EmptyChunks({
  status,
  pick,
}: {
  status: IngestStatus;
  pick: (tr: string, en: string) => string;
}) {
  return (
    <div className="mx-auto flex max-w-[420px] flex-col items-center gap-3 rounded-lg border border-dashed border-rule bg-paper-2 px-6 py-12 text-center text-[13px] text-ink-3">
      <div className="font-serif text-[20px] text-ink">
        {status === "error"
          ? pick("Bu kaynak ayrıştırılamadı", "This source failed to parse")
          : pick("Henüz okuma içeriği yok", "No reader content yet")}
      </div>
      <p className="leading-[1.6]">
        {pick(
          "PDF ingest pipeline Phase 2'nin sıradaki dilimi. Workers yapılandırıldıktan sonra chunks burada akacak.",
          "PDF ingest pipeline is the next slice of Phase 2. Chunks will appear here once the worker config lands.",
        )}
      </p>
    </div>
  );
}

function ChatPanel({
  messages,
  chunks,
  chatStatus,
  chunkCount,
  sourceReady,
  onSend,
  onCancel,
  onUnlock,
  onJumpCitation,
  onRetry,
  onFork,
  onGenerateCards,
  onProposeCardsFromMessage,
  onSaveJournalEntry,
  sourceTitle,
  pick,
  variant = "desktop",
  aiResponseLocale,
  onAiResponseLocaleChange,
  skippedCount,
  quotedText,
  onClearQuote,
  mode = "default",
  onModeChange,
  threadList,
  webSearchEnabled = false,
  onWebSearchToggle,
  onWebCitationClick,
  noteSourceIds,
}: {
  messages: ChatMessageRecord[];
  chunks: ChunkRecord[];
  chatStatus: ChatStatus;
  chunkCount: number;
  sourceReady: boolean;
  onSend: (v: string) => void;
  onCancel: () => void;
  onUnlock: () => void;
  onJumpCitation: (chunk: ChunkRecord) => void;
  onRetry?: ((messageId: string) => void) | undefined;
  onFork?: ((messageId: string) => void) | undefined;
  /** Phase 6.9.7 — forwarded to ChatBubbleStandalone so citations resolving
   *  to note-source chunks render with the emerald NotebookPen tone. */
  noteSourceIds?: ReadonlySet<string>;
  /** Phase 5.5.C.B — composer state owned by the page (sticky-in-session).
   *  ChatPanel reads it to color/aria-check the toggle button + renders it
   *  only when the resolved chat option supports web search. */
  webSearchEnabled?: boolean;
  onWebSearchToggle?: ((next: boolean) => void) | undefined;
  /** Forwarded to ChatBubbleStandalone — clicking a web citation chip
   *  opens the peek modal at the page level. */
  onWebCitationClick?:
    | ((citation: import("@/lib/ai/web-search/types").WebCitation) => void)
    | undefined;
  /** Opens the source-aware GenerateBatchModal at the page level. Optional
   *  so the panel still renders when the host hasn't wired AI generation. */
  onGenerateCards?: (() => void) | undefined;
  /** Forwarded to ChatBubbleStandalone — surfaces "Karta çevir" on assistant
   *  bubbles. The host page captures the message id, builds the chat
   *  context, and opens GenerateBatchModal in single mode. */
  onProposeCardsFromMessage?: ((messageId: string) => void) | undefined;
  /** Forwarded to ChatBubbleStandalone — surfaces "Çalışma günlüğüne
   *  kaydet" on assistant bubbles. Host writes the StudyJournalEntry. */
  onSaveJournalEntry?: ((messageId: string) => void) | undefined;
  sourceTitle: string;
  pick: (tr: string, en: string) => string;
  variant?: "mobile" | "desktop";
  aiResponseLocale: AiResponseLocale;
  onAiResponseLocaleChange: (value: AiResponseLocale) => void;
  skippedCount: number;
  /** Optional quoted passage to show as a chip above the input. The chip is
   *  prepended to the final message on send and cleared automatically. */
  quotedText?: string | null;
  onClearQuote?: () => void;
  mode?: ReaderPanelMode;
  onModeChange?: (mode: ReaderPanelMode) => void;
  threadList?: React.ReactNode;
}) {
  const t = useTranslations("reader");
  const tAi = useTranslations("ai_locale");
  const [langPopoverOpen, setLangPopoverOpen] = useState(false);
  const [threadPopoverOpen, setThreadPopoverOpen] = useState(false);
  // Draft is local to ChatPanel so typing doesn't re-render the rest of the
  // reader (article + chunks list + PdfViewer when mounted) on every key.
  // The parent only learns about it when the user actually sends.
  const [draft, setDraft] = useState("");
  // Header label reflects the *currently selected* chat binding so users can
  // see at a glance which provider/model this panel will route to. Bubbles
  // continue to show the per-message model (which may differ from the live
  // selection if the user changed bindings mid-thread).
  const chatBinding = usePrefs((s) => s.modelBindings.chat);
  const tWebSearch = useTranslations("web_search");
  const chatOptionMeta = useMemo(() => findChatOption(chatBinding), [chatBinding]);
  const headerChatLabel = useMemo(() => {
    const opt = chatOptionMeta;
    if (!opt) return pick("Sohbet", "Chat");
    const presetLabel = opt.label.split(" · ")[0] ?? opt.presetId;
    return `${presetLabel} · ${opt.modelId}`;
  }, [chatOptionMeta, pick]);
  // Phase 5.5.C.B — only show the toggle when (a) the parent wired it AND
  // (b) the resolved chat option declares native web-search support. We
  // still render a disabled greyed-out chip when unsupported so the user
  // can see the feature exists; tooltip points at Settings → Models.
  const webSearchAvailable = Boolean(onWebSearchToggle);
  const webSearchSupported = chatOptionMeta?.supportsWebSearch ?? false;
  const isStreaming = chatStatus.kind === "streaming";
  const isPreparing = chatStatus.kind === "preparing";
  const isBusy = isStreaming || isPreparing;
  const isVaultLocked =
    chatStatus.kind === "error" && chatStatus.code === "vault_locked";
  const inputDisabled = !sourceReady || chunkCount === 0 || isBusy;

  function sendWithQuote(): void {
    const trimmedDraft = draft.trim();
    if (quotedText) {
      // If the user typed a question, prepend the quote; otherwise default
      // to "explain this" so a click-Sor-then-Enter still does something.
      const question = trimmedDraft || pick("Bunu açıklar mısın?", "Can you explain this?");
      onSend(`"${quotedText}" — ${question}`);
      onClearQuote?.();
      setDraft("");
    } else if (trimmedDraft.length > 0) {
      onSend(draft);
      setDraft("");
    }
  }
  const lastAssistantId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m && m.role === "assistant") return m.id;
    }
    return null;
  }, [messages]);

  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  if (variant === "desktop" && mode === "closed") {
    return (
      <aside className="flex min-h-0 flex-col items-center border-l border-rule bg-paper py-3">
        <button
          type="button"
          onClick={() => onModeChange?.("default")}
          className="grid h-9 w-9 place-items-center rounded-[9px] border border-rule text-ink-3 transition-colors hover:border-accent hover:text-ink"
          title={pick("Sohbet panelini aç", "Open chat panel")}
          aria-label={pick("Sohbet panelini aç", "Open chat panel")}
        >
          <ChevronsLeft className="h-4 w-4" aria-hidden />
        </button>
        <div className="mt-4 rotate-90 whitespace-nowrap font-mono text-[10px] uppercase tracking-[0.12em] text-ink-4">
          Claude
        </div>
      </aside>
    );
  }

  return (
    <aside
      className={cn(
        "min-h-0 flex-col border-rule bg-paper",
        variant === "mobile"
          ? "flex h-full border-l-0"
          : "hidden border-l lg:flex",
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b border-rule px-4 py-3">
        <div className="min-w-0">
          <div
            className="truncate font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-3"
            title={headerChatLabel}
          >
            {headerChatLabel}
          </div>
          <div className="mt-0.5 truncate text-[12px] text-ink-3">{sourceTitle}</div>
        </div>
        <div className="relative flex items-center gap-1">
          {threadList ? (
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={pick("Sohbetleri aÃ§", "Open chats")}
              title={pick("Sohbetler", "Chats")}
              aria-expanded={threadPopoverOpen}
              onClick={() => {
                setThreadPopoverOpen((v) => !v);
                setLangPopoverOpen(false);
              }}
            >
              <SquareStack className="h-3.5 w-3.5" aria-hidden />
            </Button>
          ) : null}
          {onGenerateCards ? (
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={pick("Bu kaynaktan AI ile kart üret", "Generate flashcards from this source with AI")}
              title={pick("AI'dan kart üret", "Generate cards with AI")}
              onClick={onGenerateCards}
            >
              <Sparkles className="h-3.5 w-3.5" aria-hidden />
            </Button>
          ) : null}
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={tAi("topbar_tooltip")}
              title={tAi("topbar_tooltip")}
              aria-expanded={langPopoverOpen}
              onClick={() => {
                setLangPopoverOpen((v) => !v);
                setThreadPopoverOpen(false);
              }}
          >
            <Languages className="h-3.5 w-3.5" aria-hidden />
          </Button>
          <Link href="/settings#api" title={pick("API ayarları", "API settings")}>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={pick("API ayarları", "API settings")}
            >
              <Settings2 className="h-3.5 w-3.5" aria-hidden />
            </Button>
          </Link>
          {langPopoverOpen ? (
            <div
              role="dialog"
              aria-label={tAi("section_title")}
              className="absolute right-0 top-full z-30 mt-2 w-[260px] rounded-[12px] border border-rule bg-paper p-3 shadow-[var(--shadow-medium)]"
            >
              <div className="mb-2 font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-3">
                {tAi("section_title")}
              </div>
              <SegmentedControl<AiResponseLocale>
                size="sm"
                value={aiResponseLocale}
                onChange={(v) => {
                  onAiResponseLocaleChange(v);
                  setLangPopoverOpen(false);
                }}
                options={[
                  { value: "tr", label: tAi("option_tr") },
                  { value: "en", label: tAi("option_en") },
                  { value: "follow_source", label: tAi("option_follow") },
                ]}
                ariaLabel={tAi("section_title")}
                className="w-full"
              />
            </div>
          ) : null}
          {threadPopoverOpen && threadList ? (
            <div
              role="dialog"
              aria-label={pick("Sohbetler", "Chats")}
              className="absolute right-0 top-full z-30 mt-2 w-[300px]"
            >
              {threadList}
            </div>
          ) : null}
        </div>
      </div>

      {skippedCount > 0 ? (
        <div className="border-b border-rule bg-amber-50 px-4 py-2 text-[12.5px] text-amber-900">
          {pick(
            `${skippedCount} chunk farklı modelle gömülü. Tutarlı sonuç için yeniden gömün.`,
            `${skippedCount} chunks were embedded with a different model. Reembed for consistent results.`,
          )}
          <Link
            href="/settings#embed"
            className="ml-2 underline underline-offset-2"
          >
            {pick("Ayarlardan reembed", "Reembed in Settings")}
          </Link>
        </div>
      ) : null}

      {chatStatus.kind === "error" ? (
        <ChatErrorBanner status={chatStatus} onUnlock={onUnlock} pick={pick} />
      ) : null}

      <div ref={listRef} className="flex-1 space-y-5 overflow-y-auto px-4 py-4">
        {messages.length === 0 ? (
          <p className="text-[12.5px] leading-[1.6] text-ink-4">
            {pick(
              "Sohbet boş. Bir şey sormak için aşağıya yaz veya metinden bir parça seç.",
              "Chat is empty. Type below or select a passage to ask about it.",
            )}
          </p>
        ) : (
          messages.map((m) => (
            <ChatBubbleStandalone
              key={m.id}
              message={m}
              chunks={chunks}
              isStreaming={isStreaming && m.id === lastAssistantId}
              onJumpCitation={onJumpCitation}
              {...(onRetry ? { onRetry } : {})}
              {...(onFork ? { onFork } : {})}
              {...(onProposeCardsFromMessage ? { onProposeCardsFromMessage } : {})}
              {...(onSaveJournalEntry ? { onSaveJournalEntry } : {})}
              {...(onWebCitationClick ? { onWebCitationClick } : {})}
              {...(noteSourceIds ? { noteSourceIds } : {})}
            />
          ))
        )}
        {isPreparing ? <TypingDots pick={pick} /> : null}
      </div>

      <div className="border-t border-rule bg-paper-2 px-3 py-3">
        {quotedText ? (
          <div className="mb-2 flex items-start gap-2 rounded-md border border-rule-soft bg-paper px-2.5 py-2 text-[12px] leading-snug">
            <CornerUpLeft
              className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-4"
              aria-hidden
            />
            <p className="line-clamp-3 flex-1 italic text-ink-2">
              &ldquo;{quotedText}&rdquo;
            </p>
            <button
              type="button"
              onClick={() => onClearQuote?.()}
              aria-label={pick("Alıntıyı kaldır", "Remove quote")}
              title={pick("Alıntıyı kaldır", "Remove quote")}
              className="grid h-5 w-5 shrink-0 place-items-center rounded text-ink-4 transition-colors hover:bg-paper-2 hover:text-ink"
            >
              <X className="h-3 w-3" aria-hidden />
            </button>
          </div>
        ) : null}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            sendWithQuote();
          }}
          className="flex items-end gap-2 rounded-lg border border-rule bg-paper p-2 transition-colors focus-within:border-ink-5"
        >
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendWithQuote();
              }
              if (e.key === "Escape" && isStreaming) {
                e.preventDefault();
                onCancel();
              }
            }}
            placeholder={
              !sourceReady
                ? pick(
                    "Kaynak hazır olduğunda soru sorabilirsin.",
                    "Ask once the source is ready.",
                  )
                : t("bir_sey_sor")
            }
            rows={2}
            disabled={inputDisabled && !isStreaming}
            className="flex-1 resize-none bg-transparent px-2 py-1 text-[13.5px] outline-none placeholder:text-ink-4 disabled:cursor-not-allowed disabled:text-ink-4"
          />
          {isStreaming ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={onCancel}
              aria-label={pick("Yanıtı durdur", "Stop response")}
            >
              <CircleStop className="h-3.5 w-3.5" aria-hidden />
              {pick("Durdur", "Stop")}
            </Button>
          ) : isVaultLocked ? (
            <Button type="button" size="sm" variant="primary" onClick={onUnlock}>
              <KeyRound className="h-3.5 w-3.5" aria-hidden />
              {pick("Aç", "Unlock")}
            </Button>
          ) : (
            <Button type="submit" size="sm" variant="primary" disabled={inputDisabled}>
              {isPreparing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <Send className="h-3.5 w-3.5" aria-hidden />
              )}
              {t("gonder")}
            </Button>
          )}
        </form>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-ink-4">
          <div className="flex items-center gap-1.5">
            <Kbd>⌘</Kbd>
            <Kbd>↵</Kbd>
            <span>{t("gonder_2")}</span>
            {isStreaming ? (
              <>
                <span className="px-1">·</span>
                <Kbd>Esc</Kbd>
                <span>{pick("durdur", "stop")}</span>
              </>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            {webSearchAvailable ? (
              <button
                type="button"
                role="switch"
                aria-checked={webSearchEnabled && webSearchSupported}
                aria-label={
                  webSearchEnabled
                    ? tWebSearch("toggle_on_aria")
                    : tWebSearch("toggle_off_aria")
                }
                title={
                  webSearchSupported
                    ? tWebSearch("toggle_label")
                    : tWebSearch("toggle_unsupported")
                }
                // The toggle reflects a per-message preference, not in-flight
                // request state — the web-search adapter is captured once at
                // runChat start (see line ~812), so flipping this mid-stream
                // only affects the NEXT request. Disabling while `isBusy` is
                // true used to lock the button on after the user pressed it
                // and immediately sent a message; allow off-toggling so the
                // next turn can opt out.
                disabled={!webSearchSupported}
                data-testid="web-search-toggle"
                onClick={() => onWebSearchToggle?.(!webSearchEnabled)}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10.5px] uppercase tracking-[0.06em] transition-colors",
                  webSearchSupported && webSearchEnabled
                    ? "border-accent bg-accent-wash text-accent-hot"
                    : "border-rule text-ink-4 hover:border-ink-3 hover:text-ink-3",
                  !webSearchSupported &&
                    "cursor-not-allowed opacity-60 hover:border-rule hover:text-ink-4",
                )}
              >
                <Globe className="h-3 w-3" aria-hidden />
                <span>{tWebSearch("toggle_label")}</span>
              </button>
            ) : null}
            <span>
              {messages.length} {t("mesaj")}
            </span>
          </div>
        </div>
      </div>
    </aside>
  );
}

function ChatErrorBanner({
  status,
  onUnlock,
  pick,
}: {
  status: { kind: "error"; code: string; message: string };
  onUnlock: () => void;
  pick: (tr: string, en: string) => string;
}) {
  const isLocked = status.code === "vault_locked";
  const isMissing =
    status.code === "key_missing" ||
    status.code === "missing_key" ||
    status.code === "unauthorized";
  const Icon = isLocked ? Lock : isMissing ? KeyRound : AlertCircle;
  return (
    <div
      role="alert"
      className="flex items-start gap-2 border-b border-err/30 bg-err/10 px-4 py-2.5 text-[12.5px] text-err"
    >
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      <div className="flex-1 leading-[1.5]">{status.message}</div>
      {isLocked ? (
        <button
          type="button"
          onClick={onUnlock}
          className="font-medium underline-offset-2 hover:underline"
        >
          {pick("Aç", "Unlock")}
        </button>
      ) : null}
    </div>
  );
}

function TypingDots({
  pick,
}: {
  pick: (tr: string, en: string) => string;
}) {
  return (
    <div className="flex items-center gap-2 text-[11.5px] text-ink-4">
      <div className="flex gap-1">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ink-4 [animation-delay:0ms]" />
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ink-4 [animation-delay:120ms]" />
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ink-4 [animation-delay:240ms]" />
      </div>
      <span>{pick("Hazırlanıyor…", "Preparing…")}</span>
    </div>
  );
}

function ChatBubble({
  message,
  chunks,
  isStreaming,
  onJumpCitation,
  pick,
}: {
  message: ChatMessageRecord;
  chunks: ChunkRecord[];
  isStreaming: boolean;
  onJumpCitation: (chunk: ChunkRecord) => void;
  pick: (tr: string, en: string) => string;
}) {
  const t = useTranslations("reader");
  const isUser = message.role === "user";
  const time = useMemo(() => formatTime(message.createdAt, pick), [message.createdAt, pick]);
  const totalIn = (message.tokensIn ?? 0);
  const cacheHit = (message.cacheReadTokens ?? 0) > 0;
  const showMeta =
    !isUser && (totalIn > 0 || (message.tokensOut ?? 0) > 0 || message.model);

  const tokens = useMemo(
    () => (isUser ? null : parseCitations(message.content ?? "")),
    [isUser, message.content],
  );

  if (message.role === "tool") return null;
  if (message.role === "assistant" && message.toolName) {
    return <ToolActionBubble message={message} pick={pick} />;
  }

  return (
    <div className={cn("flex flex-col gap-2", isUser && "items-end")}>
      <div className="flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-4">
        <span>{isUser ? t("sen") : "Claude"}</span>
        <span>·</span>
        <span>{time}</span>
      </div>
      <div
        className={cn(
          "max-w-[300px] whitespace-pre-wrap rounded-lg px-3.5 py-2.5 text-[13.5px] leading-[1.6]",
          isUser
            ? "border border-accent-soft/40 bg-accent-wash text-ink"
            : "bg-paper-2 text-ink",
          isStreaming && !isUser && "after:ml-0.5 after:inline-block after:h-3 after:w-1.5 after:animate-pulse after:bg-ink-4 after:align-middle",
        )}
      >
        {isUser ? (
          message.content
        ) : tokens && tokens.length > 0 ? (
          tokens.map((tok, i) => {
            if (tok.kind === "text") {
              return <span key={i}>{tok.text}</span>;
            }
            const chunk = findChunkForRef(tok.ref, chunks);
            return (
              <CitationChip
                key={i}
                ref={tok.ref}
                active={!!chunk}
                onActivate={() => chunk && onJumpCitation(chunk)}
              />
            );
          })
        ) : message.content ? (
          message.content
        ) : isStreaming ? (
          ""
        ) : (
          "…"
        )}
      </div>
      {showMeta ? (
        <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-4">
          {(message.tokensIn ?? 0)}↓ · {(message.tokensOut ?? 0)}↑
          {" · "}
          {pick("önbellek", "cache")}: {cacheHit ? pick("isabet", "hit") : pick("kaçık", "miss")}
          {message.interrupted ? ` · ${pick("kesildi", "interrupted")}` : ""}
        </div>
      ) : null}
    </div>
  );
}

function ToolActionBubble({
  message,
  pick,
}: {
  message: ChatMessageRecord;
  pick: (tr: string, en: string) => string;
}) {
  const status = message.toolStatus ?? "pending";
  const StatusIcon =
    status === "ok" ? Check : status === "error" ? AlertCircle : Loader2;
  const statusTone =
    status === "ok"
      ? "text-ok"
      : status === "error"
        ? "text-err"
        : "text-ink-3";
  const argsPreview = formatToolArgs(message.toolArgs);
  const labelMap: Record<string, [string, string]> = {
    add_flashcard: ["Karta ekle", "Add flashcard"],
    open_citation: ["Alıntıya git", "Open citation"],
    simplify_explanation: ["Daha basit anlat", "Simplify"],
  };
  const label = labelMap[message.toolName ?? ""];
  const labelText = label
    ? pick(label[0], label[1])
    : (message.toolName ?? "");

  return (
    <div className="flex max-w-[300px] flex-col gap-1">
      <div className="flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-4">
        <Wrench className="h-3 w-3" aria-hidden />
        <span>TOOL</span>
        <span>·</span>
        <span className="normal-case">{message.toolName}</span>
      </div>
      <div className="rounded-lg border border-rule bg-paper-2 px-3 py-2">
        <div className="flex items-center gap-2 text-[12.5px] text-ink-2">
          <StatusIcon
            className={cn(
              "h-3.5 w-3.5 shrink-0",
              statusTone,
              status === "pending" && "animate-spin",
            )}
            aria-hidden
          />
          <span className="font-medium">{labelText}</span>
        </div>
        {argsPreview ? (
          <pre className="mt-1.5 line-clamp-3 whitespace-pre-wrap break-words font-mono text-[11px] leading-snug text-ink-3">
            {argsPreview}
          </pre>
        ) : null}
      </div>
    </div>
  );
}

function formatToolArgs(args: Record<string, unknown> | undefined): string {
  if (!args) return "";
  const entries = Object.entries(args).filter(
    ([, v]) => v !== undefined && v !== "" && v !== null,
  );
  if (entries.length === 0) return "";
  return entries
    .map(([k, v]) => {
      const text = typeof v === "string" ? v : JSON.stringify(v);
      const trimmed = text.length > 120 ? `${text.slice(0, 120)}…` : text;
      return `${k}: ${trimmed}`;
    })
    .join("\n");
}

function formatTime(ts: number, pick: (tr: string, en: string) => string): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return pick("şimdi", "now");
  const date = new Date(ts);
  const hh = date.getHours().toString().padStart(2, "0");
  const mm = date.getMinutes().toString().padStart(2, "0");
  return `${hh}:${mm}`;
}

// Renders nothing until selection state changes. Lives in its own subscriber
// so the reader page does NOT re-render on selection — only this Host (and
// the Popover beneath it) re-renders, leaving ReaderPanel / MarkdownPreview
// untouched. That makes the popover appear instantly even on long sources.
function SelectionPopoverHost({
  onAsk,
  pick,
}: {
  onAsk: (text: string) => void;
  pick: (tr: string, en: string) => string;
}) {
  const selection = useSelection((s) => s.selection);
  const setSelection = useSelection((s) => s.setSelection);
  if (!selection) return null;
  return (
    <SelectionPopover
      selection={selection}
      onAsk={() => {
        const text = selection.text;
        setSelection(null);
        onAsk(text);
      }}
      onClose={() => setSelection(null)}
      pick={pick}
    />
  );
}

function SelectionPopover({
  selection,
  onAsk,
  onClose,
  pick: _pick,
}: {
  selection: { text: string; x: number; y: number };
  onAsk: () => void;
  onClose: () => void;
  pick: (tr: string, en: string) => string;
}) {
  const t = useTranslations("reader");
  return (
    <div
      className="fixed z-30 -translate-x-1/2 -translate-y-full rounded-lg border border-rule bg-paper p-1 shadow-[0_12px_32px_-12px_rgba(0,0,0,0.35)]"
      style={{ left: selection.x, top: selection.y }}
      role="toolbar"
      aria-label={t("secim_aksiyonlari")}
    >
      <div className="flex items-center gap-0.5">
        <button
          onClick={onAsk}
          className="inline-flex items-center gap-1.5 rounded px-2.5 py-1.5 text-[12.5px] text-ink hover:bg-paper-2"
        >
          <Sparkles className="h-3.5 w-3.5" aria-hidden />
          {t("bunu_sor")}
          <Kbd className="ml-1">⌘⇧A</Kbd>
        </button>
        <span className="h-4 w-px bg-rule" />
        <button
          onClick={onClose}
          className="inline-flex items-center gap-1.5 rounded px-2.5 py-1.5 text-[12.5px] text-ink hover:bg-paper-2"
        >
          <Highlighter className="h-3.5 w-3.5" aria-hidden />
          {t("highlight")}
        </button>
        <button
          onClick={onClose}
          className="inline-flex items-center gap-1.5 rounded px-2.5 py-1.5 text-[12.5px] text-ink hover:bg-paper-2"
        >
          <NotebookPen className="h-3.5 w-3.5" aria-hidden />
          {t("not")}
        </button>
        <button
          onClick={onClose}
          className="inline-flex items-center gap-1.5 rounded px-2.5 py-1.5 text-[12.5px] text-ink hover:bg-paper-2"
        >
          <SquareStack className="h-3.5 w-3.5" aria-hidden />
          {t("karta_ekle")}
        </button>
      </div>
    </div>
  );
}
