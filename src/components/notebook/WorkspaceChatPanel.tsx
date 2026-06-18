"use client";

import { CircleStop, Loader2, MessagesSquare, Plus, Send } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChatBubble as ChatBubbleStandalone } from "@/components/notebook/ChatBubble";
import { ContextBar } from "@/components/notebook/ContextBar";
import { Button } from "@/components/ui/Button";
import { Kbd } from "@/components/ui/Kbd";
import { useLocalePick } from "@/i18n/IntlProvider";
import type { ContextScope } from "@/lib/ai/context/types";
import type {
  ChatMessageRecord,
  ChatThreadRecord,
  ChunkRecord,
  SourceRecord,
} from "@/lib/db/types";
import { cn } from "@/lib/utils/cn";

// Structural mirror of the reader page's local `ChatStatus`. The workspace
// runner produces the same discriminated union; declared here (not imported)
// so the panel doesn't take a hard dependency on the runner module's export
// surface — any value satisfying this shape interlocks.
export type WorkspaceChatStatus =
  | { kind: "idle" }
  | { kind: "preparing" }
  | { kind: "streaming"; messageId: string }
  | { kind: "error"; code: string; message: string };

export type WorkspaceChatPanelProps = {
  /** Used to route citation clicks to `/w/[id]/read/[sourceId]`, since the
   *  workspace chat has no adjacent reader to scroll. */
  workspaceId: string;
  threads: ChatThreadRecord[];
  activeThreadId: string | null;
  selectThread: (id: string) => void;
  newThread: () => void;
  messages: ChatMessageRecord[];
  chunks: ChunkRecord[];
  chatStatus: WorkspaceChatStatus;
  contextScopes: ContextScope[];
  setContextScopes: (next: ContextScope[]) => void;
  webSearchEnabled: boolean;
  setWebSearchEnabled: (next: boolean) => void;
  sendMessage: (text: string) => void;
  cancelStream: () => void;
  retry: (messageId: string) => void;
  fork: (messageId: string) => void;
  /** True when the workspace has zero sources. Shows a gentle hint so the user
   *  knows the chat still works off notes / general knowledge. */
  hasNoSources?: boolean;
  /** Workspace sources — fed to the ContextBar's source-scope picker (ready
   *  sources only). */
  sources?: SourceRecord[];
  /** Empty ⇒ all sources; non-empty ⇒ that subset is searched. */
  selectedSourceIds?: string[];
  setSelectedSourceIds?: (next: string[]) => void;
};

