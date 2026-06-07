"use client";

import {
  Edit2,
  MoreHorizontal,
  Pin,
  PinOff,
  Plus,
  Trash2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { Button } from "@/components/ui/Button";
import { ConfirmDeleteModal } from "@/components/ui/ConfirmDeleteModal";
import { useToast } from "@/components/ui/Toast";
import { useLocalePick } from "@/i18n/IntlProvider";
import {
  deleteThread,
  findOrCreateSourceThread,
  renameThread,
  togglePin,
} from "@/lib/db/chats";
import { useThreadsBySource } from "@/lib/db/hooks";
import type { ChatThreadRecord } from "@/lib/db/types";
import { cn } from "@/lib/utils/cn";

type ChatThreadSidebarProps = {
  workspaceId: string;
  sourceId: string;
  sourceTitle: string;
  activeThreadId: string | null;
  onSelect: (id: string) => void;
  variant?: "sidebar" | "popover";
};

export function ChatThreadSidebar({
  workspaceId,
  sourceId,
  sourceTitle,
  activeThreadId,
  onSelect,
  variant = "sidebar",
}: ChatThreadSidebarProps) {
  const t = useTranslations("chat_thread");
  const pick = useLocalePick();
  const { toast } = useToast();
  const threads = useThreadsBySource(sourceId) ?? [];
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const sorted = [...threads].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.updatedAt - a.updatedAt;
  });

  const handleNewThread = useCallback(async () => {
    try {
      const baseTitle = t("default_title");
      // We deliberately bypass `findOrCreateSourceThread` here to allow
      // multiple threads per source — but reuse it semantically by always
      // creating a fresh thread with a counter suffix when one exists.
      const count = threads.length;
      const newTitle =
        count > 0 ? `${baseTitle} ${count + 1}` : sourceTitle || baseTitle;
      // We use findOrCreateSourceThread only for the very first thread;
      // for subsequent threads we manually create via repo.
      let thread: ChatThreadRecord;
      if (count === 0) {
        thread = await findOrCreateSourceThread(
          workspaceId,
          sourceId,
          newTitle,
        );
      } else {
        const { createThread } = await import("@/lib/db/chats");
        thread = await createThread({
          workspaceId,
          sourceId,
          title: newTitle,
        });
      }
      onSelect(thread.id);
    } catch (err) {
      toast({
        variant: "error",
        title: pick("Sohbet açılamadı", "Could not create chat"),
        description: err instanceof Error ? err.message : String(err),
      });
    }
  }, [
    onSelect,
    pick,
    sourceId,
    sourceTitle,
    t,
    threads.length,
    toast,
    workspaceId,
  ]);

  const pendingDeleteThread = pendingDeleteId
    ? sorted.find((th) => th.id === pendingDeleteId) ?? null
    : null;

  return (
    <>
      <aside
        className={cn(
          "flex min-h-0 flex-col bg-paper-2",
          variant === "sidebar"
            ? "border-r border-rule"
            : "max-h-[min(520px,calc(100vh-160px))] min-h-[260px] rounded-[12px] border border-rule shadow-[var(--shadow-medium)]",
        )}
      >
        <div className="flex items-center justify-between gap-2 border-b border-rule px-3 py-2.5">
          <div className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-3">
            {pick("Sohbetler", "Chats")}
          </div>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={t("new_thread")}
            title={t("new_thread")}
            onClick={() => void handleNewThread()}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
          </Button>
        </div>
        <nav className="flex-1 overflow-y-auto px-1.5 py-1.5">
          {sorted.length === 0 ? (
            <p className="px-2 py-3 text-[12px] text-ink-4">
              {pick(
                "Sohbet yok. + ile yeni başlat.",
                "No chats yet. Hit + to start one.",
              )}
            </p>
          ) : (
            sorted.map((th) => (
              <ThreadItem
                key={th.id}
                thread={th}
                active={th.id === activeThreadId}
                onSelect={() => onSelect(th.id)}
                onRequestDelete={() => setPendingDeleteId(th.id)}
                pick={pick}
                t={t}
              />
            ))
          )}
        </nav>
      </aside>
      <ConfirmDeleteModal
        open={Boolean(pendingDeleteThread)}
        onClose={() => setPendingDeleteId(null)}
        onConfirm={async () => {
          if (!pendingDeleteThread) return;
          try {
            const wasActive = pendingDeleteThread.id === activeThreadId;
            await deleteThread(pendingDeleteThread.id);
            setPendingDeleteId(null);
            if (wasActive) {
              const next = sorted.find((th) => th.id !== pendingDeleteThread.id);
              if (next) onSelect(next.id);
            }
          } catch (err) {
            toast({
              variant: "error",
              title: pick("Silinemedi", "Delete failed"),
              description: err instanceof Error ? err.message : String(err),
            });
          }
        }}
        title={t("delete_confirm_title")}
        description={t("delete_confirm_desc")}
        confirmText={pick("sil", "delete")}
        confirmInputLabel={pick(
          "Onaylamak için 'sil' yaz.",
          "Type 'delete' to confirm.",
        )}
        confirmButtonLabel={t("delete")}
        cancelButtonLabel={pick("Vazgeç", "Cancel")}
      />
    </>
  );
}

