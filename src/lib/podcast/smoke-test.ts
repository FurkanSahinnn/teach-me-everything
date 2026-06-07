import type { SynthesizeResult, TtsAdapter } from "./adapter";
import type { VoicePickerEntry } from "./voices";

export const SMOKE_TEST_MIN_AUDIO_BYTES = 44;

const SMOKE_TEST_TEXT: Record<"tr" | "en", string> = {
  tr: "Merhaba, ben {name}. Bu kısa örnek, ses modelinin doğru kurulduğunu ve oynatılabilir ses ürettiğini kontrol eder.",
  en: "Hello, I'm {name}. This short sample checks that the voice model is installed and can generate playable audio.",
};

export type RunTtsSmokeTestArgs = {
  adapter: TtsAdapter;
  voice: VoicePickerEntry;
  signal?: AbortSignal | undefined;
};

export function buildSmokeTestText(voice: VoicePickerEntry): string {
  const locale: "tr" | "en" = voice.nativeLocale === "tr" ? "tr" : "en";
  return SMOKE_TEST_TEXT[locale].replace("{name}", voice.name);
}

export async function runTtsSmokeTest(
  args: RunTtsSmokeTestArgs,
): Promise<SynthesizeResult> {
  const result = await args.adapter.synthesize({
    text: buildSmokeTestText(args.voice),
    voiceId: args.voice.voiceId,
    signal: args.signal,
  });
  assertSmokeTestResult(result);
  return result;
}

export function assertSmokeTestResult(result: SynthesizeResult): void {
  if (!result.mimeType.toLowerCase().startsWith("audio/")) {
    throw new Error(`Unsupported smoke test audio type: ${result.mimeType}`);
  }
  if (result.audio.byteLength < SMOKE_TEST_MIN_AUDIO_BYTES) {
    throw new Error("TTS smoke test produced empty audio.");
  }
}
