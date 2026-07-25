// src/hooks/useMeasurementBridge.ts
import { useEffect, useRef } from 'react';
import { annotation as csAnnotation } from '@cornerstonejs/tools';
import type { AnnotationMeasurement } from '@/hooks/useMeasurements';
import { ensureAnnotationAvailable } from '@/lib/cornerstone/annotations';
import {
  safeSetAnnotationVisibility,
  normalizeImageId,
} from '@/lib/cornerstone/helpers';
import { safeAddAnnotation } from '@/lib/viewer/annotationHelpers';

/**
 * useMeasurementBridge
 *
 * - Reconcile annotation objects from Cornerstone state with a viewport element.
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
  prevSelectedSeries,
  onAutoSelect,
}: {
  allMeasurements: AnnotationMeasurement[];
  viewportEl: HTMLDivElement | null;
  hiddenMeasurements: Set<string>;
  selectedSeries?: string | null;
  mergedSeriesMap?: Record<string, { files: string[]; metadata: any }>;
  renderingEngineRender?: () => void;
  prevSelectedSeries?: string | null;
  onAutoSelect?: (annotationUID: string, frameIndex: number) => void;
}) {
  // set of annotationUIDs that we've attached to the viewport
  const attachedRef = useRef<Set<string>>(new Set());

  // cache visibility to avoid repeated setVisibility calls
  const visibilityCacheRef = useRef<Map<string, boolean>>(new Map());
  const previousViewportElRef = useRef<HTMLDivElement | null>(null);

  // Measurements are auto-selected only once, when their UID first appears.
  // Without this persistent set, every parent render selected the whole list
  // again and the last item kept overwriting an explicit card selection.
  const autoSelectedUIDsRef = useRef<Set<string>>(new Set());

  // 1) These annotations are owned by Cornerstone/useMeasurements, not this
  // bridge. A viewport change only invalidates our local association caches.
  useEffect(() => {
    if (previousViewportElRef.current === viewportEl) return;
    previousViewportElRef.current = viewportEl;
    attachedRef.current.clear();
    visibilityCacheRef.current.clear();
  }, [viewportEl]);

  // 2) Ensure annotations are attached to viewport when measurement list changes / viewportEl available
  useEffect(() => {
    if (!viewportEl) return;

    const stateAny = csAnnotation.state as any;
    let cancelled = false;
    const currentUIDs = new Set(
      allMeasurements.map((measurement) => measurement.annotationUID)
    );
    const selectedFiles = new Set(
      (mergedSeriesMap?.[selectedSeries ?? '']?.files ?? []).map(normalizeImageId)
    );

    for (const uid of Array.from(attachedRef.current)) {
      if (!currentUIDs.has(uid)) {
        attachedRef.current.delete(uid);
        visibilityCacheRef.current.delete(uid);
      }
    }

    // Read recently removed set (if present on window) to avoid re-attach races.
    const recent = (typeof window !== 'undefined'
      ? (window as any).__recentlyRemovedAnnotations
      : null) as Set<string> | null;

    (async () => {
      for (const m of allMeasurements) {
        if (cancelled) break;
        const uid = m.annotationUID;

        // Skip if UID was just removed (avoid re-attaching a just-removed annotation)
        try {
          if (recent && recent.has(uid)) {
            continue;
          }
        } catch {
          // swallow
        }

        if (attachedRef.current.has(uid)) continue;

        let inst: any = null;

        // Try getAnnotation first (sync), fall back to ensureAnnotationAvailable (async wait)
        try {
          inst = stateAny.getAnnotation?.(uid) ?? null;
        } catch {
          inst = null;
        }

        if (!inst) {
          try {
            inst = await ensureAnnotationAvailable(uid, 1200, 50);
          } catch {
            inst = null;
          }
        }

        if (!inst) continue;
        if (cancelled) break;

        try {
          const meta = m.metadata ?? {};
          const refImg = normalizeImageId(
            String(
              meta.referencedImageId ??
                meta.imageId ??
                (m.data as any)?.referencedImageId ??
                (m.data as any)?.imageId ??
                ''
            )
          );
          const visible =
            !hiddenMeasurements.has(uid) &&
            (meta.seriesUID === selectedSeries || selectedFiles.has(refImg));
          const attached = await safeAddAnnotation(inst, viewportEl, { visible });

          if (!cancelled && attached) {
            attachedRef.current.add(uid);
            if (safeSetAnnotationVisibility(csAnnotation, uid, visible)) {
              visibilityCacheRef.current.set(uid, visible);
            }
          }
        } catch {}
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    allMeasurements,
    hiddenMeasurements,
    mergedSeriesMap,
    selectedSeries,
    viewportEl,
  ]);

  // 3) Sync visibility for each measurement based on selectedSeries / hiddenMeasurements / mergedSeriesMap
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
      const meta: any = m.metadata ?? {};

      const refImg =
        meta?.referencedImageId ??
        meta?.imageId ??
        (m.data as any)?.imageId ??
        '';

      const visible =
        !hiddenMeasurements.has(uid) &&
        (
          meta?.seriesUID === selectedSeries ||
          files.has(normalizeImageId(refImg))
        );

      const prev = visibilityCacheRef.current.get(uid);
      if (prev === undefined || prev !== visible) {
        try {
          const annotationExists = Boolean(stateAny?.getAnnotation?.(uid));
          const applied =
            annotationExists &&
            safeSetAnnotationVisibility(csAnnotation, uid, Boolean(visible));
          if (applied) {
            visibilityCacheRef.current.set(uid, visible);
            anyChanged = true;
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

  // 4) Auto-select only a newly-added measurement, once per annotation UID.
  useEffect(() => {
    if (!onAutoSelect || !viewportEl) return;

    const filesForSelected = new Set(
      (mergedSeriesMap?.[selectedSeries ?? '']?.files ?? []).map(normalizeImageId)
    );

    const newlyAdded = allMeasurements.filter(
      (measurement) =>
        !autoSelectedUIDsRef.current.has(measurement.annotationUID)
    );

    const candidates = newlyAdded.filter((m) => {
      const seriesUID = m.metadata?.seriesUID ?? '';
      const refImg = normalizeImageId(
        String(m.metadata?.referencedImageId ?? m.metadata?.imageId ?? '')
      );

      return (
        seriesUID === selectedSeries ||
        seriesUID === prevSelectedSeries ||
        filesForSelected.has(refImg)
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
  }, [allMeasurements, selectedSeries, viewportEl, prevSelectedSeries, mergedSeriesMap, onAutoSelect]);
}