export function WorkspaceChatPanel({
  workspaceId,
  threads,
  activeThreadId,
  selectThread,
  newThread,
  messages,
  chunks,
  chatStatus,
  contextScopes,
  setContextScopes,
  webSearchEnabled,
  setWebSearchEnabled,
  sendMessage,
  cancelStream,
  retry,
  fork,
  hasNoSources = false,
  sources,
  selectedSourceIds,
  setSelectedSourceIds,
}: WorkspaceChatPanelProps) {
  const t = useTranslations("workspace_chat");
  const pick = useLocalePick();
  const router = useRouter();

  // Only ready sources have chunks to retrieve from, so the picker lists those.
  const pickableSources = useMemo(
    () =>
      (sources ?? [])
        .filter((s) => s.ingestStatus === "ready")
        .map((s) => ({
          id: s.id,
          title: s.title,
          titleEn: s.titleEn,
          type: s.type,
        })),
    [sources],
  );

  const isStreaming = chatStatus.kind === "streaming";
  const isPreparing = chatStatus.kind === "preparing";
  const isBusy = isStreaming || isPreparing;
  const isError = chatStatus.kind === "error";

  const lastAssistantId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m && m.role === "assistant") return m.id;
    }
    return null;
  }, [messages]);

  // Auto-scroll to the newest message / typing indicator.
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, isPreparing]);

  // Citations route to the matching reader. The chunk carries the sourceId; we
  // navigate rather than scroll in-place because there is no adjacent reader.
  const handleJumpCitation = useCallback(
    (chunk: ChunkRecord) => {
      router.push(`/w/${workspaceId}/read/${chunk.sourceId}`);
    },
    [router, workspaceId],
  );

  // Toggle a single non-web scope on the thread. Membership add/remove keeps
  // the runner's `setContextScopes` as the single source of truth; we never
  // touch "web" here (the ContextBar wires that through `setWebSearchEnabled`).
  const handleToggleScope = useCallback(
    (scope: ContextScope) => {
      const active = new Set(contextScopes);
      if (active.has(scope)) active.delete(scope);
      else active.add(scope);
      setContextScopes([...active]);
    },
    [contextScopes, setContextScopes],
  );

  const handleSend = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isBusy) return;
      sendMessage(trimmed);
    },
    [isBusy, sendMessage],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-paper">
      <ThreadSwitcher
        threads={threads}
        activeThreadId={activeThreadId}
        onSelect={selectThread}
        onNew={newThread}
        disabled={isBusy}
      />

      <ContextBar
        scopes={contextScopes}
        onToggleScope={handleToggleScope}
        webEnabled={webSearchEnabled}
        onToggleWeb={setWebSearchEnabled}
        sources={pickableSources}
        selectedSourceIds={selectedSourceIds ?? []}
        disabled={isBusy}
        {...(setSelectedSourceIds
          ? { onChangeSelectedSources: setSelectedSourceIds }
          : {})}
      />

      {isError ? (
        <div
          role="alert"
          className="border-b border-err/30 bg-err/10 px-4 py-2.5 text-[12.5px] leading-[1.5] text-err"
        >
          {(chatStatus as { message: string }).message}
        </div>
      ) : null}

      <div ref={listRef} className="flex-1 space-y-5 overflow-y-auto px-4 py-5">
        {messages.length === 0 ? (
          <div className="mx-auto flex max-w-[520px] flex-col items-center justify-center py-10 text-center">
            <div className="text-ink-3" aria-hidden>
              <MessagesSquare className="h-10 w-10" />
            </div>
            <h3 className="mt-4 font-serif text-[18px] font-medium leading-tight text-ink">
              {t("empty_title")}
            </h3>
            <p className="mt-2 max-w-[440px] text-[13px] leading-6 text-ink-3">
              {t("empty_desc")}
            </p>
            {hasNoSources ? (
              <p className="mt-4 rounded-[10px] border border-rule bg-paper-2 px-3.5 py-2.5 text-[12.5px] leading-[1.5] text-ink-3">
                <span className="font-medium text-ink-2">
                  {t("no_sources_title")}
                </span>
                {" — "}
                {t("no_sources_desc")}
              </p>
            ) : null}
          </div>
        ) : (
          messages.map((m) => (
            <ChatBubbleStandalone
              key={m.id}
              message={m}
              chunks={chunks}
              isStreaming={isStreaming && m.id === lastAssistantId}
              onJumpCitation={handleJumpCitation}
              onRetry={retry}
              onFork={fork}
              wide
            />
          ))
        )}
        {isPreparing ? <TypingDots label={t("title")} pick={pick} /> : null}
      </div>

      <Composer
        onSend={handleSend}
        onCancel={cancelStream}
        isStreaming={isStreaming}
        isPreparing={isPreparing}
        messageCount={messages.length}
      />
    </div>
  );
}

