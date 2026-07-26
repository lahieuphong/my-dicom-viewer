// src/lib/cornerstone/helpers.ts
/**
 * Helpers liên quan tới Cornerstone / EnabledElement / ImageId normalization
 * và một số wrapper "best-effort" để tương tác an toàn với API annotation.
 *
 * Các helper dùng API Cornerstone đã được pin trong ứng dụng.
 */

import { getEnabledElement } from '@cornerstonejs/core';

/* =========================
   Enabled-element helpers
   ========================= */

/**
 * Very small safe wrapper around imported getEnabledElement.
 * Tránh ném lỗi: trả về null nếu getEnabledElement throws.
 */
export function safeGetEnabledElement(el: HTMLElement | null): any | null {
  if (!el) return null;
  try {
    return getEnabledElement(el as HTMLDivElement);
  } catch {
    return null;
  }
}

/* =========================
   ImageId normalization
   ========================= */

/**
 * Normalize an imageId string:
 * - remove leading "imageId:" if present
 * - strip query string
 * - trim trailing slash
 */
export function normalizeImageId(id?: string): string {
  if (!id) return '';
  let s = String(id);
  if (s.startsWith('imageId:')) s = s.replace(/^imageId:/, '');
  const q = s.indexOf('?');
  if (q >= 0) s = s.slice(0, q);
  if (s.endsWith('/')) s = s.slice(0, -1);
  return s;
}

function normalizeImageIdQuery(
  id: string,
  keepFrame: boolean
): string {
  const queryIndex = id.indexOf('?');
  if (queryIndex < 0) return id;

  const path = id.slice(0, queryIndex);
  const query = id
    .slice(queryIndex + 1)
    .split('&')
    .filter(Boolean)
    .filter((part) => {
      if (keepFrame) return true;
      return part.split('=', 1)[0]?.toLowerCase() !== 'frame';
    })
    .sort()
    .join('&');

  return query ? `${path}?${query}` : path;
}

/**
 * Canonical image identity that preserves a multiframe reference.
 * Unlike normalizeImageId, this never collapses `?frame=1` and `?frame=2`.
 */
export function normalizeImageIdWithFrame(id?: string): string {
  if (!id) return '';
  let value = String(id).trim().replace(/^imageId:/, '');
  value = normalizeImageIdQuery(value, true);
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

export function areImageStacksEqual(
  first?: readonly unknown[] | null,
  second?: readonly unknown[] | null
): boolean {
  return (
    Array.isArray(first) &&
    Array.isArray(second) &&
    first.length === second.length &&
    first.every(
      (imageId, index) =>
        normalizeImageIdWithFrame(String(imageId ?? '')) ===
        normalizeImageIdWithFrame(String(second[index] ?? ''))
    )
  );
}

/**
 * Canonical source-instance identity used only after an exact frame-aware
 * comparison. It removes the frame selector but keeps every other query key,
 * so two WADO-URI SOP instances do not collapse to the same URL.
 */
export function normalizeImageSourceId(id?: string): string {
  if (!id) return '';
  let value = String(id)
    .trim()
    .replace(/^imageId:/, '')
    .replace(/\/frames\/\d+(?=\/|$|\?)/i, '');
  value = normalizeImageIdQuery(value, false);
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

export function getImageIdFrameNumber(
  imageId?: string
): number | undefined {
  const match = String(imageId ?? '').match(
    /(?:[?&]frame=|\/frames\/)(\d+)/i
  );
  const frameNumber = Number(match?.[1]);
  return Number.isInteger(frameNumber) && frameNumber >= 1
    ? frameNumber
    : undefined;
}

/**
 * Resolve a referenced image without choosing the first frame of an ambiguous
 * multiframe stack. Exact/frame-aware identity wins; a stored frame index is
 * only used when it points at the same source SOP.
 */
export function findMatchingImageIdIndex(
  imageIds: string[],
  referencedImageId?: string,
  storedFrameIndex?: number
): number {
  if (!referencedImageId || !Array.isArray(imageIds)) return -1;

  const exactReference = normalizeImageIdWithFrame(referencedImageId);
  const exactIndex = imageIds.findIndex(
    (candidate) =>
      normalizeImageIdWithFrame(candidate) === exactReference
  );
  if (exactIndex >= 0) return exactIndex;

  const sourceReference = normalizeImageSourceId(referencedImageId);
  const sourceMatches = imageIds.reduce<number[]>(
    (matches, candidate, index) => {
      if (normalizeImageSourceId(candidate) === sourceReference) {
        matches.push(index);
      }
      return matches;
    },
    []
  );

  const referencedFrameNumber =
    getImageIdFrameNumber(referencedImageId);
  if (referencedFrameNumber) {
    const frameMatch = sourceMatches.find(
      (index) =>
        getImageIdFrameNumber(imageIds[index]) === referencedFrameNumber
    );
    if (typeof frameMatch === 'number') return frameMatch;
  }

  if (
    Number.isInteger(storedFrameIndex) &&
    Number(storedFrameIndex) >= 0 &&
    Number(storedFrameIndex) < imageIds.length &&
    normalizeImageSourceId(imageIds[Number(storedFrameIndex)]) ===
      sourceReference
  ) {
    return Number(storedFrameIndex);
  }

  if (sourceMatches.length === 1) return sourceMatches[0];

  // Compatibility fallback for legacy image-id wrappers. Never choose an
  // arbitrary item when multiple frames collapse to the same legacy key.
  const legacyReference = normalizeImageId(referencedImageId);
  const legacyMatches = imageIds.reduce<number[]>(
    (matches, candidate, index) => {
      if (normalizeImageId(candidate) === legacyReference) {
        matches.push(index);
      }
      return matches;
    },
    []
  );
  return legacyMatches.length === 1 ? legacyMatches[0] : -1;
}

/* =========================
   Annotation helper
   ========================= */

export function safeSetAnnotationVisibility(stateAny: any, annotationUID: string, visible: boolean): boolean {
  if (!stateAny || !annotationUID) return false;
  try {
    const state = stateAny.state ?? stateAny;
    if (
      typeof state?.getAnnotation === 'function' &&
      !state.getAnnotation(annotationUID)
    ) {
      return false;
    }

    // prefer .visibility sub-object if present
    const vis = stateAny.visibility ?? stateAny;
    if (vis && typeof vis.setAnnotationVisibility === 'function') {
      vis.setAnnotationVisibility(annotationUID, visible);
      const actual = vis.isAnnotationVisible?.(annotationUID);
      return typeof actual === 'boolean' ? actual === visible : true;
    }
    if (typeof stateAny.setAnnotationVisibility === 'function') {
      stateAny.setAnnotationVisibility(annotationUID, visible);
      const actual = stateAny.isAnnotationVisible?.(annotationUID);
      return typeof actual === 'boolean' ? actual === visible : true;
    }
  } catch {
    // ignore
  }
  return false;
}
