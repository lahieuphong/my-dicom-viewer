'use client';

import type { RenderingEngine, StackViewport } from '@cornerstonejs/core';

import { normalizeCanvasAndContext } from '@/lib/viewer/canvasUtils';

type ViewPresentation = ReturnType<StackViewport['getViewPresentation']>;

const IMAGE_RENDERED_EVENT = 'CORNERSTONE_IMAGE_RENDERED';
const RESIZE_SNAPSHOT_SELECTOR = '[data-viewer-resize-snapshot="true"]';

function preserveCurrentFrame(element: HTMLElement) {
  const canvas = element.querySelector('canvas.cornerstone-canvas') as HTMLCanvasElement | null;
  const host = canvas?.parentElement;
  if (!canvas || !host || canvas.width <= 0 || canvas.height <= 0) {
    return { refresh: () => {}, remove: () => {} };
  }

  const previousSnapshot = host.querySelector(
    RESIZE_SNAPSHOT_SELECTOR
  ) as HTMLCanvasElement | null;
  const source = previousSnapshot ?? canvas;
  const snapshot = document.createElement('canvas');
  snapshot.dataset.viewerResizeSnapshot = 'true';
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
    snapshot.getContext('2d')?.drawImage(source, 0, 0);
    host.appendChild(snapshot);
    previousSnapshot?.remove();
  } catch {
    snapshot.remove();
  }

  return {
    refresh: () => {
      try {
        snapshot.width = canvas.width;
        snapshot.height = canvas.height;
        snapshot.getContext('2d')?.drawImage(canvas, 0, 0);
      } catch {}
    },
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

export function fitViewportToElement({
  element,
  engine,
  viewport,
  viewportId,
}: {
  element: HTMLElement | null;
  engine: RenderingEngine | null;
  viewport: StackViewport | null;
  viewportId: string;
}) {
  if (!element || !viewport) return;

  const width = Math.round(element.clientWidth || element.getBoundingClientRect().width);
  const height = Math.round(element.clientHeight || element.getBoundingClientRect().height);
  if (width <= 0 || height <= 0) return;

  const presentation = readPresentation(viewport);
  const snapshot = preserveCurrentFrame(element);
  let fallbackTimer: number | null = null;
  let removalTimer: number | null = null;

  const handleImageRendered = () => {
    element.removeEventListener(IMAGE_RENDERED_EVENT, handleImageRendered);
    if (fallbackTimer != null) window.clearTimeout(fallbackTimer);
    if (removalTimer != null) window.clearTimeout(removalTimer);
    snapshot.refresh();
    removalTimer = window.setTimeout(() => {
      removalTimer = null;
      snapshot.remove();
    }, 34);
  };

  element.addEventListener(IMAGE_RENDERED_EVENT, handleImageRendered, { once: true });
  fallbackTimer = window.setTimeout(handleImageRendered, 300);

  normalizeCanvasAndContext(element);

  if (!engine) {
    try {
      viewport.resetCameraForResize?.();
      restorePresentation(viewport, presentation);
      viewport.render?.();
    } catch {
      handleImageRendered();
    }
    return;
  }

  try {
    // Fit the new canvas, then retain the user's relative camera presentation.
    engine.resize(false, false);
    restorePresentation(viewport, presentation);
    engine.renderViewport(viewportId);
  } catch {
    handleImageRendered();
  }
}
