import type { Page } from "@playwright/test";

// Seeds Dexie with a master vault row, an OpenAI api-key row encrypted under
// a known throwaway password, and a workspace. Then installs an init script
// that re-imports the JWK-exported master key on every page load and patches
// useVault → unlocked. This lets the chat test land directly on the workspace
// page without walking the Setup Wizard or the master-password modal — the
// Wizard already has its own Playwright coverage in `setup-wizard.e2e.ts`.
//
// Why JWK round-trip instead of re-deriving via PBKDF2 on each load: 600k
// PBKDF2 iterations cost ~600 ms per nav, which the chat happy-path triggers
// 2-3 times. Importing a JWK is sub-millisecond.
//
// Why expose useVault on window at all (1-line affordance in src/stores/
// vault.ts): vault state is in-memory only by design (no persist middleware
// — masterKey must never hit disk). Without an externally reachable handle,
// every full page navigation in the test would silently re-lock the vault
// and embedding/chat would degrade to the "key missing" path.

const E2E_PASSWORD = "tme-e2e-seed-password";
const E2E_WORKSPACE_ID = "ws_e2e_seed";
const E2E_OPENAI_KEY_PLAINTEXT = "sk-e2e-mocked-never-used-by-network";

// Must match constants in src/lib/crypto/api-keys.ts. If those change, this
// helper has to follow or unlocking via the modal would diverge.
const PBKDF2_ITERATIONS = 600_000;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const VERIFIER_CONSTANT = "tme:vault:v1";

export type SeedResult = { workspaceId: string };

export type ExtraApiKey = { provider: string; plaintext: string };

