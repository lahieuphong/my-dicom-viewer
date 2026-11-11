'use client';

import {
  Enums as CoreEnums,
  type StackViewport,
} from '@cornerstonejs/core';

import { getRenderingEngine, RENDERER_ID } from '@/lib/cornerstone/renderer';
import { resizeEngineIfNeeded } from '@/lib/viewer/fitViewport';

const RENDER_RETRY_DELAYS_MS = [0, 80, 180, 360, 720] as const;
const RENDER_EVENT_TIMEOUT_MS = 900;

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}

/** Resolves true on the viewport's next IMAGE_RENDERED, false on timeout. */
export function waitForImageRendered(
  element: HTMLDivElement,
  viewportId: string,
  timeoutMs: number
) {
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (rendered: boolean) => {
      if (settled) return;
      settled = true;
      element.removeEventListener(
        CoreEnums.Events.IMAGE_RENDERED,
        handleImageRendered as EventListener
      );
      window.clearTimeout(timeoutId);
      resolve(rendered);
    };
    const handleImageRendered = (event: Event) => {
      const renderedViewportId = (
        event as CustomEvent<{ viewportId?: string }>
      ).detail?.viewportId;
      if (renderedViewportId && renderedViewportId !== viewportId) return;
      finish(true);
    };
    const timeoutId = window.setTimeout(() => finish(false), timeoutMs);

    element.addEventListener(
      CoreEnums.Events.IMAGE_RENDERED,
      handleImageRendered as EventListener
    );
  });
}

/** The viewport drew an image of the expected stack into a sized canvas. */
export function hasRenderedExpectedImage(
  viewport: StackViewport,
  expectedImageIds: ReadonlySet<string>
) {
  const currentImageId = viewport.getCurrentImageId?.();
  const canvas = viewport.getCanvas?.();
  return Boolean(
    currentImageId &&
      expectedImageIds.has(currentImageId) &&
      canvas &&
      canvas.width > 1 &&
      canvas.height > 1 &&
      viewport.viewportStatus === CoreEnums.ViewportStatus.RENDERED
  );
}

/**
 * Renders a viewport whose stack was just set until Cornerstone reports the
 * draw, retrying with growing delays. Every pane uses this after setStack.
 *
 * A canvas whose backing buffer does not match its element (for example one
 * created while its cell was still being laid out) is resized first, but
 * only then: RenderingEngine.resize clears the canvas of every pane, so an
 * unconditional resize per attempt blanked the whole grid each time one pane
 * loaded a stack.
 */
export async function renderViewportUntilReady({
  viewport,
  viewportId,
  element,
  expectedImageIds,
  isCancelled,
}: {
  viewport: StackViewport;
  viewportId: string;
  element: HTMLDivElement;
  expectedImageIds: ReadonlySet<string>;
  isCancelled: () => boolean;
}) {
  for (const retryDelay of RENDER_RETRY_DELAYS_MS) {
    if (isCancelled()) return false;
    if (retryDelay > 0) await wait(retryDelay);
    if (isCancelled()) return false;

    // Always render: callers change the camera after setStack, and
    // resetCamera does not schedule a render itself.
    const renderedEvent = waitForImageRendered(
      element,
      viewportId,
      RENDER_EVENT_TIMEOUT_MS
    );

    try {
      const renderingEngine = getRenderingEngine(RENDERER_ID);
      resizeEngineIfNeeded(renderingEngine);
      viewport.render();
      renderingEngine.renderViewport(viewportId);
    } catch {
      try { viewport.render(); } catch {}
    }

    const receivedRenderEvent = await renderedEvent;
    if (
      !isCancelled() &&
      (receivedRenderEvent ||
        hasRenderedExpectedImage(viewport, expectedImageIds))
    ) {
      return true;
    }
  }

  return !isCancelled() && hasRenderedExpectedImage(viewport, expectedImageIds);
}
