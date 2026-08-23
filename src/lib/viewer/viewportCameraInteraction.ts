'use client';

import { Enums as CoreEnums } from '@cornerstonejs/core';

const CAMERA_MODIFIED_DATASET_KEY = 'viewerCameraModified';

/**
 * Camera state is kept separately from stack/frame interaction. Scrolling to
 * another slice must not make a viewport opt out of layout fitting, while a
 * real pan/zoom gesture must be preserved when the grid changes.
 */
export function isViewportCameraUserModified(
  element: HTMLElement | null | undefined
) {
  return element?.dataset[CAMERA_MODIFIED_DATASET_KEY] === 'true';
}

export function clearViewportCameraUserModified(
  element: HTMLElement | null | undefined
) {
  if (!element) return;
  delete element.dataset[CAMERA_MODIFIED_DATASET_KEY];
}

/**
 * Marks a viewport only when Cornerstone changes its camera during a genuine
 * pointer gesture. Wheel input is reserved for stack scrolling in this viewer,
 * so it must never make a slice-driven camera update look user-modified.
 */
export function trackViewportCameraInteraction(element: HTMLElement) {
  let pointerActive = false;

  const handlePointerDown = (event: PointerEvent) => {
    if (event.isPrimary === false) return;
    pointerActive = true;
  };
  const handlePointerEnd = () => {
    pointerActive = false;
  };
  const handleCameraModified = () => {
    if (!pointerActive) return;
    element.dataset[CAMERA_MODIFIED_DATASET_KEY] = 'true';
  };

  element.addEventListener('pointerdown', handlePointerDown, true);
  element.addEventListener(
    CoreEnums.Events.CAMERA_MODIFIED,
    handleCameraModified as EventListener
  );
  window.addEventListener('pointerup', handlePointerEnd, true);
  window.addEventListener('pointercancel', handlePointerEnd, true);

  return () => {
    element.removeEventListener('pointerdown', handlePointerDown, true);
    element.removeEventListener(
      CoreEnums.Events.CAMERA_MODIFIED,
      handleCameraModified as EventListener
    );
    window.removeEventListener('pointerup', handlePointerEnd, true);
    window.removeEventListener('pointercancel', handlePointerEnd, true);
  };
}
