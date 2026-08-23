// src/hooks/useMeasurementBridge.ts
import { useEffect, useRef } from 'react';
import {
  annotation as csAnnotation,
  utilities as csToolsUtilities,
} from '@cornerstonejs/tools';
import { getRenderingEngines } from '@cornerstonejs/core';
import type { AnnotationMeasurement } from '@/hooks/useMeasurements';
import {
  safeSetAnnotationVisibility,
  normalizeImageId,
} from '@/lib/cornerstone/helpers';
import { isMeasurementInSeries } from '@/lib/viewer/measurementVisibility';

/**
 * useMeasurementBridge
 *
 * - Reconcile source-series visibility and the active read-only SR overlay.
 * - Gọi onAutoSelect (nếu có) cho mỗi annotationUID phù hợp, deduplicate.
 */
export function useMeasurementBridge({
  allMeasurements,
  viewportEl,
  hiddenMeasurements,
  selectedSeries,
  visibleSeriesUIDs = [],
  activeSrId,
  mergedSeriesMap,
  renderingEngineRender,
  onAutoSelect,
}: {
  allMeasurements: AnnotationMeasurement[];
  viewportEl: HTMLDivElement | null;
  hiddenMeasurements: Set<string>;
  selectedSeries?: string | null;
  visibleSeriesUIDs?: readonly string[];
  activeSrId?: string | null;
  mergedSeriesMap?: Record<string, { files: string[]; metadata: any }>;
  renderingEngineRender?: () => void;
  onAutoSelect?: (annotationUID: string, frameIndex: number) => void;
}) {
  // Measurements are auto-selected only once, when their UID first appears.
  // Without this persistent set, every parent render selected the whole list
  // again and the last item kept overwriting an explicit card selection.
  const autoSelectedUIDsRef = useRef<Set<string>>(new Set());

  // Sync visibility for each measurement based on selected series and hidden state.
  useEffect(() => {
    if (!viewportEl) return;

    const displayedSeriesUIDs = Array.from(
      new Set(
        [selectedSeries, ...visibleSeriesUIDs].filter(
          (seriesUID): seriesUID is string => Boolean(seriesUID)
        )
      )
    );
    const filesBySeriesUID = new Map(
      displayedSeriesUIDs.map((seriesUID) => [
        seriesUID,
        new Set(
          (mergedSeriesMap?.[seriesUID]?.files ?? []).map(normalizeImageId)
        ),
      ])
    );
    let anyChanged = false;
    let hasRegisteredAnnotation = false;

    for (const m of allMeasurements) {
      const uid = m.annotationUID;

      const reportSeriesUID = m.metadata?.reportSeriesUID;
      const visible = activeSrId
        ? reportSeriesUID === activeSrId
        : !reportSeriesUID &&
          !hiddenMeasurements.has(uid) &&
          displayedSeriesUIDs.some((seriesUID) =>
            isMeasurementInSeries(
              m,
              seriesUID,
              filesBySeriesUID.get(seriesUID) ?? new Set<string>()
            )
          );

      try {
        if (!csAnnotation.state.getAnnotation(uid)) continue;
        hasRegisteredAnnotation = true;

        const actual = csAnnotation.visibility.isAnnotationVisible(uid);
        if (actual === visible) continue;

        if (safeSetAnnotationVisibility(csAnnotation, uid, visible)) {
          anyChanged = true;
        }
      } catch {
        // A later measurement/state update will reconcile again.
      }
    }

    if (hasRegisteredAnnotation || allMeasurements.length === 0) {
      const targetElements = new Set<HTMLDivElement>([viewportEl]);
      try {
        for (const renderingEngine of getRenderingEngines() ?? []) {
          for (const viewport of renderingEngine.getViewports?.() ?? []) {
            const candidate = viewport?.element as
              | HTMLDivElement
              | undefined;
            if (candidate?.dataset?.viewportRole === 'content') {
              targetElements.add(candidate);
            }
          }
        }
      } catch {}

      let rendered = false;
      for (const targetElement of targetElements) {
        try {
          // Visibility is rendered by Cornerstone Tools' annotation SVG
          // engine, so reconcile every mounted content viewport.
          csToolsUtilities.triggerAnnotationRender(targetElement);
          rendered = true;
        } catch {}
      }
      if (!rendered && anyChanged) {
        try {
          renderingEngineRender?.();
        } catch {}
      }
    }
  }, [
    allMeasurements,
    activeSrId,
    selectedSeries,
    visibleSeriesUIDs,
    hiddenMeasurements,
    mergedSeriesMap,
    viewportEl,
    renderingEngineRender,
  ]);

  // Auto-select only a newly-added measurement, once per annotation UID.
  useEffect(() => {
    if (!onAutoSelect || !viewportEl) return;

    const filesForSelected = new Set(
      (mergedSeriesMap?.[selectedSeries ?? '']?.files ?? []).map(normalizeImageId)
    );

    const newlyAdded = allMeasurements.filter(
      (measurement) =>
        !autoSelectedUIDsRef.current.has(measurement.annotationUID)
    );

    const candidates = newlyAdded.filter((measurement) => {
      const reportSeriesUID = measurement.metadata?.reportSeriesUID;
      if (activeSrId) return reportSeriesUID === activeSrId;
      return (
        !reportSeriesUID &&
        isMeasurementInSeries(
          measurement,
          selectedSeries,
          filesForSelected
        )
      );
    });

    for (const measurement of newlyAdded) {
      autoSelectedUIDsRef.current.add(measurement.annotationUID);
    }

    if (candidates.length === 0) return;

    const newest = candidates.reduce((latest, candidate) => {
      const latestTime = Date.parse(latest.createdAt ?? latest.metadata?.createdAt ?? '');
      const candidateTime = Date.parse(
        candidate.createdAt ?? candidate.metadata?.createdAt ?? ''
      );
      if (!Number.isFinite(candidateTime)) return latest;
      if (!Number.isFinite(latestTime) || candidateTime >= latestTime) return candidate;
      return latest;
    });

    const frameIndex =
      typeof newest.metadata?.frameIndex === 'number' ? newest.metadata.frameIndex : 0;
    try {
      onAutoSelect(newest.annotationUID, frameIndex);
    } catch {
      autoSelectedUIDsRef.current.delete(newest.annotationUID);
    }
  }, [
    activeSrId,
    allMeasurements,
    selectedSeries,
    viewportEl,
    mergedSeriesMap,
    onAutoSelect,
  ]);
}
