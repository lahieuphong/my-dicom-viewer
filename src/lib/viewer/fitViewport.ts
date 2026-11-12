'use client';

import type { RenderingEngine, StackViewport } from '@cornerstonejs/core';

import { normalizeCanvasAndContext } from '@/lib/viewer/canvasUtils';
import {
  canvasBufferNeedsResize,
  getCameraForResizedElement,
  getCameraForStaleCanvas,
  type ViewportSize,
} from '@/lib/viewer/resizeGeometry';
import { fitViewportKeepingOrientation } from '@/lib/viewer/viewportActions';

type ViewPresentation = ReturnType<StackViewport['getViewPresentation']>;
type ViewportCamera = ReturnType<StackViewport['getCamera']>;
export type ViewportResizeMode = 'preserve-camera' | 'fit-image';

const IMAGE_RENDERED_EVENT = 'CORNERSTONE_IMAGE_RENDERED';
const RESIZE_SNAPSHOT_SELECTOR = '[data-viewer-resize-snapshot="true"]';
const CORNERSTONE_CANVAS_SELECTOR = 'canvas.cornerstone-canvas';
const SNAPSHOT_FALLBACK_MS = 500;

type ContentViewport = {
  viewport: StackViewport;
  element: HTMLElement;
  viewportId: string;
};

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

function restoreCamera(viewport: StackViewport, camera: ViewportCamera | null) {
  if (!camera) return false;
  try {
    viewport.setCamera(camera);
    return true;
  } catch {
    return false;
  }
}

function getDevicePixelRatio() {
  return (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
}

function getCornerstoneCanvas(element: HTMLElement) {
  return element.querySelector<HTMLCanvasElement>(CORNERSTONE_CANVAS_SELECTOR);
}

/**
 * Viewer-owned panes only. Tools such as Magnify create internal viewports in
 * the same rendering engine and manage their own geometry.
 */
function getContentViewports(
  engine: RenderingEngine | null,
  { requireImage = false }: { requireImage?: boolean } = {}
): ContentViewport[] {
  if (!engine) return [];
  let viewports: unknown[] = [];
  try {
    viewports = engine.getViewports?.() ?? [];
  } catch {
    return [];
  }

  const result: ContentViewport[] = [];
  for (const candidate of viewports) {
    const viewport = candidate as StackViewport;
    const element = viewport?.element as HTMLElement | undefined;
    if (!element?.isConnected || element.dataset?.viewportRole !== 'content') {
      continue;
    }
    if (requireImage) {
      try {
        if (!viewport.getCurrentImageId?.()) continue;
      } catch {
        continue;
      }
    }
    result.push({ viewport, element, viewportId: String(viewport.id) });
  }
  return result;
}

/** True when any viewer-owned canvas no longer matches its CSS box. */
export function contentCanvasesNeedResize(engine: RenderingEngine | null) {
  return getContentViewports(engine).some(({ element }) => {
    const canvas = getCornerstoneCanvas(element);
    return Boolean(canvas && canvasBufferNeedsResize(canvas, getDevicePixelRatio()));
  });
}

/**
 * RenderingEngine.resize() clears every canvas of the engine and resets each
 * viewport's camera for the new size. Callers that only want the canvases to
 * match their cells must not pay that on every call: resize only when one is
 * actually out of date.
 */
export function resizeEngineIfNeeded(engine: RenderingEngine | null | undefined) {
  if (!engine || !contentCanvasesNeedResize(engine)) return false;
  engine.resize(true, true);
  return true;
}

/**
 * Until its backing buffer is resized, a canvas shows its last frame scaled
 * with object-fit: contain. Derive the camera that keeps exactly that frame
 * from the buffer size, so applying it after any number of keep-camera engine
 * resizes is idempotent.
 */
function planVisibleFrames(entries: ContentViewport[]) {
  const plans: Array<ContentViewport & { camera: ViewportCamera }> = [];
  const pixelRatio = getDevicePixelRatio();

  for (const entry of entries) {
    const canvas = getCornerstoneCanvas(entry.element);
    if (!canvas || !canvasBufferNeedsResize(canvas, pixelRatio)) continue;

    const camera = getCameraForStaleCanvas(
      readCamera(entry.viewport),
      canvas,
      pixelRatio
    );
    if (camera) plans.push({ ...entry, camera });
  }

  return plans;
}

/**
 * Keeps a copy of the current frame above the canvas until Cornerstone has
 * rendered into the resized buffer. Returns a function that releases it early.
 */
function holdFrameUntilRendered(element: HTMLElement) {
  const snapshot = preserveCurrentFrame(element);
  let released = false;
  let fallbackTimer: number | null = null;

  const release = () => {
    if (released) return;
    released = true;
    element.removeEventListener(IMAGE_RENDERED_EVENT, release);
    if (fallbackTimer != null) window.clearTimeout(fallbackTimer);

    // IMAGE_RENDERED is dispatched during Cornerstone's render pass. Keep the
    // preserved frame through the next paint so a cleared canvas is never shown.
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        window.setTimeout(() => snapshot.remove(), 34);
      });
    });
  };

  element.addEventListener(IMAGE_RENDERED_EVENT, release, { once: true });
  fallbackTimer = window.setTimeout(release, SNAPSHOT_FALLBACK_MS);
  return release;
}

