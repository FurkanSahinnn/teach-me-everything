import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  _setWatcherImplForTests,
  filterEvents,
  isLockFile,
  isMarkdownPath,
  isTempFile,
  normaliseTauriEvents,
  startVaultWatcher,
  type VaultWatchEvent,
  type VaultWatcherImpl,
} from "./watcher";
import {
  _clearRecentWritesForTests,
  _setNowForTests,
  markRecentWrite,
} from "./watcher-suppression";

afterEach(() => {
  _setWatcherImplForTests(null);
  _clearRecentWritesForTests();
  _setNowForTests(null);
});

describe("vault/watcher path predicates", () => {
  it("isMarkdownPath: only `.md` at end-of-string", () => {
    expect(isMarkdownPath("/v/a.md")).toBe(true);
    expect(isMarkdownPath("/v/a.MD")).toBe(true);
    expect(isMarkdownPath("/v/a.txt")).toBe(false);
    expect(isMarkdownPath("/v/a.md.tmp.abc")).toBe(false);
    expect(isMarkdownPath("/v/markdown")).toBe(false);
  });

  it("isTempFile: atomic-write tmp suffix on POSIX and Windows", () => {
    expect(isTempFile("/v/a.md.tmp.abc123")).toBe(true);
    expect(isTempFile("C:\\v\\a.md.tmp.x1y2")).toBe(true);
    expect(isTempFile("/v/a.md")).toBe(false);
    expect(isTempFile("/v/.tmp")).toBe(false);
    expect(isTempFile("/v/a.tmp")).toBe(false);
  });

  it("isLockFile: bare or path-terminating `.tme-lock`", () => {
    expect(isLockFile("/v/.tme-lock")).toBe(true);
    expect(isLockFile("C:\\v\\.tme-lock")).toBe(true);
    expect(isLockFile(".tme-lock")).toBe(true);
    expect(isLockFile("/v/note.md")).toBe(false);
    expect(isLockFile("/v/.tme-lock.bak")).toBe(false);
  });
});

describe("vault/watcher filterEvents", () => {
  it("keeps `.md` events", () => {
    const events: VaultWatchEvent[] = [
      { kind: "modify", path: "/v/a.md" },
    ];
    expect(filterEvents(events)).toEqual(events);
  });

  it("drops non-`.md` create/modify events", () => {
    expect(
      filterEvents([
        { kind: "modify", path: "/v/a.txt" },
        { kind: "create", path: "/v/a.md" },
      ]),
    ).toEqual([{ kind: "create", path: "/v/a.md" }]);
  });

  it("passes non-`.md` REMOVE events through for folder-cascade expansion (Phase 7.4.E)", () => {
    expect(
      filterEvents([
        { kind: "remove", path: "/v/Sub" },
        { kind: "remove", path: "/v/Other.md" },
      ]),
    ).toEqual([
      { kind: "remove", path: "/v/Sub" },
      { kind: "remove", path: "/v/Other.md" },
    ]);
  });

  it("drops tmp-file events", () => {
    expect(
      filterEvents([
        { kind: "create", path: "/v/a.md.tmp.abc" },
        { kind: "modify", path: "/v/a.md" },
      ]),
    ).toEqual([{ kind: "modify", path: "/v/a.md" }]);
  });

  it("drops `.tme-lock` events", () => {
    expect(
      filterEvents([
        { kind: "create", path: "/v/.tme-lock" },
        { kind: "modify", path: "/v/a.md" },
      ]),
    ).toEqual([{ kind: "modify", path: "/v/a.md" }]);
  });

  it("drops events for recently-suppressed paths", () => {
    _setNowForTests(() => 1000);
    markRecentWrite("/v/a.md", 2000);
    expect(
      filterEvents([
        { kind: "modify", path: "/v/a.md" },
        { kind: "modify", path: "/v/b.md" },
      ]),
    ).toEqual([{ kind: "modify", path: "/v/b.md" }]);
  });

  it("returns [] when every event is filtered", () => {
    expect(
      filterEvents([
        { kind: "modify", path: "/v/a.txt" },
        { kind: "create", path: "/v/.tme-lock" },
      ]),
    ).toEqual([]);
  });
});

