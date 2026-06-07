import { afterEach, describe, expect, it } from "vitest";
import {
  _setTauriInvokeForTests,
  piperAdapter,
} from "./piper";

type TestInvoke = Parameters<typeof _setTauriInvokeForTests>[0];

function wavBytes(): number[] {
  return [
    82, 73, 70, 70, // RIFF
    40, 0, 0, 0,
    87, 65, 86, 69, // WAVE
    102, 109, 116, 32,
    16, 0, 0, 0,
    1, 0,
    1, 0,
    34, 86, 0, 0,
    68, 172, 0, 0,
    2, 0,
    16, 0,
    100, 97, 116, 97,
    4, 0, 0, 0,
    0, 0, 0, 0,
  ];
}

afterEach(() => {
  _setTauriInvokeForTests(null);
});

describe("piperAdapter.synthesize", () => {
  it("normalizes object-shaped IPC byte payloads into playable WAV bytes", async () => {
    const bytes = wavBytes();
    _setTauriInvokeForTests((async () => {
      return Object.fromEntries(bytes.map((byte, index) => [index, byte]));
    }) as TestInvoke);

    const result = await piperAdapter.synthesize({
      text: "Hello",
      voiceId: "en_US-ryan-medium",
    });

    expect(result.mimeType).toBe("audio/wav");
    expect(Array.from(new Uint8Array(result.audio).slice(0, 12))).toEqual(
      bytes.slice(0, 12),
    );
  });

  it("rejects malformed IPC byte payloads before the UI creates an Audio source", async () => {
    _setTauriInvokeForTests((async () => ({ unexpected: true })) as TestInvoke);

    await expect(
      piperAdapter.synthesize({
        text: "Hello",
        voiceId: "en_US-ryan-medium",
      }),
    ).rejects.toMatchObject({
      code: "synthesis_failed",
      providerId: "piper",
    });
  });
});
