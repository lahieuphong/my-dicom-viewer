// src/hooks/useCine.ts
import { useCallback, useEffect, useState } from 'react';
import { utilities } from '@cornerstonejs/tools';
import { clampCineFps } from '@/constants/cine';
import {
  prepareCineStack,
  type CinePreloadMode,
  type CinePreloadProgress,
} from '@/lib/viewer/cinePreload';

export type CinePreparationPhase =
  | 'idle'
  | 'preparing'
  | 'ready'
  | 'error';

export type CinePreparationState = CinePreloadProgress & {
  mode: CinePreloadMode;
  phase: CinePreparationPhase;
};

type UseCineOptions = {
  enabled: boolean;
  element: HTMLDivElement | null;
  fps: number;
  isPlaying: boolean;
  stackKey?: string | null;
};

const IDLE_PREPARATION: CinePreparationState = {
  phase: 'idle',
  loadedImages: 0,
  totalImages: 0,
  failedImages: 0,
  mode: 'full',
  percent: 0,
};

/**
 * Prepares the active stack and controls Cornerstone's Cine playback.
 * Normal stacks are gated until every frame is decoded; oversized stacks are
 * gated on a forward buffer and then use OHIF's expanding context prefetcher.
 */
export function useCine({
  enabled,
  element,
  fps,
  isPlaying,
  stackKey,
}: UseCineOptions) {
  const [preparation, setPreparation] =
    useState<CinePreparationState>(IDLE_PREPARATION);
  const [retryGeneration, setRetryGeneration] = useState(0);

  const retryPreparation = useCallback(() => {
    setRetryGeneration((generation) => generation + 1);
  }, []);

  useEffect(() => {
    if (!enabled || !element) {
      setPreparation(IDLE_PREPARATION);
      return;
    }

    const controller = new AbortController();
    let active = true;
    let pendingProgress: CinePreloadProgress | null = null;
    let progressTimer: ReturnType<typeof setTimeout> | null = null;

    const flushProgress = () => {
      progressTimer = null;
      if (!active || controller.signal.aborted || !pendingProgress) return;

      const progress = pendingProgress;
      pendingProgress = null;
      setPreparation({ ...progress, mode: 'full', phase: 'preparing' });
    };

    setPreparation({
      ...IDLE_PREPARATION,
      phase: 'preparing',
    });

    void prepareCineStack(element, {
      concurrency: 3,
      signal: controller.signal,
      onProgress: (progress) => {
        if (!active || controller.signal.aborted) return;
        // Decode completion can arrive in bursts. Publish only the latest
        // snapshot at 10 Hz so the whole workspace is not rendered per image.
        pendingProgress = progress;
        if (progressTimer === null) {
          progressTimer = setTimeout(flushProgress, 100);
        }
      },
    })
      .then((result) => {
        if (!active || result.aborted) return;
        if (progressTimer !== null) clearTimeout(progressTimer);
        progressTimer = null;
        pendingProgress = null;
        setPreparation({
          loadedImages: result.loadedImages,
          totalImages: result.totalImages,
          failedImages: result.failedImages,
          mode: result.mode,
          percent: result.percent,
          phase: result.ready ? 'ready' : 'error',
        });
      })
      .catch(() => {
        if (!active || controller.signal.aborted) return;
        if (progressTimer !== null) clearTimeout(progressTimer);
        progressTimer = null;
        pendingProgress = null;
        setPreparation((current) => ({
          ...current,
          phase: 'error',
          failedImages: Math.max(
            current.failedImages,
            current.totalImages - current.loadedImages
          ),
        }));
      });

    return () => {
      active = false;
      controller.abort();
      if (progressTimer !== null) clearTimeout(progressTimer);
    };
  }, [element, enabled, retryGeneration, stackKey]);

  useEffect(() => {
    if (
      !enabled ||
      !element ||
      preparation.phase !== 'ready' ||
      preparation.mode !== 'buffered'
    ) {
      return;
    }

    // Very large stacks cannot be held fully in cache. After a deterministic
    // forward buffer is ready, use the same expanding context prefetcher as
    // OHIF to keep feeding frames without permanently blocking Play.
    try {
      utilities.stackContextPrefetch.enable(element);
    } catch {
      return;
    }

    return () => {
      try {
        utilities.stackContextPrefetch.disable(element);
      } catch {}
    };
  }, [element, enabled, preparation.mode, preparation.phase]);

  useEffect(() => {
    if (
      !enabled ||
      !element ||
      !isPlaying ||
      preparation.phase !== 'ready'
    ) {
      return;
    }

    const framesPerSecond = clampCineFps(fps);
    utilities.cine.playClip(element, {
      framesPerSecond,
      loop: true,
    });

    return () => {
      utilities.cine.stopClip(element);
    };
  }, [element, enabled, fps, isPlaying, preparation.phase]);

  return {
    ...preparation,
    retryPreparation,
  };
}
