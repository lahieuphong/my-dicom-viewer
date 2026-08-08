'use client';

import { useEffect, useId, useRef } from 'react';
import {
  Enums as CoreEnums,
  cache,
  getEnabledElement,
  imageLoader,
  imageLoadPoolManager,
} from '@cornerstonejs/core';

const NEAR_IMAGES = 2;
const DIRECTION_IMAGES = 8;
const PREFETCH_PRIORITY = 5;

function buildPrefetchIndices(
  currentIndex: number,
  imageCount: number,
  direction: -1 | 0 | 1
) {
  const indices: number[] = [];
  const addDirection = (step: -1 | 1, count: number) => {
    for (let distance = 1; distance <= count; distance += 1) {
      const index = currentIndex + step * distance;
      if (index >= 0 && index < imageCount) indices.push(index);
    }
  };

  if (direction < 0) {
    addDirection(-1, DIRECTION_IMAGES);
    addDirection(1, NEAR_IMAGES);
  } else {
    addDirection(1, DIRECTION_IMAGES);
    addDirection(-1, NEAR_IMAGES);
  }

  return indices;
}

/**
 * Keeps a bounded, direction-aware window warm without allowing Cornerstone
 * 3.33's context prefetcher to fill a quarter of its multi-gigabyte cache.
 * Interactive viewport requests stay in their own higher-priority pool.
 */
export function useStackPrefetch(
  element: HTMLDivElement | null,
  disabled = false
) {
  const ownerId = useId();
  const previousIndexRef = useRef<number | null>(null);

  useEffect(() => {
    if (!element || disabled) return;

    const owner = `dicom-stack-prefetch-${ownerId}`;
    let schedulingFrame: number | null = null;

    const clearQueuedRequests = () => {
      try {
        imageLoadPoolManager.filterRequests(
          (request) =>
            (request.additionalDetails as Record<string, unknown>)
              ?.prefetchOwner !== owner
        );
      } catch {}
    };

    const queueNearbyImages = () => {
      schedulingFrame = null;

      try {
        const enabledElement = getEnabledElement(element);
        const viewport = enabledElement?.viewport;
        const imageIds = viewport?.getImageIds?.();
        if (!Array.isArray(imageIds) || imageIds.length <= 1) {
          clearQueuedRequests();
          previousIndexRef.current = null;
          return;
        }

        const rawCurrentIndex = Number(
          viewport?.getCurrentImageIdIndex?.() ?? 0
        );
        const currentIndex = Number.isFinite(rawCurrentIndex)
          ? Math.max(0, Math.min(rawCurrentIndex, imageIds.length - 1))
          : 0;
        const previousIndex = previousIndexRef.current;
        const directDelta =
          previousIndex == null ? 0 : currentIndex - previousIndex;
        // Treat the last -> first and first -> last Cine/scroll transitions as
        // adjacent cyclic frames instead of reversing the prefetch direction.
        const cyclicDelta =
          Math.abs(directDelta) > imageIds.length / 2
            ? -Math.sign(directDelta)
            : Math.sign(directDelta);
        const direction: -1 | 0 | 1 =
          cyclicDelta < 0 ? -1 : cyclicDelta > 0 ? 1 : 0;
        previousIndexRef.current = currentIndex;

        clearQueuedRequests();

        for (const index of buildPrefetchIndices(
          currentIndex,
          imageIds.length,
          direction
        )) {
          const imageId = imageIds[index];
          if (!imageId || cache.getImageLoadObject(imageId)) continue;

          imageLoadPoolManager.addRequest(
            () =>
              imageLoader
                .loadAndCacheImage(imageId, {
                  requestType: CoreEnums.RequestType.Prefetch,
                  priority: PREFETCH_PRIORITY,
                })
                .catch(() => undefined),
            CoreEnums.RequestType.Prefetch,
            { imageId, prefetchOwner: owner },
            PREFETCH_PRIORITY
          );
        }
      } catch {
        // The viewport may still be between enableElement and setStack.
      }
    };

    const scheduleNearbyImages = () => {
      if (schedulingFrame != null) {
        window.cancelAnimationFrame(schedulingFrame);
      }
      schedulingFrame = window.requestAnimationFrame(queueNearbyImages);
    };

    const handleNewImageSet = () => {
      previousIndexRef.current = null;
      scheduleNearbyImages();
    };

    element.addEventListener(
      CoreEnums.Events.VIEWPORT_NEW_IMAGE_SET,
      handleNewImageSet
    );
    element.addEventListener(
      CoreEnums.Events.STACK_NEW_IMAGE,
      scheduleNearbyImages
    );
    scheduleNearbyImages();

    return () => {
      if (schedulingFrame != null) {
        window.cancelAnimationFrame(schedulingFrame);
      }
      element.removeEventListener(
        CoreEnums.Events.VIEWPORT_NEW_IMAGE_SET,
        handleNewImageSet
      );
      element.removeEventListener(
        CoreEnums.Events.STACK_NEW_IMAGE,
        scheduleNearbyImages
      );
      clearQueuedRequests();
      previousIndexRef.current = null;
    };
  }, [disabled, element, ownerId]);
}

export default useStackPrefetch;
