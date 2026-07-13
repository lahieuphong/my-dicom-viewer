// src/lib/viewer/preload.ts
'use client';

export function getPreloadWindow(
  imageIds: string[],
  centerIndex = 0,
  options: { backward?: number; forward?: number; max?: number } = {}
) {
  if (!Array.isArray(imageIds) || imageIds.length === 0) return [];

  const backward = Math.max(0, options.backward ?? 4);
  const forward = Math.max(0, options.forward ?? 16);
  const max = Math.max(1, options.max ?? backward + forward + 1);
  const center = Math.max(0, Math.min(Math.floor(Number(centerIndex) || 0), imageIds.length - 1));
  const windowed: string[] = [imageIds[center]];

  // Decode the frames a user is most likely to request first. Forward frames
  // lead because Cine normally advances through the stack in that direction.
  for (
    let distance = 1;
    windowed.length < max && (distance <= forward || distance <= backward);
    distance += 1
  ) {
    if (distance <= forward && center + distance < imageIds.length) {
      windowed.push(imageIds[center + distance]);
    }
    if (
      windowed.length < max &&
      distance <= backward &&
      center - distance >= 0
    ) {
      windowed.push(imageIds[center - distance]);
    }
  }

  return windowed;
}

export async function loadAndCacheImageWithTimeout(
  imageId?: string | null,
  perLoadTimeoutMs = 8000,
  signal?: AbortSignal | null
): Promise<boolean> {
  if (!imageId) return false;
  if (signal?.aborted) return false;

  let done = false;

  return new Promise<boolean>(async (resolve) => {
    const t = window.setTimeout(() => {
      if (done) return;
      done = true;
      resolve(false);
    }, perLoadTimeoutMs);

    const onAbort = () => {
      if (done) return;
      done = true;
      clearTimeout(t);
      resolve(false);
    };

    try {
      if (signal) signal.addEventListener('abort', onAbort, { once: true });
    } catch {}

    try {
      // 1) Prefer global convenience fn if set by initCornerstone
      try {
        const win = (typeof window !== 'undefined') ? (window as any) : null;
        const globalFn = win?.__cornerstoneImageLoaderFn ?? null;
        if (typeof globalFn === 'function') {
          globalFn(imageId)
            .then(() => {
              if (done) return;
              done = true;
              clearTimeout(t);
              try { signal?.removeEventListener?.('abort', onAbort); } catch {}
              resolve(true);
            })
            .catch((err: any) => {
              if (done) return;
              done = true;
              clearTimeout(t);
              try { signal?.removeEventListener?.('abort', onAbort); } catch {}
              resolve(false);
            });
          return;
        }
      } catch (err) {
      }

      // 2) Try global __cornerstoneCore.imageLoader
      try {
        const win = (typeof window !== 'undefined') ? (window as any) : null;
        const csGlobal = win?.__cornerstoneCore ?? null;
        const loaderFromGlobal = csGlobal?.imageLoader ?? null;
        if (loaderFromGlobal && typeof loaderFromGlobal.loadAndCacheImage === 'function') {
          loaderFromGlobal.loadAndCacheImage(imageId)
            .then(() => {
              if (done) return;
              done = true;
              clearTimeout(t);
              try { signal?.removeEventListener?.('abort', onAbort); } catch {}
              resolve(true);
            })
            .catch((err: any) => {
              if (done) return;
              done = true;
              clearTimeout(t);
              try { signal?.removeEventListener?.('abort', onAbort); } catch {}
              resolve(false);
            });
          return;
        }
      } catch (err) {
      }

      // 3) Dynamic import fallback
      try {
        const cs = await import('@cornerstonejs/core').catch(() => null);
        const dyn = (cs as any)?.imageLoader;
        if (dyn && typeof dyn.loadAndCacheImage === 'function') {
          dyn.loadAndCacheImage(imageId)
            .then(() => {
              if (done) return;
              done = true;
              clearTimeout(t);
              try { signal?.removeEventListener?.('abort', onAbort); } catch {}
              resolve(true);
            })
            .catch((err: any) => {
              if (done) return;
              done = true;
              clearTimeout(t);
              try { signal?.removeEventListener?.('abort', onAbort); } catch {}
              resolve(false);
            });
          return;
        }
      } catch (err) {
      }

      if (!done) {
        done = true;
        clearTimeout(t);
        try { signal?.removeEventListener?.('abort', onAbort); } catch {}
        resolve(false);
      }
    } catch (e) {
      if (!done) {
        done = true;
        clearTimeout(t);
        try { signal?.removeEventListener?.('abort', onAbort); } catch {}
        resolve(false);
      }
    }
  });
}

/**
 * Preload a small set of images with limited concurrency and per-image timeout.
 * Options:
 *  - concurrency
 *  - perLoadTimeoutMs
 *  - limit
 *  - onProgress(loaded, total)
 *  - signal: AbortSignal to cancel
 */
export async function preloadImagesWithTimeout(
  imageIds: string[],
  options: {
    concurrency?: number;
    perLoadTimeoutMs?: number;
    limit?: number;
    onProgress?: (loaded: number, total: number) => void;
    signal?: AbortSignal | null;
  } = {}
) {
  const concurrency = options.concurrency ?? 3;
  const perLoadTimeoutMs = options.perLoadTimeoutMs ?? 8000;
  const limit = options.limit ?? Math.min(6, imageIds.length);
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
  const signal = options.signal ?? null;

  const toLoad = imageIds.slice(0, limit);
  const total = toLoad.length;
  let loadedCount = 0;


  const queue = toLoad.slice();

  const workers = Array.from({ length: Math.max(1, concurrency) }).map(async () => {
    while (queue.length > 0) {
      if (signal?.aborted) {
        return;
      }
      const id = queue.shift();
      if (!id) break;
      await loadAndCacheImageWithTimeout(id, perLoadTimeoutMs, signal).catch(() => false);
      loadedCount += 1;
      try {
        if (onProgress) onProgress(loadedCount, total);
      } catch {}
      try {
      } catch {}
      // also call optional global UI hook if present
      try {
        const w: any = (typeof window !== 'undefined') ? (window as any) : null;
        if (w && typeof w.__viewerLoadingProgress === 'function') {
          try {
            w.__viewerLoadingProgress(Math.round((loadedCount / Math.max(1, total)) * 100));
          } catch {}
        }
      } catch {}
    }
  });

  await Promise.all(workers);

}
