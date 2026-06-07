import { test, expect, type Page, type Route, type Request } from "@playwright/test";
import {
  installAiMocks,
  isPodcastScriptRequest,
  chunkifyText,
} from "./helpers/mock-ai-routes";
import { seedPodcastWorkspace } from "./helpers/seed-state";

// Phase 5.B.D happy-path E2E.
//
// Flow under test:
//   workspace overview → "Podcast oluştur" → GenerateScriptModal opens
//   → user accepts defaults (Bella/Adam voices, 15 min, ready source pre-
//     selected) → "Üret"
//   → generatePodcastScript streams script via /api/ai/chat (mocked SSE)
//   → createPodcast persists status=scripted
//   → synthesizePodcastAudio runs per-segment TTS via /api/ai/tts
//     (mocked MP3 bytes) → AudioContext.decodeAudioData (stubbed) returns
//     a deterministic 1 s Float32 buffer → audio-assembly builds a single
//     WAV blob → setPodcastBlob + status=ready
//   → router.push /w/[id]/audio/[podcastId]
//
// What is mocked (test-time only — production code is untouched):
//   - /api/ai/chat: SSE stream with the podcast-script JSON envelope.
//     The JSON refs the seeded source/chunk ids exactly so the runner's
//     filterRefs doesn't strip every segment.
//   - /api/ai/tts: opaque MP3 bytes. The stubbed AudioContext doesn't
//     parse them; it just returns a fake AudioBuffer per call.
//   - window.AudioContext: stubbed before any TME code runs so the
//     synth orchestrator's `decodeAudioData` resolves deterministically
//     under headless Chromium (real WebAudio decode of fake bytes
//     would reject, then the pipeline would flip the row to status=error).
//
// What is NOT mocked:
//   - lib/ai/podcast-generation.ts        — runs real
//   - lib/podcast/{tts,audio-assembly,synthesize}.ts — runs real
//   - lib/db/podcasts.ts + workspaces.ts + sources.ts + chunks.ts — real
//   - GenerateScriptModal + audio page    — runs real
//
// Therefore a regression in any of those modules will fail this test.

const TTS_HITS_LABEL = "podcast-script";

// Minimal "MP3 bytes" — the stubbed AudioContext only checks byteLength
// is > 0 before returning the canned buffer. Real ElevenLabs MP3 would
// be tens of KB; 32 bytes is enough to round-trip through the proxy.
const FAKE_MP3_BYTES = new Uint8Array(32);
for (let i = 0; i < FAKE_MP3_BYTES.length; i += 1) FAKE_MP3_BYTES[i] = i;

async function installAudioContextStub(page: Page): Promise<void> {
  // page.addInitScript runs in every isolated frame BEFORE any
  // application script, so the GenerateScriptModal's
  // `defaultBrowserAudioContext()` reads the patched constructor on
  // first synth invocation.
  //
  // The stub returns a 1-second mono Float32 buffer per decode call.
  // synth.assemblePodcastAudio computes timings off
  // decodedBuffer.duration × 1000, so with three 1 s segments + 250 ms
  // default gaps we get a deterministic 2.5 s total — easy to assert.
  await page.addInitScript(() => {
    class FakeAudioBuffer {
      readonly numberOfChannels = 1;
      readonly sampleRate = 44_100;
      readonly duration = 1;
      readonly length = 44_100;
      private readonly data: Float32Array;
      constructor() {
        this.data = new Float32Array(this.length);
      }
      getChannelData(_channel: number): Float32Array {
        return this.data;
      }
    }
    class FakeAudioContext {
      readonly sampleRate = 44_100;
      readonly state = "running";
      async decodeAudioData(buf: ArrayBuffer): Promise<FakeAudioBuffer> {
        if (!(buf instanceof ArrayBuffer)) {
          throw new Error("FakeAudioContext: expected ArrayBuffer");
        }
        if (buf.byteLength === 0) {
          throw new Error("FakeAudioContext: empty buffer");
        }
        return new FakeAudioBuffer();
      }
      async close(): Promise<void> {}
    }
    // Make both the standard and the webkit-prefixed constructors point
    // at the same fake — the synth orchestrator probes both.
    (window as unknown as { AudioContext: typeof FakeAudioContext }).AudioContext =
      FakeAudioContext;
    (window as unknown as { webkitAudioContext: typeof FakeAudioContext }).webkitAudioContext =
      FakeAudioContext;
  });
}