export async function seedUnlockedVault(
  page: Page,
  opts: { extraApiKeys?: ExtraApiKey[] } = {},
): Promise<SeedResult> {
  const extraApiKeys = opts.extraApiKeys ?? [];
  // Hit /dashboard — it imports Dexie hooks (`useDashboardStats` →
  // `useLiveQuery` → `db.workspaces.toArray()`), which forces the singleton
  // `db = new TmeDb()` to actually open IndexedDB. Landing on `/` skips
  // that path because the root page is mostly static. We can't write to
  // object stores that don't exist yet.
  await page.goto("/dashboard");
  await page.waitForLoadState("networkidle");

  const seed = await page.evaluate(
    async (args: {
      password: string;
      wsId: string;
      apiKeyPlaintext: string;
      iters: number;
      saltLen: number;
      ivLen: number;
      verifier: string;
      extraApiKeys: ExtraApiKey[];
    }) => {
      const enc = new TextEncoder();

      function bytesToBase64(bytes: Uint8Array): string {
        let s = "";
        for (let i = 0; i < bytes.length; i++) {
          s += String.fromCharCode(bytes[i] as number);
        }
        return btoa(s);
      }

      const salt = crypto.getRandomValues(new Uint8Array(args.saltLen));
      const baseKey = await crypto.subtle.importKey(
        "raw",
        enc.encode(args.password),
        "PBKDF2",
        false,
        ["deriveKey"],
      );
      const masterKey = await crypto.subtle.deriveKey(
        { name: "PBKDF2", salt, iterations: args.iters, hash: "SHA-256" },
        baseKey,
        { name: "AES-GCM", length: 256 },
        true,
        ["encrypt", "decrypt"],
      );

      async function encryptSecret(
        plaintext: string,
      ): Promise<{ ciphertext: string; iv: string }> {
        const iv = crypto.getRandomValues(new Uint8Array(args.ivLen));
        const ct = await crypto.subtle.encrypt(
          { name: "AES-GCM", iv },
          masterKey,
          enc.encode(plaintext),
        );
        return {
          ciphertext: bytesToBase64(new Uint8Array(ct)),
          iv: bytesToBase64(iv),
        };
      }

      const verifierEnc = await encryptSecret(args.verifier);
      const openaiKeyEnc = await encryptSecret(args.apiKeyPlaintext);
      // The reader's runChat path reads `getApiKey("anthropic")` first and
      // bails with `key_missing` (without firing /api/ai/chat) if absent.
      // Seed an anthropic row alongside the openai row so the chat happy-
      // path reaches the streamed-response branch under the same mocks.
      const anthropicKeyEnc = await encryptSecret(args.apiKeyPlaintext);

      // Encrypt any extra api-key rows up front so the IndexedDB
      // transaction body stays synchronous w.r.t. crypto work.
      const extraEncrypted = await Promise.all(
        args.extraApiKeys.map(async (k) => ({
          provider: k.provider,
          enc: await encryptSecret(k.plaintext),
        })),
      );

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

      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(
            ["vault", "apiKeys", "workspaces"],
            "readwrite",
          );
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.objectStore("vault").put({
            id: "master",
            salt: bytesToBase64(salt),
            verifierCiphertext: verifierEnc.ciphertext,
            verifierIv: verifierEnc.iv,
            createdAt: Date.now(),
          });
          tx.objectStore("apiKeys").put({
            provider: "openai",
            ciphertext: openaiKeyEnc.ciphertext,
            iv: openaiKeyEnc.iv,
            updatedAt: Date.now(),
          });
          tx.objectStore("apiKeys").put({
            provider: "anthropic",
            ciphertext: anthropicKeyEnc.ciphertext,
            iv: anthropicKeyEnc.iv,
            updatedAt: Date.now(),
          });
          for (const extra of extraEncrypted) {
            tx.objectStore("apiKeys").put({
              provider: extra.provider,
              ciphertext: extra.enc.ciphertext,
              iv: extra.enc.iv,
              updatedAt: Date.now(),
            });
          }
          tx.objectStore("workspaces").put({
            id: args.wsId,
            name: "E2E Test Workspace",
            color: "#8b5cf6",
            initials: "E2",
            createdAt: Date.now(),
            updatedAt: Date.now(),
            archivedAt: null,
          });
        });
      } finally {
        db.close();
      }

      const jwk = await crypto.subtle.exportKey("jwk", masterKey);
      return { jwk };
    },
    {
      password: E2E_PASSWORD,
      wsId: E2E_WORKSPACE_ID,
      apiKeyPlaintext: E2E_OPENAI_KEY_PLAINTEXT,
      iters: PBKDF2_ITERATIONS,
      saltLen: SALT_LENGTH,
      ivLen: IV_LENGTH,
      verifier: VERIFIER_CONSTANT,
      extraApiKeys,
    },
  );

  await page.addInitScript((jwkSerialized: string) => {
    const jwk: JsonWebKey = JSON.parse(jwkSerialized);
    type VaultStoreHandle = {
      setState: (s: { masterKey: CryptoKey; isUnlocked: boolean }) => void;
    };

    const restore = async (): Promise<boolean> => {
      const handle = (
        window as unknown as { __useVault?: VaultStoreHandle }
      ).__useVault;
      if (!handle) return false;
      const masterKey = await crypto.subtle.importKey(
        "jwk",
        jwk,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"],
      );
      handle.setState({ masterKey, isUnlocked: true });
      return true;
    };

    // Poll until the vault store mounts. App boot is ~50-200 ms; cap at 5 s
    // so a missing affordance fails the test loudly instead of silently
    // leaving the vault locked through the rest of the run.
    const start = Date.now();
    const tick = async (): Promise<void> => {
      if (await restore()) return;
      if (Date.now() - start > 5_000) return;
      setTimeout(() => {
        void tick();
      }, 25);
    };
    void tick();
  }, JSON.stringify(seed.jwk));

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
const E2E_ELEVENLABS_KEY_PLAINTEXT = "xl-e2e-mocked-never-used-by-network";

export type PodcastSeed = {
  workspaceId: string;
  sourceId: string;
  chunkIds: readonly string[];
};

// Layered on top of seedUnlockedVault: seeds an ElevenLabs api-key row
// alongside the standard Anthropic/OpenAI rows, then writes one
// ready-status PDF source plus three chunks. The podcast-script runner
// and the TTS synthesis stage both need their keys, and the runner's
// `filterRefs` will strip any segment whose sourceRefs don't reference
// these exact ids — so JSON envelopes the AI mock returns must cite
// E2E_PODCAST_SOURCE_ID + E2E_PODCAST_CHUNK_IDS verbatim.
export async function seedPodcastWorkspace(
  page: Page,
): Promise<PodcastSeed> {
  const base = await seedUnlockedVault(page, {
    extraApiKeys: [
      { provider: "elevenlabs", plaintext: E2E_ELEVENLABS_KEY_PLAINTEXT },
    ],
  });

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
