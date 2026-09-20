import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChatSession, useChatSession } from "./chat-session";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("chat ownership across navigation", () => {
  it("keeps producing with no view and reconnects Stop to the original request", async () => {
    const key = "navigation-test";
    const first = renderHook(() => useChatSession(key));
    const session = first.result.current.session;
    const done = deferred();
    const abort = vi.fn(done.resolve);
    let run!: Promise<void>;
    act(() => {
      run = session.run(async () => {
        session.bindThread("original-thread");
        session.current = { abort };
        session.setStatus({ kind: "streaming", messageId: "first" });
        await done.promise;
      }, "failed");
    });
    first.unmount();
    expect(abort).not.toHaveBeenCalled();
    session.setStatus({ kind: "streaming", messageId: "next-tool-round" });
    const second = renderHook(() => useChatSession(key));
    expect(second.result.current.threadId).toBe("original-thread");
    expect(second.result.current.status).toEqual({ kind: "streaming", messageId: "next-tool-round" });
    await act(async () => { second.result.current.session.cancel(); await run; });
    expect(abort).toHaveBeenCalledTimes(1);
    expect(second.result.current.status.kind).toBe("idle");
    second.unmount();
  });

  it("completes normally while away without marking the response interrupted", async () => {
    const view = renderHook(() => useChatSession("completion-test"));
    const session = view.result.current.session;
    const done = deferred();
    let run!: Promise<void>;
    act(() => { run = session.run(() => done.promise, "failed"); });
    view.unmount();
    done.resolve();
    await run;
    const returned = renderHook(() => useChatSession("completion-test"));
    expect(returned.result.current.status.kind).toBe("idle");
    expect(session.cancelled).toBe(false);
    returned.unmount();
  });

  it("latches Stop during preparation and prevents overlapping runs until cleanup finishes", async () => {
    const session = new ChatSession();
    const prepare = deferred();
    const cleanup = deferred();
    const abort = vi.fn();
    const run = session.run(async () => {
      await prepare.promise;
      session.current = { abort };
      await cleanup.promise;
    }, "failed");
    session.cancel();
    session.cancel();
    const duplicate = vi.fn();
    await session.run(duplicate, "failed");
    expect(duplicate).not.toHaveBeenCalled();
    prepare.resolve();
    await prepare.promise;
    expect(abort).toHaveBeenCalledTimes(1);
    cleanup.resolve();
    await run;
    await session.run(async () => { expect(session.cancelled).toBe(false); }, "failed");
    expect(session.getSnapshot().status.kind).toBe("idle");
  });

  it("isolates Stop by source/workspace and recovers from unexpected failures", async () => {
    const a = new ChatSession();
    const b = new ChatSession();
    const done = deferred();
    const abort = vi.fn();
    const running = b.run(async () => { b.current = { abort }; await done.promise; }, "failed");
    a.cancel();
    expect(abort).not.toHaveBeenCalled();
    await a.run(async () => { throw new Error("private provider payload"); }, "safe error");
    expect(a.getSnapshot().status).toEqual({ kind: "error", code: "unknown", message: "safe error" });
    await a.run(async () => {}, "failed");
    expect(a.getSnapshot().status.kind).toBe("idle");
    done.resolve();
    await running;
  });

  it("cancels the latest tool round after a route key changes and returns", async () => {
    const view = renderHook(({ scope }) => useChatSession(scope), { initialProps: { scope: "tool-round-source" } });
    const original = view.result.current.session;
    const done = deferred();
    const firstAbort = vi.fn();
    const secondAbort = vi.fn(done.resolve);
    let run!: Promise<void>;
    act(() => {
      run = original.run(async () => {
        original.current = { abort: firstAbort };
        await done.promise;
      }, "failed");
    });
    view.rerender({ scope: "different-source" });
    act(() => { view.result.current.session.cancel(); });
    expect(firstAbort).not.toHaveBeenCalled();
    original.current = null;
    original.current = { abort: secondAbort };
    view.rerender({ scope: "tool-round-source" });
    await act(async () => { view.result.current.session.cancel(); await run; });
    expect(firstAbort).not.toHaveBeenCalled();
    expect(secondAbort).toHaveBeenCalledTimes(1);
    view.unmount();
  });
});
