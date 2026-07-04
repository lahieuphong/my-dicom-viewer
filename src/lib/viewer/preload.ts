// src/lib/viewer/preload.ts
'use client';

function pushViewerLog(evt: string, payload: Record<string, any> = {}) {
  try {
    const w: any = (typeof window !== 'undefined') ? (window as any) : null;
    if (!w) return;
    w.__viewerLog = w.__viewerLog || [];
    w.__viewerLog.push({ t: Date.now(), evt, ...payload });
    // Keep the log size bounded
    if (w.__viewerLog.length > 4000) w.__viewerLog.splice(0, w.__viewerLog.length - 4000);
  } catch {
    // swallow
  }
}

export async function loadAndCacheImageWithTimeout(
  imageId?: string | null,
  perLoadTimeoutMs = 8000,
  signal?: AbortSignal | null
): Promise<boolean> {
  if (!imageId) return false;
  if (signal?.aborted) return false;

  let done = false;
  pushViewerLog('preload.start', { imageId, perLoadTimeoutMs });

  return new Promise<boolean>(async (resolve) => {
    const t = window.setTimeout(() => {
      if (done) return;
      done = true;
      pushViewerLog('preload.timeout', { imageId, perLoadTimeoutMs });
      console.log('[PRELOAD] timeout', imageId, perLoadTimeoutMs);
      resolve(false);
    }, perLoadTimeoutMs);

    const onAbort = () => {
      if (done) return;
      done = true;
      clearTimeout(t);
      pushViewerLog('preload.aborted', { imageId });
      console.log('[PRELOAD] aborted', imageId);
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
              pushViewerLog('preload.success.globalFn', { imageId });
              console.log('[PRELOAD] globalFn success', imageId);
              resolve(true);
            })
            .catch((err: any) => {
              if (done) return;
              done = true;
              clearTimeout(t);
              try { signal?.removeEventListener?.('abort', onAbort); } catch {}
              pushViewerLog('preload.fail.globalFn', { imageId, err: String(err) });
              console.warn('[viewerPreloadHelpers] global imageLoaderFn failed', err);
              resolve(false);
            });
          return;
        }
      } catch (err) {
        pushViewerLog('preload.err.checkGlobalFn', { imageId, err: String(err) });
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
              pushViewerLog('preload.success.csGlobal', { imageId });
              console.log('[PRELOAD] csGlobal success', imageId);
              resolve(true);
            })
            .catch((err: any) => {
              if (done) return;
              done = true;
              clearTimeout(t);
              try { signal?.removeEventListener?.('abort', onAbort); } catch {}
              pushViewerLog('preload.fail.csGlobal', { imageId, err: String(err) });
              console.warn('[viewerPreloadHelpers] global core.loadAndCacheImage failed', err);
              resolve(false);
            });
          return;
        }
      } catch (err) {
        pushViewerLog('preload.err.checkCsGlobal', { imageId, err: String(err) });
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
              pushViewerLog('preload.success.dynamic', { imageId });
              console.log('[PRELOAD] dynamic core success', imageId);
              resolve(true);
            })
            .catch((err: any) => {
              if (done) return;
              done = true;
              clearTimeout(t);
              try { signal?.removeEventListener?.('abort', onAbort); } catch {}
              pushViewerLog('preload.fail.dynamic', { imageId, err: String(err) });
              console.warn('[viewerPreloadHelpers] dynamic core.loadAndCacheImage failed', err);
              resolve(false);
            });
          return;
        }
      } catch (err) {
        pushViewerLog('preload.err.dynamicImport', { imageId, err: String(err) });
      }

      if (!done) {
        done = true;
        clearTimeout(t);
        try { signal?.removeEventListener?.('abort', onAbort); } catch {}
        pushViewerLog('preload.noLoader', { imageId });
        console.log('[PRELOAD] no loader available for', imageId);
        resolve(false);
      }
    } catch (e) {
      if (!done) {
        done = true;
        clearTimeout(t);
        try { signal?.removeEventListener?.('abort', onAbort); } catch {}
        pushViewerLog('preload.error', { imageId, err: String(e) });
        console.warn('[PRELOAD] failed', imageId, e);
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

  pushViewerLog('preload.batch.start', { requestedTotal: imageIds.length, toLoadLength: toLoad.length, concurrency, perLoadTimeoutMs });

  const queue = toLoad.slice();

  const workers = Array.from({ length: Math.max(1, concurrency) }).map(async () => {
    while (queue.length > 0) {
      if (signal?.aborted) {
        pushViewerLog('preload.batch.worker.aborted', { remaining: queue.length });
        return;
      }
      const id = queue.shift();
      if (!id) break;
      // eslint-disable-next-line no-await-in-loop
      const ok = await loadAndCacheImageWithTimeout(id, perLoadTimeoutMs, signal).catch(() => false);
      loadedCount += 1;
      try {
        if (onProgress) onProgress(loadedCount, total);
      } catch {}
      try {
        pushViewerLog('preload.batch.progress', { loaded: loadedCount, total, imageId: id, ok });
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

  pushViewerLog('preload.batch.done', { loaded: loadedCount, total });
  console.log('[PRELOAD] batch done', { loaded: loadedCount, total });
}
