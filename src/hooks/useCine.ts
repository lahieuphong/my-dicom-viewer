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
    if (!element || !isPlaying) return;

    const framesPerSecond = Math.max(1, Math.min(60, Math.round(fps)));
    utilities.cine.playClip(element, {
      framesPerSecond,
      loop: true,
    });

    return () => {
      utilities.cine.stopClip(element);
    };
  }, [isPlaying, fps, element]);
}
