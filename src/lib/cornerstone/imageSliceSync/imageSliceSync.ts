'use client';

import {
  Enums as CoreEnums,
  getRenderingEngine,
  getRenderingEngines,
  metaData,
  utilities as coreUtilities,
  type Types as CoreTypes,
} from '@cornerstonejs/core';
import { SynchronizerManager, type Synchronizer } from '@cornerstonejs/tools';
import areViewportsCoplanar from '@cornerstonejs/tools/synchronizers/callbacks/areViewportsCoplanar';
import { mat4, vec3 } from 'gl-matrix';

import { getRegisteredImagePosition } from './imagePositions';

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

function getImagePosition(imageId: string | undefined): vec3 | null {
  if (!imageId) return null;
  const loaded = metaData.get('imagePlaneModule', imageId)?.imagePositionPatient;
  const position = loaded ?? getRegisteredImagePosition(imageId);
  return position && position.length === 3
    ? vec3.fromValues(Number(position[0]), Number(position[1]), Number(position[2]))
    : null;
}

/**
 * Mirrors imageSliceSyncCallback from @cornerstonejs/tools 3.33 for the
 * stack viewports of this viewer. Cornerstone's version reads the
 * imagePlaneModule of every target image and throws when one is missing; the
 * static wadouri data source has that metadata only for images already
 * loaded, so a pane showing another series never moved. Positions here come
 * from loaded metadata or, before loading, from the data source's instance
 * geometry, and images without any position are skipped.
 */
async function viewerImageSliceSyncCallback(
  synchronizer: Synchronizer,
  sourceInfo: ViewportInfo,
  targetInfo: ViewportInfo
) {
  const renderingEngine = getRenderingEngine(targetInfo.renderingEngineId);
  if (!renderingEngine) return;
  const options = synchronizer.getOptions(targetInfo.viewportId) as
    | { disabled?: boolean; useInitialPosition?: boolean }
    | undefined;
  if (options?.disabled) return;

  const source = renderingEngine.getViewport(
    sourceInfo.viewportId
  ) as CoreTypes.IStackViewport;
  const target = renderingEngine.getViewport(
    targetInfo.viewportId
  ) as CoreTypes.IStackViewport;
  if (!source || !target) return;

  const sourcePosition = getImagePosition(source.getCurrentImageId());
  if (!sourcePosition || !areViewportsCoplanar(source, target)) return;

  const getRegistration = () =>
    coreUtilities.spatialRegistrationMetadataProvider.get(
      'spatialRegistrationModule',
      targetInfo.viewportId,
      sourceInfo.viewportId
    ) as mat4 | undefined;
  let registration = getRegistration();
  if (!registration) {
    if (
      source.getFrameOfReferenceUID() === target.getFrameOfReferenceUID() &&
      options?.useInitialPosition !== false
    ) {
      registration = mat4.identity(mat4.create());
    } else {
      coreUtilities.calculateViewportsSpatialRegistration(source, target);
      registration = getRegistration();
    }
    if (!registration) return;
  }

  const targetPoint = vec3.transformMat4(vec3.create(), sourcePosition, registration);
  let closestIndex = -1;
  let closestDistance = Number.POSITIVE_INFINITY;
  target.getImageIds().forEach((imageId, index) => {
    const position = getImagePosition(imageId);
    if (!position) return;
    const distance = vec3.distance(position, targetPoint);
    if (distance < closestDistance) {
      closestDistance = distance;
      closestIndex = index;
    }
  });

  if (closestIndex !== -1 && target.getCurrentImageIdIndex() !== closestIndex) {
    await coreUtilities.jumpToSlice(target.element, { imageIndex: closestIndex });
  }
}

function getOrCreateSynchronizer(renderingEngineId: string): Synchronizer {
  const synchronizerId = getSynchronizerId(renderingEngineId);
  const existing = SynchronizerManager.getSynchronizer(synchronizerId);

  if (existing) {
    managedSynchronizerIds.add(synchronizerId);
    return existing;
  }

  const synchronizer = SynchronizerManager.createSynchronizer(
    synchronizerId,
    CoreEnums.Events.STACK_NEW_IMAGE,
    viewerImageSliceSyncCallback,
    { auxiliaryEvents: [{ name: 'VOLUME_NEW_IMAGE' }] }
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
