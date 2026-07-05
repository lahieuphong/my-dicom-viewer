// src/hooks/useMeasurementBridge.ts
import { useEffect, useRef } from 'react';
import { annotation as csAnnotation } from '@cornerstonejs/tools';
import type { AnnotationMeasurement } from '@/hooks/useMeasurements';
import { ensureAnnotationAvailable } from '@/lib/annotationUtils';
import {
  safeRemoveAnnotation,
  safeSetAnnotationVisibility,
  normalizeImageId,
} from '@/lib/cornerstoneHelpers';

/**
 * useMeasurementBridge
 *
 * - Gắn annotation object từ Cornerstone annotation state vào một viewport DOM element.
 * - Quản lý visibility dựa trên selectedSeries / hiddenMeasurements / mergedSeriesMap.
 * - Khi viewport element bị remove, xoá annotation liên quan và reset cache.
 * - Gọi onAutoSelect (nếu có) cho mỗi annotationUID phù hợp, deduplicate.
 *
 * Lưu ý: giữ hành vi "swallow errors" (im lặng) tương tự code gốc để tránh phá vỡ UI.
 */
export function useMeasurementBridge({
  allMeasurements,
  viewportEl,
  hiddenMeasurements,
  selectedSeries,
  mergedSeriesMap,
  renderingEngineRender,
  viewportId,
  prevSelectedSeries,
  onAutoSelect,
}: {
  allMeasurements: AnnotationMeasurement[];
  viewportEl: HTMLDivElement | null;
  hiddenMeasurements: Set<string>;
  selectedSeries?: string | null;
  mergedSeriesMap?: Record<string, { files: string[]; metadata: any }>;
  renderingEngineRender?: () => void;
  viewportId?: string;
  prevSelectedSeries?: string | null;
  onAutoSelect?: (annotationUID: string, frameIndex: number) => void;
}) {
  // set of annotationUIDs that we've attached to the viewport
  const attachedRef = useRef<Set<string>>(new Set());

  // cache visibility to avoid repeated setVisibility calls
  const visibilityCacheRef = useRef<Map<string, boolean>>(new Map());

  // util: safely obtain the annotation "state" or module object from the imported csAnnotation
  const getAnnotationState = () => {
    // the csAnnotation import might be the state object itself or have a .state property
    return ((csAnnotation as any).state ?? (csAnnotation as any)) as any;
  };

  // 1) Cleanup when viewportEl is removed: remove attached annotations & clear visibility cache
  useEffect(() => {
    if (viewportEl) return;

    // viewport was removed (or not present) -> clear caches and remove annotations
    const stateAny = getAnnotationState();
    const toRemove = Array.from(attachedRef.current);

    // Fire-and-forget removals but use Promise.allSettled to attempt them
    (async () => {
      try {
        await Promise.allSettled(
          toRemove.map(async (uid) => {
            try {
              await safeRemoveAnnotation(stateAny, uid);
            } catch {
              // swallow
            }
          })
        );
      } catch {
        // swallow
      } finally {
        attachedRef.current.clear();
        visibilityCacheRef.current = new Map();
      }
    })();

    // nothing to cleanup on unmount here because we are handling immediate removal
  }, [viewportEl]);

  // 2) Ensure annotations are attached to viewport when measurement list changes / viewportEl available
  useEffect(() => {
    if (!viewportEl) return;

    const stateAny = getAnnotationState();
    const addFn = stateAny?.addAnnotation;
    let cancelled = false;
    const locallyAdded: string[] = [];

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

        try {
          // call addAnnotation either as promise or sync
          if (typeof addFn === 'function') {
            const res = addFn.call(stateAny, inst, viewportEl);
            if (res && typeof res.then === 'function') {
              await res;
            }
          } else {
            try {
              stateAny.addAnnotation?.(inst, viewportEl);
            } catch {
              // swallow
            }
          }

          attachedRef.current.add(uid);
          locallyAdded.push(uid);
        } catch {
          // last-resort: try the simple call and mark attached if succeeds
          try {
            stateAny.addAnnotation?.(inst, viewportEl);
            attachedRef.current.add(uid);
            locallyAdded.push(uid);
          } catch {
            // swallow
          }
        }
      }
    })();

    // cleanup for this effect - remove only those we added in this run
    return () => {
      cancelled = true;
      (async () => {
        const s = getAnnotationState();
        await Promise.allSettled(
          locallyAdded.map(async (uid) => {
            try {
              await safeRemoveAnnotation(s, uid);
            } catch {
              // swallow
            } finally {
              attachedRef.current.delete(uid);
            }
          })
        );
      })();
    };
    // Intentionally not including getAnnotationState/addFn; they are derived from csAnnotation module.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allMeasurements, viewportEl]);

  // 3) Sync visibility for each measurement based on selectedSeries / hiddenMeasurements / mergedSeriesMap
  useEffect(() => {
    if (!viewportEl) return;

    const files = mergedSeriesMap?.[selectedSeries ?? '']?.files ?? [];
    const prevCache = new Map(visibilityCacheRef.current);
    let anyChanged = false;
    const stateAny = getAnnotationState();

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
          files.some((id: string) => normalizeImageId(id) === normalizeImageId(refImg))
        );

      const prev = prevCache.get(uid);
      if (prev === undefined || prev !== visible) {
        // use safe helper to set visibility; swallow errors per-uid
        try {
          safeSetAnnotationVisibility(stateAny, uid, Boolean(visible));
        } catch {
          // swallow
        }
        visibilityCacheRef.current.set(uid, visible);
        anyChanged = true;
      } else {
        // preserve previous
        visibilityCacheRef.current.set(uid, prev);
      }
    }

    if (anyChanged) {
      try {
        renderingEngineRender?.();
      } catch {
        // swallow
      }
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allMeasurements, selectedSeries, hiddenMeasurements, mergedSeriesMap, viewportEl, renderingEngineRender]);

  // 4) Auto-select: deduplicate by annotationUID and call onAutoSelect once per UID
  useEffect(() => {
    if (!onAutoSelect || !viewportEl) return;

    const toCall = new Map<string, number>();

    const filesForSelected = (mergedSeriesMap?.[selectedSeries ?? '']?.files ?? []).map((id) =>
      normalizeImageId(id)
    );

    for (const m of allMeasurements) {
      const seriesUID = m.metadata?.seriesUID ?? '';
      const frameIdx =
        typeof m.metadata?.frameIndex === 'number' ? m.metadata.frameIndex : 0;

      const refImg = normalizeImageId(
        String(m.metadata?.referencedImageId ?? m.metadata?.imageId ?? '')
      );

      const belongs =
        seriesUID === selectedSeries ||
        seriesUID === prevSelectedSeries ||
        filesForSelected.some((norm) => norm === refImg);

      if (belongs) {
        if (!toCall.has(m.annotationUID)) {
          toCall.set(m.annotationUID, frameIdx);
        }
      }
    }

    if (toCall.size > 0) {
      for (const [uid, idx] of toCall.entries()) {
        try {
          onAutoSelect(uid, idx);
        } catch {
          // swallow
        }
      }
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allMeasurements, selectedSeries, viewportEl, prevSelectedSeries, mergedSeriesMap, onAutoSelect]);
}
