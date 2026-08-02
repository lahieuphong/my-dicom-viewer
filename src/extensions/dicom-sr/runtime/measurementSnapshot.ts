'use client';

import type { AnnotationMeasurement } from '@/hooks/useMeasurements';
import { hasActiveAnnotationInteraction } from '@/lib/cornerstone/annotationInteraction';
import { isAnnotationRemovalTombstoned } from '@/lib/viewer/annotationHelpers';
import type { Series } from '@/platform/core';

import type { SRMeasurement } from './generator';

type SeriesMapEntry = {
  files: string[];
  metadata: Series;
};

function cloneExportAnnotation(annotation: any): any {
  const data = { ...(annotation?.data ?? {}) };
  // SplineROI's runtime spline instance contains methods and is not part of
  // the measurement data encoded by the DICOM adapter.
  delete data.spline;
  const source = {
    ...annotation,
    data,
  };

  try {
    return structuredClone(source);
  } catch {
    return JSON.parse(JSON.stringify(source));
  }
}

function readLatestLabel(
  measurement: AnnotationMeasurement,
  annotation: any
): string | undefined {
  // An explicitly empty live label means the user cleared it. Do not fall
  // back to a stale React snapshot while that update is still propagating.
  if (
    Object.prototype.hasOwnProperty.call(
      annotation?.metadata ?? {},
      'label'
    ) ||
    Object.prototype.hasOwnProperty.call(annotation?.data ?? {}, 'label')
  ) {
    const liveLabel =
      typeof annotation?.metadata?.label === 'string'
        ? annotation.metadata.label
        : annotation?.data?.label;
    return typeof liveLabel === 'string' && liveLabel.trim()
      ? liveLabel.trim()
      : undefined;
  }

  const candidates = [
    annotation?.data?.text,
    measurement.label,
  ];
  return candidates.find(
    (value): value is string =>
      typeof value === 'string' && Boolean(value.trim())
  )?.trim();
}

export class StaleMeasurementSnapshotError extends Error {
  readonly missingAnnotationUIDs: string[];
  readonly expectedMeasurementCount: number;

  constructor(
    missingAnnotationUIDs: string[],
    expectedMeasurementCount: number
  ) {
    super(
      `Không thể tạo SR vì ${missingAnnotationUIDs.length}/${expectedMeasurementCount} measurement không còn đồng bộ với Cornerstone. Vui lòng thử lại sau khi danh sách Measurement được làm mới.`
    );
    this.name = 'StaleMeasurementSnapshotError';
    this.missingAnnotationUIDs = missingAnnotationUIDs;
    this.expectedMeasurementCount = expectedMeasurementCount;
  }
}

export class ActiveMeasurementInteractionError extends Error {
  constructor() {
    super(
      'Vui lòng hoàn tất thao tác vẽ hoặc chỉnh sửa Measurement trước khi tạo SR.'
    );
    this.name = 'ActiveMeasurementInteractionError';
  }
}

/**
 * OHIF-style intersection between tracked Measurement records and live
 * Cornerstone annotations. Unlike a permissive filter, this is all-or-nothing:
 * a stale card must never produce a silently incomplete report.
 */
export function collectSrMeasurementSnapshot({
  allMeasurements,
  seriesMap,
  studyInstanceUID,
  trackedSeriesInstanceUID,
  getAnnotation,
}: {
  allMeasurements: AnnotationMeasurement[];
  seriesMap: Record<string, SeriesMapEntry>;
  studyInstanceUID: string;
  trackedSeriesInstanceUID: string;
  getAnnotation: (annotationUID: string) => any | null | undefined;
}): SRMeasurement[] {
  if (hasActiveAnnotationInteraction()) {
    throw new ActiveMeasurementInteractionError();
  }

  const candidates = new Map<string, AnnotationMeasurement>();

  for (const measurement of allMeasurements) {
    const annotationUID = String(measurement.annotationUID ?? '');
    const seriesInstanceUID = String(
      measurement.metadata?.seriesUID ?? ''
    );
    const series = seriesMap[seriesInstanceUID];

    if (
      !annotationUID ||
      isAnnotationRemovalTombstoned(annotationUID) ||
      Boolean(measurement.metadata?.reportSeriesUID) ||
      measurement.metadata?.studyUID !== studyInstanceUID ||
      seriesInstanceUID !== trackedSeriesInstanceUID ||
      !series ||
      series.metadata?.seriesModality === 'SR'
    ) {
      continue;
    }
    candidates.set(annotationUID, measurement);
  }

  const missingAnnotationUIDs: string[] = [];
  const snapshot: SRMeasurement[] = [];

  for (const [annotationUID, measurement] of candidates) {
    const annotation = getAnnotation(annotationUID);
    if (!annotation) {
      missingAnnotationUIDs.push(annotationUID);
      continue;
    }

    snapshot.push({
      uid: annotationUID,
      label: readLatestLabel(measurement, annotation),
      // Freeze geometry and metadata at confirmation time. Later edits,
      // visibility changes or deletion cannot mutate an in-flight export.
      annotation: cloneExportAnnotation(annotation),
    });
  }

  if (missingAnnotationUIDs.length) {
    throw new StaleMeasurementSnapshotError(
      missingAnnotationUIDs,
      candidates.size
    );
  }

  return snapshot;
}
