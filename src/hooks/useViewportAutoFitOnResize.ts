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

const VIEWER_GRID_SELECTOR = '.viewer-workspace-grid';
const RESIZE_SETTLE_DELAY_MS = 80;

function isPanelResizeActive(viewportEl: HTMLElement) {
  const grid = viewportEl.closest<HTMLElement>(VIEWER_GRID_SELECTOR);
  return grid?.dataset.panelResizing === 'true';
}

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
  const panelResizePendingRef = useRef(false);

  const fitViewport = useCallback(() => {
    frameRef.current = null;
    if (!enabled || !viewportEl || !viewportInstance) return;

    // Cornerstone clears its backing canvas when resize() changes its dimensions.
    // Keep the current frame CSS-scaled while a panel is actively being dragged,
    // then perform one real resize after the layout has settled.
    if (isPanelResizeActive(viewportEl)) {
      panelResizePendingRef.current = true;
      forceNextFitRef.current = true;
      return;
    }

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
    panelResizePendingRef.current = false;
  }, [enabled, renderingEngineRef, viewportEl, viewportId, viewportInstance]);

  const scheduleFit = useCallback((force = false) => {
    if (force) forceNextFitRef.current = true;
    if (frameRef.current != null) return;
    frameRef.current = window.requestAnimationFrame(fitViewport);
  }, [fitViewport]);

  const scheduleSettledFit = useCallback(() => {
    if (trailingTimerRef.current != null) {
      window.clearTimeout(trailingTimerRef.current);
    }
    trailingTimerRef.current = window.setTimeout(() => {
      trailingTimerRef.current = null;
      if (viewportEl && isPanelResizeActive(viewportEl)) {
        panelResizePendingRef.current = true;
        forceNextFitRef.current = true;
        return;
      }
      scheduleFit(true);
    }, RESIZE_SETTLE_DELAY_MS);
  }, [scheduleFit, viewportEl]);

  const clearScheduledFit = useCallback(() => {
    if (frameRef.current != null) {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    if (trailingTimerRef.current != null) {
      window.clearTimeout(trailingTimerRef.current);
      trailingTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!enabled || !viewportEl || !viewportInstance) return;

    scheduleFit();

    const gridEl = viewportEl.closest<HTMLElement>(VIEWER_GRID_SELECTOR);

    const handleResize = () => {
      if (isPanelResizeActive(viewportEl)) {
        panelResizePendingRef.current = true;
        forceNextFitRef.current = true;
        clearScheduledFit();
        return;
      }

      // ResizeObserver may fire every frame during a grid transition. Waiting
      // for a quiet window avoids repeatedly clearing the WebGL canvas.
      scheduleSettledFit();
    };

    const handlePanelResizeStateChange = () => {
      if (isPanelResizeActive(viewportEl)) {
        panelResizePendingRef.current = true;
        forceNextFitRef.current = true;
        clearScheduledFit();
        return;
      }

      if (!panelResizePendingRef.current) return;
      scheduleSettledFit();
    };

    const mutationObserver =
      gridEl && typeof MutationObserver !== 'undefined'
        ? new MutationObserver(handlePanelResizeStateChange)
        : null;
    if (mutationObserver && gridEl) {
      mutationObserver.observe(gridEl, {
        attributes: true,
        attributeFilter: ['data-panel-resizing'],
      });
    }

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', handleResize);
      return () => {
        window.removeEventListener('resize', handleResize);
        mutationObserver?.disconnect();
        clearScheduledFit();
      };
    }

    const observer = new ResizeObserver(handleResize);
    observer.observe(viewportEl);

    return () => {
      observer.disconnect();
      mutationObserver?.disconnect();
      clearScheduledFit();
    };
  }, [
    clearScheduledFit,
    enabled,
    scheduleFit,
    scheduleSettledFit,
    viewportEl,
    viewportInstance,
  ]);

  useEffect(() => {
    if (!enabled || !viewportEl || !viewportInstance) return;
    scheduleSettledFit();
  }, [enabled, resizeSignal, scheduleSettledFit, viewportEl, viewportInstance]);
}
