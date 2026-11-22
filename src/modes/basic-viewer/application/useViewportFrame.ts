// The current frame and cine state of the basic-viewer mode's primary pane.
'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { utilities as csCoreUtilities } from '@cornerstonejs/core';

import { DEFAULT_CINE_FPS } from '@/constants/cine';

/**
 * Whether cine plays and at which rate. handleViewportFrameIndexChange
 * passes the viewport's image changes to the frame state, except during
 * cine: the overlay and the stack scrollbar follow STACK_NEW_IMAGE
 * themselves, so a cine tick does not rerender the whole workspace.
 */
export function useCinePlayback(setCurrentFrameBatched: (frame: number) => void) {
  const [fps, setFps] = useState(DEFAULT_CINE_FPS);
  const [isPlaying, setIsPlaying] = useState(false);
  const isPlayingRef = useRef(isPlaying);

  useLayoutEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  const handleViewportFrameIndexChange = useCallback(
    (frame: number) => {
      if (!isPlayingRef.current) setCurrentFrameBatched(frame);
    },
    [setCurrentFrameBatched]
  );

  return { fps, setFps, isPlaying, setIsPlaying, handleViewportFrameIndexChange };
}

type FrameViewport = {
  getImageIds?: () => string[];
  getCurrentImageIdIndex?: () => number;
  setImageIdIndex: (index: number) => Promise<unknown>;
};

/**
 * Keeps the frame state on the primary viewport's image (once a viewport is
 * published and whenever cine stops) and returns the handler that moves the
 * viewport to a one-based frame. The handler resolves with whether the
 * viewport moved; the frame state is put back if it did not.
 */
export function useViewportFrameNavigation({
  viewportEl,
  viewportInstance,
  isPlaying,
  setCurrentFrame,
}: {
  viewportEl: HTMLDivElement | null;
  viewportInstance: FrameViewport | null;
  isPlaying: boolean;
  setCurrentFrame: (frame: number) => void;
}) {
  useEffect(() => {
    if (isPlaying || !viewportInstance) return;
    try {
      const imageIndex = viewportInstance.getCurrentImageIdIndex?.();
      if (Number.isInteger(imageIndex) && Number(imageIndex) >= 0) {
        setCurrentFrame(Number(imageIndex) + 1);
      }
    } catch {}
  }, [isPlaying, setCurrentFrame, viewportInstance]);

  return useCallback(
    async (frameOneBased: number) => {
      if (!viewportEl || !viewportInstance) return false;

      const imageIds = viewportInstance.getImageIds?.() ?? [];
      if (!Array.isArray(imageIds) || imageIds.length <= 1) return false;

      const targetIndex = Math.min(
        imageIds.length - 1,
        Math.max(0, Math.round(Number(frameOneBased) || 1) - 1)
      );

      setCurrentFrame(targetIndex + 1);

      try {
        await csCoreUtilities.jumpToSlice(viewportEl, {
          imageIndex: targetIndex,
          debounceLoading: true,
        });
        return true;
      } catch {
        try {
          await viewportInstance.setImageIdIndex(targetIndex);
          return true;
        } catch {
          const currentIndex = viewportInstance.getCurrentImageIdIndex?.();
          if (typeof currentIndex === 'number' && currentIndex >= 0) {
            setCurrentFrame(currentIndex + 1);
          }
          return false;
        }
      }
    },
    [setCurrentFrame, viewportEl, viewportInstance]
  );
}
