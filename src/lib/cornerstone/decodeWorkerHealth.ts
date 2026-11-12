// Detects dicom-image-loader decode workers that failed to start.
'use client';

/**
 * sessionStorage key holding when the page last reloaded for a broken
 * decode worker, so a worker that keeps failing cannot reload it in a loop.
 */
export const DECODE_WORKER_RELOAD_KEY = 'dicomViewer:decodeWorkerReloadAt';
export const DECODE_WORKER_RELOAD_INTERVAL_MS = 60_000;

type WorkerLike = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

export type DecodeWorkerWatchOptions = {
  /** Reload the page once when a worker fails; set during development. */
  reloadOnFailure: boolean;
  reload: () => void;
  storage?: StorageLike | null;
  now?: () => number;
  report?: (message: string) => void;
};

/**
 * Watches the decode workers until each answers its first message. A worker
 * that reports an error before that never loaded its script: its first
 * decode never settles, so the image it was asked for never appears.
 *
 * On a cold `next dev`, webpack can still be writing the ~1 MB worker chunk
 * when the page creates its workers; every worker then gets a truncated
 * script and fails with a SyntaxError. A reload after the chunk is written
 * fixes it, so during development the page reloads once (at most once per
 * DECODE_WORKER_RELOAD_INTERVAL_MS). Otherwise, and when a reload already
 * happened recently, the failure is reported instead.
 *
 * Returns a function that stops watching.
 */
export function watchDecodeWorkers(
  workers: readonly WorkerLike[],
  {
    reloadOnFailure,
    reload,
    storage = null,
    now = Date.now,
    report = (message) => console.error(message),
  }: DecodeWorkerWatchOptions
): () => void {
  const stops: Array<() => void> = [];
  const stopAll = () => {
    for (const stop of stops.splice(0)) stop();
  };

  // The first failure ends the watch, so the other workers' failures are
  // not handled again.
  const onFailure = () => {
    stopAll();

    const lastReloadAt = Number(readItem(storage, DECODE_WORKER_RELOAD_KEY));
    const reloadedRecently =
      Number.isFinite(lastReloadAt) &&
      lastReloadAt > 0 &&
      now() - lastReloadAt < DECODE_WORKER_RELOAD_INTERVAL_MS;

    if (reloadOnFailure && !reloadedRecently) {
      writeItem(storage, DECODE_WORKER_RELOAD_KEY, String(now()));
      report('[viewer] A DICOM decode worker failed to start; reloading the page once.');
      reload();
      return;
    }
    report(
      '[viewer] A DICOM decode worker failed to start, so images may never ' +
        'decode. Reload the page; if it persists, check that the worker ' +
        'script is served completely.'
    );
  };

  for (const worker of workers) {
    const onMessage = () => stop();
    const onError = () => onFailure();
    const stop = () => {
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
    };
    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
    stops.push(stop);
  }

  return stopAll;
}

function readItem(storage: StorageLike | null, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writeItem(storage: StorageLike | null, key: string, value: string) {
  try {
    storage?.setItem(key, value);
  } catch {}
}
