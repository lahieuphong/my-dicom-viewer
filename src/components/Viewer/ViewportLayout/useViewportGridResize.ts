'use client';

import { useEffect } from 'react';
import { Enums as CoreEnums, type StackViewport } from '@cornerstonejs/core';

import { VIEWPORT_ID } from '@/constants/viewport';
import { getRenderingEngine, RENDERER_ID } from '@/lib/cornerstone/renderer';
import { resizeViewportsKeepingVisibleFrame } from '@/lib/viewer/fitViewport';
import { fitViewportKeepingOrientation } from '@/lib/viewer/viewportActions';
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
 * The primary viewport's auto-fit settles container resizes after 80 ms plus
 * one frame and already resizes every pane. Settling later keeps this pass a
 * no-op in that case; it only has work left when that hook is inactive, for
 * example while the primary pane has no image.
 */
const CONTAINER_RESIZE_SETTLE_MS = 180;
const WORKSPACE_GRID_SELECTOR = '.viewer-workspace-grid';

function isPanelResizeActive(workspaceElement: HTMLElement | null) {
  return workspaceElement?.dataset.panelResizing === 'true';
}

/**
 * Keeps every Cornerstone canvas aligned with its CSS grid cell.
 *
 * Normal container resizing preserves the frame each pane shows. Resizing a
 * backing buffer clears it, so nothing is resized while a side panel is being
 * dragged; panes stay CSS-scaled and settle once the drag ends. A real layout
 * change is different: each viewport must be fitted to its new cell,
 * otherwise the primary viewport keeps the zoom calculated for the previous
 * large canvas.
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
    const workspaceElement = gridElement.closest<HTMLElement>(
      WORKSPACE_GRID_SELECTOR
    );

    let containerResizeTimer: number | null = null;
    let containerResizePending = false;
    let firstFitFrame: number | null = null;
    let secondFitFrame: number | null = null;
    let layoutFitTimer: number | null = null;
    let layoutFitCompleted = false;
    const retryTimers = new Set<number>();

    const getEngine = () => getRenderingEngine(RENDERER_ID);

    const cancelContainerResize = () => {
      if (containerResizeTimer === null) return;
      window.clearTimeout(containerResizeTimer);
      containerResizeTimer = null;
    };

    const settleContainerResize = () => {
      containerResizeTimer = null;
      if (isPanelResizeActive(workspaceElement)) {
        containerResizePending = true;
        return;
      }
      containerResizePending = false;
      try {
        // The primary camera is converted by its own auto-fit hook from the
        // size it last fitted; converting it here as well would scale it twice.
        resizeViewportsKeepingVisibleFrame(getEngine(), {
          excludeViewportIds: [VIEWPORT_ID],
        });
      } catch {}
    };

    const scheduleContainerResize = () => {
      cancelContainerResize();
      if (isPanelResizeActive(workspaceElement)) {
        containerResizePending = true;
        return;
      }
      // A timer, not requestAnimationFrame: see resizeViewportsKeepingVisibleFrame.
      containerResizeTimer = window.setTimeout(
        settleContainerResize,
        CONTAINER_RESIZE_SETTLE_MS
      );
    };

    const handlePanelResizeStateChange = () => {
      if (isPanelResizeActive(workspaceElement)) {
        containerResizePending = true;
        cancelContainerResize();
        return;
      }
      if (containerResizePending) scheduleContainerResize();
    };

    const fitGridToCurrentLayout = () => {
      // Never resize buffers mid-drag; the drag-end settle pass takes over.
      if (isPanelResizeActive(workspaceElement)) {
        containerResizePending = true;
        return false;
      }
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

            fitViewportKeepingOrientation(viewport);
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
        secondFitFrame !== null ||
        layoutFitTimer !== null
      ) {
        return;
      }

      // Two frames ensure the browser has committed the new grid tracks before
      // Cornerstone measures the viewport elements. The fit itself runs in a
      // task: resizing clears every canvas and Cornerstone redraws on the next
      // animation frame, which a resize inside rAF would only reach after the
      // browser painted the cleared canvases.
      firstFitFrame = window.requestAnimationFrame(() => {
        firstFitFrame = null;
        secondFitFrame = window.requestAnimationFrame(() => {
          secondFitFrame = null;
          layoutFitTimer = window.setTimeout(() => {
            layoutFitTimer = null;
            layoutFitCompleted = fitGridToCurrentLayout();
          }, 0);
        });
      });
    };

    const scheduleSettlingRenders = () => {
      retryTimers.forEach((timer) => window.clearTimeout(timer));
      retryTimers.clear();

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

    const observer = new ResizeObserver(scheduleContainerResize);
    observer.observe(gridElement);

    const panelResizeObserver =
      workspaceElement && typeof MutationObserver !== 'undefined'
        ? new MutationObserver(handlePanelResizeStateChange)
        : null;
    if (panelResizeObserver && workspaceElement) {
      panelResizeObserver.observe(workspaceElement, {
        attributes: true,
        attributeFilter: ['data-panel-resizing'],
      });
    }

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
      panelResizeObserver?.disconnect();
      cancelContainerResize();
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
      if (layoutFitTimer !== null) window.clearTimeout(layoutFitTimer);
      if (firstFitFrame !== null) window.cancelAnimationFrame(firstFitFrame);
      if (secondFitFrame !== null) window.cancelAnimationFrame(secondFitFrame);
      retryTimers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [layout, primaryViewportEl]);
}

export default useViewportGridResize;
