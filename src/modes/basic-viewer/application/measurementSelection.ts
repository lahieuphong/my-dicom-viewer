// Which measurements the basic-viewer lists and keeps selected; framework-free.

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

/**
 * The measurements the measurement panel lists: those of the open SR, or,
 * while none is open, the measurements of no SR in the series of the active
 * pane (`trackedSeriesUID`, whose images are `seriesImageIds`).
 */
export function listPanelMeasurements(
  measurements: readonly AnnotationMeasurement[],
  {
    activeSrId,
    trackedSeriesUID,
    seriesImageIds,
  }: {
    activeSrId: string | null;
    trackedSeriesUID: string;
    seriesImageIds: readonly string[];
  }
): AnnotationMeasurement[] {
  if (activeSrId) {
    return measurements.filter(
      (measurement) => measurement.metadata?.reportSeriesUID === activeSrId
    );
  }
  if (!trackedSeriesUID) return [];

  const normalizedImageIds = new Set(seriesImageIds.map(normalizeImageId));
  return measurements.filter(
    (measurement) =>
      !measurement.metadata?.reportSeriesUID &&
      isMeasurementInSeries(measurement, trackedSeriesUID, normalizedImageIds)
  );
}
