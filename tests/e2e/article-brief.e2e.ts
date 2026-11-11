import { expect, test } from "@playwright/test";
import { seedUnlockedVault } from "./helpers/seed-state";

function sseEvent(name: string, data: unknown): string {
  return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
}

test("reads a new article brief and opens its contextual assistant", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  const { workspaceId } = await seedUnlockedVault(page);
  await page.evaluate(async (wsId) => {
    const databases = await indexedDB.databases();
    const name = databases.find((database) => database.name)?.name;
    if (!name) throw new Error("App database was not opened");
    const request = indexedDB.open(name);
    const database: IDBDatabase = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const now = Date.now();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(["sources", "chunks", "articleAnalyses"], "readwrite");
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.objectStore("sources").put({
        id: "brief-source", workspaceId: wsId, type: "pdf", title: "A Paper", status: "ready", createdAt: now, updatedAt: now,
      });
      transaction.objectStore("chunks").put({
        id: "brief-chunk", sourceId: "brief-source", workspaceId: wsId, index: 0,
        text: "We compared the proposed method with a baseline.", tokenCount: 12, createdAt: now,
      });
      transaction.objectStore("articleAnalyses").put({
        id: "brief-analysis", workspaceId: wsId, sourceId: "brief-source", title: "A Paper", targetLang: "en", status: "ready",
        modelSnapshot: { extract: "anthropic::claude-sonnet-4-6", synthesize: "anthropic::claude-sonnet-4-6", critique: "anthropic::claude-sonnet-4-6" },
        usage: { inputTokens: 100, outputTokens: 100 }, createdAt: now, updatedAt: now,
        brief: {
          version: 2, paperType: "empirical", coverage: { includedChunks: 1, omittedChunks: 0 },
          thesis: { id: "thesis", kind: "prose", text: "The method is compared with a baseline.", grounding: "source", citations: [{ quote: "compared the proposed method with a baseline", chunkId: "brief-chunk", verification: "exact" }] },
          sections: [{ id: "method-0", kind: "method", title: "How it works", blocks: [{ id: "method-0-0", kind: "step", text: "Compare the two approaches on the same task.", why: "The comparison controls the task.", grounding: "interpretation" }] }],
        },
      });
    });
    database.close();
  }, workspaceId);

  await page.route("**/api/ai/chat", async (route) => {
    const answer = JSON.stringify({
      text: "It compares the proposed method against a baseline in the same task.",
      quotes: ["compared the proposed method with a baseline"],
    });
    await route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream; charset=utf-8" },
      body: [
        sseEvent("message_start", { type: "message_start", message: { id: "brief-answer", type: "message", role: "assistant", model: "claude-sonnet-4-6", content: [], usage: { input_tokens: 0, output_tokens: 0 } } }),
        sseEvent("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }),
        sseEvent("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: answer } }),
        sseEvent("content_block_stop", { type: "content_block_stop", index: 0 }),
        sseEvent("message_delta", { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { input_tokens: 50, output_tokens: 30 } }),
        sseEvent("message_stop", { type: "message_stop" }),
      ].join(""),
    });
  });

  await page.goto(`/w/${workspaceId}/analysis/brief-analysis`);
  await expect(page.getByText("The method is compared with a baseline.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "How it works" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("article-brief.png"), fullPage: true });
  await page.getByRole("button", { name: /Bu bölümü sor|Ask about this section/ }).click();
  await expect(page.getByRole("textbox", { name: /Soru veya talimat|Question or instruction/ })).toBeVisible();
  await expect(page.getByText("How it works", { exact: true }).last()).toBeVisible();
  await expect(page.getByRole("button", { name: /Gönder|Send/ })).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath("article-brief-assistant.png"), fullPage: true });
  await page.getByRole("textbox", { name: /Soru veya talimat|Question or instruction/ }).fill("What is compared?");
  await page.getByRole("button", { name: /Gönder|Send/ }).click();
  await expect(page.getByText("It compares the proposed method against a baseline in the same task.")).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: /Bu bölümü sor|Ask about this section/ }).click();
  await expect(page.getByText("It compares the proposed method against a baseline in the same task.")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("textbox", { name: /Soru veya talimat|Question or instruction/ })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("article-brief-mobile.png") });
});
