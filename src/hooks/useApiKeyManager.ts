"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  deleteApiKey,
  getApiKey,
  listStoredProviders,
  setApiKey,
} from "@/lib/db/api-keys-repo";
import { type Provider } from "@/lib/db/schema";

const DEFAULT_PROVIDERS: Provider[] = [
  "anthropic",
  "claude-code-oauth",
  "openai",
  "firecrawl",
];

// Partial because the literal union now spans 19+ presets + `custom:${string}`;
// every read site already coalesces with `?? ""`.
type Drafts = Partial<Record<Provider, string>>;

function emptyDrafts(): Drafts {
  return {};
}

export type UseApiKeyManager = ReturnType<typeof useApiKeyManager>;

function noop(): void {}

export function useApiKeyManager(providers: Provider[] = DEFAULT_PROVIDERS) {
  const [drafts, setDrafts] = useState<Drafts>(emptyDrafts);
  const [initial, setInitial] = useState<Drafts>(emptyDrafts);
  const [stored, setStored] = useState<Provider[]>([]);
  const [storedLoaded, setStoredLoaded] = useState(false);
  const providersRef = useRef(providers);
  providersRef.current = providers;

  const refreshStored = useCallback(async () => {
    setStoredLoaded(false);
    const list = await listStoredProviders();
    setStored(list);
    setStoredLoaded(true);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void listStoredProviders().then((list) => {
      if (!cancelled) {
        setStored(list);
        setStoredLoaded(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void Promise.all(
      providers.map(async (provider) => {
        const value = await getApiKey(provider);
        return [provider, value ?? ""] as const;
      }),
    ).then((entries) => {
      if (cancelled) return;
      setDrafts((prev) => {
        const next = { ...prev };
        for (const [provider, value] of entries) next[provider] = value;
        return next;
      });
      setInitial((prev) => {
        const next = { ...prev };
        for (const [provider, value] of entries) next[provider] = value;
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [providers]);

  const setDraft = useCallback((provider: Provider, value: string) => {
    setDrafts((prev) => ({ ...prev, [provider]: value }));
  }, []);

  const save = useCallback(
    async (provider: Provider) => {
      const value = drafts[provider] ?? "";
      await setApiKey(provider, value);
      setInitial((prev) => ({ ...prev, [provider]: value }));
      await refreshStored();
    },
    [drafts, refreshStored],
  );

  const saveAll = useCallback(async () => {
    for (const provider of providers) {
      const next = drafts[provider] ?? "";
      if (next !== (initial[provider] ?? "")) {
        await setApiKey(provider, next);
      }
    }
    setInitial((prev) => ({ ...prev, ...drafts }));
    await refreshStored();
  }, [drafts, initial, providers, refreshStored]);

  const remove = useCallback(
    async (provider: Provider) => {
      await deleteApiKey(provider);
      setDrafts((prev) => ({ ...prev, [provider]: "" }));
      setInitial((prev) => ({ ...prev, [provider]: "" }));
      await refreshStored();
    },
    [refreshStored],
  );

  const isDirty = useCallback(
    (provider: Provider) =>
      (drafts[provider] ?? "") !== (initial[provider] ?? ""),
    [drafts, initial],
  );

  const isStored = useCallback(
    (provider: Provider) => stored.includes(provider),
    [stored],
  );

  const hasAnyDirty = providers.some(
    (provider) => (drafts[provider] ?? "") !== (initial[provider] ?? ""),
  );

  return {
    drafts,
    setDraft,
    save,
    saveAll,
    remove,
    isDirty,
    isStored,
    storedLoaded,
    hasAnyDirty,
    // Phase 9 — Legacy stubs. Pre-Phase-9 the hook gated on `isUnlocked` and
    // surfaced a master-password modal. Now keys are stored without gating
    // (keychain on Tauri, plaintext Dexie on web) so these fields exist only
    // so the consumer JSX continues to compile until consumers are cleaned up.
    isUnlocked: true as const,
    modalOpen: false as const,
    setModalOpen: noopBool,
    onUnlockSuccess: noop,
  };
}

function noopBool(_open: boolean): void {}
