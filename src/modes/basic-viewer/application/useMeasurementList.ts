// Every measurement of the basic-viewer mode's study.
'use client';

import { useCallback, useEffect, useState, type RefObject } from 'react';
import { annotation as csAnnotation } from '@cornerstonejs/tools';

import type { AnnotationMeasurement } from '@/platform/core';
import { isAnnotationRemovalTombstoned } from '@/lib/viewer/annotationHelpers';
import { createMeasurementListFingerprint } from '@/lib/viewer/measurementFingerprint';

import { mergeMeasurementSnapshot, type SeriesFilesMap } from './measurementSnapshot';

/**
 * The study's measurements, kept from the snapshots useMeasurements sends
 * (see mergeMeasurementSnapshot). A snapshot that changes nothing keeps the
 * previous array, so nothing rerenders. The list empties when the study
 * changes. useMeasurementSelection clears a selection that left the list.
 */
export function useMeasurementList({
  studyUID,
  seriesMapRef,
}: {
  studyUID: string;
  seriesMapRef: RefObject<SeriesFilesMap>;
}) {
  const [allMeasurements, setAllMeasurements] = useState<AnnotationMeasurement[]>([]);

  const handleMeasurementsChange = useCallback(
    (current: AnnotationMeasurement[]) => {
      setAllMeasurements((previous) => {
        const getAnnotation = (csAnnotation.state as any)?.getAnnotation;
        const next = mergeMeasurementSnapshot(previous, current, {
          seriesMap: seriesMapRef.current || {},
          isRemoved: isAnnotationRemovalTombstoned,
          getAnnotation:
            typeof getAnnotation === 'function'
              ? (annotationUID) =>
                  getAnnotation.call(csAnnotation.state, annotationUID)
              : undefined,
        });
        return createMeasurementListFingerprint(previous) ===
          createMeasurementListFingerprint(next)
          ? previous
          : next;
      });
    },
    [seriesMapRef]
  );

  useEffect(() => {
    setAllMeasurements([]);
  }, [studyUID]);

  return { allMeasurements, setAllMeasurements, handleMeasurementsChange };
}
