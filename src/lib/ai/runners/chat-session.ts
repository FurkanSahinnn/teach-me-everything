import { useMemo, useSyncExternalStore } from "react";

export type ChatRunStatus =
  | { kind: "idle" }
  | { kind: "preparing" }
  | { kind: "streaming"; messageId: string }
  | { kind: "error"; code: string; message: string };

/** Owns a turn independently of its React view. Unsubscribe never means Stop. */
export class ChatSession {
  private snapshot: { status: ChatRunStatus; threadId?: string } = { status: { kind: "idle" } };
  private listeners = new Set<() => void>();
  private running = false;
  private controller: { abort: () => void } | null = null;
  cancelled = false;

  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private publish() { for (const listener of this.listeners) listener(); }
  setStatus = (status: ChatRunStatus) => {
    this.snapshot = { ...this.snapshot, status };
    this.publish();
  };
  bindThread(id: string) {
    this.snapshot = { ...this.snapshot, threadId: id };
    this.publish();
  }
  get current() { return this.controller; }
  set current(controller: { abort: () => void } | null) {
    this.controller = controller;
    if (this.cancelled) controller?.abort();
  }
  cancel = () => {
    if (!this.running || this.cancelled) return;
    this.cancelled = true;
    this.controller?.abort();
  };
  get isObserved() { return this.listeners.size > 0; }
  get isRunning() { return this.running; }
  async run(task: () => Promise<void>, errorMessage: string) {
    if (this.running) return;
    this.running = true;
    this.cancelled = false;
    this.setStatus({ kind: "preparing" });
    try {
      await task();
    } catch {
      if (!this.cancelled) this.controller?.abort();
      // Never expose provider payloads or credentials through unexpected errors.
      this.setStatus({ kind: "error", code: "unknown", message: errorMessage });
    } finally {
      this.controller = null;
      this.running = false;
      if (this.cancelled || this.snapshot.status.kind !== "error") {
        this.setStatus({ kind: "idle" });
      }
    }
  }
}

const sessions = new Map<string, ChatSession>();
export function useChatSession(key: string) {
  const session = useMemo(() => {
    let value = sessions.get(key);
    if (!value) { value = new ChatSession(); sessions.set(key, value); }
    return value;
  }, [key]);
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  return { session, ...snapshot };
}
