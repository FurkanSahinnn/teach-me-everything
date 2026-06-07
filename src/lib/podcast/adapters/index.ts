// Phase 11.A — Adapter registry boot.
//
// Side-effect imports register each adapter on module load via
// `registerAdapter()`. Anything that needs an adapter resolves it
// through `getActiveAdapter(prefs)`; importing this module once
// (e.g. from `synthesize.ts`) is enough to populate the registry for
// the rest of the runtime.

import "./web-speech";
import "./piper";
import "./experimental-local";

import {
  getAdapter,
  type TtsAdapter,
  type TtsProviderId,
} from "../adapter";

export function getActiveAdapter(providerId: TtsProviderId): TtsAdapter {
  return getAdapter(providerId);
}
