import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createPodcast,
  deletePodcast,
  getPodcast,
  getPodcastBlob,
  listPodcastsByWorkspace,
  setPodcastBlob,
  setPodcastStatus,
  updatePodcast,
} from "./podcasts";
import { createWorkspace, deleteWorkspace } from "./workspaces";
import { db } from "./schema";
import type {
  PodcastSegment,
  PodcastVoice,
} from "@/lib/podcast/types";

beforeEach(async () => {
  await db.delete();
  await db.open();
});

afterEach(async () => {
  await db.delete();
});

const VOICES: PodcastVoice[] = [
  { speaker: "alev", name: "Alev", voiceId: "v_a" },
  { speaker: "deniz", name: "Deniz", voiceId: "v_d" },
];

function defaultInput(workspaceId: string, overrides: Record<string, unknown> = {}) {
  const segments: PodcastSegment[] = [
    { speaker: "alev", text: "Soru" },
    { speaker: "deniz", text: "Cevap" },
  ];
  return {
    workspaceId,
    title: "Pilot bölüm",
    locale: "tr" as const,
    sourceIds: ["src_1"],
    segments,
    chapters: [{ title: "Açılış", segmentIndex: 0, startMs: 0 }],
    voices: VOICES,
    modelId: "claude-sonnet-4-6",
    generationPromptVersion: "podcast-script@1",
    ...overrides,
  };
}

describe("podcasts repo", () => {
  it("creates a podcast with status=scripted by default", async () => {
    const ws = await createWorkspace({
      name: "QFT",
      color: "#000",
      initials: "QF",
    });
    const rec = await createPodcast(defaultInput(ws.id));
    expect(rec.id).toMatch(/^pod_/);
    expect(rec.status).toBe("scripted");
    expect(rec.workspaceId).toBe(ws.id);
    expect(rec.segments).toHaveLength(2);

    const fetched = await getPodcast(rec.id);
    expect(fetched?.title).toBe("Pilot bölüm");
  });

  it("lists podcasts by workspace newest-first", async () => {
    const ws = await createWorkspace({
      name: "QFT",
      color: "#000",
      initials: "QF",
    });
    const a = await createPodcast(defaultInput(ws.id, { title: "A" }));
    // Force a strictly-greater createdAt so list ordering is deterministic
    // even on systems where consecutive Date.now() calls return the same ms.
    await new Promise((r) => setTimeout(r, 5));
    const b = await createPodcast(defaultInput(ws.id, { title: "B" }));
    const list = await listPodcastsByWorkspace(ws.id);
    expect(list.map((p) => p.id)).toEqual([b.id, a.id]);
  });

  it("scopes listPodcastsByWorkspace to the given workspace", async () => {
    const w1 = await createWorkspace({ name: "W1", color: "#0", initials: "W" });
    const w2 = await createWorkspace({ name: "W2", color: "#0", initials: "W" });
    await createPodcast(defaultInput(w1.id, { title: "W1-a" }));
    await createPodcast(defaultInput(w2.id, { title: "W2-a" }));
    const inW1 = await listPodcastsByWorkspace(w1.id);
    expect(inW1).toHaveLength(1);
    expect(inW1[0]?.title).toBe("W1-a");
  });

  it("updatePodcast bumps updatedAt and persists patches", async () => {
    const ws = await createWorkspace({
      name: "QFT",
      color: "#000",
      initials: "QF",
    });
    const rec = await createPodcast(defaultInput(ws.id));
    const before = rec.updatedAt;
    await new Promise((r) => setTimeout(r, 5));
    await updatePodcast(rec.id, { title: "Pilot v2", totalMs: 12_000 });
    const after = await getPodcast(rec.id);
    expect(after?.title).toBe("Pilot v2");
    expect(after?.totalMs).toBe(12_000);
    expect((after?.updatedAt ?? 0) > before).toBe(true);
  });

  it("setPodcastStatus(error) defaults the error message", async () => {
    const ws = await createWorkspace({
      name: "QFT",
      color: "#000",
      initials: "QF",
    });
    const rec = await createPodcast(defaultInput(ws.id));
    await setPodcastStatus(rec.id, "error");
    const after = await getPodcast(rec.id);
    expect(after?.status).toBe("error");
    expect(after?.errorMessage).toBe("Unknown error");
  });

  it("setPodcastBlob / getPodcastBlob round-trips audio", async () => {
    const ws = await createWorkspace({
      name: "QFT",
      color: "#000",
      initials: "QF",
    });
    const rec = await createPodcast(defaultInput(ws.id));
    const blob = new Blob([new Uint8Array([1, 2, 3, 4])], { type: "audio/mpeg" });
    await setPodcastBlob(rec.id, blob, "audio/mpeg");
    const stored = await getPodcastBlob(rec.id);
    expect(stored?.byteSize).toBe(4);
    expect(stored?.contentType).toBe("audio/mpeg");
  });

  it("deletePodcast cascades the audio blob", async () => {
    const ws = await createWorkspace({
      name: "QFT",
      color: "#000",
      initials: "QF",
    });
    const rec = await createPodcast(defaultInput(ws.id));
    await setPodcastBlob(
      rec.id,
      new Blob([new Uint8Array([0])], { type: "audio/mpeg" }),
      "audio/mpeg",
    );
    await deletePodcast(rec.id);
    expect(await getPodcast(rec.id)).toBeNull();
    expect(await getPodcastBlob(rec.id)).toBeNull();
  });

  it("deleteWorkspace cascades both podcasts and their blobs", async () => {
    const ws = await createWorkspace({
      name: "QFT",
      color: "#000",
      initials: "QF",
    });
    const a = await createPodcast(defaultInput(ws.id, { title: "A" }));
    const b = await createPodcast(defaultInput(ws.id, { title: "B" }));
    await setPodcastBlob(
      a.id,
      new Blob([new Uint8Array([1])], { type: "audio/mpeg" }),
      "audio/mpeg",
    );
    await setPodcastBlob(
      b.id,
      new Blob([new Uint8Array([2])], { type: "audio/mpeg" }),
      "audio/mpeg",
    );

    await deleteWorkspace(ws.id);
    expect(await listPodcastsByWorkspace(ws.id)).toHaveLength(0);
    expect(await getPodcastBlob(a.id)).toBeNull();
    expect(await getPodcastBlob(b.id)).toBeNull();
  });
});
