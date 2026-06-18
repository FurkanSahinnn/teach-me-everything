"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { buildWorkspaceChatSystem } from "@/lib/ai/prompts/workspace-chat";
import type { WorkspaceSource } from "@/lib/ai/prompts/workspace-chat";
import { gatherContextBlocks } from "@/lib/ai/context";
import type { ContextScope } from "@/lib/ai/context/types";
import { buildWorkspaceTools, type AnthropicTool } from "@/lib/ai/tools";
import {
  runAddFlashcard,
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
  createWorkspaceThread,
  deleteMessage,
  findOrCreateWorkspaceThread,
  forkThread,
  patchMessageUsage,
  setMessageContent,
  setMessageWebCitations,
  setThreadContextScopes,
  setThreadSelectedSources,
  setToolStatus,
} from "@/lib/db/chats";
import { deleteFlashcard } from "@/lib/db/flashcards";
import { useToast } from "@/components/ui/Toast";
import {
  useChunksByWorkspace,
  useMessages,
  useSources,
  useWorkspaceChatThreads,
} from "@/lib/db/hooks";
import type { ChatMessageRecord, ChunkRecord, SourceRecord } from "@/lib/db/types";
import { usePrefs, webSearchPrefsToOptions } from "@/stores/prefs";
import { useVault } from "@/stores/vault";
import type { Provider } from "@/lib/db/schema";

// Cross-source retrieval is wider than the single-source reader (10 / 6000):
// the model is synthesising across the whole workspace, so it needs more
// candidate passages and a larger budget. Tunable per the spec (§8).
const RETRIEVAL_TOP_K = 14;
const RETRIEVAL_MAX_TOKENS = 8000;
// When no embeddings exist yet we fall back to the first N chunks across the
// workspace so the chat still functions (degraded but not broken). Capped
// tighter than RETRIEVAL_TOP_K*2 to keep the prompt from ballooning when a
// workspace has thousands of un-embedded chunks.
const RETRIEVAL_FALLBACK_LIMIT = 16;
const MAX_TOOL_ROUNDS = 3;
const FLASHCARD_UNDO_MS = 5000;

const DEFAULT_CONTEXT_SCOPES: ContextScope[] = ["sources"];

export type WorkspaceChatStatus =
  | { kind: "idle" }
  | { kind: "preparing" }
  | { kind: "streaming"; messageId: string }
  | { kind: "error"; code: string; message: string };

export type UseWorkspaceChatArgs = {
  workspaceId: string;
};

export type UseWorkspaceChatResult = {
  threads: ReturnType<typeof useWorkspaceChatThreads>;
  activeThreadId: string | undefined;
  selectThread: (id: string) => void;
  newThread: () => void;
  messages: ChatMessageRecord[];
  chunks: ChunkRecord[];
  chatStatus: WorkspaceChatStatus;
  contextScopes: ContextScope[];
  setContextScopes: (next: ContextScope[]) => void;
  // Source-scope narrowing. Empty ⇒ all workspace sources (default); a
  // non-empty array restricts cross-source retrieval to just those sources.
  selectedSourceIds: string[];
  setSelectedSourceIds: (next: string[]) => void;
  webSearchEnabled: boolean;
  setWebSearchEnabled: (b: boolean) => void;
  sendMessage: (text: string) => void;
  cancelStream: () => void;
  retry: (messageId: string) => void;
  fork: (messageId: string) => void;
};

