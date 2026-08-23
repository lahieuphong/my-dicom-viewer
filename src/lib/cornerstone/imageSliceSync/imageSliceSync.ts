'use client';

import {
  getRenderingEngines,
  type Types as CoreTypes,
} from '@cornerstonejs/core';
import {
  SynchronizerManager,
  synchronizers,
  type Synchronizer,
} from '@cornerstonejs/tools';

const IMAGE_SLICE_SYNC_ID_PREFIX = 'viewer-image-slice-sync';

let requestedEnabled = false;
const managedSynchronizerIds = new Set<string>();
const managedViewportElements = new Map<string, HTMLElement>();

type ViewportInfo = CoreTypes.IViewportId;
type SynchronizableViewport = {
  info: ViewportInfo;
  element: HTMLElement;
};

export type ImageSliceSyncSnapshot = {
  enabled: boolean;
  canSynchronize: boolean;
  viewportCount: number;
};

function getSynchronizerId(renderingEngineId: string): string {
  return `${IMAGE_SLICE_SYNC_ID_PREFIX}:${renderingEngineId}`;
}

function isSynchronizableViewport(viewport: any): boolean {
  if (!viewport?.element) return false;
  // Only synchronize viewer-owned diagnostic viewports. Cornerstone tools such
  // as Magnify Probe create internal viewports in the same rendering engine;
  // treating those as peers would make the loupe scroll the source stack.
  if (viewport.element.dataset?.viewportRole !== 'content') return false;
  if (typeof viewport.getCurrentImageId !== 'function') return false;
  if (typeof viewport.getCurrentImageIdIndex !== 'function') return false;
  if (typeof viewport.getImageIds !== 'function') return false;

  try {
    const imageIds = viewport.getImageIds();
    return Array.isArray(imageIds) && imageIds.length > 0;
  } catch {
    return false;
  }
}

function getOrCreateSynchronizer(renderingEngineId: string): Synchronizer {
  const synchronizerId = getSynchronizerId(renderingEngineId);
  const existing = SynchronizerManager.getSynchronizer(synchronizerId);

  if (existing) {
    managedSynchronizerIds.add(synchronizerId);
    return existing;
  }

  const synchronizer = synchronizers.createImageSliceSynchronizer(
    synchronizerId
  );
  managedSynchronizerIds.add(synchronizerId);
  return synchronizer;
}

function viewportKey(viewport: ViewportInfo): string {
  return `${viewport.renderingEngineId}:${viewport.viewportId}`;
}

function reconcileSynchronizer(
  synchronizer: Synchronizer,
  desiredViewports: SynchronizableViewport[]
): void {
  const desiredKeys = new Set(
    desiredViewports.map(({ info }) => viewportKey(info))
  );
  const registeredViewports = new Map<string, ViewportInfo>();

  for (const viewport of [
    ...synchronizer.getSourceViewports(),
    ...synchronizer.getTargetViewports(),
  ]) {
    registeredViewports.set(viewportKey(viewport), viewport);
  }

  // Rebind when Cornerstone recreates a viewport with the same IDs but a new
  // DOM element. Keeping the old listener would make sync silently stop after
  // a layout or rendering-engine rebuild.
  for (const { info, element } of desiredViewports) {
    const key = viewportKey(info);
    const previousElement = managedViewportElements.get(key);
    if (previousElement && previousElement !== element) {
      try {
        synchronizer.remove(info);
      } catch {}
      registeredViewports.delete(key);
    }
  }

  for (const [key, viewport] of registeredViewports) {
    if (!desiredKeys.has(key)) {
      try {
        synchronizer.remove(viewport);
      } catch {}
      managedViewportElements.delete(key);
    }
  }

  for (const { info: viewport, element } of desiredViewports) {
    const hasSource = synchronizer.hasSourceViewport(
      viewport.renderingEngineId,
      viewport.viewportId
    );
    const hasTarget = synchronizer.hasTargetViewport(
      viewport.renderingEngineId,
      viewport.viewportId
    );

    if (!hasSource || !hasTarget) {
      try {
        synchronizer.add(viewport);
      } catch {}
    }
    managedViewportElements.set(viewportKey(viewport), element);
  }
}

/**
 * Reconciles the native Cornerstone synchronizers with every loaded stack or
 * volume-slice viewport. A synchronizer is kept per rendering engine because
 * Cornerstone's image-slice callback resolves source and target viewports from
 * the same engine.
 */
export function refreshImageSliceSync(): ImageSliceSyncSnapshot {
  const activeSynchronizerIds = new Set<string>();
  let canSynchronize = false;
  let viewportCount = 0;

  for (const renderingEngine of getRenderingEngines() ?? []) {
    const renderingEngineId = renderingEngine.id;
    const desiredViewports: SynchronizableViewport[] = [];

    for (const viewport of renderingEngine.getViewports?.() ?? []) {
      if (!isSynchronizableViewport(viewport)) continue;

      desiredViewports.push({
        info: {
          renderingEngineId,
          viewportId: viewport.id,
        },
        element: viewport.element,
      });
    }

    viewportCount += desiredViewports.length;
    if (desiredViewports.length === 0) continue;

    const synchronizer = getOrCreateSynchronizer(renderingEngineId);
    const synchronizerId = getSynchronizerId(renderingEngineId);
    const hasPeerViewport = desiredViewports.length > 1;
    canSynchronize ||= hasPeerViewport;
    activeSynchronizerIds.add(synchronizerId);
    reconcileSynchronizer(synchronizer, desiredViewports);
    synchronizer.setEnabled(requestedEnabled && hasPeerViewport);
  }

  for (const synchronizerId of managedSynchronizerIds) {
    if (activeSynchronizerIds.has(synchronizerId)) continue;
    try {
      SynchronizerManager.getSynchronizer(synchronizerId)?.setEnabled(false);
    } catch {}
  }

  if (!canSynchronize) requestedEnabled = false;

  return {
    enabled: requestedEnabled && canSynchronize,
    canSynchronize,
    viewportCount,
  };
}

export function setImageSliceSyncEnabled(
  enabled: boolean
): ImageSliceSyncSnapshot {
  requestedEnabled = enabled;
  return refreshImageSliceSync();
}
