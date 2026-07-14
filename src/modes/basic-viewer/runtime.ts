'use client';

import {
  InMemoryMeasurementService,
  createViewerRuntime,
  type AnnotationMeasurement,
} from '@/platform/core';
import {
  createCornerstoneCommandManager,
  stackSopClassHandler,
  type CornerstoneCommandSchema,
} from '@/extensions/cornerstone';
import { staticDicomDataSource } from '@/extensions/static-dicom-data-source';

/**
 * Static OHIF-style composition for the basic viewer.
 *
 * BasicViewerImplementation does not consume this runtime yet; exporting the
 * factory makes the intended ownership explicit without changing today's
 * Cornerstone lifecycle.
 */
export function createBasicViewerRuntime(viewerId: string) {
  const runtime = createViewerRuntime<
    CornerstoneCommandSchema,
    HTMLDivElement,
    AnnotationMeasurement['data']
  >({
    viewerId,
    commandManager: createCornerstoneCommandManager(),
    measurementService: new InMemoryMeasurementService(),
  });

  runtime.displaySets.registerSopClassHandler(stackSopClassHandler);
  runtime.registerService('dataSource', staticDicomDataSource);

  return runtime;
}

export type BasicViewerRuntime = ReturnType<typeof createBasicViewerRuntime>;