// The proxy + provider wrap upstream errors as `${code}: ${message}` (the
// legacy StreamEvent error shape has no separate code field). Pull the code
// back out so the UI can pick a friendly localized message. Mirrors the
// reader's parseEventCode verbatim.
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
    authKind?: "oauth" | "api-key";
    fellBackFromOAuth?: boolean;
    upstreamDetail?: string;
  },
): string {
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

// Group a flat list of retrieved chunks back into per-source WorkspaceSource
// records, preserving the chunks' in-document order (the chunks already arrive
// sorted by (sourceId, index) from listChunksByWorkspace, and topKChunks
// preserves nothing in particular — so we sort within each group by index).
// Sources with no retrieved chunks are dropped: the prompt only carries the
// material actually fed to the model. `sourceById` is the workspace source
// catalog so titles/author/type ride along.
function groupChunksBySource(
  chunks: ChunkRecord[],
  sourceById: Map<string, SourceRecord>,
): WorkspaceSource[] {
  const byId = new Map<string, ChunkRecord[]>();
  for (const c of chunks) {
    const arr = byId.get(c.sourceId);
    if (arr) arr.push(c);
    else byId.set(c.sourceId, [c]);
  }
  const out: WorkspaceSource[] = [];
  for (const [sourceId, group] of byId) {
    const src = sourceById.get(sourceId);
    group.sort((a, b) => a.index - b.index);
    const ws: WorkspaceSource = {
      id: sourceId,
      title: src?.title ?? sourceId,
      type: src?.type ?? "pdf",
      chunks: group,
      ...(src?.titleEn !== undefined ? { titleEn: src.titleEn } : {}),
      ...(src?.author !== undefined ? { author: src.author } : {}),
    };
    out.push(ws);
  }
  return out;
}

export function useWorkspaceChat(
  { workspaceId }: UseWorkspaceChatArgs,
): UseWorkspaceChatResult {
  const pick = useLocalePick();
  const locale = usePrefs((s) => s.locale);
  const aiResponseLocale = usePrefs((s) => s.aiResponseLocale);
  const { toast } = useToast();

  const masterKey = useVault((s) => s.masterKey);

  const threads = useWorkspaceChatThreads(workspaceId);
  const sources = useSources(workspaceId) ?? [];
  const chunks = useChunksByWorkspace(workspaceId) ?? [];

  const sourceById = useMemo(() => {
    const m = new Map<string, SourceRecord>();
    for (const s of sources) m.set(s.id, s);
    return m;
  }, [sources]);

  // Active thread selection. Default to the first (pinned-first, newest)
  // workspace thread when the user hasn't explicitly picked one. `newThread`
  // sets a sentinel that forces the next sendMessage to create a fresh thread
  // and clears the visible message list in the meantime.
  const [explicitThreadId, setExplicitThreadId] = useState<string | null>(null);
  const [forceNewThread, setForceNewThread] = useState(false);
  const activeThreadId =
    forceNewThread
      ? undefined
      : explicitThreadId && threads.some((t) => t.id === explicitThreadId)
        ? explicitThreadId
        : threads[0]?.id;

  const messages = useMessages(activeThreadId) ?? [];

  // Context chips. Initialised from the active thread's persisted scopes (or
  // the default ["sources"]). Local state owns the live value; we mirror it to
  // the thread row via setThreadContextScopes whenever it changes so reopening
  // restores the toggles.
  const activeThread = useMemo(
    () => threads.find((t) => t.id === activeThreadId),
    [threads, activeThreadId],
  );
  const [contextScopes, setContextScopesState] =
    useState<ContextScope[]>(DEFAULT_CONTEXT_SCOPES);
  // Source-scope narrowing for the active thread. Empty ⇒ all sources.
  const [selectedSourceIds, setSelectedSourceIdsState] = useState<string[]>([]);
  // True after the user manually toggles a chip in the current session — gates
  // the thread-sync effect so reselecting a thread re-seeds from persistence
  // but in-session edits aren't clobbered by the live-query echo.
  const lastSyncedThreadRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    // Re-seed when the active thread changes (including → undefined for a new
    // thread). Reading the persisted scopes here keeps the chips in sync with
    // whatever the thread was last left at.
    if (lastSyncedThreadRef.current === activeThreadId) return;
    lastSyncedThreadRef.current = activeThreadId;
    const persisted = activeThread?.contextScopes;
    if (persisted && persisted.length > 0) {
      setContextScopesState(persisted as ContextScope[]);
    } else {
      setContextScopesState(DEFAULT_CONTEXT_SCOPES);
    }
    const persistedSources = activeThread?.selectedSourceIds;
    setSelectedSourceIdsState(
      persistedSources && persistedSources.length > 0 ? persistedSources : [],
    );
  }, [
    activeThreadId,
    activeThread?.contextScopes,
    activeThread?.selectedSourceIds,
  ]);

  const setContextScopes = useCallback(
    (next: ContextScope[]) => {
      setContextScopesState(next);
      // Persist to the active thread when one exists. A brand-new (not yet
      // created) thread has no row to write to; runChat persists the scopes
      // onto the thread it creates on first send.
      if (activeThreadId) {
        void setThreadContextScopes(activeThreadId, next);
      }
    },
    [activeThreadId],
  );

  const setSelectedSourceIds = useCallback(
    (next: string[]) => {
      setSelectedSourceIdsState(next);
      // Same persistence contract as context scopes: write to the live thread
      // when one exists; runChat persists onto the thread it creates on first
      // send otherwise.
      if (activeThreadId) {
        void setThreadSelectedSources(activeThreadId, next);
      }
    },
    [activeThreadId],
  );

  // Web-search toggle. Sticky-in-session, seeded from the user's stored
  // default (same pattern as the reader). After the first manual toggle the
  // per-message state owns the value.
  const webSearchDefault = usePrefs((s) => s.webSearchPrefs.enabled);
  const [webSearchEnabled, setWebSearchEnabledState] =
    useState<boolean>(webSearchDefault);
  const userHasToggledWebRef = useRef(false);
  useEffect(() => {
    if (!userHasToggledWebRef.current) setWebSearchEnabledState(webSearchDefault);
  }, [webSearchDefault]);
  const setWebSearchEnabled = useCallback((next: boolean) => {
    userHasToggledWebRef.current = true;
    setWebSearchEnabledState(next);
  }, []);

  const [chatStatus, setChatStatus] = useState<WorkspaceChatStatus>({
    kind: "idle",
  });

  const streamControllerRef = useRef<{ abort: () => void } | null>(null);

  useEffect(() => {
    return () => {
      streamControllerRef.current?.abort();
    };
  }, []);

  // Clear a sticky vault_locked error once the vault is (re-)unlocked. We watch
  // the masterKey reference (freshly derived per unlock) so re-unlocking while
  // already unlocked still clears the banner. (Post-Phase-9 the masterKey is a
  // non-null sentinel on every build, so this is effectively a no-op guard
  // kept for parity with the reader.)
  useEffect(() => {
    if (!masterKey) return;
    setChatStatus((prev) =>
      prev.kind === "error" && prev.code === "vault_locked"
        ? { kind: "idle" }
        : prev,
    );
  }, [masterKey]);

  const selectThread = useCallback((id: string) => {
    setForceNewThread(false);
    setExplicitThreadId(id);
  }, []);

  const newThread = useCallback(() => {
    // Don't tear down a running stream's thread out from under it.
    setForceNewThread(true);
    setExplicitThreadId(null);
    setContextScopesState(DEFAULT_CONTEXT_SCOPES);
    setSelectedSourceIdsState([]);
    lastSyncedThreadRef.current = undefined;
  }, []);

  const runChat = useCallback(
    async (
      userMessage: string,
      workspaceChunks: ChunkRecord[],
      activeScopes: ContextScope[],
      sourceSelection: string[],
      opts?: {
        webSearchEnabled?: boolean;
        // Retry / fork path: supply a truncated message list to use as API
        // history. Without this, runChat reads `messages` from its closure,
        // which after an async delete still contains the failed turn —
        // producing a duplicate "..." bubble + a duplicate user turn.
        historyOverride?: ChatMessageRecord[];
        // `newThread()` path: force a brand-new workspace thread instead of
        // reusing the newest existing one. Without this, findOrCreate would
        // hand back the most recent thread and "New chat" would be a no-op
        // whenever the workspace already had a thread.
        forceNew?: boolean;
      },
    ) => {
      const useWebSearch = opts?.webSearchEnabled === true;

      // Mark the run in-flight up-front (before the async credential resolution
      // below) so `isBusy` gates the context chips + source picker for the
      // WHOLE turn — including the brief window before a brand-new thread row
      // exists. Without this, a mid-credential-await toggle wouldn't persist and
      // would diverge from the value the turn actually used.
      setChatStatus({ kind: "preparing" });

      // Read fresh from the store (matches the reader): the captured masterKey
      // from the useCallback closure can lag a just-completed unlock.
      const currentMasterKey = useVault.getState().masterKey;
      if (!currentMasterKey) {
        setChatStatus({
          kind: "error",
          code: "vault_locked",
          message: pick("Anahtar kilitli.", "Vault is locked."),
        });
        return;
      }

      // Resolve the user's Settings → Models selection. No hardcoded fallback:
      // the picker is authoritative.
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

      // Workspace thread (NOT a source thread). On the `newThread()` path we
      // always create a fresh one; otherwise findOrCreate reuses the newest
      // existing workspace thread (or creates the first). Title is derived
      // from the opening message. Context scopes are persisted onto the thread
      // so they survive a reopen even before the user toggles a chip.
      const threadTitle =
        userMessage.slice(0, 60) || pick("Yeni sohbet", "New chat");
      const thread = opts?.forceNew
        ? await createWorkspaceThread(workspaceId, threadTitle)
        : await findOrCreateWorkspaceThread(workspaceId, threadTitle);
      // We just (maybe) created a thread; make it the visible one and clear the
      // force-new sentinel so the message list follows it.
      setForceNewThread(false);
      setExplicitThreadId(thread.id);
      lastSyncedThreadRef.current = thread.id;
      void setThreadContextScopes(thread.id, activeScopes);
      void setThreadSelectedSources(thread.id, sourceSelection);

      await addMessage({
        threadId: thread.id,
        workspaceId,
        role: "user",
        content: userMessage,
      });

      // === Cross-source retrieval ===
      // The "Kaynaklar" (sources) chip is a REAL switch: when it's off the
      // tutor ignores the workspace documents entirely and answers from general
      // knowledge (plus web / notes / concepts / etc. if those are toggled on).
      // We model that by leaving the candidate set empty so the <sources> block
      // is empty and the embedding round below is skipped.
      const sourcesEnabled = activeScopes.includes("sources");
      // When sources ARE on, first narrow to the user's source selection. Empty
      // ⇒ all sources; a non-empty selection restricts retrieval to that subset.
      // Ids that no longer map to a live source (a deleted source) are dropped
      // first, so a selection left holding ONLY stale ids collapses back to
      // "all" instead of silently retrieving nothing.
      const liveSourceIds = new Set(sources.map((s) => s.id));
      const liveSelection = sourceSelection.filter((id) =>
        liveSourceIds.has(id),
      );
      const sourceFilter =
        liveSelection.length > 0 ? new Set(liveSelection) : null;
      const candidateChunks: ChunkRecord[] = !sourcesEnabled
        ? []
        : sourceFilter
          ? workspaceChunks.filter((c) => sourceFilter.has(c.sourceId))
          : workspaceChunks;

      // Filter to chunks carrying embeddings; embed the query once; topKChunks
      // over the union. topKChunks skips chunks whose embedding dim doesn't
      // match the query's → skippedCount drives the embedding-mismatch notice.
      const chunksWithEmbeddings = candidateChunks.filter((c) => c.embedding);
      let promptChunks = candidateChunks.slice(0, RETRIEVAL_FALLBACK_LIMIT);
      let retrievalEmpty = false;
      let skippedCount = 0;

      // A deliberate narrow selection whose sources carry no retrievable chunks
      // (while the workspace DOES have chunks) would otherwise feed an empty
      // <sources> block with no notice. Flag it so the "answering from general
      // knowledge" line fires. Gated on sourcesEnabled: when the chip is off the
      // empty block is intentional (the user opted out), so no notice.
      if (
        sourcesEnabled &&
        sourceFilter &&
        candidateChunks.length === 0 &&
        workspaceChunks.length > 0
      ) {
        retrievalEmpty = true;
        promptChunks = [];
      }

      if (chunksWithEmbeddings.length > 0) {
        const embeddingProvider =
          chunksWithEmbeddings.find((c) => c.embeddingProvider)
            ?.embeddingProvider ?? "openai";
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
            const queryEmbed = await getEmbedProvider(
              embeddingProvider as ProviderId,
            ).embed({
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
              skippedCount = retrieved.skippedCount;
              if (retrieved.chunks.length === 0) {
                // Embeddings exist but nothing matched. Clear the fallback
                // chunks so the <sources> block is genuinely empty — otherwise
                // the model sees arbitrary chunks while being told to answer
                // from general knowledge, and may cite irrelevant material.
                retrievalEmpty = true;
                promptChunks = [];
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

      // Group the retrieved chunks back into per-source blocks for the prompt.
      const promptSources = groupChunksBySource(promptChunks, sourceById);

      // Gather the toggled context blocks (notes / concepts / roadmap /
      // performance). gatherContextBlocks filters out "sources" and "web"
      // itself, but we pass the full active scope list so the dispatch reads
      // exactly what the chips reflect.
      let contextBlocks: Awaited<ReturnType<typeof gatherContextBlocks>> = [];
      try {
        contextBlocks = await gatherContextBlocks(workspaceId, activeScopes);
      } catch {
        // A failing context builder must never break the chat — the answer
        // simply proceeds without that block. (No telemetry, no surfaced
        // error; the chips remain a best-effort enrichment.)
        contextBlocks = [];
      }

      const system = buildWorkspaceChatSystem({
        sources: promptSources,
        contextBlocks,
        locale,
        aiResponseLocale,
      });

      // Workspace tools: add_flashcard + simplify_explanation only. The
      // generate_flashcards / generate_quiz tools are intentionally NOT exposed
      // (see module note + return handoff): their generators run their own
      // nested LLM call and require the human-in-the-loop proposal modal, so
      // auto-persisting from a chat tool round-trip would bypass that flow.
      const tools: AnthropicTool[] = [...buildWorkspaceTools(locale)];

      const webSearchAdapter = useWebSearch
        ? getWebSearchAdapter(chatPresetId)
        : null;
      if (webSearchAdapter) {
        const wsOpts = webSearchPrefsToOptions(
          usePrefs.getState().webSearchPrefs,
        );
        const toolBlock = webSearchAdapter.buildToolBlock(wsOpts);
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
      // Track the last assistant turn so we can append the embedding-mismatch
      // notice to it once the turn settles cleanly (see below).
      let lastAssistantId: string | undefined;
      let lastAssistantBuffer = "";

      const isOAuth = chatPresetId === "anthropic" && authKind === "oauth";

      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const initialAssistantContent =
          round === 0 && retrievalEmpty
            ? pick(
                "Kaynaklarında soruyla doğrudan eşleşen bir pasaj bulamadım — genel bilgiyle yanıtlıyorum.\n\n",
                "I couldn't find a passage in your sources that matches this — answering from general knowledge instead.\n\n",
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
        lastAssistantId = assistant.id;

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
        const webCitations: WebCitation[] = [];
        const webCitationUrls = new Set<string>();
        let webSearchUsage: WebSearchUsage | undefined;

        const flush = async () => {
          await setMessageContent(assistant.id, buffer);
        };
        // Non-blocking throttled flush (verbatim from the reader): at most one
        // write in flight, the latest buffer always wins, the SSE loop never
        // awaits a write. A final flush after the loop guarantees the last
        // bytes land before usage/stopReason is persisted.
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
        lastAssistantBuffer = buffer;
        await patchMessageUsage(assistant.id, {
          tokensIn: tokensIn || undefined,
          tokensOut: tokensOut || undefined,
          cacheReadTokens: cacheRead || undefined,
          cacheCreationTokens: cacheCreation || undefined,
          stopReason,
          interrupted: interrupted ? true : undefined,
        });
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
            input = tc.input
              ? (JSON.parse(tc.input) as Record<string, unknown>)
              : {};
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
          // Anchor for add_flashcard. The handler prefers the CITED chunk's own
          // source (cross-source correctness, resolved via sourceChunkId/
          // section against the full workspace chunk set); this is only the
          // fallback when no chunk resolves. Never fall back to workspaceId —
          // that is not a sourceId and would dangle.
          const anchorSourceId = promptSources[0]?.id ?? sources[0]?.id;
          const handlerCtx = {
            workspaceId,
            ...(anchorSourceId ? { sourceId: anchorSourceId } : {}),
            chunks: promptChunks,
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
                description: `${tc.parsed.question as string}`.slice(0, 80),
                duration: FLASHCARD_UNDO_MS,
                action: {
                  label: pick("Geri al", "Undo"),
                  onClick: () => {
                    void deleteFlashcard(flashcardId).then(() => {
                      toast({
                        variant: "info",
                        title: pick("Kart geri alındı", "Card removed"),
                      });
                    });
                  },
                },
              });
            } else {
              toast({
                variant: "error",
                title: pick("Kart eklenemedi", "Could not add card"),
                description: r.error,
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

        // OAuth: the tool round-trip already happened server-side in the SDK;
        // skip the follow-up turn entirely.
        if (isOAuth) break;

        const userBlocks: AnthropicContentBlock[] = [...resultBlocks];
        if (simplifyExtraText) {
          userBlocks.push({ type: "text", text: simplifyExtraText });
        }
        apiMessages.push({ role: "user", content: userBlocks });
      }

      streamControllerRef.current = null;

      // Surface the embedding-dim mismatch as a non-fatal notice. topKChunks
      // skips chunks whose embedding dim doesn't match the query's (sources
      // indexed under a different embedder) — when that happened on a clean
      // turn, append a one-line italic note to the answer so the user knows
      // some material was excluded. Appended to the settled buffer (we run
      // after the final flush) so it never races the streaming writer.
      if (
        !streamError &&
        !interrupted &&
        skippedCount > 0 &&
        lastAssistantId !== undefined
      ) {
        const notice = pick(
          "Bazı kaynaklar farklı bir embedding modeliyle indexlenmiş ve bu yanıt için atlandı.",
          "Some sources were indexed with a different embedding model and were skipped for this answer.",
        );
        await setMessageContent(
          lastAssistantId,
          `${lastAssistantBuffer}\n\n_${notice}_`,
        );
      }

      if (streamError) {
        const parsed = parseEventCode(streamError.message);
        const finalCode =
          streamError.code === "unauthorized" ||
          streamError.code === "rate_limited" ||
          streamError.code === "network"
            ? streamError.code
            : parsed.code ?? streamError.code;
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
            ...(parsed.clean && parsed.clean !== streamError.message
              ? { upstreamDetail: parsed.clean }
              : { upstreamDetail: streamError.message }),
          }),
        });
        return;
      }

      setChatStatus({ kind: "idle" });
    },
    [
      locale,
      aiResponseLocale,
      messages,
      pick,
      sourceById,
      sources,
      toast,
      workspaceId,
    ],
  );

  const sendMessage = useCallback(
    (raw: string) => {
      const message = raw.trim();
      if (!message) return;
      // Re-entry guard: never kick off a second turn while one is in flight.
      if (chatStatus.kind === "preparing" || chatStatus.kind === "streaming") {
        return;
      }
      void runChat(message, chunks, contextScopes, selectedSourceIds, {
        webSearchEnabled,
        // Only the FIRST message after `newThread()` forces a new thread;
        // runChat clears the sentinel once the thread exists so follow-up
        // turns in that fresh thread reuse it.
        ...(forceNewThread ? { forceNew: true } : {}),
      });
    },
    [
      chatStatus.kind,
      chunks,
      contextScopes,
      forceNewThread,
      runChat,
      selectedSourceIds,
      webSearchEnabled,
    ],
  );

  const cancelStream = useCallback(() => {
    streamControllerRef.current?.abort();
  }, []);

  const retry = useCallback(
    (messageId: string) => {
      void (async () => {
        if (
          chatStatus.kind === "preparing" ||
          chatStatus.kind === "streaming"
        ) {
          return;
        }
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
        if (!userMsg) return;
        // Drop the failed turn + everything after it. Pass the pre-user slice
        // as historyOverride because the closure's `messages` won't reflect the
        // deletes synchronously (stale-closure-on-async-delete fix).
        const historyOverride = messages.slice(0, userIdx);
        const toDelete = messages.slice(userIdx);
        await Promise.all(toDelete.map((m) => deleteMessage(m.id)));
        void runChat(userMsg.content, chunks, contextScopes, selectedSourceIds, {
          webSearchEnabled,
          historyOverride,
        });
      })();
    },
    [
      chatStatus.kind,
      chunks,
      contextScopes,
      messages,
      runChat,
      selectedSourceIds,
      webSearchEnabled,
    ],
  );

  const fork = useCallback(
    (messageId: string) => {
      void (async () => {
        if (!activeThreadId) return;
        try {
          const { newThreadId } = await forkThread(activeThreadId, messageId);
          setForceNewThread(false);
          setExplicitThreadId(newThreadId);
          lastSyncedThreadRef.current = undefined;
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
      })();
    },
    [activeThreadId, pick, toast],
  );

  return {
    threads,
    activeThreadId,
    selectThread,
    newThread,
    messages,
    chunks,
    chatStatus,
    contextScopes,
    setContextScopes,
    selectedSourceIds,
    setSelectedSourceIds,
    webSearchEnabled,
    setWebSearchEnabled,
    sendMessage,
    cancelStream,
    retry,
    fork,
  };
}
