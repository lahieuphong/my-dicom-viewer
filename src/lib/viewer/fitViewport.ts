'use client';

import type { RenderingEngine, StackViewport } from '@cornerstonejs/core';

import { normalizeCanvasAndContext } from '@/lib/viewer/canvasUtils';

type ViewPresentation = ReturnType<StackViewport['getViewPresentation']>;
type ViewportCamera = ReturnType<StackViewport['getCamera']>;
type ViewportSize = { width: number; height: number };

const IMAGE_RENDERED_EVENT = 'CORNERSTONE_IMAGE_RENDERED';
const RESIZE_SNAPSHOT_SELECTOR = '[data-viewer-resize-snapshot="true"]';

function preserveCurrentFrame(element: HTMLElement) {
  const canvas = element.querySelector('canvas.cornerstone-canvas') as HTMLCanvasElement | null;
  const host = canvas?.parentElement;
  if (!canvas || !host || canvas.width <= 0 || canvas.height <= 0) {
    return { remove: () => {} };
  }

  const previousSnapshot = host.querySelector(
    RESIZE_SNAPSHOT_SELECTOR
  ) as HTMLCanvasElement | null;
  const source = previousSnapshot ?? canvas;
  const snapshot = document.createElement('canvas');
  const context = snapshot.getContext('2d');
  if (!context) {
    return { remove: () => {} };
  }

  snapshot.dataset.viewerResizeSnapshot = 'true';
  snapshot.setAttribute('aria-hidden', 'true');
  snapshot.width = source.width;
  snapshot.height = source.height;
  Object.assign(snapshot.style, {
    position: 'absolute',
    inset: '0',
    width: '100%',
    height: '100%',
    objectFit: 'contain',
    objectPosition: 'center',
    pointerEvents: 'none',
    zIndex: '1',
  });

  try {
    context.drawImage(source, 0, 0);
    host.appendChild(snapshot);
    previousSnapshot?.remove();
  } catch {
    snapshot.remove();
  }

  return {
    remove: () => snapshot.remove(),
  };
}

function readPresentation(viewport: StackViewport): ViewPresentation | null {
  try {
    return viewport.getViewPresentation?.() ?? null;
  } catch {
    return null;
  }
}

function restorePresentation(viewport: StackViewport, presentation: ViewPresentation | null) {
  if (!presentation) return;
  try {
    viewport.setViewPresentation?.(presentation);
  } catch {}
}

function readCamera(viewport: StackViewport): ViewportCamera | null {
  try {
    return viewport.getCamera?.() ?? null;
  } catch {
    return null;
  }
}

function getCameraForResizedElement(
  camera: ViewportCamera | null,
  previousSize: ViewportSize | null,
  nextSize: ViewportSize
): ViewportCamera | null {
  const parallelScale = camera?.parallelScale;
  if (
    !camera ||
    !previousSize ||
    !Number.isFinite(parallelScale) ||
    parallelScale == null ||
    parallelScale <= 0 ||
    previousSize.width <= 0 ||
    previousSize.height <= 0
  ) {
    return null;
  }

  const widthRatio = nextSize.width / previousSize.width;
  const heightRatio = nextSize.height / previousSize.height;
  const visibleFrameScale = Math.min(widthRatio, heightRatio);
  if (!Number.isFinite(visibleFrameScale) || visibleFrameScale <= 0) return null;

  // During a panel drag the old canvas is object-fit: contain. Convert that
  // exact visible scale into an absolute Cornerstone camera for the new canvas.
  const nextParallelScale = (parallelScale * heightRatio) / visibleFrameScale;
  if (!Number.isFinite(nextParallelScale) || nextParallelScale <= 0) return null;

  return { ...camera, parallelScale: nextParallelScale };
}

function restoreCamera(viewport: StackViewport, camera: ViewportCamera | null) {
  if (!camera) return false;
  try {
    viewport.setCamera(camera);
    return true;
  } catch {
    return false;
  }
}

export function fitViewportToElement({
  element,
  engine,
  viewport,
  viewportId,
  previousSize = null,
}: {
  element: HTMLElement | null;
  engine: RenderingEngine | null;
  viewport: StackViewport | null;
  viewportId: string;
  previousSize?: ViewportSize | null;
}) {
  if (!element || !viewport) return;

  const width = Math.round(element.clientWidth || element.getBoundingClientRect().width);
  const height = Math.round(element.clientHeight || element.getBoundingClientRect().height);
  if (width <= 0 || height <= 0) return;

  const presentation = readPresentation(viewport);
  const resizedCamera = getCameraForResizedElement(
    readCamera(viewport),
    previousSize,
    { width, height }
  );
  const snapshot = preserveCurrentFrame(element);
  let fallbackTimer: number | null = null;
  let removalTimer: number | null = null;
  let firstRemovalFrame: number | null = null;
  let secondRemovalFrame: number | null = null;
  let rendered = false;

  const handleImageRendered = () => {
    if (rendered) return;
    rendered = true;
    element.removeEventListener(IMAGE_RENDERED_EVENT, handleImageRendered);
    if (fallbackTimer != null) window.clearTimeout(fallbackTimer);
    if (removalTimer != null) window.clearTimeout(removalTimer);
    if (firstRemovalFrame != null) window.cancelAnimationFrame(firstRemovalFrame);
    if (secondRemovalFrame != null) window.cancelAnimationFrame(secondRemovalFrame);

    // IMAGE_RENDERED is dispatched during Cornerstone's render pass. Keep the
    // preserved frame through the next paint so a cleared canvas is never shown.
    firstRemovalFrame = window.requestAnimationFrame(() => {
      firstRemovalFrame = null;
      secondRemovalFrame = window.requestAnimationFrame(() => {
        secondRemovalFrame = null;
        removalTimer = window.setTimeout(() => {
          removalTimer = null;
          snapshot.remove();
        }, 34);
      });
    });
  };

  element.addEventListener(IMAGE_RENDERED_EVENT, handleImageRendered, { once: true });
  fallbackTimer = window.setTimeout(handleImageRendered, 500);

  normalizeCanvasAndContext(element);

  if (!engine) {
    try {
      viewport.resetCameraForResize?.();
      if (!restoreCamera(viewport, resizedCamera)) {
        restorePresentation(viewport, presentation);
      }
      viewport.render?.();
    } catch {
      handleImageRendered();
    }
    return;
  }

  try {
    // Resize establishes the new fit camera; the absolute camera then keeps the
    // frame seen during the drag instead of reapplying a relative zoom value.
    engine.resize(false, false);
    if (!restoreCamera(viewport, resizedCamera)) {
      restorePresentation(viewport, presentation);
    }
    engine.renderViewport(viewportId);
  } catch {
    handleImageRendered();
  }
}
