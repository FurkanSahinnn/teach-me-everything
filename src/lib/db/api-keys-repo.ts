// Phase 9 — Master-password vault removed.
//
// Five CRUD entry points (setApiKey / getApiKey / hasApiKey / deleteApiKey /
// listStoredProviders) dispatch between two credential backends:
//
//   • Tauri  → OS-native keychain (Phase 8 — keyring-rs under com.tme.byok)
//   • Web    → IndexedDB plaintext (dev-only; web build is not distributed)
//
// Backend selection short-circuits via `isKeychainAvailable()` so the web
// bundle never imports keychain code paths at runtime. The web path has no
// at-rest encryption: TME is distributed exclusively as a Tauri binary via
// GitHub Releases, and the web build only runs during `npm run dev`. The
// same-origin sandbox is the trust boundary — any JS on the same origin
// can already read these regardless of encryption-at-rest.
//
// `_setCredentialBackendForTests` lets Vitest pin a specific path without
// touching `window.__TAURI__`.

import {
  isKeychainAvailable,
  keychainDelete,
  keychainGet,
  keychainList,
  keychainSet,
} from "@/lib/crypto/keychain";
import { db, type Provider } from "./schema";

export type CredentialBackend = "keychain" | "dexie";

let backendOverride: CredentialBackend | null = null;

function activeBackend(): CredentialBackend {
  if (backendOverride !== null) return backendOverride;
  return isKeychainAvailable() ? "keychain" : "dexie";
}

/**
 * Test seam — pin the credential backend for a single test.
 * Pass `null` to clear and re-resolve via `isKeychainAvailable()`.
 */
export function _setCredentialBackendForTests(
  backend: CredentialBackend | null,
): void {
  backendOverride = backend;
}

// -- Dexie (web) backend implementation ------------------------------

async function setApiKeyDexie(
  provider: Provider,
  plaintext: string,
): Promise<void> {
  const trimmed = plaintext.trim();
  if (!trimmed) {
    await db.apiKeys.delete(provider);
    return;
  }
  await db.apiKeys.put({
    provider,
    plaintext: trimmed,
    updatedAt: Date.now(),
  });
}

async function getApiKeyDexie(provider: Provider): Promise<string | null> {
  const record = await db.apiKeys.get(provider);
  return record?.plaintext ?? null;
}

async function hasApiKeyDexie(provider: Provider): Promise<boolean> {
  const record = await db.apiKeys.get(provider);
  return record !== undefined;
}

async function deleteApiKeyDexie(provider: Provider): Promise<void> {
  await db.apiKeys.delete(provider);
}

async function listStoredProvidersDexie(): Promise<Provider[]> {
  const all = await db.apiKeys.toArray();
  return all.map((row) => row.provider);
}

// -- Keychain (Tauri) backend implementation -------------------------

async function setApiKeyKeychain(
  provider: Provider,
  plaintext: string,
): Promise<void> {
  const trimmed = plaintext.trim();
  if (!trimmed) {
    await keychainDelete(provider);
    return;
  }
  await keychainSet(provider, trimmed);
}

async function getApiKeyKeychain(provider: Provider): Promise<string | null> {
  return keychainGet(provider);
}

async function hasApiKeyKeychain(provider: Provider): Promise<boolean> {
  const list = await keychainList();
  return list.includes(provider);
}

async function deleteApiKeyKeychain(provider: Provider): Promise<void> {
  await keychainDelete(provider);
}

async function listStoredProvidersKeychain(): Promise<Provider[]> {
  const list = await keychainList();
  return list as Provider[];
}

// -- Public dispatching API -----------------------------------------

export async function setApiKey(
  provider: Provider,
  plaintext: string,
): Promise<void> {
  if (activeBackend() === "keychain") {
    await setApiKeyKeychain(provider, plaintext);
    return;
  }
  await setApiKeyDexie(provider, plaintext);
}

export async function getApiKey(provider: Provider): Promise<string | null> {
  if (activeBackend() === "keychain") {
    return getApiKeyKeychain(provider);
  }
  return getApiKeyDexie(provider);
}

export async function hasApiKey(provider: Provider): Promise<boolean> {
  if (activeBackend() === "keychain") {
    return hasApiKeyKeychain(provider);
  }
  return hasApiKeyDexie(provider);
}

export async function deleteApiKey(provider: Provider): Promise<void> {
  if (activeBackend() === "keychain") {
    await deleteApiKeyKeychain(provider);
    return;
  }
  await deleteApiKeyDexie(provider);
}

export async function listStoredProviders(): Promise<Provider[]> {
  if (activeBackend() === "keychain") {
    return listStoredProvidersKeychain();
  }
  return listStoredProvidersDexie();
}