/**
 * Settles a container resize for every viewer-owned pane at once: the shared
 * engine is resized only when a canvas no longer fits its cell, and every
 * resized pane keeps the frame it was showing instead of snapping to the
 * absolute camera Cornerstone restores with `keepCamera`.
 *
 * Call it from a task, never from a requestAnimationFrame callback. Resizing
 * clears the canvases and Cornerstone renders on the next animation frame; from
 * a task that frame still lands before the browser paints.
 */
export function resizeViewportsKeepingVisibleFrame(
  engine: RenderingEngine | null,
  { excludeViewportIds = [] }: { excludeViewportIds?: readonly string[] } = {}
) {
  if (!engine || !contentCanvasesNeedResize(engine)) return false;

  const excluded = new Set(excludeViewportIds);
  const plans = planVisibleFrames(
    getContentViewports(engine, { requireImage: true }).filter(
      ({ viewportId }) => !excluded.has(viewportId)
    )
  );

  try {
    // `immediate=true` schedules the render that picks up the cameras below.
    engine.resize(true, true);
  } catch {
    return false;
  }
  for (const plan of plans) restoreCamera(plan.viewport, plan.camera);
  return true;
}

export function fitViewportToElement({
  element,
  engine,
  viewport,
  viewportId,
  previousSize = null,
  mode = 'preserve-camera',
}: {
  element: HTMLElement | null;
  engine: RenderingEngine | null;
  viewport: StackViewport | null;
  viewportId: string;
  previousSize?: ViewportSize | null;
  mode?: ViewportResizeMode;
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
  // This runs from a requestAnimationFrame callback, so a resized canvas is
  // painted once before Cornerstone renders into it. Sibling panes in a split
  // layout share the engine resize below and need the same frame protection
  // and visible-frame camera as the primary pane.
  const siblings = getContentViewports(engine, { requireImage: true }).filter(
    (entry) => entry.element !== element && entry.viewportId !== viewportId
  );
  const needsResize = contentCanvasesNeedResize(engine);
  const siblingPlans = planVisibleFrames(siblings);
  const handleImageRendered = holdFrameUntilRendered(element);
  // engine.resize() clears every canvas, including panes whose size did not
  // change, so every sibling with an image needs its frame held.
  const releaseSiblingFrames = needsResize
    ? siblings.map((sibling) => holdFrameUntilRendered(sibling.element))
    : [];
  const releaseAllFrames = () => {
    handleImageRendered();
    releaseSiblingFrames.forEach((release) => release());
  };

  normalizeCanvasAndContext(element);

  if (!engine) {
    try {
      viewport.resetCameraForResize?.();
      if (mode === 'fit-image') {
        fitViewportKeepingOrientation(viewport);
      } else if (!restoreCamera(viewport, resizedCamera)) {
        restorePresentation(viewport, presentation);
      }
      viewport.render?.();
    } catch {
      handleImageRendered();
    }
    return;
  }

  try {
    // Resize all backing canvases without resetting sibling cameras, and only
    // when one is out of date: every resize clears every canvas. The requested
    // viewport is then either fitted to its new grid cell or given the camera
    // that preserves a deliberate user pan/zoom.
    if (needsResize) engine.resize(true, true);
    for (const plan of siblingPlans) restoreCamera(plan.viewport, plan.camera);
    if (mode === 'fit-image') {
      fitViewportKeepingOrientation(viewport);
    } else if (!restoreCamera(viewport, resizedCamera)) {
      restorePresentation(viewport, presentation);
    }
    engine.renderViewport(viewportId);
  } catch {
    releaseAllFrames();
  }
}
