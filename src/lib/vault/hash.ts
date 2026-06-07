// Phase 7.4.A — SHA-256 content fingerprint used by the reconciliation
// engine to decide whether a disk file and its Dexie counterpart carry
// the same payload. Async by necessity (Web Crypto is async); works in
// both the Tauri webview (which exposes window.crypto.subtle) and the
// Vitest node runtime (Node 20+ exposes globalThis.crypto.subtle).
//
// `hashNormalizedContent` is the production entry point — always hash the
// normalised string so a BOM or CRLF on either side doesn't trip the
// equality check.

import { normalizeForRead } from "./normalise";

export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const buf = await getSubtle().digest("SHA-256", bytes);
  return bytesToHex(new Uint8Array(buf));
}

export async function hashNormalizedContent(text: string): Promise<string> {
  return sha256Hex(normalizeForRead(text));
}

function getSubtle(): SubtleCrypto {
  const subtle = (globalThis as { crypto?: { subtle?: SubtleCrypto } }).crypto
    ?.subtle;
  if (!subtle) {
    throw new Error(
      "Web Crypto subtle API unavailable — environment lacks crypto.subtle",
    );
  }
  return subtle;
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}
