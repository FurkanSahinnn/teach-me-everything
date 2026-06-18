import {
  test,
  expect,
  type Page,
  type Route,
  type Request,
} from "@playwright/test";

// E2E happy path for the WORKSPACE chat (the multi-source tutor at
// /w/[id]/chat), distinct from the single-source reader chat.
//
// Flow under test:
//   seed a workspace + one ready source + one chunk + a plaintext anthropic
//   key (post-Phase-9 schema: no vault table, useVault is always-unlocked) →
//   open /w/[id]/chat → the page renders the ContextBar (Sources chip on by
//   default) + composer → toggle the "Notes" context chip ON → send a
//   message → `/api/ai/chat` returns an Anthropic-shaped SSE whose reply text
//   carries a multi-source citation `[§<source-title> · <section>]` →
//   `useWorkspaceChat` streams it into a ChatBubble → the citation resolves
//   (findChunkForRef splits on ` · `) so the chip is active → clicking it
//   routes to /w/[id]/read/[sourceId].
//
// Asserted end-state (the wiring that has no unit coverage):
//   - the request the runner sent included the source's text in the cached
//     <sources> block (proves cross-source RAG assembled the prompt);
//   - a workspace-scoped thread was persisted with the toggled contextScopes
//     (proves the chip → setThreadContextScopes plumbing);
//   - user + assistant messages landed in IndexedDB;
//   - the citation chip navigates to the right reader.
//
// This test seeds against the CURRENT schema inline rather than reusing
// tests/e2e/helpers/seed-state.ts, which predates Phase 9 (it writes the
// dropped `vault` store + encrypted apiKeys). What is mocked: only the AI
// HTTP boundary (`/api/ai/chat` + `/api/ai/embed`). Everything else —
// the runner, prompt builder, ChatBubble, CitationChip — runs for real.

const WS_ID = "ws_e2e_wschat";
const SOURCE_ID = "src_e2e_wschat";
const SOURCE_TITLE = "Quantum Mechanics — E2E Source";
const SECTION = "Section 1";

const REPLY_PROSE =
  "Superposition lets a quantum system occupy several states at once until it is measured ";
const CITATION = `[§${SOURCE_TITLE} · ${SECTION}]`;
const REPLY_TEXT = `${REPLY_PROSE}${CITATION}.`;

function sseEvent(name: string, data: unknown): string {
  return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
}

function extractSystemText(system: unknown): string {
  if (Array.isArray(system)) {
    return system
      .map((b) =>
        b && typeof b === "object" && "text" in b
          ? String((b as { text?: unknown }).text ?? "")
          : "",
      )
      .join("\n");
  }
  return typeof system === "string" ? system : "";
}

async function installChatMock(page: Page): Promise<{
  hits: () => number;
  systemSeen: () => string;
}> {
  let hits = 0;
  let systemSeen = "";

  // The embed proxy is mocked defensively — the seeded chunk has no embedding,
  // so the runner takes the first-N fallback and never calls it; this keeps the
  // test robust if that ever changes.
  await page.route("**/api/ai/embed", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: [{ embedding: [0.1, 0.2, 0.3] }] }),
    });
  });

  await page.route("**/api/ai/chat", async (route: Route, req: Request) => {
    hits += 1;
    try {
      const body = req.postDataJSON() as { system?: unknown };
      systemSeen = extractSystemText(body.system);
    } catch {
      systemSeen = "";
    }

    const events: string[] = [];
    events.push(
      sseEvent("message_start", {
        type: "message_start",
        message: {
          id: "msg_e2e_wschat",
          type: "message",
          role: "assistant",
          model: "claude-sonnet-4-6",
          content: [],
          usage: { input_tokens: 0, output_tokens: 0 },
        },
      }),
    );
    events.push(
      sseEvent("content_block_start", {
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "" },
      }),
    );
    events.push(
      sseEvent("content_block_delta", {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: REPLY_TEXT },
      }),
    );
    events.push(
      sseEvent("content_block_stop", { type: "content_block_stop", index: 0 }),
    );
    events.push(
      sseEvent("message_delta", {
        type: "message_delta",
        delta: { stop_reason: "end_turn" },
        usage: { input_tokens: 64, output_tokens: 24 },
      }),
    );
    events.push(sseEvent("message_stop", { type: "message_stop" }));

    await route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream; charset=utf-8" },
      body: events.join(""),
    });
  });

  return { hits: () => hits, systemSeen: () => systemSeen };
}

