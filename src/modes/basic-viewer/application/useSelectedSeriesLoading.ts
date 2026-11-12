// Loading state and settling of the primary pane's selected series.
'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MutableRefObject,
} from 'react';
import type { RenderingEngine, StackViewport } from '@cornerstonejs/core';

import { VIEWPORT_ID } from '@/constants/viewport';
import {
  disableReleaseGraphicsResourcesGlobally,
  type AttachedStack,
} from '@/extensions/cornerstone';
import { areImageStacksEqual } from '@/lib/cornerstone/helpers';

import type { SeriesMapEntry } from './useSeriesLoader';

/** The image a series should show once it is selected for a navigation. */
export type PendingSeriesNavigation = {
  seriesUID: string;
  imageIndex: number;
};

// After this long without the engine attaching the selected stack, the
// settle effect reports a slow attach once.
const ENGINE_ATTACH_WARN_MS = 8000;

/**
 * Whether the primary pane is still loading the selected series, and the
 * settling of that series once it is shown.
 *
 * useRenderingEngine is the only owner of StackViewport.setStack for this
 * pane, opens a newly selected series at its pending navigation index and
 * publishes attachedStack once the stack's first image is drawn. The settle
 * effect then applies a navigation the engine could not (one requested for
 * the series already shown, or after the engine had started) and settles the
 * frame and loading UI. Loading starts with every series selection and ends
 * when the series is settled or its image is shown (imageAvailable).
 */
export function useSelectedSeriesLoading({
  selectedSeries,
  mergedSeriesMap,
  attachedStack,
  viewportReady,
  imageAvailable,
  renderingEngineRef,
  viewportInstance,
  pendingSeriesNavigationRef,
  setCurrentFrame,
}: {
  selectedSeries: string;
  mergedSeriesMap: Record<string, SeriesMapEntry>;
  attachedStack: AttachedStack | null;
  viewportReady: boolean;
  imageAvailable: boolean;
  renderingEngineRef: MutableRefObject<RenderingEngine | null>;
  viewportInstance: StackViewport | null;
  pendingSeriesNavigationRef: MutableRefObject<PendingSeriesNavigation | null>;
  setCurrentFrame: (frame: number) => void;
}) {
  const [loadingStack, setLoadingStack] = useState(false);
  const setLoadingStackIfChanged = useCallback((value: boolean) => {
    setLoadingStack((previous) => (previous === value ? previous : value));
  }, []);

  const attachSessionRef = useRef(0);
  // Read when the effect runs; neither must re-run it.
  const viewportInstanceRef = useRef(viewportInstance);
  const setCurrentFrameRef = useRef(setCurrentFrame);
  useLayoutEffect(() => {
    viewportInstanceRef.current = viewportInstance;
    setCurrentFrameRef.current = setCurrentFrame;
  });

  useEffect(() => {
    if (!selectedSeries || !viewportReady) return;

    let cancelled = false;
    const thisSession = (attachSessionRef.current += 1);
    const shouldAbort = () =>
      cancelled || thisSession !== attachSessionRef.current;
    let slowAttachTimer: number | null = null;
    const cleanup = () => {
      cancelled = true;
      if (slowAttachTimer !== null) window.clearTimeout(slowAttachTimer);
      attachSessionRef.current += 1;
      try { disableReleaseGraphicsResourcesGlobally(); } catch {}
    };

    // The series' files are its stack in display order: the list
    // useRenderingEngine sets and every frame index refers to.
    const imageIds = mergedSeriesMap[selectedSeries]?.files ?? [];
    if (imageIds.length === 0) return cleanup;

    const attachedViewport = (() => {
      if (attachedStack?.seriesId !== selectedSeries) return null;
      try {
        const vp: any =
          renderingEngineRef.current?.getViewport?.(VIEWPORT_ID) ??
          viewportInstanceRef.current;
        return areImageStacksEqual(vp?.getImageIds?.() ?? null, imageIds)
          ? vp
          : null;
      } catch {
        return null;
      }
    })();

    // A slow network only delays the engine; this effect runs again when it
    // attaches the stack. Report a long wait once.
    if (!attachedViewport) {
      setLoadingStackIfChanged(true);
      slowAttachTimer = window.setTimeout(() => {
        if (shouldAbort()) return;
        console.warn(
          `[viewer] Series ${selectedSeries} is still not attached after ${
            ENGINE_ATTACH_WARN_MS / 1000
          } s.`
        );
      }, ENGINE_ATTACH_WARN_MS);
      return cleanup;
    }

    const pendingNavigation =
      pendingSeriesNavigationRef.current?.seriesUID === selectedSeries
        ? pendingSeriesNavigationRef.current
        : null;
    const desiredImageIndex = Math.max(
      0,
      Math.min(
        Number.isInteger(pendingNavigation?.imageIndex)
          ? pendingNavigation!.imageIndex
          : 0,
        imageIds.length - 1
      )
    );

    void (async () => {
      try {
        const vp = attachedViewport;
        let currentIndex = Number(vp.getCurrentImageIdIndex?.() ?? 0);
        if (
          pendingNavigation &&
          currentIndex !== desiredImageIndex &&
          typeof vp.setImageIdIndex === 'function'
        ) {
          await vp.setImageIdIndex(desiredImageIndex);
          if (shouldAbort()) return;
          currentIndex = Number(vp.getCurrentImageIdIndex?.() ?? desiredImageIndex);
        }
        if (!Number.isInteger(currentIndex) || currentIndex < 0) {
          currentIndex = desiredImageIndex;
        }
        setCurrentFrameRef.current(currentIndex + 1);
        if (
          currentIndex === desiredImageIndex &&
          pendingSeriesNavigationRef.current === pendingNavigation
        ) {
          pendingSeriesNavigationRef.current = null;
        }
      } catch {
        // The viewport can be replaced while settling; the next run settles it.
      }
      if (shouldAbort()) return;
      // The overlay stays until the image renders (imageAvailable).
      setLoadingStackIfChanged(false);
    })();

    return cleanup;
  }, [
    attachedStack,
    mergedSeriesMap,
    pendingSeriesNavigationRef,
    renderingEngineRef,
    selectedSeries,
    setLoadingStackIfChanged,
    viewportReady,
  ]);

  useEffect(() => {
    if (!selectedSeries) return;
    setLoadingStackIfChanged(true);
  }, [selectedSeries, setLoadingStackIfChanged]);

  useEffect(() => {
    if (imageAvailable) setLoadingStackIfChanged(false);
  }, [imageAvailable, setLoadingStackIfChanged]);

  return { loadingStack };
}
