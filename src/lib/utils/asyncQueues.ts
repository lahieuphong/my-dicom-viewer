// src/lib/utils/asyncQueues.ts
// Framework-free helpers for serialising user-triggered async work.

type LatestWinsQueueOptions<T> = {
  run: (item: T) => unknown;
  /** Checked when an item is queued and again right before it runs. */
  shouldSkip?: (item: T) => boolean;
};

/**
 * Runs one task at a time and keeps only the latest pending item. Calls made
 * while a task runs collapse into a single follow-up run with the last item,
 * so rapid clicks stay ordered and the final one is never dropped.
 */
export function createLatestWinsQueue<T>({
  run,
  shouldSkip = () => false,
}: LatestWinsQueueOptions<T>) {
  let pending: { item: T } | null = null;
  let running: Promise<void> | null = null;

  const drain = async () => {
    while (pending) {
      const { item } = pending;
      pending = null;
      if (shouldSkip(item)) continue;
      try {
        await run(item);
      } catch {
        // One failed task must not stop the items queued after it.
      }
    }
  };

  return {
    /** Resolves when the queue is idle again. */
    enqueue(item: T): Promise<void> {
      if (shouldSkip(item)) return Promise.resolve();
      pending = { item };
      if (running) return running;
      running = drain().finally(() => {
        running = null;
      });
      return running;
    },
    /** Forgets the pending item when it matches; a running task continues. */
    dropPending(predicate: (item: T) => boolean) {
      if (pending && predicate(pending.item)) pending = null;
    },
    isRunning() {
      return running !== null;
    },
  };
}

/**
 * Shares one in-flight promise per key: calling `run` again for a key whose
 * task has not settled returns that task's promise instead of starting a
 * second one.
 */
export function createSingleFlight<K, V>() {
  const inFlight = new Map<K, Promise<V>>();

  return {
    run(key: K, task: () => Promise<V>): Promise<V> {
      const existing = inFlight.get(key);
      if (existing) return existing;

      const promise = task();
      inFlight.set(key, promise);
      const release = () => {
        if (inFlight.get(key) === promise) inFlight.delete(key);
      };
      void promise.then(release, release);
      return promise;
    },
    clear() {
      inFlight.clear();
    },
  };
}
