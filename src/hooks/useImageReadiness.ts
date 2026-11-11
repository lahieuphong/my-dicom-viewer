// src/hooks/useImageReadiness.ts
'use client';
import { useCallback, useMemo, useSyncExternalStore } from 'react';
import {
  Enums as CoreEnums,
  getEnabledElement,
  type StackViewport,
} from '@cornerstonejs/core';

type UseImageReadinessOpts = {
  viewportEl: HTMLDivElement | null;
  selectedSeries?: string | null;
  mergedSeriesMap?: Record<string, { files: string[]; metadata?: unknown }>;
};

/**
 * Cornerstone fires STACK_NEW_IMAGE right after a loaded image replaces the
 * displayed one and IMAGE_RENDERED after every draw, so together they cover
 * every change of the image this hook reads.
 */
const READINESS_EVENTS = [
  CoreEnums.Events.STACK_NEW_IMAGE,
  CoreEnums.Events.IMAGE_RENDERED,
] as const;

const getServerSnapshot = () => false;

function getDisplayedImageId(element: HTMLDivElement) {
  try {
    const viewport = getEnabledElement(element)?.viewport as
      | StackViewport
      | undefined;
    return viewport?.getCornerstoneImage?.()?.imageId ?? null;
  } catch {
    return null;
  }
}

/**
 * Whether the primary viewport displays an image of the selected series.
 *
 * This reads the image Cornerstone actually displays, not the current image
 * ID: setStack switches the current ID (and status) before the new image has
 * loaded, while the previous series is still on screen. The viewport status is
 * no signal either, as it drops to PRE_RENDER on every scroll or VOI change
 * until the next draw. The value is derived from Cornerstone's own events, so
 * the former polling loops and render/resize retries are no longer needed;
 * useRenderingEngine owns setStack and the render nudges for this pane.
 */
export function useImageReadiness({
  viewportEl,
  selectedSeries,
  mergedSeriesMap = {},
}: UseImageReadinessOpts) {
  const selectedFiles = mergedSeriesMap[selectedSeries ?? '']?.files;
  const selectedImageIds = useMemo(
    () => new Set<string>(selectedFiles ?? []),
    [selectedFiles]
  );

  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!viewportEl) return () => {};
      READINESS_EVENTS.forEach((type) =>
        viewportEl.addEventListener(type, onChange)
      );
      return () => {
        READINESS_EVENTS.forEach((type) =>
          viewportEl.removeEventListener(type, onChange)
        );
      };
    },
    [viewportEl]
  );

  const getSnapshot = useCallback(() => {
    if (!viewportEl || selectedImageIds.size === 0) return false;
    const imageId = getDisplayedImageId(viewportEl);
    return Boolean(imageId && selectedImageIds.has(imageId));
  }, [selectedImageIds, viewportEl]);

  const imageReady = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot
  );

  return { imageReady };
}

export default useImageReadiness;
