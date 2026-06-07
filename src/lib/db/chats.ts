import { newId } from "@/lib/utils/id";
import { db } from "./schema";
import type {
  ChatMessageRecord,
  ChatRole,
  ChatThreadRecord,
} from "./types";

export type ThreadInput = {
  id?: string;
  workspaceId: string;
  sourceId?: string;
  title: string;
  titleEn?: string;
  pinned?: boolean;
};

export type ThreadPatch = Partial<
  Pick<ChatThreadRecord, "title" | "titleEn" | "pinned">
>;

export type MessageInput = {
  id?: string;
  threadId: string;
  workspaceId: string;
  role: ChatRole;
  content: string;
  contentEn?: string;
  citations?: ChatMessageRecord["citations"];
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolUseId?: string;
  toolStatus?: "pending" | "ok" | "error";
  tokensIn?: number;
  tokensOut?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  model?: string;
  stopReason?: string;
  interrupted?: boolean;
};

export type MessageUsagePatch = {
  tokensIn?: number | undefined;
  tokensOut?: number | undefined;
  cacheReadTokens?: number | undefined;
  cacheCreationTokens?: number | undefined;
  model?: string | undefined;
  stopReason?: string | undefined;
  interrupted?: boolean | undefined;
};

export async function createThread(
  input: ThreadInput,
): Promise<ChatThreadRecord> {
  const now = Date.now();
  const record: ChatThreadRecord = {
    id: input.id ?? newId("thr"),
    workspaceId: input.workspaceId,
    sourceId: input.sourceId,
    title: input.title,
    titleEn: input.titleEn,
    pinned: input.pinned ?? false,
    createdAt: now,
    updatedAt: now,
  };
  await db.chatThreads.add(record);
  return record;
}

export async function getThread(
  id: string,
): Promise<ChatThreadRecord | undefined> {
  return db.chatThreads.get(id);
}

export async function updateThread(
  id: string,
  patch: ThreadPatch,
): Promise<void> {
  await db.chatThreads.update(id, { ...patch, updatedAt: Date.now() });
}

export async function deleteThread(id: string): Promise<void> {
  await db.transaction("rw", [db.chatThreads, db.chatMessages], async () => {
    await db.chatMessages.where("threadId").equals(id).delete();
    await db.chatThreads.delete(id);
  });
}

export async function renameThread(
  threadId: string,
  title: string,
): Promise<void> {
  const trimmed = title.trim();
  if (!trimmed) throw new Error("Thread title cannot be empty");
  const now = Date.now();
  await db.chatThreads.update(threadId, {
    title: trimmed,
    renamedAt: now,
    updatedAt: now,
  });
}

export async function togglePin(
  threadId: string,
  pinned: boolean,
): Promise<void> {
  await db.chatThreads.update(threadId, {
    pinned,
    updatedAt: Date.now(),
  });
}

export async function forkThread(
  sourceThreadId: string,
  untilMessageId: string,
): Promise<{ newThreadId: string }> {
  return db.transaction("rw", [db.chatThreads, db.chatMessages], async () => {
    const source = await db.chatThreads.get(sourceThreadId);
    if (!source) throw new Error(`Thread not found: ${sourceThreadId}`);
    const allMessages = await db.chatMessages
      .where("[threadId+createdAt]")
      .between(
        [sourceThreadId, 0],
        [sourceThreadId, Number.MAX_SAFE_INTEGER],
        true,
        true,
      )
      .toArray();
    const cutIdx = allMessages.findIndex((m) => m.id === untilMessageId);
    if (cutIdx < 0) {
      throw new Error(`Message not found in thread: ${untilMessageId}`);
    }
    const subset = allMessages.slice(0, cutIdx + 1);

    const now = Date.now();
    const newId_ = newId("thr");
    const forkedTitle = `${source.title} ↗`;
    const newThread: ChatThreadRecord = {
      id: newId_,
      workspaceId: source.workspaceId,
      sourceId: source.sourceId,
      title: forkedTitle,
      titleEn: source.titleEn ? `${source.titleEn} ↗` : undefined,
      pinned: false,
      createdAt: now,
      updatedAt: now,
    };
    await db.chatThreads.add(newThread);

    let offset = 0;
    for (const m of subset) {
      const copy: ChatMessageRecord = {
        ...m,
        id: newId("msg"),
        threadId: newId_,
        createdAt: now + offset,
      };
      await db.chatMessages.add(copy);
      offset += 1;
    }

    return { newThreadId: newId_ };
  });
}