async function installTtsRoute(page: Page): Promise<{ hits: () => number }> {
  let hits = 0;
  await page.route("**/api/ai/tts", async (route: Route, req: Request) => {
    hits += 1;
    // Sanity-check the proxy contract: client must send a bearer token
    // (the decrypted ElevenLabs key) and a body with voiceId + text.
    const auth = req.headers()["authorization"] ?? "";
    if (!/^Bearer\s+/.test(auth)) {
      await route.fulfill({ status: 401, body: "missing_key" });
      return;
    }
    let voiceId: unknown = null;
    let text: unknown = null;
    try {
      const body = req.postDataJSON() as {
        voiceId?: unknown;
        text?: unknown;
      };
      voiceId = body.voiceId;
      text = body.text;
    } catch {
      /* fall through; assertions below will fail */
    }
    if (typeof voiceId !== "string" || typeof text !== "string") {
      await route.fulfill({ status: 400, body: "bad_shape" });
      return;
    }
    await route.fulfill({
      status: 200,
      headers: { "content-type": "audio/mpeg" },
      body: Buffer.from(FAKE_MP3_BYTES),
    });
  });
  return { hits: () => hits };
}

test.describe("podcast happy-path — generate script + synthesize + play", () => {
  test("generates podcast end-to-end and lands on the audio page in ready state", async ({
    page,
  }) => {
    test.setTimeout(180_000);

    // 1) Install the AudioContext stub BEFORE seeding navigates the
    //    page so /dashboard's bundle never sees the real constructor.
    await installAudioContextStub(page);

    const seed = await seedPodcastWorkspace(page);

    // 2) The podcast-script JSON envelope MUST cite the seeded source +
    //    chunk ids exactly. The runner's mapParsedScriptToInput strips
    //    refs to unknown ids — leaving every segment with empty refs is
    //    fine, but if all three segments end up with zero text from the
    //    parser we'd hit `no_segments` and the pipeline would abort.
    const scriptPayload = JSON.stringify({
      title: "Renormalizasyon, bir diyalogda",
      titleEn: "Renormalization, in a dialogue",
      description: "İki sunucu RG akışını sezgisel anlatır.",
      chapters: [
        { title: "Cutoff fikri", segmentIndex: 0 },
        { title: "β fonksiyonu", segmentIndex: 2 },
      ],
      segments: [
        {
          speaker: "alev",
          text: "Renormalizasyon neden gerekli aslında?",
          sourceRefs: [
            { sourceId: seed.sourceId, chunkIds: [seed.chunkIds[0]!] },
          ],
        },
        {
          speaker: "deniz",
          text: "UV bölgesinde sonsuzlukları emen bir hesap aracıdır.",
          sourceRefs: [
            { sourceId: seed.sourceId, chunkIds: [seed.chunkIds[0]!] },
          ],
        },
        {
          speaker: "alev",
          text: "β fonksiyonu bağlaşımların nasıl aktığını söyler, değil mi?",
          sourceRefs: [
            { sourceId: seed.sourceId, chunkIds: [seed.chunkIds[1]!] },
          ],
        },
      ],
    });

    const mocks = await installAiMocks(page, {
      chatResponders: [
        {
          label: TTS_HITS_LABEL,
          match: isPodcastScriptRequest,
          textChunks: chunkifyText(scriptPayload, 6),
          inputTokens: 1500,
          outputTokens: 800,
        },
      ],
    });
    const tts = await installTtsRoute(page);

    // 3) Open the workspace overview and trigger the modal.
    await page.goto(`/w/${seed.workspaceId}`);
    await page.waitForLoadState("networkidle");

    const openModalBtn = page
      .getByRole("button", { name: /podcast oluştur|create podcast/i })
      .first();
    await expect(openModalBtn).toBeVisible({ timeout: 10_000 });
    await openModalBtn.click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    // 4) The modal pre-selects every ready source + DEFAULT_VOICE_PICKS
    //    (bella/adam) + 15 min — we just hit "Üret".
    const generateBtn = dialog
      .getByRole("button", { name: /^(Üret|Generate)$/i })
      .first();
    await expect(generateBtn).toBeEnabled({ timeout: 10_000 });
    await generateBtn.click();

    // 5) Wait for the pipeline to finish + the modal to push us to the
    //    audio page. The URL pattern is the strongest signal — status
    //    flip + blob write happen synchronously inside the runner before
    //    `router.push` fires.
    await page.waitForURL(/\/audio\/pod_[a-z0-9]+/i, { timeout: 60_000 });

    // 6) Assertions against persisted state — read the audio page URL,
    //    pluck the podcastId, then query Dexie directly. This catches
    //    pipeline failures that quietly downgrade the row (e.g. status
    //    flipped to error after a TTS / decode hiccup).
    const audioUrl = new URL(page.url());
    const match = audioUrl.pathname.match(/\/audio\/(pod_[A-Za-z0-9]+)/);
    expect(match?.[1]).toBeTruthy();
    const podcastId = match?.[1] as string;

    const persisted = await page.evaluate(async (id: string) => {
      const candidates = await indexedDB.databases();
      const tmeDb = candidates.find(
        (d) => typeof d.name === "string" && d.name.length > 0,
      );
      if (!tmeDb || typeof tmeDb.name !== "string") {
        throw new Error("no IndexedDB database open");
      }
      const dbReq = indexedDB.open(tmeDb.name);
      const db: IDBDatabase = await new Promise((resolve, reject) => {
        dbReq.onsuccess = () => resolve(dbReq.result);
        dbReq.onerror = () => reject(dbReq.error);
      });
      try {
        const row = await new Promise<unknown>((resolve, reject) => {
          const tx = db.transaction("podcasts", "readonly");
          const req = tx.objectStore("podcasts").get(id);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
        const blob = await new Promise<unknown>((resolve, reject) => {
          const tx = db.transaction("podcastBlobs", "readonly");
          const req = tx.objectStore("podcastBlobs").get(id);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
        return { row, blob };
      } finally {
        db.close();
      }
    }, podcastId);

    const row = persisted.row as {
      status: string;
      segments: Array<{ speaker: string; text: string; startMs?: number }>;
      chapters: Array<{ startMs: number; title: string }>;
      totalMs?: number;
      ttsProvider?: string;
      audioMimeType?: string;
    };
    expect(row.status).toBe("ready");
    expect(row.ttsProvider).toBe("elevenlabs");
    expect(row.audioMimeType).toBe("audio/wav");
    expect(row.segments).toHaveLength(3);
    expect(row.totalMs ?? 0).toBeGreaterThan(0);
    // 3 × 1 000 ms speech + 2 × 250 ms inter-segment gap = 3 500 ms;
    // assemblePodcastAudio rounds totalMs to the nearest int.
    expect(row.totalMs).toBe(3500);
    expect(row.segments[0]?.startMs).toBe(0);
    expect(row.segments[1]?.startMs).toBe(1250);
    expect(row.segments[2]?.startMs).toBe(2500);

    const blob = persisted.blob as {
      blob: Blob;
      contentType: string;
      byteSize: number;
    };
    expect(blob).toBeTruthy();
    expect(blob.contentType).toBe("audio/wav");
    expect(blob.byteSize).toBeGreaterThan(44); // WAV header alone is 44 B

    // 7) Audio page DOM smoke — the live page should render the
    //    transcript with the speakers we generated.
    await expect(
      page.getByRole("heading", { name: /Renormalization|Renormalizasyon/ }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByText(
        /Renormalizasyon neden gerekli|UV bölgesinde|β fonksiyonu/,
      ).first(),
    ).toBeVisible();

    // 8) Coverage smoke — both routes were actually exercised.
    expect(mocks.responderHits(TTS_HITS_LABEL)).toBeGreaterThanOrEqual(1);
    expect(tts.hits()).toBe(3); // one TTS request per segment
  });
});
