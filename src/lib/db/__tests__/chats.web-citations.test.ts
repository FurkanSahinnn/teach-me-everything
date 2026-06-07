// Phase 5.5.C.B — `setMessageWebCitations` repo helper. Used by the chat
// handler to persist `webSearchUsed` + `webCitations[]` on the assistant
// message at stream end (and incrementally during streaming so the bubble
// "Sources (N)" footer ticks up live).
//
// We keep these tests in a separate file rather than co-locating them in
// `chats.test.ts` so the WebCitation/WebSearch type imports don't need to
// load when the legacy thread-management tests run.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { addMessage, createThread, setMessageWebCitations } from "../chats";
import { createWorkspace } from "../workspaces";
import { db } from "../schema";
import type { WebCitation } from "@/lib/ai/web-search/types";

beforeEach(async () => {
  await db.delete();
  await db.open();
});

afterEach(async () => {
  await db.delete();
});

function makeCitation(
  url: string,
  title = "Title",
  index = 0,
): WebCitation {
  return {
    result: {
      url,
      title,
      snippet: "",
      provider: "anthropic",
    },
    messageBlockIndex: index,
  };
}

describe("setMessageWebCitations", () => {
  it("persists webSearchUsed=true with a non-empty citations array", async () => {
    const ws = await createWorkspace({ name: "WS", color: "#000", initials: "W" });
    const thread = await createThread({ workspaceId: ws.id, title: "T" });
    const msg = await addMessage({
      threadId: thread.id,
      workspaceId: ws.id,
      role: "assistant",
      content: "hello",
    });

    const citations = [
      makeCitation("https://a.example/x"),
      makeCitation("https://b.example/y", "Other", 1),
    ];
    await setMessageWebCitations(msg.id, {
      webSearchUsed: true,
      webCitations: citations,
    });

    const got = await db.chatMessages.get(msg.id);
    expect(got?.webSearchUsed).toBe(true);
    expect(got?.webCitations).toEqual(citations);
  });

  it("can flip webSearchUsed back to false without dropping citations", async () => {
    // The chat handler re-flushes on stream end; if the user retries with
    // the toggle off after a successful web-search turn, we still want to
    // keep the historical citations intact and just clear the flag — UI
    // gates on `webSearchUsed` so the bubble hides the sources footer.
    const ws = await createWorkspace({ name: "WS", color: "#000", initials: "W" });
    const thread = await createThread({ workspaceId: ws.id, title: "T" });
    const msg = await addMessage({
      threadId: thread.id,
      workspaceId: ws.id,
      role: "assistant",
      content: "x",
    });

    await setMessageWebCitations(msg.id, {
      webSearchUsed: true,
      webCitations: [makeCitation("https://x.example/q")],
    });
    await setMessageWebCitations(msg.id, { webSearchUsed: false });

    const got = await db.chatMessages.get(msg.id);
    expect(got?.webSearchUsed).toBe(false);
    expect(got?.webCitations?.length).toBe(1);
  });

  it("omitting webCitations leaves the previously persisted list untouched", async () => {
    // Defensive: incremental flushes during streaming pass `webCitations`
    // explicitly. The flag-only update path (rare) must not clobber the
    // accumulated list with `undefined`.
    const ws = await createWorkspace({ name: "WS", color: "#000", initials: "W" });
    const thread = await createThread({ workspaceId: ws.id, title: "T" });
    const msg = await addMessage({
      threadId: thread.id,
      workspaceId: ws.id,
      role: "assistant",
      content: "x",
    });

    const seeded = [makeCitation("https://only.example/p")];
    await setMessageWebCitations(msg.id, {
      webSearchUsed: true,
      webCitations: seeded,
    });
    await setMessageWebCitations(msg.id, { webSearchUsed: true });

    const got = await db.chatMessages.get(msg.id);
    expect(got?.webCitations).toEqual(seeded);
  });
});