export async function listThreadsByWorkspace(
  workspaceId: string,
): Promise<ChatThreadRecord[]> {
  const items = await db.chatThreads
    .where("workspaceId")
    .equals(workspaceId)
    .toArray();
  return items.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.updatedAt - a.updatedAt;
  });
}

export async function listThreadsBySource(
  sourceId: string,
): Promise<ChatThreadRecord[]> {
  const items = await db.chatThreads
    .where("sourceId")
    .equals(sourceId)
    .toArray();
  return items.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function findOrCreateSourceThread(
  workspaceId: string,
  sourceId: string,
  title: string,
): Promise<ChatThreadRecord> {
  const existing = await db.chatThreads
    .where("sourceId")
    .equals(sourceId)
    .first();
  if (existing) return existing;
  return createThread({ workspaceId, sourceId, title });
}

export async function addMessage(
  input: MessageInput,
): Promise<ChatMessageRecord> {
  const now = Date.now();
  const record: ChatMessageRecord = {
    id: input.id ?? newId("msg"),
    threadId: input.threadId,
    workspaceId: input.workspaceId,
    role: input.role,
    content: input.content,
    contentEn: input.contentEn,
    citations: input.citations,
    toolName: input.toolName,
    toolArgs: input.toolArgs,
    toolUseId: input.toolUseId,
    toolStatus: input.toolStatus,
    tokensIn: input.tokensIn,
    tokensOut: input.tokensOut,
    cacheReadTokens: input.cacheReadTokens,
    cacheCreationTokens: input.cacheCreationTokens,
    model: input.model,
    stopReason: input.stopReason,
    interrupted: input.interrupted,
    createdAt: now,
  };
  await db.transaction("rw", [db.chatMessages, db.chatThreads], async () => {
    await db.chatMessages.add(record);
    await db.chatThreads.update(input.threadId, { updatedAt: now });
  });
  return record;
}

export async function appendAssistantContent(
  messageId: string,
  delta: string,
): Promise<void> {
  const message = await db.chatMessages.get(messageId);
  if (!message) return;
  await db.chatMessages.update(messageId, {
    content: (message.content ?? "") + delta,
  });
}

export async function setMessageContent(
  messageId: string,
  content: string,
): Promise<void> {
  await db.chatMessages.update(messageId, { content });
}

export async function patchMessageUsage(
  messageId: string,
  patch: MessageUsagePatch,
): Promise<void> {
  await db.chatMessages.update(messageId, patch);
}

// Phase 5.5.C.B — persist web-search citations + flag on the assistant
// message. Called once at stream end so reload restores the citation chips.
// `webSearchUsed: false` is allowed so the chat handler can clear the flag
// when the user retried a turn without the web-search toggle.
export async function setMessageWebCitations(
  messageId: string,
  patch: { webSearchUsed: boolean; webCitations?: import("@/lib/ai/web-search/types").WebCitation[] },
): Promise<void> {
  await db.chatMessages.update(messageId, {
    webSearchUsed: patch.webSearchUsed,
    ...(patch.webCitations !== undefined ? { webCitations: patch.webCitations } : {}),
  });
}

export async function listMessages(
  threadId: string,
): Promise<ChatMessageRecord[]> {
  return db.chatMessages
    .where("[threadId+createdAt]")
    .between([threadId, 0], [threadId, Number.MAX_SAFE_INTEGER], true, true)
    .toArray();
}

export async function deleteMessage(id: string): Promise<void> {
  await db.chatMessages.delete(id);
}

const TOOL_RESULT_BODY_CAP = 4096;

export type ToolResultInput = {
  threadId: string;
  workspaceId: string;
  toolUseId: string;
  toolName: string;
  content: string;
  status: "ok" | "error";
};

export async function addToolResult(
  input: ToolResultInput,
): Promise<ChatMessageRecord> {
  const trimmed =
    input.content.length > TOOL_RESULT_BODY_CAP
      ? `${input.content.slice(0, TOOL_RESULT_BODY_CAP)}…`
      : input.content;
  return addMessage({
    threadId: input.threadId,
    workspaceId: input.workspaceId,
    role: "tool",
    content: trimmed,
    toolName: input.toolName,
    toolUseId: input.toolUseId,
    toolStatus: input.status,
  });
}

export async function setToolStatus(
  messageId: string,
  status: "pending" | "ok" | "error",
): Promise<void> {
  await db.chatMessages.update(messageId, { toolStatus: status });
}
