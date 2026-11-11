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
  const draftsRef = useRef<Drafts>({});
  const initialRef = useRef<Drafts>({});
  const providersRef = useRef(providers);
  useEffect(() => { providersRef.current = providers; }, [providers]);

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
        for (const [provider, value] of entries) {
          if (next[provider] === undefined) next[provider] = value;
        }
        draftsRef.current = next;
        return next;
      });
      setInitial((prev) => {
        const next = { ...prev };
        for (const [provider, value] of entries) next[provider] = value;
        initialRef.current = next;
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [providers]);

  const setDraft = useCallback((provider: Provider, value: string) => {
    draftsRef.current = { ...draftsRef.current, [provider]: value };
    setDrafts((prev) => {
      const next = { ...prev, [provider]: value };
      draftsRef.current = next;
      return next;
    });
  }, []);

  const save = useCallback(
    async (provider: Provider, overrideValue?: string) => {
      const value =
        overrideValue !== undefined
          ? overrideValue
          : (draftsRef.current[provider] ?? drafts[provider] ?? "");
      await setApiKey(provider, value);
      if (overrideValue !== undefined) {
        draftsRef.current = { ...draftsRef.current, [provider]: value };
        setDrafts((prev) => ({ ...prev, [provider]: value }));
      }
      initialRef.current = { ...initialRef.current, [provider]: value };
      setInitial((prev) => ({ ...prev, [provider]: value }));
      await refreshStored();
    },
    [drafts, refreshStored],
  );

  const saveAll = useCallback(async () => {
    const currentDrafts = draftsRef.current;
    const currentInitial = initialRef.current;
    for (const provider of providersRef.current) {
      const next = currentDrafts[provider] ?? "";
      if (next !== (currentInitial[provider] ?? "")) {
        await setApiKey(provider, next);
      }
    }
    const nextInitial = { ...currentInitial, ...currentDrafts };
    initialRef.current = nextInitial;
    setInitial(nextInitial);
    await refreshStored();
  }, [refreshStored]);

  const remove = useCallback(
    async (provider: Provider) => {
      await deleteApiKey(provider);
      draftsRef.current = { ...draftsRef.current, [provider]: "" };
      initialRef.current = { ...initialRef.current, [provider]: "" };
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

const noopBool: (open: boolean) => void = () => {};
