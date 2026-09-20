/** Serialize snapshots; the final write waits for every earlier write. */
export function createStreamWriter(read: () => string, write: (text: string) => Promise<unknown>) {
  let tail = Promise.resolve();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let failure: unknown;
  let closed = false;
  const enqueue = () => {
    const value = read();
    tail = tail.then(async () => { await write(value); }).catch((error: unknown) => { failure = error; });
  };
  return {
    schedule() {
      if (closed || timer !== undefined) return;
      timer = setTimeout(() => { timer = undefined; enqueue(); }, 80);
    },
    async finish() {
      closed = true;
      clearTimeout(timer);
      enqueue();
      await tail;
      if (failure) throw failure;
    },
  };
}
