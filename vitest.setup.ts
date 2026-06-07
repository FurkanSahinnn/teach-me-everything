// Global test setup. Loaded once per worker before any test file.
// Order matters: indexeddb shim must be present before any module that
// touches `indexedDB` at import time (Dexie does on `new TmeDb()`).
import "fake-indexeddb/auto";
import "@testing-library/jest-dom/vitest";

import { webcrypto } from "node:crypto";

if (typeof globalThis.crypto === "undefined" || !globalThis.crypto.subtle) {
  Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
    configurable: true,
  });
}

// jsdom does not implement structuredClone in older versions; Dexie uses it
// internally for some serialization paths. Node 20+ has it natively, but the
// jsdom env wipes the Node global, so re-attach when missing.
if (typeof globalThis.structuredClone === "undefined") {
  (globalThis as { structuredClone: (v: unknown) => unknown }).structuredClone =
    (v: unknown) => JSON.parse(JSON.stringify(v)) as unknown;
}