describe("vault/watcher normaliseTauriEvents", () => {
  it("normalises a single create event with one path", () => {
    expect(
      normaliseTauriEvents({
        type: { create: { kind: "file" } },
        paths: ["/v/a.md"],
      }),
    ).toEqual([{ kind: "create", path: "/v/a.md" }]);
  });

  it("normalises a string-kind event (Tauri shorthand)", () => {
    expect(
      normaliseTauriEvents({ type: "modify", paths: ["/v/a.md"] }),
    ).toEqual([{ kind: "modify", path: "/v/a.md" }]);
  });

  it("handles arrays from the debounce window", () => {
    expect(
      normaliseTauriEvents([
        { type: { modify: {} }, paths: ["/v/a.md"] },
        { type: { create: {} }, paths: ["/v/b.md"] },
      ]),
    ).toEqual([
      { kind: "modify", path: "/v/a.md" },
      { kind: "create", path: "/v/b.md" },
    ]);
  });

  it("maps unknown kinds to `other`", () => {
    expect(
      normaliseTauriEvents({ type: { access: {} }, paths: ["/v/a.md"] }),
    ).toEqual([{ kind: "other", path: "/v/a.md" }]);
  });

  it("ignores malformed shapes", () => {
    expect(normaliseTauriEvents(null)).toEqual([]);
    expect(normaliseTauriEvents("garbage")).toEqual([]);
    expect(normaliseTauriEvents({ type: "modify" })).toEqual([]); // no paths
    expect(
      normaliseTauriEvents({ type: "modify", paths: [123, null, ""] }),
    ).toEqual([]); // all paths invalid
  });

  it("emits one event per path when a Tauri event lists multiple paths", () => {
    expect(
      normaliseTauriEvents({
        type: "modify",
        paths: ["/v/a.md", "/v/b.md"],
      }),
    ).toEqual([
      { kind: "modify", path: "/v/a.md" },
      { kind: "modify", path: "/v/b.md" },
    ]);
  });
});

describe("vault/watcher startVaultWatcher", () => {
  let started: Array<{
    rootPath: string;
    opts: { recursive: boolean; delayMs: number };
  }>;
  let triggerEvents: ((events: VaultWatchEvent[]) => void) | null;
  let unwatchCalled: boolean;

  beforeEach(() => {
    started = [];
    triggerEvents = null;
    unwatchCalled = false;
    const impl: VaultWatcherImpl = {
      watch: async (rootPath, cb, opts) => {
        started.push({ rootPath, opts });
        triggerEvents = cb;
        return async () => {
          unwatchCalled = true;
        };
      },
    };
    _setWatcherImplForTests(impl);
  });

  it("subscribes with recursive=true and delayMs=500 by default", async () => {
    await startVaultWatcher({ rootPath: "/vault", onChange: () => {} });
    expect(started).toHaveLength(1);
    expect(started[0]!.rootPath).toBe("/vault");
    expect(started[0]!.opts).toEqual({ recursive: true, delayMs: 500 });
  });

  it("forwards filtered events to onChange", async () => {
    const received: VaultWatchEvent[][] = [];
    await startVaultWatcher({
      rootPath: "/vault",
      onChange: (events) => received.push(events),
    });
    triggerEvents!([
      { kind: "modify", path: "/v/a.txt" },
      { kind: "create", path: "/v/a.md.tmp.abc" },
      { kind: "modify", path: "/v/note.md" },
    ]);
    expect(received).toEqual([[{ kind: "modify", path: "/v/note.md" }]]);
  });

  it("skips onChange when every event is filtered out", async () => {
    const received: VaultWatchEvent[][] = [];
    await startVaultWatcher({
      rootPath: "/vault",
      onChange: (events) => received.push(events),
    });
    triggerEvents!([
      { kind: "modify", path: "/v/a.txt" },
      { kind: "create", path: "/v/a.md.tmp.abc" },
    ]);
    expect(received).toEqual([]);
  });

  it("stop() awaits the underlying unwatch", async () => {
    const handle = await startVaultWatcher({
      rootPath: "/vault",
      onChange: () => {},
    });
    expect(unwatchCalled).toBe(false);
    await handle.stop();
    expect(unwatchCalled).toBe(true);
  });

  it("honours custom delayMs / recursive options", async () => {
    await startVaultWatcher({
      rootPath: "/vault",
      onChange: () => {},
      delayMs: 1000,
      recursive: false,
    });
    expect(started[0]!.opts).toEqual({ recursive: false, delayMs: 1000 });
  });
});
