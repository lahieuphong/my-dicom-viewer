// src/hooks/useMeasurementBridge.ts
import { useEffect, useRef } from 'react';
import { annotation as csAnnotation } from '@cornerstonejs/tools';
import type { AnnotationMeasurement } from '@/hooks/useMeasurements';
import {
  safeSetAnnotationVisibility,
  normalizeImageId,
} from '@/lib/cornerstone/helpers';
import { isMeasurementInSeries } from '@/lib/viewer/measurementVisibility';

/**
 * useMeasurementBridge
 *
 * - Quản lý visibility dựa trên selectedSeries / hiddenMeasurements / mergedSeriesMap.
 * - Reset local caches when the viewport element changes.
 * - Gọi onAutoSelect (nếu có) cho mỗi annotationUID phù hợp, deduplicate.
 */
export function useMeasurementBridge({
  allMeasurements,
  viewportEl,
  hiddenMeasurements,
  selectedSeries,
  mergedSeriesMap,
  renderingEngineRender,
  onAutoSelect,
}: {
  allMeasurements: AnnotationMeasurement[];
  viewportEl: HTMLDivElement | null;
  hiddenMeasurements: Set<string>;
  selectedSeries?: string | null;
  mergedSeriesMap?: Record<string, { files: string[]; metadata: any }>;
  renderingEngineRender?: () => void;
  onAutoSelect?: (annotationUID: string, frameIndex: number) => void;
}) {
  // cache visibility to avoid repeated setVisibility calls
  const visibilityCacheRef = useRef<Map<string, boolean>>(new Map());
  const previousViewportElRef = useRef<HTMLDivElement | null>(null);

  // Measurements are auto-selected only once, when their UID first appears.
  // Without this persistent set, every parent render selected the whole list
  // again and the last item kept overwriting an explicit card selection.
  const autoSelectedUIDsRef = useRef<Set<string>>(new Set());

  // Cornerstone/useMeasurements owns annotation registration. The bridge only
  // owns derived visibility and auto-selection state.
  useEffect(() => {
    if (previousViewportElRef.current === viewportEl) return;
    previousViewportElRef.current = viewportEl;
    visibilityCacheRef.current.clear();
  }, [viewportEl]);

  // Sync visibility for each measurement based on selected series and hidden state.
  useEffect(() => {
    if (!viewportEl) return;

    const files = new Set(
      (mergedSeriesMap?.[selectedSeries ?? '']?.files ?? []).map(normalizeImageId)
    );
    const currentUIDs = new Set(
      allMeasurements.map((measurement) => measurement.annotationUID)
    );
    let anyChanged = false;
    const stateAny = csAnnotation.state as any;

    for (const uid of Array.from(visibilityCacheRef.current.keys())) {
      if (!currentUIDs.has(uid)) {
        visibilityCacheRef.current.delete(uid);
      }
    }

    for (const m of allMeasurements) {
      const uid = m.annotationUID;

      const visible =
        !hiddenMeasurements.has(uid) &&
        isMeasurementInSeries(m, selectedSeries, files);

      const prev = visibilityCacheRef.current.get(uid);
      if (prev === undefined || prev !== visible) {
        try {
          const annotationExists = Boolean(stateAny?.getAnnotation?.(uid));
          const previousVisibility =
            (csAnnotation.visibility as any)?.isAnnotationVisible?.(uid);
          const applied =
            annotationExists &&
            safeSetAnnotationVisibility(csAnnotation, uid, Boolean(visible));
          if (applied) {
            visibilityCacheRef.current.set(uid, visible);
            anyChanged = anyChanged || previousVisibility !== visible;
          } else {
            // Retry after asynchronous annotation registration.
            visibilityCacheRef.current.delete(uid);
          }
        } catch {
          visibilityCacheRef.current.delete(uid);
        }
      }
    }

    if (anyChanged) {
      try {
        renderingEngineRender?.();
      } catch {}
    }
  }, [allMeasurements, selectedSeries, hiddenMeasurements, mergedSeriesMap, viewportEl, renderingEngineRender]);

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

    const candidates = newlyAdded.filter((measurement) =>
      isMeasurementInSeries(
        measurement,
        selectedSeries,
        filesForSelected
      )
    );

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
  }, [allMeasurements, selectedSeries, viewportEl, mergedSeriesMap, onAutoSelect]);
}
