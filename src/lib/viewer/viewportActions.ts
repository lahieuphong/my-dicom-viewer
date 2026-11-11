'use client';

import type { StackViewport } from '@cornerstonejs/core';

import { clearViewportCameraUserModified } from '@/lib/viewer/viewportCameraInteraction';

/**
 * Toolbar view actions for one stack viewport. The primary pane and every
 * secondary pane in a split layout share these, so a viewport behaves the
 * same whichever pane is active. Callers own any extra state (persisted VOI,
 * UI toggle state) and handle a viewport that is mounting or unmounting.
 */

/**
 * OHIF Reset View: restore the current image's default VOI/display
 * properties, then fit the camera without rotation or flip.
 */
export function resetViewportView(viewport: StackViewport) {
  viewport.resetProperties();

  // resetCamera also resets rotation on the GPU path. Cornerstone's CPU
  // fallback does not, so normalise it through the public presentation API.
  const presentation = viewport.getViewPresentation();
  viewport.setViewPresentation({ ...presentation, rotation: 0 });

  viewport.resetCamera({
    resetPan: true,
    resetZoom: true,
    resetToCenter: true,
  });

  // Keep Cornerstone's public flip state in sync in the CPU fallback too.
  viewport.setCamera({ flipHorizontal: false, flipVertical: false });

  // A reset view is fitted again, so later grid changes may refit it.
  clearViewportCameraUserModified(viewport.element as HTMLElement | null);
  viewport.render();
}

/**
 * Fits the camera to the viewport's cell (zoom, pan, centre) but keeps the
 * rotation and flips, the way Cornerstone's own resize does. resetCamera
 * alone also resets rotation and flips on the GPU path, so automatic fits
 * (layout changes, new-stack settling) used to undo an orientation the user
 * had just chosen. Only Reset View returns the orientation to default.
 */
export function fitViewportKeepingOrientation(viewport: StackViewport) {
  const rotation = viewport.getRotation?.() ?? 0;
  const { flipHorizontal = false, flipVertical = false } = viewport.getCamera();
  viewport.resetCamera({ resetPan: true, resetZoom: true, resetToCenter: true });
  if (flipHorizontal || flipVertical) {
    viewport.setCamera({ flipHorizontal, flipVertical });
  }
  if (rotation) viewport.setViewPresentation({ rotation });
}

export function rotateViewportClockwise(viewport: StackViewport) {
  const presentation = viewport.getViewPresentation();
  viewport.setViewPresentation({
    ...presentation,
    rotation: ((presentation.rotation ?? 0) + 90) % 360,
  });
  viewport.render();
}

export function toggleViewportFlipHorizontal(viewport: StackViewport) {
  const isFlipped = viewport.getCamera().flipHorizontal ?? false;
  // Only mutate the flip flag. Passing the previous full camera here can
  // overwrite the geometry that Cornerstone creates for the flip.
  viewport.setCamera({ flipHorizontal: !isFlipped });
  viewport.render();
}

export function readViewportInvert(viewport: StackViewport) {
  return Boolean(viewport.getProperties()?.invert);
}

/**
 * Toggles invert from the live viewport value, so rapid clicks never act on
 * stale UI state, and returns the value the rendering path accepted.
 */
export function toggleViewportInvert(viewport: StackViewport) {
  viewport.setProperties({ invert: !readViewportInvert(viewport) });
  viewport.render();
  return readViewportInvert(viewport);
}
