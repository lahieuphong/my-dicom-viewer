import type { AnnotationMeasurement } from '@/extensions/cornerstone';
import { findMatchingImageIdIndex } from '@/lib/cornerstone/helpers';
import { normalizeId } from '@/lib/viewer/dom';

/** The part of the viewer's series map that measurement attribution needs. */
export type SeriesFilesMap = Readonly<
  Record<string, { files?: readonly string[] } | undefined>
>;

export type MergeMeasurementSnapshotOptions = {
  seriesMap: SeriesFilesMap;
  /** True for a measurement the user deleted that must not reappear. */
  isRemoved: (annotationUID: string) => boolean;
  /**
   * Looks an annotation up in the annotation runtime, which is the source of
   * truth for whether it still exists. Without it, every previous
   * measurement that is missing from the snapshot is kept.
   */
  getAnnotation?: (annotationUID: string) => unknown;
};

function seriesFiles(seriesMap: SeriesFilesMap, seriesUID: string) {
  return (seriesMap[seriesUID]?.files ?? []) as string[];
}

/** The first series whose stack contains the referenced image. */
export function findSeriesUIDByImageId(
  seriesMap: SeriesFilesMap,
  referencedImageId: string
): string | undefined {
  for (const [seriesUID, entry] of Object.entries(seriesMap ?? {})) {
    if (
      findMatchingImageIdIndex(
        (entry?.files ?? []) as string[],
        referencedImageId
      ) >= 0
    ) {
      return seriesUID;
    }
  }
  return undefined;
}

/**
 * Resolves the series of an annotation's image: by image identity first,
 * then by the SOP part of the ID for references that carry another prefix.
 */
export function resolveSeriesFromImageId(
  seriesMap: SeriesFilesMap,
  referencedImageId?: string
): string | undefined {
  if (!referencedImageId) return undefined;

  const byImage = findSeriesUIDByImageId(seriesMap, referencedImageId);
  if (byImage) return byImage;

  const sopMatch = String(referencedImageId)
    .replace(/^imageId:/, '')
    .split('/')
    .pop();
  if (sopMatch) {
    for (const [seriesUID, entry] of Object.entries(seriesMap ?? {})) {
      const files = entry?.files ?? [];
      if (files.some((file) => normalizeId(file).includes(sopMatch))) {
        return seriesUID;
      }
    }
  }

  return undefined;
}

function getImageReference(measurement: AnnotationMeasurement) {
  return (
    measurement.metadata?.referencedImageId ??
    measurement.metadata?.imageId ??
    measurement.data?.imageId ??
    ''
  ).toString();
}

function readFrameIndex(measurement: AnnotationMeasurement) {
  return Number.isFinite(Number(measurement.metadata?.frameIndex))
    ? Number(measurement.metadata.frameIndex)
    : undefined;
}

/** A measurement seen for the first time: attribute its series and frame. */
function enrichNewMeasurement(
  measurement: AnnotationMeasurement,
  seriesMap: SeriesFilesMap
): AnnotationMeasurement {
  let seriesUID = measurement.metadata?.seriesUID ?? '';
  if (!seriesUID) {
    const reference = getImageReference(measurement);
    if (reference) {
      seriesUID = findSeriesUIDByImageId(seriesMap, reference) ?? '';
    }
  }

  const files = seriesFiles(seriesMap, seriesUID);
  let frameIndex = readFrameIndex(measurement);
  if (frameIndex === undefined) {
    const reference = getImageReference(measurement);
    if (reference && files.length) {
      const found = findMatchingImageIdIndex(
        files,
        reference,
        measurement.metadata?.frameIndex
      );
      if (found >= 0) frameIndex = found;
    }
  }
  if (frameIndex === undefined) frameIndex = 0;

  return {
    ...measurement,
    label: measurement.label ?? '',
    data: measurement.data ?? {},
    metadata: {
      ...(measurement.metadata || {}),
      seriesUID,
      frameIndex,
    },
    createdAt: measurement.createdAt || new Date().toISOString(),
  };
}

