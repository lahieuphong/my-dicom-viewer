// src/hooks/useCine.ts
import { useEffect } from 'react';
import { utilities } from '@cornerstonejs/tools';

/**
 * Hook to control cine playback using Cornerstone Tools' utilities.cine API
 * @param isPlaying - whether playback is active
 * @param fps - frames per second for playback
 * @param element - the HTML element where Cornerstone viewport is attached
 */
export function useCine(
  isPlaying: boolean,
  fps: number,
  element: HTMLDivElement | null
) {
  useEffect(() => {
    if (!element) {
      return;
    }

    if (isPlaying) {
      // Start cine playback on the viewport element
      utilities.cine.playClip(element, { framesPerSecond: fps });
    } else {
      // Stop playback
      utilities.cine.stopClip(element);
    }

    return () => {
      // Cleanup on unmount or dependency change
      utilities.cine.stopClip(element);
    };
  }, [isPlaying, fps, element]);
}