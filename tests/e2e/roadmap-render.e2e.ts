import { test, expect } from "@playwright/test";

// Phase 13 — Roadmap render + interact E2E.
//
// We bypass the AI wizard entirely (mocking the streaming chat endpoint is
// out of scope for v1) and seed a complete roadmap directly into Dexie via
// IndexedDB. That covers the parts the user actually touches once a
// roadmap exists: the list page card, the graph canvas, node selection,
// and the Done toggle in the inspector.
//
// The repo + Zod parser + AI runner + token budget logic are all covered
// by Vitest; this file is the integration layer that proves the SVG +
// React state machine + Dexie live-queries glue still works end-to-end.

const WORKSPACE_ID = "ws_rmp_e2e";
const ROADMAP_ID = "rmp_e2e_seed";

async function openDb(page: import("@playwright/test").Page): Promise<void> {
  // Land on a page that imports Dexie hooks so the singleton actually opens
  // IndexedDB. Without this every direct objectStore call below races a
  // not-yet-created database.
  await page.goto("/dashboard");
  await page.waitForLoadState("networkidle");
}

async function seedRoadmap(page: import("@playwright/test").Page): Promise<void> {
  await page.evaluate(
    async (args: { workspaceId: string; roadmapId: string }) => {
      // Wait for Dexie's open transaction. We poll because the singleton
      // `db = new TmeDb()` runs on first module import but the upgrade
      // transaction (v27/v28) can lag a frame behind first paint.
      let candidates = await indexedDB.databases();
      for (let i = 0; candidates.length === 0 && i < 50; i += 1) {
        await new Promise((r) => setTimeout(r, 100));
        candidates = await indexedDB.databases();
      }
      const handle = candidates.find(
        (d) => typeof d.name === "string" && d.name.length > 0,
      );
      if (!handle || typeof handle.name !== "string") {
        throw new Error("seedRoadmap: IndexedDB never opened");
      }
      const open = indexedDB.open(handle.name);
      const idb: IDBDatabase = await new Promise((resolve, reject) => {
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error);
      });
      try {
        const now = Date.now();
        await new Promise<void>((resolve, reject) => {
          const tx = idb.transaction(
            ["workspaces", "roadmaps", "roadmapNodes", "roadmapEdges"],
            "readwrite",
          );
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.objectStore("workspaces").put({
            id: args.workspaceId,
            name: "Roadmap E2E",
            color: "#6B3A5E",
            initials: "RE",
            createdAt: now,
            updatedAt: now,
            archivedAt: null,
          });
          tx.objectStore("roadmaps").put({
            id: args.roadmapId,
            workspaceId: args.workspaceId,
            title: "Backprop temelleri",
            topic: "Neural network backpropagation",
            timeframe: "weekly",
            level: "beginner",
            usedSources: false,
            model: "claude-sonnet-4-6",
            createdAt: now,
            updatedAt: now,
          });
          // Two root nodes + a directed edge between them.
          const nodes = [
            {
              id: "rmn_a",
              roadmapId: args.roadmapId,
              parentId: null,
              depth: 0,
              title: "Gradient",
              description: "Türevin yön bilgisi.",
              status: "todo",
              createdAt: now,
              updatedAt: now,
            },
            {
              id: "rmn_b",
              roadmapId: args.roadmapId,
              parentId: null,
              depth: 0,
              title: "Chain rule",
              description: "Bileşik fonksiyon türevi.",
              status: "todo",
              createdAt: now + 1,
              updatedAt: now + 1,
            },
          ];
          for (const n of nodes) tx.objectStore("roadmapNodes").put(n);
          tx.objectStore("roadmapEdges").put({
            id: "rme_a_b",
            roadmapId: args.roadmapId,
            fromNodeId: "rmn_a",
            toNodeId: "rmn_b",
            createdAt: now,
          });
        });
      } finally {
        idb.close();
      }
    },
    { workspaceId: WORKSPACE_ID, roadmapId: ROADMAP_ID },
  );
}

test.describe("Phase 13 — Roadmap render + interact", () => {
  test("seeded roadmap renders, node click opens inspector, Done toggle persists", async ({
    page,
  }) => {
    test.setTimeout(60_000);

    await openDb(page);
    await seedRoadmap(page);

    // List page card.
    await page.goto(`/w/${WORKSPACE_ID}/roadmap`);
    await page.waitForLoadState("networkidle");
    const cardTitle = page.getByText("Backprop temelleri", { exact: false });
    await expect(cardTitle).toBeVisible({ timeout: 15_000 });

    // Click the card → graph view.
    await cardTitle.first().click();
    await expect(page).toHaveURL(
      new RegExp(`/w/${WORKSPACE_ID}/roadmap/${ROADMAP_ID}$`),
      { timeout: 10_000 },
    );

    // SVG canvas with the two seeded nodes. Phase 13 renders each node as a
    // square: the label lives in a pointer-events:none <foreignObject>, and the
    // title is ALSO emitted as an SVG <title> tooltip — so scope the visibility
    // check to the foreignObject label to avoid a strict-mode double match.
    const gradientLabel = page
      .locator("svg foreignObject")
      .getByText("Gradient", { exact: false });
    const chainRuleLabel = page
      .locator("svg foreignObject")
      .getByText("Chain rule", { exact: false });
    await expect(gradientLabel).toBeVisible({ timeout: 10_000 });
    await expect(chainRuleLabel).toBeVisible({ timeout: 10_000 });

    // Select the Gradient node → NodeInspector slides in. Selection fires from
    // the node's clickable <rect> (a no-travel tap), targeted via the
    // data-node-id test affordance (the label foreignObject is pointer-inert).
    await page.locator('rect[data-node-id="rmn_a"]').click();
    const inspectorHeading = page.getByRole("heading", { name: "Gradient" });
    await expect(inspectorHeading).toBeVisible({ timeout: 5_000 });

    // Done toggle. The Switch component renders a button — its aria-label
    // is locale-driven, so we scope by the inspector aside instead and
    // click the only switch present.
    const inspector = page.getByLabel(/Node detayları|Node details/);
    await expect(inspector).toBeVisible();
    const doneToggle = inspector.locator("button[role=\"switch\"]").first();
    await doneToggle.click();

    // Persisted progress aggregates re-fire live; the header progress label
    // should report 1 / 2 after the toggle settles.
    const progressLabel = page.locator("text=/\\b1 \\/ 2\\b/");
    await expect(progressLabel).toBeVisible({ timeout: 10_000 });
  });
});
