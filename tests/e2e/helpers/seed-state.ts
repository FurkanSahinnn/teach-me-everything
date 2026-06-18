import type { Page } from "@playwright/test";

// Seeds Dexie (CURRENT post-Phase-9 schema) + a workspace so chat /
// guided-study / podcast / notes E2E tests land directly on a workspace
// without walking the Setup Wizard (which has its own coverage in
// setup-wizard.e2e.ts).
//
// Phase 9 removed the master-password vault: the `vault` object store is gone
// (Dexie v24) and `ApiKeyRecord` is now plaintext `{provider, plaintext,
// updatedAt}`. `useVault` is a trivial always-unlocked stub, so there is no
// masterKey to import/restore. The only "setup done" signal is the
// `tme:setup-complete` localStorage flag (lib/setup-completion.ts /
// FirstRunGate) — set it before any navigation so the gate doesn't bounce to
// /setup.

const E2E_WORKSPACE_ID = "ws_e2e_seed";
const E2E_API_KEY_PLAINTEXT = "sk-e2e-mocked-never-used-by-network";
const SETUP_COMPLETE_KEY = "tme:setup-complete";

export type SeedResult = { workspaceId: string };

export type ExtraApiKey = { provider: string; plaintext: string };

export async function seedUnlockedVault(
  page: Page,
  opts: { extraApiKeys?: ExtraApiKey[] } = {},
): Promise<SeedResult> {
  const extraApiKeys = opts.extraApiKeys ?? [];

  // Mark setup complete before any navigation so FirstRunGate (which reads the
  // `tme:setup-complete` localStorage flag post-Phase-9) doesn't bounce to
  // /setup. addInitScript applies to every page load in the test.
  await page.addInitScript((key: string) => {
    window.localStorage.setItem(key, "1");
  }, SETUP_COMPLETE_KEY);

  // Hit /dashboard — it imports Dexie hooks (`useDashboardStats` →
  // `useLiveQuery` → `db.workspaces.toArray()`), which forces the singleton
  // `db = new TmeDb()` to actually open IndexedDB. Landing on `/` skips
  // that path because the root page is mostly static. We can't write to
  // object stores that don't exist yet.
  await page.goto("/dashboard");
  await page.waitForLoadState("networkidle");

  await page.evaluate(
    async (args: {
      wsId: string;
      apiKeyPlaintext: string;
      extraApiKeys: ExtraApiKey[];
    }) => {
      // Wait until Dexie has finished opening the database — `db = new
      // TmeDb()` is module-level, so it kicks off on first import, but the
      // open transaction can lag behind page load.
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
        throw new Error("seedUnlockedVault: no IndexedDB database found");
      }

      const dbReq = indexedDB.open(tmeDb.name);
      const db: IDBDatabase = await new Promise((resolve, reject) => {
        dbReq.onsuccess = () => resolve(dbReq.result);
        dbReq.onerror = () => reject(dbReq.error);
      });

      const now = Date.now();
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(["apiKeys", "workspaces"], "readwrite");
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);

          // Post-Phase-9 ApiKeyRecord: { provider, plaintext, updatedAt }.
          // Seed `anthropic` (default chat binding is
          // `anthropic::claude-sonnet-4-6`) AND `openai` (the embed path) so
          // both chat and retrieval reach their mocked routes instead of the
          // `key_missing` branch.
          const keys = tx.objectStore("apiKeys");
          keys.put({
            provider: "anthropic",
            plaintext: args.apiKeyPlaintext,
            updatedAt: now,
          });
          keys.put({
            provider: "openai",
            plaintext: args.apiKeyPlaintext,
            updatedAt: now,
          });
          for (const extra of args.extraApiKeys) {
            keys.put({
              provider: extra.provider,
              plaintext: extra.plaintext,
              updatedAt: now,
            });
          }

          tx.objectStore("workspaces").put({
            id: args.wsId,
            name: "E2E Test Workspace",
            color: "#8b5cf6",
            initials: "E2",
            createdAt: now,
            updatedAt: now,
            archivedAt: null,
          });
        });
      } finally {
        db.close();
      }
    },
    {
      wsId: E2E_WORKSPACE_ID,
      apiKeyPlaintext: E2E_API_KEY_PLAINTEXT,
      extraApiKeys,
    },
  );

  return { workspaceId: E2E_WORKSPACE_ID };
}

const E2E_GS_SOURCE_ID = "src_e2e_guided_study";
const E2E_GS_CHUNK_IDS = [
  "ck_e2e_gs_1",
  "ck_e2e_gs_2",
  "ck_e2e_gs_3",
] as const;

export type GuidedStudySeed = {
  workspaceId: string;
  sourceId: string;
  chunkIds: readonly string[];
};

