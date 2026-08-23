'use client';

import { useEffect } from 'react';
import { Enums as CoreEnums, type StackViewport } from '@cornerstonejs/core';

import { VIEWPORT_ID } from '@/constants/viewport';
import { getRenderingEngine, RENDERER_ID } from '@/lib/cornerstone/renderer';
import {
  clearViewportCameraUserModified,
  isViewportCameraUserModified,
  trackViewportCameraInteraction,
} from '@/lib/viewer/viewportCameraInteraction';

import {
  getViewportCount,
  getViewportIdAt,
  type ViewportGridLayout,
} from './viewportLayout';

type UseViewportGridResizeOptions = {
  layout: ViewportGridLayout;
  primaryViewportEl: HTMLDivElement | null;
};

const SETTLING_RENDER_DELAYS_MS = [100, 260, 600, 1200] as const;

/**
 * Keeps every Cornerstone canvas aligned with its CSS grid cell.
 *
 * Normal container resizing preserves the user's camera. A real layout change
 * is different: each viewport must be fitted to its new cell, otherwise the
 * primary viewport keeps the zoom calculated for the previous large canvas.
 */
export function useViewportGridResize({
  layout,
  primaryViewportEl,
}: UseViewportGridResizeOptions) {
  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;
    const primaryElement = primaryViewportEl;
    const gridElement = primaryElement?.closest<HTMLElement>(
      '[data-viewport-grid]'
    );
    if (!gridElement || !primaryElement) return;

    let resizeFrame: number | null = null;
    let firstFitFrame: number | null = null;
    let secondFitFrame: number | null = null;
    let layoutFitCompleted = false;
    const retryTimers = new Set<number>();

    const getEngine = () => getRenderingEngine(RENDERER_ID);

    const renderGridKeepingCamera = () => {
      try {
        const engine = getEngine();
        engine.resize(true, true);
        engine.render();
      } catch {}
    };

    const fitGridToCurrentLayout = () => {
      try {
        const engine = getEngine();

        // Resize every canvas, but do not globally reset sibling cameras. Each
        // untouched viewport is fitted explicitly below; a viewport that the
        // user panned/zoomed keeps its own camera.
        engine.resize(true, true);

        let primaryReady = false;
        const viewportCount = getViewportCount(layout);
        for (let index = 0; index < viewportCount; index += 1) {
          const viewportId = getViewportIdAt(index);
          try {
            const viewport = engine.getViewport(viewportId) as StackViewport;
            if (!viewport?.getCurrentImageId?.()) continue;

            const viewportElement = gridElement.querySelector<HTMLElement>(
              `[data-viewport-uid="${viewportId}"]`
            );
            if (viewportId === VIEWPORT_ID) primaryReady = true;
            if (isViewportCameraUserModified(viewportElement)) {
              viewport.render();
              continue;
            }

            viewport.resetCamera({
              resetPan: true,
              resetZoom: true,
              resetToCenter: true,
            });
            viewport.render();
          } catch {}
        }

        engine.render();
        return primaryReady;
      } catch {
        return false;
      }
    };

    const scheduleLayoutFit = () => {
      if (
        layoutFitCompleted ||
        firstFitFrame !== null ||
        secondFitFrame !== null
      ) {
        return;
      }

      // Two frames ensure the browser has committed the new grid tracks before
      // Cornerstone measures the viewport elements.
      firstFitFrame = window.requestAnimationFrame(() => {
        firstFitFrame = null;
        secondFitFrame = window.requestAnimationFrame(() => {
          secondFitFrame = null;
          layoutFitCompleted = fitGridToCurrentLayout();
        });
      });
    };

    const scheduleResize = () => {
      if (resizeFrame !== null) return;
      resizeFrame = window.requestAnimationFrame(() => {
        resizeFrame = null;
        renderGridKeepingCamera();
      });
    };

    const scheduleSettlingRenders = () => {
      retryTimers.forEach((timer) => window.clearTimeout(timer));
      retryTimers.clear();
      scheduleResize();

      for (const delay of SETTLING_RENDER_DELAYS_MS) {
        const timer = window.setTimeout(() => {
          retryTimers.delete(timer);
          fitGridToCurrentLayout();
        }, delay);
        retryTimers.add(timer);
      }
    };

    const handleNewStack = (event: Event) => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.dataset.viewportRole === 'content'
      ) {
        clearViewportCameraUserModified(target);
        scheduleSettlingRenders();
      }
    };

    const handlePrimaryImageRendered = () => {
      if (!layoutFitCompleted) scheduleLayoutFit();
    };

    const observer = new ResizeObserver(scheduleResize);
    observer.observe(gridElement);

    const viewportElements = Array.from(
      gridElement.querySelectorAll<HTMLElement>(
        '[data-viewport-role="content"]'
      )
    );
    const detachCameraInteractionTracking = viewportElements.map((element) =>
      trackViewportCameraInteraction(element)
    );
    viewportElements.forEach((element) => {
      element.addEventListener(
        CoreEnums.Events.VIEWPORT_NEW_IMAGE_SET,
        handleNewStack
      );
    });
    primaryElement.addEventListener(
      CoreEnums.Events.IMAGE_RENDERED,
      handlePrimaryImageRendered
    );

    scheduleLayoutFit();
    scheduleSettlingRenders();

    return () => {
      observer.disconnect();
      viewportElements.forEach((element) => {
        element.removeEventListener(
          CoreEnums.Events.VIEWPORT_NEW_IMAGE_SET,
          handleNewStack
        );
      });
      detachCameraInteractionTracking.forEach((detach) => detach());
      primaryElement.removeEventListener(
        CoreEnums.Events.IMAGE_RENDERED,
        handlePrimaryImageRendered
      );
      if (resizeFrame !== null) window.cancelAnimationFrame(resizeFrame);
      if (firstFitFrame !== null) window.cancelAnimationFrame(firstFitFrame);
      if (secondFitFrame !== null) window.cancelAnimationFrame(secondFitFrame);
      retryTimers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [layout, primaryViewportEl]);
}

export default useViewportGridResize;
