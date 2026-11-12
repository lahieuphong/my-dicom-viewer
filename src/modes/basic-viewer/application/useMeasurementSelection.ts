// The selected measurement of the basic-viewer mode.
'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from 'react';

import type { AnnotationMeasurement } from '@/platform/core';
import {
  syncMeasurementNativeSelection,
  syncMeasurementSelectionStyles,
} from '@/lib/cornerstone/measurementStyles';

import { isMeasurementSelectionShown } from './measurementSelection';
import type { SeriesMapEntry } from './useSeriesLoader';

/**
 * The selected measurement's annotation UID. commitSelectedMeasurementUID is
 * its only writer and updates the ref right away, so a handler that runs
 * before the next render already sees the new selection. A selection the
 * viewer no longer shows (see isMeasurementSelectionShown) is cleared, and
 * so is every selection when the study changes.
 */
export function useMeasurementSelection({
  studyUID,
  allMeasurements,
  activeSrId,
  selectedSeries,
  mergedSeriesMap,
}: {
  studyUID: string;
  allMeasurements: AnnotationMeasurement[];
  activeSrId: string | null;
  selectedSeries: string;
  mergedSeriesMap: Record<string, SeriesMapEntry>;
}) {
  const [selectedMeasurementUID, setSelectedMeasurementUID] = useState<
    string | null
  >(null);
  const selectedMeasurementUIDRef = useRef<string | null>(null);

  const commitSelectedMeasurementUID = useCallback((uid: string | null) => {
    selectedMeasurementUIDRef.current = uid;
    setSelectedMeasurementUID(uid);
  }, []);

  useEffect(() => {
    commitSelectedMeasurementUID(null);
  }, [commitSelectedMeasurementUID, studyUID]);

  useEffect(() => {
    if (!selectedMeasurementUID) return;
    const measurement = allMeasurements.find(
      (candidate) => candidate.annotationUID === selectedMeasurementUID
    );
    if (
      !isMeasurementSelectionShown(measurement, {
        activeSrId,
        selectedSeries,
        seriesImageIds: mergedSeriesMap[selectedSeries]?.files ?? [],
      })
    ) {
      commitSelectedMeasurementUID(null);
    }
  }, [
    activeSrId,
    allMeasurements,
    commitSelectedMeasurementUID,
    mergedSeriesMap,
    selectedMeasurementUID,
    selectedSeries,
  ]);

  return {
    selectedMeasurementUID,
    selectedMeasurementUIDRef,
    commitSelectedMeasurementUID,
  };
}

const UID_SEPARATOR = '\u001f';

/**
 * Applies the selection to Cornerstone: the selected or unselected style on
 * every measurement's annotation (styles of annotations that are no longer
 * measurements are released) and Cornerstone's own selection. Hiding an
 * annotation deselects it inside Cornerstone, so showing it again (or showing
 * its series or SR again) restores that selection without rewriting every
 * annotation's style. Unmounting releases the styles.
 *
 * Cornerstone's own selection only follows a visible annotation, so call
 * this after the hook that applies measurement visibility
 * (useMeasurementBridge): effects run in call order.
 */
export function useMeasurementSelectionStyles({
  allMeasurements,
  hiddenMeasurements,
  selectedMeasurementUID,
  selectedMeasurementUIDRef,
  activeSrId,
  selectedSeries,
  renderViewport,
}: {
  allMeasurements: AnnotationMeasurement[];
  hiddenMeasurements: ReadonlySet<string>;
  selectedMeasurementUID: string | null;
  selectedMeasurementUIDRef: MutableRefObject<string | null>;
  activeSrId: string | null;
  selectedSeries: string;
  renderViewport: () => void;
}) {
  // Sorted UID lists, so the effects run when the set changes rather than
  // whenever the arrays are rebuilt.
  const measurementUIDSignature = useMemo(
    () =>
      Array.from(
        new Set(
          allMeasurements
            .map((measurement) => measurement.annotationUID)
            .filter(Boolean)
        )
      )
        .sort()
        .join(UID_SEPARATOR),
    [allMeasurements]
  );
  const hiddenMeasurementUIDSignature = useMemo(
    () => Array.from(hiddenMeasurements).sort().join(UID_SEPARATOR),
    [hiddenMeasurements]
  );

  useEffect(() => {
    syncMeasurementSelectionStyles(
      measurementUIDSignature ? measurementUIDSignature.split(UID_SEPARATOR) : [],
      selectedMeasurementUID
    );
    renderViewport();
  }, [measurementUIDSignature, selectedMeasurementUID, renderViewport]);

  useEffect(() => {
    syncMeasurementNativeSelection(selectedMeasurementUIDRef.current);
  }, [activeSrId, hiddenMeasurementUIDSignature, selectedMeasurementUIDRef, selectedSeries]);

  useEffect(
    () => () => {
      syncMeasurementSelectionStyles([], null);
    },
    []
  );
}