/**
 * A measurement already in the list: take the update, but keep a series and
 * frame that still resolve when the update lacks or contradicts them.
 */
function mergeExistingMeasurement(
  previous: AnnotationMeasurement,
  measurement: AnnotationMeasurement,
  seriesMap: SeriesFilesMap
): AnnotationMeasurement {
  const newSeries = measurement.metadata?.seriesUID ?? '';
  const oldSeries = previous.metadata?.seriesUID ?? '';

  let seriesUID = '';
  if (
    typeof newSeries === 'string' &&
    newSeries.length > 0 &&
    Boolean(seriesMap?.[newSeries])
  ) {
    seriesUID = newSeries;
  } else if (oldSeries && Boolean(seriesMap?.[oldSeries])) {
    seriesUID = oldSeries;
  } else {
    const reference = getImageReference(measurement);
    if (reference) {
      seriesUID = findSeriesUIDByImageId(seriesMap, reference) ?? '';
    }
  }

  const files = seriesFiles(seriesMap, seriesUID);
  const previousFrameIndex =
    typeof previous.metadata?.frameIndex === 'number'
      ? previous.metadata.frameIndex
      : 0;
  let frameIndex = readFrameIndex(measurement);
  if (
    frameIndex === undefined ||
    frameIndex < 0 ||
    (files.length && frameIndex >= files.length)
  ) {
    // Unlike for a new measurement, only the referenced image is used here.
    const reference = (measurement.metadata?.referencedImageId ?? '').toString();
    if (reference && files.length) {
      const found = findMatchingImageIdIndex(
        files,
        reference,
        measurement.metadata?.frameIndex
      );
      frameIndex =
        found >= 0
          ? found
          : Math.max(0, Math.min(previousFrameIndex, files.length - 1));
    } else {
      frameIndex = previousFrameIndex;
    }
  }

  return {
    ...previous,
    ...measurement,
    label: measurement.label ?? previous.label,
    data: measurement.data ?? previous.data,
    metadata: {
      ...(previous.metadata || {}),
      ...(measurement.metadata || {}),
      seriesUID,
      frameIndex,
    },
    createdAt:
      measurement.createdAt || previous.createdAt || new Date().toISOString(),
  };
}

/**
 * Merges a snapshot of the mounted viewport's measurements into the list of
 * every measurement in the study.
 *
 * The snapshot only covers the annotations the viewport can read, so a
 * previous measurement missing from it is kept while the annotation runtime
 * still has it (for example one in another frame of reference) and dropped
 * once it does not (Escape/cancel, or an external removal). Deleted
 * measurements never come back.
 */
export function mergeMeasurementSnapshot(
  previous: readonly AnnotationMeasurement[],
  current: readonly AnnotationMeasurement[],
  { seriesMap, isRemoved, getAnnotation }: MergeMeasurementSnapshotOptions
): AnnotationMeasurement[] {
  const currentUIDs = new Set(
    current.map((measurement) => measurement.annotationUID)
  );
  const previousByUID = new Map(
    previous
      .filter((measurement) => !isRemoved(measurement.annotationUID))
      .filter((measurement) => {
        if (currentUIDs.has(measurement.annotationUID) || !getAnnotation) {
          return true;
        }
        try {
          return Boolean(getAnnotation(measurement.annotationUID));
        } catch {
          return true;
        }
      })
      .map((measurement) => [measurement.annotationUID, measurement] as const)
  );
  const merged = new Map(previousByUID);

  for (const measurement of current) {
    if (isRemoved(measurement.annotationUID)) continue;
    try {
      const existing = previousByUID.get(measurement.annotationUID);
      merged.set(
        measurement.annotationUID,
        existing
          ? mergeExistingMeasurement(existing, measurement, seriesMap)
          : enrichNewMeasurement(measurement, seriesMap)
      );
    } catch {
      // Keep the previous entry for a measurement that cannot be merged.
    }
  }

  return Array.from(merged.values());
}
