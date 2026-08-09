'use client';

import {
  Enums as CoreEnums,
  getShouldUseCPURendering,
  metaData,
  utilities as coreUtilities,
  type Types as CoreTypes,
} from '@cornerstonejs/core';
import { utilities as toolUtilities } from '@cornerstonejs/tools';

const CALIBRATION_PROVIDER_PRIORITY = 10_000;
let calibrationProviderRegistered = false;

export type ApplyUserCalibrationOptions = {
  imageId: string;
  measuredLength: number;
  actualLength: number;
  renderingEngine: CoreTypes.IRenderingEngine;
};

/** Register the provider consumed by StackViewport.calibrateSpacing(). */
export function registerCalibrationMetadataProvider(): void {
  if (calibrationProviderRegistered) return;

  const provider = coreUtilities.calibratedPixelSpacingMetadataProvider;
  if (!provider || typeof provider.get !== 'function') {
    throw new Error('Calibration metadata provider is unavailable.');
  }

  metaData.addProvider(
    provider.get.bind(provider),
    CALIBRATION_PROVIDER_PRIORITY
  );
  calibrationProviderRegistered = true;
}

export function getUserCalibrationOverride(
  imageId: string
): CoreTypes.IImageCalibration | undefined {
  return coreUtilities.calibratedPixelSpacingMetadataProvider.get(
    'calibratedPixelSpacing',
    imageId
  );
}

export function restoreUserCalibrationOverride(
  imageId: string,
  calibration: CoreTypes.IImageCalibration | undefined
): void {
  coreUtilities.calibratedPixelSpacingMetadataProvider.add(
    imageId,
    calibration as CoreTypes.IImageCalibration
  );
}

export function calculateWorldDistance(
  point1: CoreTypes.Point3,
  point2: CoreTypes.Point3
): number {
  return Math.hypot(
    point1[0] - point2[0],
    point1[1] - point2[1],
    point1[2] - point2[2]
  );
}

export function isValidPhysicalLength(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

/** Cornerstone 3.33.x does not consume calibrated spacing in CPU fallback. */
export function isUserCalibrationSupported(): boolean {
  try {
    return !getShouldUseCPURendering();
  } catch {
    return false;
  }
}

/**
 * Apply OHIF's user calibration formula to one referenced stack image.
 * The returned scale is useful for diagnostics and deterministic tests.
 */
export function applyUserCalibration({
  imageId,
  measuredLength,
  actualLength,
  renderingEngine,
}: ApplyUserCalibrationOptions): number {
  if (!imageId) throw new Error('Calibration image is unavailable.');
  if (!renderingEngine) throw new Error('Rendering engine is unavailable.');
  if (!isUserCalibrationSupported()) {
    throw new Error('Calibration is unavailable in CPU rendering mode.');
  }
  if (!isValidPhysicalLength(measuredLength)) {
    throw new Error('Measured calibration length is invalid.');
  }
  if (!isValidPhysicalLength(actualLength)) {
    throw new Error('Actual physical distance must be greater than zero.');
  }

  registerCalibrationMetadataProvider();

  const scale = measuredLength / actualLength;
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new Error('Calculated calibration scale is invalid.');
  }
  toolUtilities.calibrateImageSpacing(imageId, renderingEngine, {
    type: CoreEnums.CalibrationTypes.USER,
    scale,
  });

  return scale;
}
