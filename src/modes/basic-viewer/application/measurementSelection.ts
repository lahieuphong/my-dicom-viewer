// Which measurement selection the basic-viewer keeps; framework-free.

import type { AnnotationMeasurement } from '@/platform/core';
import { normalizeImageId } from '@/lib/cornerstone/helpers';
import { isMeasurementInSeries } from '@/lib/viewer/measurementVisibility';

/**
 * Whether a selected measurement is still one the viewer shows: it exists,
 * belongs to the open SR (or to no SR while none is open) and is in the
 * selected series. A selection that fails this is cleared.
 */
export function isMeasurementSelectionShown(
  measurement: AnnotationMeasurement | null | undefined,
  {
    activeSrId,
    selectedSeries,
    seriesImageIds,
  }: {
    activeSrId: string | null;
    selectedSeries: string;
    seriesImageIds: readonly string[];
  }
): boolean {
  if (!measurement) return false;

  const reportSeriesUID = measurement.metadata?.reportSeriesUID ?? null;
  if (activeSrId ? reportSeriesUID !== activeSrId : reportSeriesUID) {
    return false;
  }

  return isMeasurementInSeries(
    measurement,
    selectedSeries,
    new Set(seriesImageIds.map(normalizeImageId))
  );
}
