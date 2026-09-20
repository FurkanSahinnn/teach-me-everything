"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

/** Match the server's first render, then expose browser-only controls. */
export function useHydrated(): boolean {
  return useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
}