function ThreadSwitcher({
  threads,
  activeThreadId,
  onSelect,
  onNew,
  disabled,
}: {
  threads: ChatThreadRecord[];
  activeThreadId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  disabled: boolean;
}) {
  const t = useTranslations("workspace_chat");
  return (
    <div className="flex items-center gap-2 border-b border-rule bg-paper px-4 py-2.5">
      <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
        {threads.length === 0 ? (
          <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-4">
            {t("thread_default_title")}
          </span>
        ) : (
          threads.map((thread) => {
            const isActive = thread.id === activeThreadId;
            return (
              <button
                key={thread.id}
                type="button"
                onClick={() => onSelect(thread.id)}
                aria-current={isActive ? "true" : undefined}
                title={thread.title || t("thread_default_title")}
                className={cn(
                  "max-w-[160px] shrink-0 truncate rounded-full border px-3 py-1 text-[12px] transition-colors",
                  isActive
                    ? "border-accent bg-accent-wash text-accent-ink"
                    : "border-rule text-ink-3 hover:border-ink-3 hover:text-ink",
                )}
              >
                {thread.title || t("thread_default_title")}
              </button>
            );
          })
        )}
      </div>
      <Button
        size="icon-sm"
        variant="ghost"
        onClick={onNew}
        disabled={disabled}
        aria-label={t("new_thread")}
        title={t("new_thread")}
      >
        <Plus className="h-3.5 w-3.5" aria-hidden />
      </Button>
    </div>
  );
}

// Draft state is LOCAL to the composer so typing never re-renders the message
// list (which can be long and runs ReactMarkdown per assistant bubble). The
// parent only learns about the draft when the user actually sends.
function Composer({
  onSend,
  onCancel,
  isStreaming,
  isPreparing,
  messageCount,
}: {
  onSend: (text: string) => void;
  onCancel: () => void;
  isStreaming: boolean;
  isPreparing: boolean;
  messageCount: number;
}) {
  const t = useTranslations("workspace_chat");
  const pick = useLocalePick();
  const [draft, setDraft] = useState("");
  const isBusy = isStreaming || isPreparing;

  function submit(): void {
    const trimmed = draft.trim();
    if (trimmed.length === 0 || isBusy) return;
    onSend(trimmed);
    setDraft("");
  }

  return (
    <div className="border-t border-rule bg-paper-2 px-3 py-3">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="flex items-end gap-2 rounded-lg border border-rule bg-paper p-2 transition-colors focus-within:border-ink-5"
      >
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
            if (e.key === "Escape" && isStreaming) {
              e.preventDefault();
              onCancel();
            }
          }}
          placeholder={t("composer_placeholder")}
          rows={2}
          disabled={isBusy}
          className="flex-1 resize-none bg-transparent px-2 py-1 text-[13.5px] outline-none placeholder:text-ink-4 disabled:cursor-not-allowed disabled:text-ink-4"
        />
        {isStreaming ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={onCancel}
            aria-label={t("stop")}
          >
            <CircleStop className="h-3.5 w-3.5" aria-hidden />
            {t("stop")}
          </Button>
        ) : (
          <Button
            type="submit"
            size="sm"
            variant="primary"
            disabled={isBusy || draft.trim().length === 0}
          >
            {isPreparing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <Send className="h-3.5 w-3.5" aria-hidden />
            )}
            {t("send")}
          </Button>
        )}
      </form>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-ink-4">
        <div className="flex items-center gap-1.5">
          <Kbd>⌘</Kbd>
          <Kbd>↵</Kbd>
          <span>{t("send")}</span>
          {isStreaming ? (
            <>
              <span className="px-1">·</span>
              <Kbd>Esc</Kbd>
              <span>{t("stop")}</span>
            </>
          ) : null}
        </div>
        <span>
          {messageCount} {pick("mesaj", "messages")}
        </span>
      </div>
    </div>
  );
}

function TypingDots({
  label,
  pick,
}: {
  label: string;
  pick: (tr: string, en: string) => string;
}) {
  return (
    <div
      className="flex items-center gap-2 text-[11.5px] text-ink-4"
      aria-label={label}
    >
      <div className="flex gap-1">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ink-4 [animation-delay:0ms]" />
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ink-4 [animation-delay:120ms]" />
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ink-4 [animation-delay:240ms]" />
      </div>
      <span>{pick("Hazırlanıyor…", "Preparing…")}</span>
    </div>
  );
}
