import {
  test,
  expect,
  type Page,
  type Route,
  type Request,
} from "@playwright/test";
import { seedGuidedStudyWorkspace } from "./helpers/seed-state";

// Phase 5.5.F E2E happy path for the chat-side web search flow (5.5.C.B).
//
// Flow under test:
//   reader page → toggle "🌐 Web'den ara" ON → send a message →
//   `/api/ai/chat` returns an Anthropic-shaped SSE that includes a
//   `web_search_tool_result` content block with three results →
//   `AnthropicChatProvider` parses the SSE, yields `{ kind: "raw", payload }`
//   for every frame, the reader's stream loop dispatches those payloads
//   into `CLAUDE_WEB_SEARCH_ADAPTER.parseStreamEvent`, citations land on
//   the assistant message → `WebCitationChip[data-testid="web-citation-chip"]`
//   renders at the message tail → user clicks a chip → `WebCitationPeekModal`
//   opens → user clicks "Kaynak yap" → `onMakeSource` calls
//   `ingestResearchUrl({ rawInput: citation.url, webProvider: "readability" })`
//   which hits the same-origin `/api/ai/research` proxy → a source row
//   lands in IndexedDB with `ingestStatus: "ready"`.
//
// What is mocked (test-time only — production code is untouched):
//   - `/api/ai/chat`: Anthropic-shaped SSE that emits one text block
//     followed by a `web_search_tool_result` content block with three
//     deterministic results, then a usage tick. The Claude adapter only
//     needs `content_block_start` with the right `content_block.type` and
//     `content` array shape — no per-event delta is required for citations.
//   - `/api/ai/research?url=...`: deterministic article HTML for the URL
//     the user clicks "Kaynak yap" on. Without this, Readability would try
//     to hit `example.com` directly and fail under CSP / network rules.
//
// What is NOT mocked:
//   - lib/ai/providers/anthropic.ts            — runs real (parses SSE)
//   - lib/ai/providers/web-search/claude.ts    — runs real (parses citations)
//   - lib/ai/web-search/adapter.ts             — runs real (dispatch)
//   - lib/research/providers/readability.ts    — runs real
//   - lib/research/ingest.ts                    — runs real
//   - lib/db/sources.ts + chunks.ts + chats.ts — write real rows to IDB
//   - WebCitationChip + WebCitationPeekModal   — run real

const CITATION_URLS = [
  "https://example.com/qc-roadmap-2026",
  "https://example.org/error-correction-progress",
  "https://example.net/hardware-architectures",
] as const;

const CITATION_TITLES = [
  "Quantum Computing Roadmap 2026",
  "Recent Progress in Quantum Error Correction",
  "Comparing Hardware Architectures: Superconducting vs Trapped Ion",
] as const;

// Pretty trivial — the adapter doesn't surface `text` deltas as citations,
// so we don't need a long reply for the citation flow itself. A short
// preamble keeps the bubble non-empty so it can host the chip list.
const REPLY_TEXT =
  "Here is a summary of the latest progress in quantum computing.";

function sseEvent(name: string, data: unknown): string {
  return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * Mock for `/api/ai/chat` returning an Anthropic-shaped SSE that includes
 * a `web_search_tool_result` content block. The Claude web-search adapter
 * pulls citations off `content_block_start` events whose
 * `content_block.type === "web_search_tool_result"`, then expects each
 * `content[]` item to be `{ type: "web_search_result", url, title, page_age? }`.
 */
async function installWebSearchChatMock(page: Page): Promise<{
  hits: () => number;
  toolsSeen: () => unknown;
}> {
  let hits = 0;
  let toolsSeen: unknown = null;
  await page.route("**/api/ai/chat", async (route: Route, req: Request) => {
    hits += 1;
    // Capture the request body so the test can assert that the
    // web_search tool was actually spliced into `tools[]` when the toggle
    // is ON. The reader page builds the tool block from the Claude adapter.
    try {
      const body = req.postDataJSON() as { tools?: unknown };
      toolsSeen = body.tools ?? null;
    } catch {
      toolsSeen = null;
    }

    const events: string[] = [];
    events.push(
      sseEvent("message_start", {
        type: "message_start",
        message: {
          id: "msg_e2e_web_search",
          type: "message",
          role: "assistant",
          model: "claude-sonnet-4-6",
          content: [],
          usage: { input_tokens: 0, output_tokens: 0 },
        },
      }),
    );

    // Block 0 — plain assistant text so the bubble has visible content.
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
      sseEvent("content_block_stop", {
        type: "content_block_stop",
        index: 0,
      }),
    );

    // Block 1 — the web_search_tool_result. The Claude adapter looks for
    // exactly this shape: `content_block.type === "web_search_tool_result"`
    // and `content[]` filled with `web_search_result` items.
    events.push(
      sseEvent("content_block_start", {
        type: "content_block_start",
        index: 1,
        content_block: {
          type: "web_search_tool_result",
          tool_use_id: "srvtoolu_e2e_web_search",
          content: CITATION_URLS.map((url, i) => ({
            type: "web_search_result",
            url,
            title: CITATION_TITLES[i],
            page_age: i === 0 ? "2026-05-10T00:00:00Z" : null,
            encrypted_content: `enc_${i}`,
          })),
        },
      }),
    );
    events.push(
      sseEvent("content_block_stop", {
        type: "content_block_stop",
        index: 1,
      }),
    );

    events.push(
      sseEvent("message_delta", {
        type: "message_delta",
        delta: { stop_reason: "end_turn" },
        usage: {
          input_tokens: 50,
          output_tokens: 30,
          server_tool_use: { web_search_requests: 1 },
        },
      }),
    );
    events.push(
      sseEvent("message_stop", { type: "message_stop" }),
    );

    await route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream; charset=utf-8" },
      body: events.join(""),
    });
  });

  return { hits: () => hits, toolsSeen: () => toolsSeen };
}

