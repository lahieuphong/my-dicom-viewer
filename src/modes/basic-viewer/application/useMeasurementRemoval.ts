// Removing measurements in the basic-viewer mode.
'use client';

import {
  useCallback,
  useEffect,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import { annotation as csAnnotation } from '@cornerstonejs/tools';

import type { AnnotationMeasurement } from '@/platform/core';
import { releaseMeasurementAnnotationStyle } from '@/lib/cornerstone/measurementStyles';
import { safeRemoveAnnotationByUID } from '@/lib/viewer/annotationHelpers';
import { createSingleFlight } from '@/lib/utils/asyncQueues';

import { removeMeasurement } from './measurementRemoval';

/**
 * The measurement panel's delete action (see removeMeasurement). A second
 * delete click for a measurement that is still being removed gets the same
 * result instead of starting another removal. A removed measurement leaves
 * the list, its style and its hidden state, and the measurements are
 * refreshed from Cornerstone.
 */
export function useMeasurementRemoval({
  studyUID,
  selectedMeasurementUIDRef,
  commitSelectedMeasurementUID,
  selectionQueue,
  setAllMeasurements,
  forgetMeasurement,
  refreshMeasurements,
  renderViewport,
}: {
  studyUID: string;
  selectedMeasurementUIDRef: MutableRefObject<string | null>;
  commitSelectedMeasurementUID: (uid: string | null) => void;
  selectionQueue: {
    dropPending: (predicate: (measurement: AnnotationMeasurement) => boolean) => void;
  };
  setAllMeasurements: Dispatch<SetStateAction<AnnotationMeasurement[]>>;
  forgetMeasurement: (annotationUID: string) => void;
  refreshMeasurements: () => void;
  renderViewport: () => void;
}) {
  const [deletions] = useState(() => createSingleFlight<string, boolean>());

  useEffect(() => {
    deletions.clear();
  }, [deletions, studyUID]);

  return useCallback(
    (uid: string): Promise<boolean> => {
      if (!uid) return Promise.resolve(false);

      return deletions.run(uid, () =>
        removeMeasurement(uid, {
          removeAnnotation: safeRemoveAnnotationByUID,
          hasAnnotation: (annotationUID) => {
            try {
              return Boolean(
                (csAnnotation.state as any)?.getAnnotation?.(annotationUID)
              );
            } catch {
              return false;
            }
          },
          getSelectedUID: () => selectedMeasurementUIDRef.current,
          setSelectedUID: commitSelectedMeasurementUID,
          dropPendingSelection: (annotationUID) =>
            selectionQueue.dropPending(
              (measurement) => measurement.annotationUID === annotationUID
            ),
          forgetRemoved: (annotationUID) => {
            releaseMeasurementAnnotationStyle(annotationUID);
            setAllMeasurements((previous) =>
              previous.filter(
                (measurement) => measurement.annotationUID !== annotationUID
              )
            );
            forgetMeasurement(annotationUID);
            try {
              refreshMeasurements();
            } catch {}
            renderViewport();
          },
        })
      );
    },
    [
      commitSelectedMeasurementUID,
      deletions,
      forgetMeasurement,
      refreshMeasurements,
      renderViewport,
      selectedMeasurementUIDRef,
      selectionQueue,
      setAllMeasurements,
    ]
  );
}