// Seeds the CURRENT (post-Phase-9) schema: a workspace, a plaintext anthropic
// key (default chat binding is `anthropic::claude-sonnet-4-6`), one ready
// source, and one chunk (no embedding → first-N retrieval fallback, no embed
// call). useVault is an always-unlocked stub now, so no key-restore dance.
async function seedWorkspaceChat(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem("tme:setup-complete", "1");
  });

  // /dashboard imports Dexie hooks → forces the singleton DB to open so the
  // object stores exist before we write to them.
  await page.goto("/dashboard");
  await page.waitForLoadState("networkidle");

  await page.evaluate(
    async (args: {
      wsId: string;
      sourceId: string;
      sourceTitle: string;
      section: string;
    }) => {
      let candidates = await indexedDB.databases();
      let attempts = 0;
      while (candidates.length === 0 && attempts < 50) {
        await new Promise((r) => setTimeout(r, 100));
        candidates = await indexedDB.databases();
        attempts += 1;
      }
      const tmeDb = candidates.find(
        (d) => typeof d.name === "string" && d.name.length > 0,
      );
      if (!tmeDb || typeof tmeDb.name !== "string") {
        throw new Error("seedWorkspaceChat: no IndexedDB database found");
      }

      const dbReq = indexedDB.open(tmeDb.name);
      const db: IDBDatabase = await new Promise((resolve, reject) => {
        dbReq.onsuccess = () => resolve(dbReq.result);
        dbReq.onerror = () => reject(dbReq.error);
      });

      const now = Date.now();
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(
            ["apiKeys", "workspaces", "sources", "chunks"],
            "readwrite",
          );
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);

          // Post-Phase-9 ApiKeyRecord: { provider, plaintext, updatedAt }.
          tx.objectStore("apiKeys").put({
            provider: "anthropic",
            plaintext: "sk-ant-e2e-mock-never-hits-network",
            updatedAt: now,
          });
          tx.objectStore("workspaces").put({
            id: args.wsId,
            name: "E2E Workspace Chat",
            color: "#8b5cf6",
            initials: "WC",
            createdAt: now,
            updatedAt: now,
            archivedAt: null,
          });
          tx.objectStore("sources").put({
            id: args.sourceId,
            workspaceId: args.wsId,
            type: "pdf",
            title: args.sourceTitle,
            ingestStatus: "ready",
            createdAt: now,
            updatedAt: now,
          });
          tx.objectStore("chunks").put({
            id: "ck_e2e_wschat_1",
            sourceId: args.sourceId,
            workspaceId: args.wsId,
            index: 0,
            text: "Superposition allows a quantum system to exist in multiple states simultaneously until a measurement collapses the wavefunction.",
            tokenCount: 28,
            section: args.section,
            headings: [args.section],
            createdAt: now,
          });
        });
      } finally {
        db.close();
      }
    },
    {
      wsId: WS_ID,
      sourceId: SOURCE_ID,
      sourceTitle: SOURCE_TITLE,
      section: SECTION,
    },
  );
}

