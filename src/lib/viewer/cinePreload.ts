'use client';

import {
  Enums as CoreEnums,
  cache,
  getEnabledElement,
  imageLoader,
} from '@cornerstonejs/core';

const DEFAULT_CINE_PRELOAD_CONCURRENCY = 3;
const DEFAULT_IMAGE_LOAD_TIMEOUT_MS = 8000;
const CINE_CACHE_BUDGET_RATIO = 0.25;
const BUFFERED_PRELOAD_IMAGES = 48;
const MAX_LOAD_ATTEMPTS = 2;

type StackViewportLike = {
  getCurrentImageIdIndex?: () => number;
  getImageIds?: () => string[];
};

export type CinePreloadProgress = {
  loadedImages: number;
  totalImages: number;
  failedImages: number;
  percent: number;
};

export type CinePreloadMode = 'full' | 'buffered';

export type CinePreloadResult = CinePreloadProgress & {
  aborted: boolean;
  mode: CinePreloadMode;
  ready: boolean;
};

type PrepareCineStackOptions = {
  concurrency?: number;
  onProgress?: (progress: CinePreloadProgress) => void;
  perImageTimeoutMs?: number;
  signal?: AbortSignal;
};

function isImageLoaded(imageId: string, touch = false) {
  try {
    const loaded = cache.isLoaded(imageId);
    if (loaded && touch) {
      // getImage updates Cornerstone's LRU timestamp. Keep frames from the
      // active stack newer than unrelated, purgeable cache entries while it
      // is being warmed.
      const image = cache.getImage(imageId);
      if (!image) cache.getImageLoadObject(imageId);
    }
    return loaded;
  } catch {
    return false;
  }
}

function createProgress(
  loadedImages: number,
  totalImages: number,
  failedImages: number
): CinePreloadProgress {
  return {
    loadedImages,
    totalImages,
    failedImages,
    percent:
      totalImages > 0
        ? Math.round((loadedImages / totalImages) * 100)
        : 100,
  };
}

function readStack(element: HTMLDivElement) {
  try {
    const viewport = getEnabledElement(element)?.viewport as StackViewportLike;
    const imageIds = viewport?.getImageIds?.();
    if (!Array.isArray(imageIds) || imageIds.length === 0) return null;

    const rawIndex = Number(viewport.getCurrentImageIdIndex?.() ?? 0);
    const currentIndex = Number.isFinite(rawIndex)
      ? Math.min(imageIds.length - 1, Math.max(0, Math.floor(rawIndex)))
      : 0;

    return { imageIds, currentIndex };
  } catch {
    return null;
  }
}

function buildCyclicLoadOrder(imageIds: string[], currentIndex: number) {
  const ordered = [
    ...imageIds.slice(currentIndex),
    ...imageIds.slice(0, currentIndex),
  ];
  const occurrences = new Map<string, number>();
  const seen = new Set<string>();
  const uniqueImageIds: string[] = [];

  for (const imageId of imageIds) {
    if (!imageId) continue;
    occurrences.set(imageId, (occurrences.get(imageId) ?? 0) + 1);
  }

  for (const imageId of ordered) {
    if (!imageId || seen.has(imageId)) continue;
    seen.add(imageId);
    uniqueImageIds.push(imageId);
  }

  return {
    occurrences,
    uniqueImageIds,
  };
}

function countLoadedImages(occurrences: Map<string, number>, touch = false) {
  let loadedImages = 0;
  for (const [imageId, count] of occurrences) {
    if (isImageLoaded(imageId, touch)) loadedImages += count;
  }
  return loadedImages;
}

function getLoadedImageSize(imageIds: string[]) {
  for (const imageId of imageIds) {
    if (!isImageLoaded(imageId, true)) continue;
    try {
      const sizeInBytes = Number(cache.getImage(imageId)?.sizeInBytes);
      if (Number.isFinite(sizeInBytes) && sizeInBytes > 0) {
        return sizeInBytes;
      }
    } catch {}
  }
  return 0;
}

function getPreloadMode(imageIds: string[]): CinePreloadMode {
  const imageSize = getLoadedImageSize(imageIds);
  if (imageSize <= 0) return 'full';

  const estimatedStackBytes = imageSize * imageIds.length;
  const cineCacheBudget =
    cache.getMaxCacheSize() * CINE_CACHE_BUDGET_RATIO;
  return estimatedStackBytes <= cineCacheBudget ? 'full' : 'buffered';
}

type ImageLoadOutcome = 'settled' | 'timeout' | 'aborted';

