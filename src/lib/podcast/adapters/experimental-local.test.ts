import { describe, expect, it } from "vitest";
import { getAdapter, TtsAdapterError } from "../adapter";
import "./index";

describe("experimental local TTS adapters", () => {
  it.each(["kokoro", "xtts", "vibevoice"] as const)(
    "registers %s with an explicit readiness state",
    async (providerId) => {
      const adapter = getAdapter(providerId);

      await expect(adapter.checkReadiness()).resolves.toMatchObject({
        kind: "not-supported-on-platform",
      });
      expect(adapter.listVoices().length).toBeGreaterThan(0);
    },
  );

  it("fails synthesis with a structured adapter error instead of registry failure", async () => {
    const adapter = getAdapter("kokoro");

    await expect(
      adapter.synthesize({ text: "Merhaba", voiceId: "kokoro-af_heart" }),
    ).rejects.toMatchObject({
      code: "not_ready",
      providerId: "kokoro",
    } satisfies Partial<TtsAdapterError>);
  });
});