test.describe("Workspace chat — multi-source tutor happy path", () => {
  test("toggle a context chip → send → cited reply → citation navigates to reader", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    const chat = await installChatMock(page);
    await seedWorkspaceChat(page);

    await page.goto(`/w/${WS_ID}/chat`);
    await page.waitForLoadState("networkidle");

    // Page shell: the composer + the Sources context chip (on by default).
    const composer = page.locator("textarea").first();
    await expect(composer).toBeVisible({ timeout: 20_000 });
    const sourcesChip = page.locator('[data-scope="sources"]');
    await expect(sourcesChip).toBeVisible({ timeout: 10_000 });
    await expect(sourcesChip).toHaveAttribute("aria-checked", "true");

    // Signature feature: toggle the Notes context chip ON.
    const notesChip = page.locator('[data-scope="notes"]');
    await expect(notesChip).toHaveAttribute("aria-checked", "false");
    await notesChip.click();
    await expect(notesChip).toHaveAttribute("aria-checked", "true");

    // Send a question.
    await composer.fill("Explain superposition from my sources.");
    const sendBtn = page
      .getByRole("button", { name: /^(gönder|send)$/i })
      .first();
    await expect(sendBtn).toBeEnabled({ timeout: 10_000 });
    await sendBtn.click();

    // The runner must have fired the chat request.
    await expect
      .poll(() => chat.hits(), { timeout: 20_000 })
      .toBeGreaterThanOrEqual(1);

    // Assistant prose streamed into a bubble.
    await expect(
      page.getByText(/Superposition lets a quantum system/i).first(),
    ).toBeVisible({ timeout: 30_000 });

    // The multi-source citation resolved → the chip is rendered and active
    // (clickable). This exercises the `[§title · section]` split in
    // findChunkForRef that this feature added.
    const citationChip = page.locator("[data-citation-ref]").first();
    await expect(citationChip).toBeVisible({ timeout: 15_000 });
    await expect(citationChip).toBeEnabled();

    // The request the runner sent carried the source text in the <sources>
    // block — proves cross-source RAG assembled the system prompt.
    expect(chat.systemSeen()).toContain(SOURCE_TITLE);

    // Persistence: a workspace-scoped thread with the toggled contextScopes,
    // plus the user + assistant messages, landed in IndexedDB.
    const persisted = await page.evaluate(
      async (args: { workspaceId: string }) => {
        const candidates = await indexedDB.databases();
        const tmeDb = candidates.find(
          (d) => typeof d.name === "string" && d.name.length > 0,
        );
        if (!tmeDb || typeof tmeDb.name !== "string") {
          throw new Error("workspace-chat.e2e: no IndexedDB database");
        }
        const dbReq = indexedDB.open(tmeDb.name);
        const db: IDBDatabase = await new Promise((resolve, reject) => {
          dbReq.onsuccess = () => resolve(dbReq.result);
          dbReq.onerror = () => reject(dbReq.error);
        });
        try {
          const getAll = <T,>(store: string): Promise<T[]> =>
            new Promise((resolve, reject) => {
              const req = db
                .transaction([store], "readonly")
                .objectStore(store)
                .getAll();
              req.onsuccess = () => resolve(req.result as T[]);
              req.onerror = () => reject(req.error);
            });
          const threads = (
            await getAll<{
              id: string;
              workspaceId: string;
              scope?: string;
              contextScopes?: string[];
            }>("chatThreads")
          ).filter((t) => t.workspaceId === args.workspaceId);
          const messages = (
            await getAll<{ threadId: string; role: string }>("chatMessages")
          ).filter((m) => threads.some((t) => t.id === m.threadId));
          return { threads, messageRoles: messages.map((m) => m.role) };
        } finally {
          db.close();
        }
      },
      { workspaceId: WS_ID },
    );

    const wsThread = persisted.threads.find((t) => t.scope === "workspace");
    expect(wsThread).toBeTruthy();
    expect(wsThread!.contextScopes ?? []).toContain("notes");
    expect(persisted.messageRoles).toContain("user");
    expect(persisted.messageRoles).toContain("assistant");

    // Clicking the citation routes to the matching reader (no adjacent reader
    // to scroll, so the workspace chat navigates).
    await citationChip.click();
    await expect(page).toHaveURL(
      new RegExp(`/w/${WS_ID}/read/${SOURCE_ID}`),
    );
  });
});