function loadImageWithinDeadline(
  imageId: string,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<ImageLoadOutcome> {
  return new Promise((resolve) => {
    let finished = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const finish = (outcome: ImageLoadOutcome) => {
      if (finished) return;
      finished = true;
      if (timer != null) clearTimeout(timer);
      signal?.removeEventListener('abort', handleAbort);
      resolve(outcome);
    };
    const handleAbort = () => finish('aborted');

    if (signal?.aborted) {
      finish('aborted');
      return;
    }

    signal?.addEventListener('abort', handleAbort, { once: true });
    timer = setTimeout(
      () => finish('timeout'),
      Math.max(1, Math.floor(timeoutMs))
    );

    try {
      void imageLoader
        .loadAndCacheImage(imageId, {
          requestType: CoreEnums.RequestType.Prefetch,
          priority: 0,
        })
        .then(
          () => finish('settled'),
          () => finish('settled')
        );
    } catch {
      finish('settled');
    }
  });
}

/**
 * Decodes the complete active stack before Cine starts when it fits the Cine
 * cache budget. Very large stacks receive a deterministic forward buffer and
 * continue with Cornerstone's context prefetcher.
 *
 * Cornerstone's Cine timer deliberately advances even when an uncached stack
 * image misses its render deadline. Warming the whole stack makes playback
 * deterministic for normal stacks and means later loops/replays contain no
 * cache holes.
 */
export async function prepareCineStack(
  element: HTMLDivElement,
  options: PrepareCineStackOptions = {}
): Promise<CinePreloadResult> {
  const stack = readStack(element);
  if (!stack) {
    return {
      ...createProgress(0, 0, 0),
      aborted: Boolean(options.signal?.aborted),
      mode: 'full',
      ready: false,
    };
  }

  const { occurrences, uniqueImageIds } = buildCyclicLoadOrder(
    stack.imageIds,
    stack.currentIndex
  );
  // Touch every already-loaded frame before new insertions so Cornerstone's
  // LRU evicts unrelated images first.
  countLoadedImages(occurrences, true);

  const mode = getPreloadMode(uniqueImageIds);
  const targetImageIds =
    mode === 'full'
      ? uniqueImageIds
      : uniqueImageIds.slice(0, BUFFERED_PRELOAD_IMAGES);
  const targetImageIdSet = new Set(targetImageIds);
  const targetOccurrences = new Map(
    [...occurrences].filter(([imageId]) => targetImageIdSet.has(imageId))
  );
  const totalImages = [...targetOccurrences.values()].reduce(
    (total, count) => total + count,
    0
  );
  let loadedImages = countLoadedImages(targetOccurrences, true);
  let failedImages = 0;

  const emitProgress = () => {
    try {
      options.onProgress?.(
        createProgress(loadedImages, totalImages, failedImages)
      );
    } catch {}
  };

  emitProgress();

  const pendingImageIds = targetImageIds.filter(
    (imageId) => !isImageLoaded(imageId)
  );
  const concurrency = Math.max(
    1,
    Math.min(
      Math.floor(options.concurrency ?? DEFAULT_CINE_PRELOAD_CONCURRENCY),
      pendingImageIds.length || 1
    )
  );
  let nextImageIndex = 0;
  let stopScheduling = false;

  const loadNext = async () => {
    while (!options.signal?.aborted && !stopScheduling) {
      const queueIndex = nextImageIndex;
      nextImageIndex += 1;
      if (queueIndex >= pendingImageIds.length) return;

      const imageId = pendingImageIds[queueIndex];
      let loaded = isImageLoaded(imageId);

      for (
        let attempt = 0;
        attempt < MAX_LOAD_ATTEMPTS && !loaded && !options.signal?.aborted;
        attempt += 1
      ) {
        const outcome = await loadImageWithinDeadline(
          imageId,
          options.perImageTimeoutMs ?? DEFAULT_IMAGE_LOAD_TIMEOUT_MS,
          options.signal
        );
        loaded = isImageLoaded(imageId);
        if (outcome === 'aborted') return;
        // A timed-out promise may still complete and populate the cache later.
        // Do not wait on the same shared load object for another full timeout.
        if (outcome === 'timeout') {
          stopScheduling = true;
          break;
        }
      }

      if (options.signal?.aborted) return;

      if (loaded) {
        loadedImages += targetOccurrences.get(imageId) ?? 1;
      } else {
        failedImages += targetOccurrences.get(imageId) ?? 1;
      }
      emitProgress();
      if (stopScheduling) return;
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => loadNext()));

  const aborted = Boolean(options.signal?.aborted);
  loadedImages = countLoadedImages(targetOccurrences, true);
  failedImages = Math.max(0, totalImages - loadedImages);
  const progress = createProgress(loadedImages, totalImages, failedImages);

  if (!aborted) {
    try {
      options.onProgress?.(progress);
    } catch {}
  }

  return {
    ...progress,
    aborted,
    mode,
    ready: !aborted && totalImages > 0 && loadedImages === totalImages,
  };
}
