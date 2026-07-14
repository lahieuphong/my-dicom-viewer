'use client';

import type { SopClassHandler } from '@/platform/core';
import { createDisplaySetFromSeries } from '@/lib/viewer/displaySet';

export const STACK_SOP_CLASS_HANDLER_ID = 'cornerstone.stack' as const;

/**
 * Compile-time SOP handler for the current stack viewer.
 *
 * It delegates display-set construction to the existing implementation, so
 * image ordering, imageId normalization and VOI defaults remain unchanged.
 */
export const stackSopClassHandler: SopClassHandler = {
  id: STACK_SOP_CLASS_HANDLER_ID,
  priority: 0,
  supports({ series }) {
    return series.seriesModality.toUpperCase() !== 'SR';
  },
  createDisplaySets({ series }) {
    const files = (series.instances ?? []).map(
      (instance) => instance.url || instance.filename || ''
    ).filter(Boolean);

    const displaySet = createDisplaySetFromSeries({
      files,
      metadata: series,
    });

    return displaySet ? [displaySet] : [];
  },
};
