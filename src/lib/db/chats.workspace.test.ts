import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addMessage,
  createThread,
  createWorkspaceThread,
  findOrCreateSourceThread,
  findOrCreateWorkspaceThread,
  forkThread,
  listWorkspaceChatThreads,
  setThreadContextScopes,
  togglePin,
} from "./chats";
import { createWorkspace } from "./workspaces";
import { db } from "./schema";

beforeEach(async () => {
  await db.delete();
  await db.open();
});

afterEach(async () => {
  await db.delete();
});

describe("workspace chat thread helpers", () => {
  it("createWorkspaceThread sets scope:'workspace' and leaves sourceId unset", async () => {
    const ws = await createWorkspace({ name: "WS", color: "#000", initials: "W" });
    const thread = await createWorkspaceThread(ws.id, "My subject chat");

    expect(thread.scope).toBe("workspace");
    expect(thread.sourceId).toBeUndefined();
    expect(thread.title).toBe("My subject chat");

    const persisted = await db.chatThreads.get(thread.id);
    expect(persisted?.scope).toBe("workspace");
  });

  it("createThread with a sourceId sets scope:'source' (reader thread)", async () => {
    const ws = await createWorkspace({ name: "WS", color: "#000", initials: "W" });
    const thread = await createThread({
      workspaceId: ws.id,
      sourceId: "src-1",
      title: "Reader thread",
    });
    expect(thread.scope).toBe("source");
    expect(thread.sourceId).toBe("src-1");
  });

  it("listWorkspaceChatThreads excludes reader (source) threads", async () => {
    const ws = await createWorkspace({ name: "WS", color: "#000", initials: "W" });
    await createWorkspaceThread(ws.id, "Workspace A");
    await createWorkspaceThread(ws.id, "Workspace B");
    // A reader thread (has a sourceId) must never appear in the workspace list.
    await findOrCreateSourceThread(ws.id, "src-1", "Reader chat");

    const list = await listWorkspaceChatThreads(ws.id);
    expect(list).toHaveLength(2);
    expect(list.every((t) => t.scope === "workspace")).toBe(true);
    expect(list.map((t) => t.title).sort()).toEqual(["Workspace A", "Workspace B"]);
  });

  it("listWorkspaceChatThreads is pinned-first, then newest updatedAt", async () => {
    const ws = await createWorkspace({ name: "WS", color: "#000", initials: "W" });
    const first = await createWorkspaceThread(ws.id, "First");
    await new Promise((r) => setTimeout(r, 5));
    const second = await createWorkspaceThread(ws.id, "Second");
    await new Promise((r) => setTimeout(r, 5));
    await createWorkspaceThread(ws.id, "Third");

    // Pin the oldest — it should float to the top despite the older updatedAt.
    await togglePin(first.id, true);

    const list = await listWorkspaceChatThreads(ws.id);
    expect(list[0]?.id).toBe(first.id);
    // Remaining (unpinned) ordered newest-first by updatedAt.
    const unpinned = list.slice(1).map((t) => t.title);
    expect(unpinned).toEqual(["Third", "Second"]);
    expect(second.scope).toBe("workspace");
  });

  it("findOrCreateWorkspaceThread reuses the newest workspace thread", async () => {
    const ws = await createWorkspace({ name: "WS", color: "#000", initials: "W" });
    const existing = await createWorkspaceThread(ws.id, "Existing");

    const got = await findOrCreateWorkspaceThread(ws.id, "Should not be used");
    expect(got.id).toBe(existing.id);
    expect((await listWorkspaceChatThreads(ws.id)).length).toBe(1);
  });

  it("findOrCreateWorkspaceThread creates a fresh thread when none exist", async () => {
    const ws = await createWorkspace({ name: "WS", color: "#000", initials: "W" });
    // A pre-existing reader thread must NOT satisfy findOrCreate — it keys off
    // scope, so a brand-new workspace thread is created instead.
    await findOrCreateSourceThread(ws.id, "src-1", "Reader chat");

    const got = await findOrCreateWorkspaceThread(ws.id, "Brand new");
    expect(got.scope).toBe("workspace");
    expect(got.title).toBe("Brand new");
    expect((await listWorkspaceChatThreads(ws.id)).length).toBe(1);
  });

  it("setThreadContextScopes persists the active chips and bumps updatedAt", async () => {
    const ws = await createWorkspace({ name: "WS", color: "#000", initials: "W" });
    const thread = await createWorkspaceThread(ws.id, "Scoped");
    const before = thread.updatedAt;
    await new Promise((r) => setTimeout(r, 5));

    await setThreadContextScopes(thread.id, ["sources", "notes", "performance"]);

    const got = await db.chatThreads.get(thread.id);
    expect(got?.contextScopes).toEqual(["sources", "notes", "performance"]);
    expect(got?.updatedAt).toBeGreaterThan(before);
  });

  it("forkThread keeps a workspace thread in the workspace list (scope + contextScopes carried)", async () => {
    const ws = await createWorkspace({ name: "WS", color: "#000", initials: "W" });
    const thread = await createWorkspaceThread(ws.id, "Original");
    await setThreadContextScopes(thread.id, ["sources", "notes"]);
    const m1 = await addMessage({
      threadId: thread.id,
      workspaceId: ws.id,
      role: "user",
      content: "hi",
    });
    await addMessage({
      threadId: thread.id,
      workspaceId: ws.id,
      role: "assistant",
      content: "hello",
    });

    const { newThreadId } = await forkThread(thread.id, m1.id);
    const forked = await db.chatThreads.get(newThreadId);
    // Regression: without carrying `scope`, the fork was orphaned — invisible in
    // listWorkspaceChatThreads (which filters scope === "workspace").
    expect(forked?.scope).toBe("workspace");
    expect(forked?.contextScopes).toEqual(["sources", "notes"]);

    const list = await listWorkspaceChatThreads(ws.id);
    expect(list.map((t) => t.id)).toContain(newThreadId);
  });
});
