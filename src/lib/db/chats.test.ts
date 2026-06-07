import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addMessage,
  createThread,
  deleteThread,
  forkThread,
  listMessages,
  listThreadsByWorkspace,
  renameThread,
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

describe("chats repo — thread management", () => {
  it("renameThread updates the title and bumps updatedAt", async () => {
    const ws = await createWorkspace({ name: "WS", color: "#000", initials: "W" });
    const thread = await createThread({
      workspaceId: ws.id,
      title: "Original",
    });
    const before = thread.updatedAt;
    await new Promise((r) => setTimeout(r, 5));
    await renameThread(thread.id, "Renamed title");
    const got = await db.chatThreads.get(thread.id);
    expect(got?.title).toBe("Renamed title");
    expect(got?.renamedAt).toBeGreaterThan(0);
    expect(got?.updatedAt).toBeGreaterThan(before);
  });

  it("renameThread rejects empty/whitespace titles", async () => {
    const ws = await createWorkspace({ name: "WS", color: "#000", initials: "W" });
    const thread = await createThread({
      workspaceId: ws.id,
      title: "Original",
    });
    await expect(renameThread(thread.id, "   ")).rejects.toThrow();
    const got = await db.chatThreads.get(thread.id);
    expect(got?.title).toBe("Original");
  });

  it("deleteThread cascades messages so message count drops to 0", async () => {
    const ws = await createWorkspace({ name: "WS", color: "#000", initials: "W" });
    const thread = await createThread({ workspaceId: ws.id, title: "T" });
    await addMessage({
      threadId: thread.id,
      workspaceId: ws.id,
      role: "user",
      content: "hello",
    });
    await addMessage({
      threadId: thread.id,
      workspaceId: ws.id,
      role: "assistant",
      content: "hi back",
    });
    expect((await listMessages(thread.id)).length).toBe(2);
    await deleteThread(thread.id);
    expect(await db.chatThreads.get(thread.id)).toBeUndefined();
    expect((await listMessages(thread.id)).length).toBe(0);
  });

  it("togglePin pins and unpins; sort puts pinned first", async () => {
    const ws = await createWorkspace({ name: "WS", color: "#000", initials: "W" });
    const a = await createThread({ workspaceId: ws.id, title: "A" });
    await new Promise((r) => setTimeout(r, 2));
    const b = await createThread({ workspaceId: ws.id, title: "B" });

    await togglePin(a.id, true);
    let got = await db.chatThreads.get(a.id);
    expect(got?.pinned).toBe(true);

    const list = await listThreadsByWorkspace(ws.id);
    expect(list[0]?.id).toBe(a.id);
    expect(list[1]?.id).toBe(b.id);

    await togglePin(a.id, false);
    got = await db.chatThreads.get(a.id);
    expect(got?.pinned).toBe(false);
  });

  it("forkThread copies messages up to and including the cut message", async () => {
    const ws = await createWorkspace({ name: "WS", color: "#000", initials: "W" });
    const thread = await createThread({ workspaceId: ws.id, title: "Source" });
    // Stagger writes so [threadId+createdAt] index keeps deterministic order;
    // bare Date.now() in the same tick can collide on fast hardware.
    const m1 = await addMessage({
      threadId: thread.id,
      workspaceId: ws.id,
      role: "user",
      content: "q1",
    });
    await new Promise((r) => setTimeout(r, 2));
    await addMessage({
      threadId: thread.id,
      workspaceId: ws.id,
      role: "assistant",
      content: "a1",
    });
    await new Promise((r) => setTimeout(r, 2));
    const m3 = await addMessage({
      threadId: thread.id,
      workspaceId: ws.id,
      role: "user",
      content: "q2",
    });
    await new Promise((r) => setTimeout(r, 2));
    await addMessage({
      threadId: thread.id,
      workspaceId: ws.id,
      role: "assistant",
      content: "a2",
    });

    // Fork only up to the third message (m3 inclusive) — so 3 copied total.
    const { newThreadId } = await forkThread(thread.id, m3.id);
    expect(newThreadId).not.toBe(thread.id);

    const newMsgs = await listMessages(newThreadId);
    expect(newMsgs).toHaveLength(3);
    expect(newMsgs.map((m) => m.content)).toEqual(["q1", "a1", "q2"]);

    // Cut at very first message → only 1 copied.
    const { newThreadId: nid2 } = await forkThread(thread.id, m1.id);
    const tinyMsgs = await listMessages(nid2);
    expect(tinyMsgs).toHaveLength(1);
    expect(tinyMsgs[0]?.content).toBe("q1");

    // Source thread untouched.
    expect((await listMessages(thread.id)).length).toBe(4);
  });

  it("forkThread throws when message is not in the thread", async () => {
    const ws = await createWorkspace({ name: "WS", color: "#000", initials: "W" });
    const thread = await createThread({ workspaceId: ws.id, title: "Source" });
    await addMessage({
      threadId: thread.id,
      workspaceId: ws.id,
      role: "user",
      content: "q1",
    });
    await expect(forkThread(thread.id, "msg_does_not_exist")).rejects.toThrow();
  });
});
