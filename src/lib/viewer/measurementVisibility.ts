'use client';

import type { AnnotationMeasurement } from '@/hooks/useMeasurements';
import { normalizeImageId } from '@/lib/cornerstone/helpers';

/**
 * A recorded series UID is authoritative. Referenced-image matching is only a
 * compatibility fallback for legacy measurements that do not have a series.
 *
 * This prevents annotations from another source/SR series that reuses the same
 * imageIds from leaking into the current panel or viewport.
 */
export function isMeasurementInSeries(
  measurement: AnnotationMeasurement,
  selectedSeries: string | null | undefined,
  normalizedSelectedImageIds: ReadonlySet<string>
): boolean {
  if (!selectedSeries) return false;

  const seriesUID = String(measurement.metadata?.seriesUID ?? '');
  if (seriesUID) {
    return seriesUID === selectedSeries;
  }

  const referencedImageId = normalizeImageId(
    String(
      measurement.metadata?.referencedImageId ??
        measurement.metadata?.imageId ??
        (measurement.data as any)?.referencedImageId ??
        (measurement.data as any)?.imageId ??
        ''
    )
  );

  return (
    Boolean(referencedImageId) &&
    normalizedSelectedImageIds.has(referencedImageId)
  );
}