// Layered on top of seedUnlockedVault: opens the same Dexie singleton and
// writes one ready-status PDF source plus three chunks into the workspace
// the vault helper just created. The curriculum and lesson-note runners
// build their prompt context directly from these rows (no embedding or
// retrieval round-trip), so the chunks only need text + index — but the
// JSON envelope the AI mock returns has to reference these exact ids,
// otherwise the runners' filterValidRefs / mapParsedItemsToInput strip
// every parsed item and the runner throws "no valid items / refs".
export async function seedGuidedStudyWorkspace(
  page: Page,
): Promise<GuidedStudySeed> {
  const base = await seedUnlockedVault(page);

  await page.evaluate(
    async (args: {
      workspaceId: string;
      sourceId: string;
      chunkIds: readonly string[];
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
        throw new Error("seedGuidedStudyWorkspace: no IndexedDB database");
      }

      const dbReq = indexedDB.open(tmeDb.name);
      const db: IDBDatabase = await new Promise((resolve, reject) => {
        dbReq.onsuccess = () => resolve(dbReq.result);
        dbReq.onerror = () => reject(dbReq.error);
      });

      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(["sources", "chunks"], "readwrite");
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);

          tx.objectStore("sources").put({
            id: args.sourceId,
            workspaceId: args.workspaceId,
            type: "pdf",
            title: "Quantum Mechanics — E2E Source",
            ingestStatus: "ready",
            createdAt: Date.now(),
            updatedAt: Date.now(),
          });

          const chunkTexts = [
            "Wave-particle duality is the central concept that quantum objects exhibit both wave-like and particle-like behavior depending on the experimental context.",
            "Superposition allows quantum systems to exist in multiple states simultaneously until a measurement collapses the wavefunction.",
            "Entanglement describes correlations between quantum systems that persist regardless of spatial separation, with implications for information theory.",
          ];

          for (let i = 0; i < args.chunkIds.length; i++) {
            tx.objectStore("chunks").put({
              id: args.chunkIds[i],
              sourceId: args.sourceId,
              workspaceId: args.workspaceId,
              index: i,
              text: chunkTexts[i] ?? `Chunk ${i + 1}`,
              tokenCount: 32,
              section: `Section ${i + 1}`,
              headings: [`Section ${i + 1}`],
              createdAt: Date.now(),
            });
          }
        });
      } finally {
        db.close();
      }
    },
    {
      workspaceId: base.workspaceId,
      sourceId: E2E_GS_SOURCE_ID,
      chunkIds: E2E_GS_CHUNK_IDS,
    },
  );

  return {
    workspaceId: base.workspaceId,
    sourceId: E2E_GS_SOURCE_ID,
    chunkIds: E2E_GS_CHUNK_IDS,
  };
}

const E2E_PODCAST_SOURCE_ID = "src_e2e_podcast";
const E2E_PODCAST_CHUNK_IDS = [
  "ck_e2e_pod_1",
  "ck_e2e_pod_2",
  "ck_e2e_pod_3",
] as const;

export type PodcastSeed = {
  workspaceId: string;
  sourceId: string;
  chunkIds: readonly string[];
};

// Layered on top of seedUnlockedVault: writes one ready-status PDF source
// plus three chunks. The podcast-script runner's `filterRefs` strips any
// segment whose sourceRefs don't reference these exact ids — so JSON
// envelopes the AI mock returns must cite E2E_PODCAST_SOURCE_ID +
// E2E_PODCAST_CHUNK_IDS verbatim.
export async function seedPodcastWorkspace(page: Page): Promise<PodcastSeed> {
  const base = await seedUnlockedVault(page);

  await page.evaluate(
    async (args: {
      workspaceId: string;
      sourceId: string;
      chunkIds: readonly string[];
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
        throw new Error("seedPodcastWorkspace: no IndexedDB database");
      }

      const dbReq = indexedDB.open(tmeDb.name);
      const db: IDBDatabase = await new Promise((resolve, reject) => {
        dbReq.onsuccess = () => resolve(dbReq.result);
        dbReq.onerror = () => reject(dbReq.error);
      });

      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(["sources", "chunks"], "readwrite");
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);

          tx.objectStore("sources").put({
            id: args.sourceId,
            workspaceId: args.workspaceId,
            type: "pdf",
            title: "Podcast E2E Source",
            ingestStatus: "ready",
            createdAt: Date.now(),
            updatedAt: Date.now(),
          });

          const chunkTexts = [
            "Renormalization absorbs ultraviolet divergences into bare parameters by integrating out high-energy modes above a cutoff scale.",
            "The beta function records how a coupling shifts when the cutoff is lowered logarithmically, with sign determining asymptotic freedom.",
            "Fixed points are the values where the beta function vanishes; flowing to the same fixed point defines a universality class.",
          ];

          for (let i = 0; i < args.chunkIds.length; i++) {
            tx.objectStore("chunks").put({
              id: args.chunkIds[i],
              sourceId: args.sourceId,
              workspaceId: args.workspaceId,
              index: i,
              text: chunkTexts[i] ?? `Chunk ${i + 1}`,
              tokenCount: 32,
              section: `Section ${i + 1}`,
              headings: [`Section ${i + 1}`],
              createdAt: Date.now(),
            });
          }
        });
      } finally {
        db.close();
      }
    },
    {
      workspaceId: base.workspaceId,
      sourceId: E2E_PODCAST_SOURCE_ID,
      chunkIds: E2E_PODCAST_CHUNK_IDS,
    },
  );

  return {
    workspaceId: base.workspaceId,
    sourceId: E2E_PODCAST_SOURCE_ID,
    chunkIds: E2E_PODCAST_CHUNK_IDS,
  };
}