/**
 * Mock for `/api/ai/research?url=...`. The "Kaynak yap" button funnels into
 * `ingestResearchUrl` which (under the default `readability` provider) hits
 * this same-origin proxy with the citation URL.
 */
async function installResearchProxyMock(
  page: Page,
): Promise<{ hits: () => number }> {
  let hits = 0;
  await page.route(
    "**/api/ai/research**",
    async (route: Route, req: Request) => {
      hits += 1;
      const requestUrl = new URL(req.url());
      const target = requestUrl.searchParams.get("url") ?? "";
      // Article shell with enough <p> mass for Readability to score it as
      // an article and not the raw-text fallback branch.
      const body = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${target}</title></head>
<body><article>
<h1>${target}</h1>
<p>Quantum computing has advanced rapidly over the past five years, driven by both algorithmic breakthroughs and hardware improvements at multiple layers of the stack.</p>
<p>Error correction codes such as surface codes and bivariate bicycle codes now demonstrate clear thresholds in laboratory hardware, suggesting fault-tolerant operation is within experimental reach.</p>
<p>Hardware platforms remain diverse: superconducting transmons offer fast gates and mature control electronics, while trapped-ion systems offer longer coherence times and all-to-all connectivity.</p>
<p>Architectural choices increasingly favour hybrid approaches that delegate classical pre- and post-processing to high-performance CPUs and FPGAs co-located with the cryostat.</p>
</article></body></html>`;
      await route.fulfill({
        status: 200,
        contentType: "text/html; charset=utf-8",
        body,
      });
    },
  );
  return { hits: () => hits };
}

test.describe("Phase 5.5.F — Web search chat happy path", () => {
  test("toggle web search → cite three sources → make source from a citation", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    const chat = await installWebSearchChatMock(page);
    const proxy = await installResearchProxyMock(page);
    const seed = await seedGuidedStudyWorkspace(page);

    // Navigate straight to the reader for the seeded source. The chat
    // composer is part of the right rail (desktop) / drawer (mobile);
    // headless Chromium runs at desktop width by default in this repo.
    await page.goto(`/w/${seed.workspaceId}/read/${seed.sourceId}`);
    await page.waitForLoadState("networkidle");

    // Create a new chat thread so the composer has somewhere to write.
    // The sidebar starts empty ("Sohbet yok") — same affordance as the
    // notebook-happy-path test.
    const newThreadBtn = page
      .getByRole("button", { name: /^(yeni sohbet|new chat)$/i })
      .first();
    if (await newThreadBtn.isVisible().catch(() => false)) {
      await newThreadBtn.click();
    }

    // Wait for the send button to be enabled — useLiveQuery has resolved
    // the source + chunks and the runChat path is now reachable.
    const sendBtn = page
      .getByRole("button", { name: /^(gönder|send)$/i })
      .first();
    await expect(sendBtn).toBeEnabled({ timeout: 15_000 });

    // Flip the web-search toggle on. data-testid is stable; the
    // accessible-name flips between "Web aramayı aç" and "Web aramayı kapat"
    // depending on state. Easier to target by testid.
    const toggle = page.locator('[data-testid="web-search-toggle"]').first();
    await expect(toggle).toBeVisible({ timeout: 10_000 });
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");

    // Type a question + send. The composer textarea may be reused for the
    // thread sidebar — `.last()` reliably picks the active one because the
    // sidebar input lives above the chat panel in the DOM.
    const chatInput = page.locator("textarea").last();
    await chatInput.fill(
      "What's the latest progress on quantum error correction?",
    );
    await sendBtn.click();

    // First, the chat request itself must have fired. Verifying this up
    // front separates "request never went out" from "request out but no
    // citations rendered" failures.
    await expect
      .poll(() => chat.hits(), { timeout: 15_000 })
      .toBeGreaterThanOrEqual(1);

    // The bubble surfaces citations behind a collapsible "Kaynaklar (N) ▸"
    // header (ChatBubble.tsx ~L462). The header text is the strongest
    // signal that `setMessageWebCitations` flipped the Dexie row + the
    // live query re-rendered the bubble.
    const sourcesHeader = page
      .getByRole("button", { name: /^(kaynaklar|sources)\s*\(\d+\)/i })
      .first();
    await expect(sourcesHeader).toBeVisible({ timeout: 30_000 });
    await expect(sourcesHeader).toContainText(
      new RegExp(`\\(${CITATION_URLS.length}\\)`),
    );

    // Expand the collapsible so the chip elements render into the DOM.
    await sourcesHeader.click();

    const chips = page.locator('[data-testid="web-citation-chip"]');
    await expect(chips.first()).toBeVisible({ timeout: 10_000 });
    await expect(chips).toHaveCount(CITATION_URLS.length, { timeout: 10_000 });

    // The chat mock must have been hit exactly once for this message.
    expect(chat.hits()).toBe(1);

    // The request body should have included the web_search tool in
    // `tools[]` — proves the toggle actually plumbed through to the
    // request, not just toggled UI.
    const tools = chat.toolsSeen();
    expect(Array.isArray(tools)).toBe(true);
    const toolTypes = (tools as Array<{ type?: string }>).map((t) => t?.type);
    expect(toolTypes).toContain("web_search_20260209");

    // Click the first chip to open the peek modal.
    await chips.first().click();

    const makeSourceBtn = page.locator(
      '[data-testid="web-citation-make-source"]',
    );
    await expect(makeSourceBtn).toBeVisible({ timeout: 5_000 });
    await expect(makeSourceBtn).toBeEnabled();
    await makeSourceBtn.click();

    // The modal flips to "Eklendi" / "Added" once `onMakeSource` resolves.
    // The toast also fires; either visible signal is acceptable, but the
    // in-modal status is the closest assertion.
    await expect(
      page.getByText(/^(eklendi|added)$/i).first(),
    ).toBeVisible({ timeout: 30_000 });

    expect(proxy.hits()).toBeGreaterThanOrEqual(1);

    // Persisted source — the new row should be in this workspace with the
    // citation URL stored on `sourceUrl`. We had one pre-seeded ready
    // source from `seedGuidedStudyWorkspace`, so the total should be 2.
    const persisted = await page.evaluate(
      async (args: { workspaceId: string }) => {
        const candidates = await indexedDB.databases();
        const tmeDb = candidates.find(
          (d) => typeof d.name === "string" && d.name.length > 0,
        );
        if (!tmeDb || typeof tmeDb.name !== "string") {
          throw new Error("web-search-chat.e2e: no IndexedDB database");
        }
        const dbReq = indexedDB.open(tmeDb.name);
        const db: IDBDatabase = await new Promise((resolve, reject) => {
          dbReq.onsuccess = () => resolve(dbReq.result);
          dbReq.onerror = () => reject(dbReq.error);
        });
        try {
          const rows = await new Promise<
            Array<{
              id: string;
              title: string;
              ingestStatus: string;
              workspaceId: string;
              sourceUrl?: string;
            }>
          >((resolve, reject) => {
            const tx = db.transaction(["sources"], "readonly");
            const req = tx.objectStore("sources").getAll();
            req.onsuccess = () =>
              resolve(req.result as Array<{
                id: string;
                title: string;
                ingestStatus: string;
                workspaceId: string;
                sourceUrl?: string;
              }>);
            req.onerror = () => reject(req.error);
          });
          return rows.filter((r) => r.workspaceId === args.workspaceId);
        } finally {
          db.close();
        }
      },
      { workspaceId: seed.workspaceId },
    );

    // 1 seeded + 1 added via "Kaynak yap"
    expect(persisted.length).toBe(2);
    const added = persisted.find((r) => r.id !== seed.sourceId);
    expect(added).toBeTruthy();
    expect(added!.ingestStatus).toBe("ready");
  });
});
