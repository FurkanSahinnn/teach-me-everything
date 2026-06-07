"use client";

import {
  AlertCircle,
  BookmarkPlus,
  Check,
  Copy,
  GitBranch,
  Loader2,
  MoreHorizontal,
  RotateCw,
  Sparkles,
  Wrench,
} from "lucide-react";
import { useTranslations } from "next-intl";
import {
  Children,
  Fragment,
  cloneElement,
  isValidElement,
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import {
  CitationChip,
  findChunkForRef,
  parseCitations,
} from "@/components/notebook/CitationChip";
import { WebCitationChip } from "@/components/notebook/WebCitationChip";
import { useToast } from "@/components/ui/Toast";
import { useLocalePick } from "@/i18n/IntlProvider";
import { findChatOption } from "@/lib/ai/model-options";
import type { WebCitation } from "@/lib/ai/web-search/types";
import type { ChatMessageRecord, ChunkRecord } from "@/lib/db/types";
import { cn } from "@/lib/utils/cn";

type ChatBubbleProps = {
  message: ChatMessageRecord;
  chunks: ChunkRecord[];
  isStreaming: boolean;
  onJumpCitation: (chunk: ChunkRecord) => void;
  onRetry?: (messageId: string) => void;
  onFork?: (messageId: string) => void;
  /** Open the source-aware GenerateBatchModal in `single` mode anchored to
   *  this message + its preceding user turn. Only surfaced for assistant
   *  bubbles when the host wires it. */
  onProposeCardsFromMessage?: (messageId: string) => void;
  /** Save the assistant turn (with preceding user question) as a Study
   *  Journal entry. Surfaced only on completed assistant bubbles when the
   *  host wires it. */
  onSaveJournalEntry?: (messageId: string) => void;
  /** Phase 5.5.C — clicking a web citation chip opens the peek modal in
   *  the parent. Optional so legacy hosts (and unit tests) can omit it; in
   *  that case chips render but clicks are no-ops. */
  onWebCitationClick?: (citation: WebCitation) => void;
  /** Phase 6.9.7 — source ids whose `type === "note"`. A citation whose
   *  resolved chunk belongs to one of these renders with the emerald
   *  NotebookPen variant of `<CitationChip />`. Click routing still flows
   *  through `onJumpCitation`; the host inspects the chunk's source and
   *  routes to `/notes` when appropriate. */
  noteSourceIds?: ReadonlySet<string>;
};

/**
 * Walk a React subtree produced by react-markdown and replace `[§ref]`
 * patterns inside text leaves with interactive `<CitationChip />` elements.
 * We do this *after* markdown parsing so chips can land inside paragraphs,
 * list items, table cells, headings, strong/em runs — anywhere the model
 * decided to cite. We deliberately skip recursing into `<code>` / `<pre>`
 * because citations there are part of literal sample output, not references.
 */
function transformCitationsInChildren(
  children: ReactNode,
  chunks: ChunkRecord[],
  onJump: (chunk: ChunkRecord) => void,
  noteSourceIds?: ReadonlySet<string>,
): ReactNode {
  return Children.map(children, (child, idx) => {
    if (typeof child === "string") {
      const tokens = parseCitations(child);
      if (tokens.length === 0) return child;
      if (tokens.length === 1 && tokens[0]?.kind === "text") return child;
      return tokens.map((tok, i) => {
        if (tok.kind === "text") {
          return <Fragment key={`t-${idx}-${i}`}>{tok.text}</Fragment>;
        }
        const chunk = findChunkForRef(tok.ref, chunks);
        // Phase 6.9.7 — emerald variant when the resolved chunk lives in a
        // note-source. `noteSourceIds` is undefined for legacy hosts (e.g.
        // unit-test stubs of ChatBubble that don't wire the new prop), so
        // the chip falls back to the default § palette.
        const tone =
          chunk && noteSourceIds && noteSourceIds.has(chunk.sourceId)
            ? "note"
            : "default";
        return (
          <CitationChip
            key={`c-${idx}-${i}`}
            ref={tok.ref}
            active={!!chunk}
            onActivate={() => chunk && onJump(chunk)}
            tone={tone}
          />
        );
      });
    }
    if (isValidElement(child)) {
      const elementType = child.type;
      // Don't reach into code/pre — they hold literal source text and a
      // stray `[§…]` there is intentional, not a citation reference.
      if (elementType === "code" || elementType === "pre") return child;
      const props = child.props as { children?: ReactNode };
      if (props.children !== undefined) {
        return cloneElement(
          child,
          {} as never,
          transformCitationsInChildren(
            props.children,
            chunks,
            onJump,
            noteSourceIds,
          ),
        );
      }
    }
    return child;
  });
}

function ChatBubbleImpl({
  message,
  chunks,
  isStreaming,
  onJumpCitation,
  onRetry,
  onFork,
  onProposeCardsFromMessage,
  onSaveJournalEntry,
  onWebCitationClick,
  noteSourceIds,
}: ChatBubbleProps) {
  const t = useTranslations("reader");
  const tAction = useTranslations("message_action");
  const pick = useLocalePick();
  const { toast } = useToast();
  const [menuOpen, setMenuOpen] = useState(false);
  const [webCitationsOpen, setWebCitationsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const webCitations: WebCitation[] = useMemo(
    () => message.webCitations ?? [],
    [message.webCitations],
  );
  const showWebCitations = !isUserPrecomputed(message.role) && webCitations.length > 0;

  const isUser = message.role === "user";
  const time = useMemo(
    () => formatTime(message.createdAt, pick),
    [message.createdAt, pick],
  );
  const totalIn = message.tokensIn ?? 0;
  const cacheHit = (message.cacheReadTokens ?? 0) > 0;
  const showMeta =
    !isUser && (totalIn > 0 || (message.tokensOut ?? 0) > 0 || message.model);

  // Components map for ReactMarkdown — compact spacing tuned to the chat
  // bubble (max 300px wide). Memoized on chunks/onJumpCitation/noteSourceIds
  // so child overrides don't churn on every assistant streaming tick.
  const markdownComponents = useMemo<Components>(() => {
    const wrap = (children: ReactNode) =>
      transformCitationsInChildren(
        children,
        chunks,
        onJumpCitation,
        noteSourceIds,
      );
    return {
      p: ({ children }) => (
        <p className="my-1.5 first:mt-0 last:mb-0">{wrap(children)}</p>
      ),
      ul: ({ children }) => (
        <ul className="my-1.5 list-disc space-y-1 pl-4 marker:text-ink-4">
          {children}
        </ul>
      ),
      ol: ({ children }) => (
        <ol className="my-1.5 list-decimal space-y-1 pl-4 marker:text-ink-4">
          {children}
        </ol>
      ),
      li: ({ children }) => <li className="pl-0.5">{wrap(children)}</li>,
      h1: ({ children }) => (
        <h1 className="mb-1.5 mt-2 text-[15px] font-semibold leading-snug text-ink first:mt-0">
          {wrap(children)}
        </h1>
      ),
      h2: ({ children }) => (
        <h2 className="mb-1.5 mt-2 text-[14.5px] font-semibold leading-snug text-ink first:mt-0">
          {wrap(children)}
        </h2>
      ),
      h3: ({ children }) => (
        <h3 className="mb-1 mt-2 text-[13.5px] font-semibold leading-snug text-ink first:mt-0">
          {wrap(children)}
        </h3>
      ),
      h4: ({ children }) => (
        <h4 className="mb-1 mt-1.5 text-[13px] font-semibold leading-snug text-ink first:mt-0">
          {wrap(children)}
        </h4>
      ),
      strong: ({ children }) => (
        <strong className="font-semibold text-ink">{wrap(children)}</strong>
      ),
      em: ({ children }) => <em className="italic">{wrap(children)}</em>,
      blockquote: ({ children }) => (
        <blockquote className="my-1.5 border-l-2 border-rule pl-2.5 text-ink-2 [&_p]:my-1">
          {children}
        </blockquote>
      ),
      hr: () => <hr className="my-2 border-rule" />,
      a: ({ href, children }) => {
        const external = href ? /^https?:\/\//i.test(href) : false;
        return (
          <a
            href={href}
            target={external ? "_blank" : undefined}
            rel={external ? "noreferrer" : undefined}
            className="text-accent underline decoration-accent/35 underline-offset-2 hover:text-accent-hot hover:decoration-accent"
          >
            {wrap(children)}
          </a>
        );
      },
      code: ({ className, children, ...rest }) => {
        const isBlock = /language-/.test(className ?? "");
        return (
          <code
            className={cn(
              isBlock
                ? "block whitespace-pre overflow-x-auto rounded-[4px] bg-paper px-2 py-1.5 font-mono text-[12px] leading-snug"
                : "rounded-[3px] bg-paper px-[0.28em] py-[0.08em] font-mono text-[0.9em]",
              className,
            )}
            {...rest}
          >
            {children}
          </code>
        );
      },
      pre: ({ children }) => (
        <pre className="my-2 overflow-x-auto rounded-[4px] border border-rule bg-paper">
          {children}
        </pre>
      ),
      table: ({ children }) => (
        <div className="my-2 overflow-x-auto rounded border border-rule">
          <table className="min-w-full border-collapse text-left text-[12px]">
            {children}
          </table>
        </div>
      ),
      th: ({ children }) => (
        <th className="border-b border-rule bg-paper-2 px-2 py-1 font-semibold">
          {wrap(children)}
        </th>
      ),
      td: ({ children }) => (
        <td className="border-t border-rule-soft px-2 py-1 align-top text-ink-2">
          {wrap(children)}
        </td>
      ),
    };
  }, [chunks, onJumpCitation, noteSourceIds]);

  useEffect(() => {
    if (!menuOpen) return;
    function onClick(e: MouseEvent): void {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [menuOpen]);

  if (message.role === "tool") return null;
  if (message.role === "assistant" && message.toolName) {
    return <ToolActionBubble message={message} pick={pick} />;
  }

  async function handleCopy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(message.content ?? "");
      toast({ variant: "success", title: tAction("copied") });
    } catch (err) {
      toast({
        variant: "error",
        title: pick("Kopyalanamadı", "Copy failed"),
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setMenuOpen(false);
    }
  }

  function handleRetry(): void {
    setMenuOpen(false);
    onRetry?.(message.id);
  }

  function handleFork(): void {
    setMenuOpen(false);
    onFork?.(message.id);
  }

  function handleProposeCards(): void {
    setMenuOpen(false);
    onProposeCardsFromMessage?.(message.id);
  }

  function handleSaveJournal(): void {
    setMenuOpen(false);
    onSaveJournalEntry?.(message.id);
  }

  const showRetry = !isUser && Boolean(onRetry) && !isStreaming;
  const showFork = Boolean(onFork) && !isStreaming;
  // Surface "Karta çevir" only on completed assistant bubbles with usable
  // text — streaming/empty/tool bubbles wouldn't yield enough context.
  const showProposeCards =
    !isUser &&
    !isStreaming &&
    Boolean(onProposeCardsFromMessage) &&
    Boolean(message.content && message.content.trim().length > 0);
  const showSaveJournal =
    !isUser &&
    !isStreaming &&
    Boolean(onSaveJournalEntry) &&
    Boolean(message.content && message.content.trim().length > 0);

  // Resolve the message's actual model into a "Provider · model" label so the
  // user can see which upstream produced this turn — important now that the
  // chat surface routes to whatever Settings → Models picks (Anthropic /
  // OpenRouter / Groq / Ollama / …) instead of always Anthropic. Custom model
  // ids that aren't in the registry fall back to the raw model string.
  const speakerLabel = useMemo(() => {
    if (isUser) return t("sen");
    if (!message.model) return pick("Asistan", "Assistant");
    const opt = findChatOption(message.model);
    if (!opt) return message.model;
    const presetLabel = opt.label.split(" · ")[0] ?? opt.presetId;
    return `${presetLabel} · ${opt.modelId}`;
  }, [isUser, message.model, pick, t]);

  return (
    <div className={cn("group flex flex-col gap-2", isUser && "items-end")}>
      <div className="flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-4">
        <span>{speakerLabel}</span>
        <span>·</span>
        <span>{time}</span>
      </div>
      <div className={cn("relative flex max-w-[300px]", isUser && "justify-end")}>
        <div
          className={cn(
            "rounded-lg px-3.5 py-2.5 text-[13.5px] leading-[1.6]",
            // User text is plain (no markdown) so we honour explicit line
            // breaks; assistant content goes through ReactMarkdown which
            // handles whitespace its own way.
            isUser ? "whitespace-pre-wrap" : "",
            isUser
              ? "border border-accent-soft/40 bg-accent-wash text-ink"
              : "bg-paper-2 text-ink",
            isStreaming &&
              !isUser &&
              "after:ml-0.5 after:inline-block after:h-3 after:w-1.5 after:animate-pulse after:bg-ink-4 after:align-middle",
          )}
        >
          {isUser ? (
            message.content
          ) : message.content ? (
            // While streaming, render plain pre-wrapped text instead of
            // ReactMarkdown. The markdown pipeline (remarkGfm + remarkMath +
            // rehypeKatex + post-parse citation tree walk) re-parses the
            // ENTIRE growing string on every text delta — quadratic work
            // that froze the whole UI on Tauri WebView. Citations and KaTeX
            // render once when streaming completes (`isStreaming` flips to
            // false), at which point the swap is a single full parse.
            isStreaming ? (
              <div className="chat-bubble-markdown whitespace-pre-wrap">
                {message.content}
              </div>
            ) : (
              <div className="chat-bubble-markdown">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm, remarkMath]}
                  rehypePlugins={[rehypeKatex]}
                  components={markdownComponents}
                >
                  {message.content}
                </ReactMarkdown>
              </div>
            )
          ) : isStreaming ? (
            ""
          ) : (
            "…"
          )}
        </div>
        <div
          ref={menuRef}
          className={cn(
            "absolute -top-1.5 flex items-center transition-opacity",
            isUser ? "left-1.5 -translate-x-full" : "right-1.5 translate-x-full",
            menuOpen
              ? "opacity-100"
              : "opacity-0 group-hover:opacity-100 focus-within:opacity-100",
          )}
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((v) => !v);
            }}
            aria-label={pick("Mesaj menüsü", "Message menu")}
            aria-expanded={menuOpen}
            className="grid h-6 w-6 place-items-center rounded border border-rule bg-paper text-ink-3 hover:text-ink hover:bg-paper-2"
          >
            <MoreHorizontal className="h-3 w-3" aria-hidden />
          </button>
          {menuOpen ? (
            <div
              role="menu"
              className={cn(
                "absolute top-full z-20 mt-1 w-[180px] overflow-hidden rounded-[8px] border border-rule bg-paper py-1 text-[12.5px] shadow-[var(--shadow-medium)]",
                isUser ? "left-0" : "right-0",
              )}
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => void handleCopy()}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-ink-2 hover:bg-paper-2 hover:text-ink"
              >
                <Copy className="h-3.5 w-3.5" aria-hidden />
                {tAction("copy")}
              </button>
              {showRetry ? (
                <button
                  type="button"
                  role="menuitem"
                  onClick={handleRetry}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-ink-2 hover:bg-paper-2 hover:text-ink"
                >
                  <RotateCw className="h-3.5 w-3.5" aria-hidden />
                  {tAction("retry")}
                </button>
              ) : null}
              {showFork ? (
                <button
                  type="button"
                  role="menuitem"
                  onClick={handleFork}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-ink-2 hover:bg-paper-2 hover:text-ink"
                >
                  <GitBranch className="h-3.5 w-3.5" aria-hidden />
                  {tAction("fork")}
                </button>
              ) : null}
              {showProposeCards ? (
                <button
                  type="button"
                  role="menuitem"
                  onClick={handleProposeCards}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-ink-2 hover:bg-paper-2 hover:text-ink"
                >
                  <Sparkles className="h-3.5 w-3.5 text-accent" aria-hidden />
                  {pick("Karta çevir", "Make flashcards")}
                </button>
              ) : null}
              {showSaveJournal ? (
                <button
                  type="button"
                  role="menuitem"
                  onClick={handleSaveJournal}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-ink-2 hover:bg-paper-2 hover:text-ink"
                >
                  <BookmarkPlus className="h-3.5 w-3.5 text-accent" aria-hidden />
                  {tAction("save_to_journal")}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
      {showWebCitations ? (
        <div className="w-full max-w-[300px]">
          <button
            type="button"
            onClick={() => setWebCitationsOpen((v) => !v)}
            aria-expanded={webCitationsOpen}
            className="flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-3 hover:text-ink"
          >
            <span aria-hidden>🌐</span>
            <span>
              {pick("Kaynaklar", "Sources")} ({webCitations.length})
            </span>
            <span aria-hidden className="text-ink-4">
              {webCitationsOpen ? "▾" : "▸"}
            </span>
          </button>
          {webCitationsOpen ? (
            <ul className="mt-1.5 flex flex-wrap gap-1.5">
              {webCitations.map((citation, idx) => (
                <li key={`${citation.result.url}-${idx}`}>
                  <WebCitationChip
                    citation={citation}
                    index={idx + 1}
                    onActivate={(c) => onWebCitationClick?.(c)}
                  />
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      {showMeta ? (
        <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-4">
          {message.tokensIn ?? 0}↓ · {message.tokensOut ?? 0}↑
          {" · "}
          {pick("önbellek", "cache")}: {cacheHit ? pick("isabet", "hit") : pick("kaçık", "miss")}
          {message.interrupted ? ` · ${pick("kesildi", "interrupted")}` : ""}
          {message.webSearchUsed ? ` · ${pick("web arama", "web search")}` : ""}
        </div>
      ) : null}
    </div>
  );
}

// Custom equality so a re-render on ONE bubble (typically the streaming one,
// which gets a fresh `message` object identity from useLiveQuery every flush)
// doesn't cascade through the entire chat history. Callback identities are
// intentionally ignored — they capture stable refs in the parent's
// useCallback closures and their effect is purely event-time, so re-binding
// them does not change what the bubble renders.
function chatBubbleEqual(prev: ChatBubbleProps, next: ChatBubbleProps): boolean {
  if (prev.isStreaming !== next.isStreaming) return false;
  if (prev.chunks !== next.chunks) return false;
  if (prev.noteSourceIds !== next.noteSourceIds) return false;
  const a = prev.message;
  const b = next.message;
  if (a === b) return true;
  return (
    a.id === b.id &&
    a.role === b.role &&
    a.content === b.content &&
    a.model === b.model &&
    a.tokensIn === b.tokensIn &&
    a.tokensOut === b.tokensOut &&
    a.cacheReadTokens === b.cacheReadTokens &&
    a.interrupted === b.interrupted &&
    a.webSearchUsed === b.webSearchUsed &&
    a.webCitations === b.webCitations &&
    a.toolName === b.toolName &&
    a.toolStatus === b.toolStatus &&
    a.toolArgs === b.toolArgs &&
    a.createdAt === b.createdAt
  );
}

export const ChatBubble = memo(ChatBubbleImpl, chatBubbleEqual);

function isUserPrecomputed(role: ChatMessageRecord["role"]): boolean {
  return role === "user";
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

function formatTime(
  ts: number,
  pick: (tr: string, en: string) => string,
): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return pick("şimdi", "now");
  const date = new Date(ts);
  const hh = date.getHours().toString().padStart(2, "0");
  const mm = date.getMinutes().toString().padStart(2, "0");
  return `${hh}:${mm}`;
}