function ThreadItem({
  thread,
  active,
  onSelect,
  onRequestDelete,
  pick,
  t,
}: {
  thread: ChatThreadRecord;
  active: boolean;
  onSelect: () => void;
  onRequestDelete: () => void;
  pick: (tr: string, en: string) => string;
  t: ReturnType<typeof useTranslations<"chat_thread">>;
}) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(thread.title);
  const [menuOpen, setMenuOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!editing) {
      const title = thread.title;
      queueMicrotask(() => setDraft(title));
    }
  }, [thread.title, editing]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  useEffect(() => {
    if (!menuOpen) return;
    function onClick(e: MouseEvent): void {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [menuOpen]);

  async function commitRename(): Promise<void> {
    const next = draft.trim();
    if (!next || next === thread.title) {
      setEditing(false);
      setDraft(thread.title);
      return;
    }
    try {
      await renameThread(thread.id, next);
      setEditing(false);
    } catch (err) {
      toast({
        variant: "error",
        title: pick("Yeniden adlandırılamadı", "Rename failed"),
        description: err instanceof Error ? err.message : String(err),
      });
      setEditing(false);
      setDraft(thread.title);
    }
  }

  function onInputKey(e: KeyboardEvent<HTMLInputElement>): void {
    if (e.key === "Enter") {
      e.preventDefault();
      void commitRename();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setEditing(false);
      setDraft(thread.title);
    }
  }

  async function handlePinToggle(): Promise<void> {
    try {
      await togglePin(thread.id, !thread.pinned);
      setMenuOpen(false);
    } catch (err) {
      toast({
        variant: "error",
        title: pick("İşlem başarısız", "Action failed"),
        description: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return (
    <div
      className={cn(
        "group relative mb-0.5 flex items-center gap-1.5 rounded-[8px] px-2 py-1.5 text-[12.5px] transition-colors",
        active ? "bg-paper-3 text-ink" : "text-ink-2 hover:bg-paper-3/60",
      )}
    >
      {thread.pinned ? (
        <Pin
          className="h-3 w-3 shrink-0 text-accent"
          aria-label={pick("Sabitlenmiş", "Pinned")}
        />
      ) : null}
      {editing ? (
        <input
          ref={inputRef}
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onInputKey}
          onBlur={() => void commitRename()}
          className={cn(
            "min-w-0 flex-1 rounded border border-rule bg-paper px-1.5 py-0.5 text-[12.5px] outline-none",
            "focus-visible:border-accent",
          )}
        />
      ) : (
        <button
          type="button"
          onClick={onSelect}
          onDoubleClick={() => setEditing(true)}
          className="min-w-0 flex-1 truncate text-left"
        >
          <div className="truncate font-medium">{thread.title}</div>
          <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-4">
            {formatRelative(thread.updatedAt, pick)}
          </div>
        </button>
      )}
      <div className="relative" ref={menuRef}>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen((v) => !v);
          }}
          aria-label={pick("Sohbet menüsü", "Thread menu")}
          aria-expanded={menuOpen}
          className={cn(
            "grid h-6 w-6 place-items-center rounded text-ink-3 transition-opacity",
            "hover:bg-paper hover:text-ink",
            active || menuOpen
              ? "opacity-100"
              : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
          )}
        >
          <MoreHorizontal className="h-3.5 w-3.5" aria-hidden />
        </button>
        {menuOpen ? (
          <div
            role="menu"
            className="absolute right-0 top-full z-20 mt-1 w-[160px] overflow-hidden rounded-[8px] border border-rule bg-paper py-1 text-[12.5px] shadow-[var(--shadow-medium)]"
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => void handlePinToggle()}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-ink-2 hover:bg-paper-2 hover:text-ink"
            >
              {thread.pinned ? (
                <PinOff className="h-3.5 w-3.5" aria-hidden />
              ) : (
                <Pin className="h-3.5 w-3.5" aria-hidden />
              )}
              {thread.pinned ? t("unpin") : t("pin")}
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                setEditing(true);
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-ink-2 hover:bg-paper-2 hover:text-ink"
            >
              <Edit2 className="h-3.5 w-3.5" aria-hidden />
              {t("rename")}
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                onRequestDelete();
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-err hover:bg-err/10"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
              {t("delete")}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function formatRelative(
  ts: number,
  pick: (tr: string, en: string) => string,
): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return pick("şimdi", "now");
  if (diff < 3_600_000) {
    const mins = Math.floor(diff / 60_000);
    return pick(`${mins}dk`, `${mins}m`);
  }
  if (diff < 86_400_000) {
    const hours = Math.floor(diff / 3_600_000);
    return pick(`${hours}sa`, `${hours}h`);
  }
  const days = Math.floor(diff / 86_400_000);
  return pick(`${days}g`, `${days}d`);
}
