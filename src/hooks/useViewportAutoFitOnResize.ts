'use client';

import { useCallback, useEffect, useRef, type MutableRefObject } from 'react';
import type { RenderingEngine, StackViewport } from '@cornerstonejs/core';

import { fitViewportToElement } from '@/lib/viewer/fitViewport';

type RenderingEngineRef = MutableRefObject<RenderingEngine | null>;

type UseViewportAutoFitOnResizeArgs = {
  viewportEl: HTMLDivElement | null;
  viewportInstance: StackViewport | null;
  renderingEngineRef: RenderingEngineRef;
  viewportId: string;
  enabled?: boolean;
  resizeSignal?: unknown;
};

export function useViewportAutoFitOnResize({
  viewportEl,
  viewportInstance,
  renderingEngineRef,
  viewportId,
  enabled = true,
  resizeSignal,
}: UseViewportAutoFitOnResizeArgs) {
  const frameRef = useRef<number | null>(null);
  const trailingTimerRef = useRef<number | null>(null);
  const forceNextFitRef = useRef(false);
  const lastSizeRef = useRef<{ width: number; height: number } | null>(null);

  const fitViewport = useCallback(() => {
    frameRef.current = null;
    if (!enabled || !viewportEl || !viewportInstance) return;

    const width = Math.round(viewportEl.clientWidth);
    const height = Math.round(viewportEl.clientHeight);
    if (width <= 0 || height <= 0) return;

    const lastSize = lastSizeRef.current;
    const forceFit = forceNextFitRef.current;
    forceNextFitRef.current = false;
    if (!forceFit && lastSize?.width === width && lastSize?.height === height) return;
    lastSizeRef.current = { width, height };

    fitViewportToElement({
      element: viewportEl,
      engine: renderingEngineRef.current,
      viewport: viewportInstance,
      viewportId,
    });
  }, [enabled, renderingEngineRef, viewportEl, viewportId, viewportInstance]);

  const scheduleFit = useCallback((force = false) => {
    if (force) forceNextFitRef.current = true;
    if (frameRef.current != null) return;
    frameRef.current = window.requestAnimationFrame(fitViewport);
  }, [fitViewport]);

  const scheduleTrailingFit = useCallback(() => {
    if (trailingTimerRef.current != null) {
      window.clearTimeout(trailingTimerRef.current);
    }
    trailingTimerRef.current = window.setTimeout(() => {
      trailingTimerRef.current = null;
      scheduleFit(true);
    }, 80);
  }, [scheduleFit]);

  useEffect(() => {
    if (!enabled || !viewportEl || !viewportInstance) return;

    scheduleFit();

    const handleResize = () => {
      scheduleFit();
      scheduleTrailingFit();
    };

    const clearScheduledFit = () => {
      if (frameRef.current != null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      if (trailingTimerRef.current != null) {
        window.clearTimeout(trailingTimerRef.current);
        trailingTimerRef.current = null;
      }
    };

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', handleResize);
      return () => {
        window.removeEventListener('resize', handleResize);
        clearScheduledFit();
      };
    }

    const observer = new ResizeObserver(handleResize);
    observer.observe(viewportEl);

    return () => {
      observer.disconnect();
      clearScheduledFit();
    };
  }, [enabled, scheduleFit, scheduleTrailingFit, viewportEl, viewportInstance]);

  useEffect(() => {
    if (!enabled || !viewportEl || !viewportInstance) return;
    scheduleFit(true);
    scheduleTrailingFit();
  }, [enabled, resizeSignal, scheduleFit, scheduleTrailingFit, viewportEl, viewportInstance]);
}
