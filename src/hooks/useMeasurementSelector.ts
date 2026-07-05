// src/hooks/useMeasurementSelector.ts
'use client';

import React from 'react';
import { useCallback, useRef } from 'react';
import { annotation as csAnnotation } from '@cornerstonejs/tools';
import { normalizeId, getEnabledElementSafeLocal } from '@/lib/viewer/dom';
import { ensureStackOnViewport } from '@/lib/viewer/stack';
import { preloadImagesWithTimeout } from '@/lib/viewer/preload';
import { ensureAnnotationAvailable } from '@/lib/cornerstone/annotations';
import { enableElement } from '@/lib/cornerstone/element';
import { VIEWPORT_ID } from '@/constants/viewport';
import { safeAddAnnotation, safeGetAnnotations } from '@/lib/viewer/annotationHelpers';

// import chung constants để thống nhất attempts/timeouts
import { ATTEMPTS_ANNOT } from '@/lib/viewer/constants';

export type UseMeasurementSelectorOpts = {
  renderingEngineRef?: { current: any };
  viewportInstance: any | null;
  viewportEl: HTMLDivElement | null;
  viewportId?: string;

  mergedSeriesMapRef: React.RefObject<Record<string, { files: string[]; metadata?: any }>>;
  allMeasurements: any[]; // AnnotationMeasurement[]
  selectedSeries: string;
  prevSeriesRef: React.RefObject<string | null>;

  setSelectedSeries: React.Dispatch<React.SetStateAction<string>>;
  setSelectedMeasurementUID: (uid: string | null) => void;
  setCurrentFrame: (frame: number) => void;
  setActiveSrId?: (id: string | null) => void;
  hiddenMeasurements?: Set<string>;

  safeRenderViewport: (vpId?: string) => void;
  ensureImageRendered?: any;
  preloadImagesWithTimeout?: typeof preloadImagesWithTimeout;

  selectionInProgressRef?: React.RefObject<{ current: any } | boolean | any>;
  selectedMeasurementUIDRef?: React.RefObject<string | null>;
};

export default function useMeasurementSelector(opts: UseMeasurementSelectorOpts) {
  const {
    renderingEngineRef,
    viewportInstance,
    viewportEl,
    viewportId = VIEWPORT_ID,
    mergedSeriesMapRef,
    allMeasurements,
    selectedSeries,
    prevSeriesRef,
    setSelectedSeries,
    setSelectedMeasurementUID,
    setCurrentFrame,
    setActiveSrId,
    hiddenMeasurements,
    safeRenderViewport,
    ensureImageRendered,
    preloadImagesWithTimeout: preloadHelper,
    selectionInProgressRef,
    selectedMeasurementUIDRef,
  } = opts;

  // existing refs
  const selectFlowCounterRef = useRef(0);
  const selectingRef = useRef(false);
  const lastSelectingUIDRef = useRef<string | null>(null);

  function safeGetAnnotationsLocal(toolName: string | undefined, el: HTMLDivElement | null) {
    try {
      return safeGetAnnotations(toolName as any, el as any) ?? [];
    } catch {
      try {
        return safeGetAnnotations(undefined as any, el as any) ?? [];
      } catch {
        return [];
      }
    }
  }

  function safeSetSelectedMeasurementUIDHelper(
    setter: (uid: string | null) => void,
    selectedRef: React.RefObject<string | null> | undefined,
    uid: string | null
  ) {
    try {
      const prev = selectedRef && selectedRef.current ? selectedRef.current : null;
      if (prev === uid) {
        return;
      }
      setter(uid);
    } catch (error) {
      try { setter(uid); } catch {}
    }
  }

  const isViewportShowingDesiredImage = useCallback((imageIds: string[], desiredIndex: number) => {
    try {
      if (!viewportInstance || !Array.isArray(imageIds) || imageIds.length === 0) return false;

      try {
        const enIdxFn = (viewportInstance as any).getCurrentImageIdIndex ?? (viewportInstance as any).getImageIdIndex;
        if (typeof enIdxFn === 'function') {
          const curIdx = enIdxFn.call(viewportInstance);
          if (typeof curIdx === 'number' && curIdx >= 0) {
            return curIdx === desiredIndex;
          }
        }
      } catch {}

      if (!viewportInstance.getImageIds) return false;
      const vpIds: string[] = viewportInstance.getImageIds() ?? [];
      if (!Array.isArray(vpIds) || vpIds.length === 0) return false;
      const want = normalizeId(imageIds[Math.max(0, Math.min(desiredIndex, imageIds.length - 1))]);
      const found = vpIds.findIndex((id) => normalizeId(id) === want);
      return found >= 0 && found === desiredIndex;
    } catch (error) {
      return false;
    }
  }, [viewportInstance]);

  // NEW helper: set selectedMeasurementUID only when selection "confirmed" or after retries.
  const maybeSetSelectedMeasurementUID = useCallback(
    async function maybeSetSelectedMeasurementUID(
      uid: string | null,
      imageIds?: string[],
      desiredIndex?: number,
      maxAttempts = ATTEMPTS_ANNOT,
      attemptDelayMs = 80
    ) {
      try {
        if (!uid) {
          safeSetSelectedMeasurementUIDHelper(setSelectedMeasurementUID, selectedMeasurementUIDRef, null);
          return;
        }

        const prev = selectedMeasurementUIDRef && selectedMeasurementUIDRef.current ? selectedMeasurementUIDRef.current : null;
        if (prev === uid) {
          return;
        }

        for (let i = 0; i < maxAttempts; i += 1) {
          try {
            if (typeof isViewportShowingDesiredImage === 'function' && Array.isArray(imageIds) && typeof desiredIndex === 'number') {
              try {
                const ok = isViewportShowingDesiredImage(imageIds, desiredIndex);
                if (ok) {
                  safeSetSelectedMeasurementUIDHelper(setSelectedMeasurementUID, selectedMeasurementUIDRef, uid);
                  return;
                }
              } catch (e) {
              }
            }
          } catch {}

          try {
            const anns = safeGetAnnotations(undefined, viewportEl);
            if (Array.isArray(anns) && anns.some((a) => a?.annotationUID === uid)) {
              safeSetSelectedMeasurementUIDHelper(setSelectedMeasurementUID, selectedMeasurementUIDRef, uid);
              return;
            }

            try {
              const inst = (csAnnotation.state as any)?.getAnnotation?.(uid) ?? null;
              if (inst) {
                safeSetSelectedMeasurementUIDHelper(setSelectedMeasurementUID, selectedMeasurementUIDRef, uid);
                return;
              }
            } catch (e) {
            }
          } catch {}

          await new Promise((r) => setTimeout(r, attemptDelayMs));
        }
        safeSetSelectedMeasurementUIDHelper(setSelectedMeasurementUID, selectedMeasurementUIDRef, uid);
      } catch (e) {
        try { safeSetSelectedMeasurementUIDHelper(setSelectedMeasurementUID, selectedMeasurementUIDRef, uid); } catch {}
      }
    },
    [
      isViewportShowingDesiredImage,
      viewportEl,
      selectedMeasurementUIDRef,
      setSelectedMeasurementUID,
      safeSetSelectedMeasurementUIDHelper,
    ]
  );

  const handleSelectMeasurement = useCallback(async (m: any) => {
    // Guard: avoid re-entrant selection for same uid
    if (selectingRef.current && lastSelectingUIDRef.current === (m?.annotationUID ?? null)) {
      return;
    }
    selectingRef.current = true;
    lastSelectingUIDRef.current = m?.annotationUID ?? null;
    if (selectionInProgressRef && typeof selectionInProgressRef === 'object' && 'current' in selectionInProgressRef) {
      try { (selectionInProgressRef as any).current = true; } catch {}
    }

    let selectionConfirmed = false;
    try {
      const startAll = performance.now();
      const flowToken = ++selectFlowCounterRef.current;

      const targetSeriesUID = m.metadata?.seriesUID;
      if (!targetSeriesUID) {
        return;
      }

      const imageIds = mergedSeriesMapRef.current?.[targetSeriesUID]?.files ?? [];

      try {
        if (selectedMeasurementUIDRef && selectedMeasurementUIDRef.current === m.annotationUID) {
          prevSeriesRef.current = selectedSeries;
          if (selectedSeries !== targetSeriesUID) setSelectedSeries(targetSeriesUID);

          try {
            if (viewportEl) {
              const inst = (csAnnotation.state as any)?.getAnnotation?.(m.annotationUID) ?? null;
              if (inst) {
                await safeAddAnnotation(inst, viewportEl);
                try { (csAnnotation.visibility as any)?.setAnnotationVisibility?.(m.annotationUID, true); } catch {}
                selectionConfirmed = true;
              } else {
                const maybe = await ensureAnnotationAvailable(m.annotationUID, 600, 30).catch(() => null);
                if (maybe) {
                  await safeAddAnnotation(maybe, viewportEl);
                  try { (csAnnotation.visibility as any)?.setAnnotationVisibility?.(m.annotationUID, true); } catch {}
                  selectionConfirmed = true;
                } else {
                }
              }
            }
          } catch (error) {
          }

          safeRenderViewport(viewportId);
          return;
        }
      } catch (error) {
      }

      if (!Array.isArray(imageIds) || imageIds.length === 0) {
        prevSeriesRef.current = selectedSeries;

        try {
          if (viewportEl) {
            const inst = (csAnnotation.state as any)?.getAnnotation?.(m.annotationUID) ?? null;
            if (inst) {
              await safeAddAnnotation(inst, viewportEl);
              try { (csAnnotation.visibility as any)?.setAnnotationVisibility?.(m.annotationUID, true); } catch {}
              selectionConfirmed = true;
            } else {
              const maybe = await ensureAnnotationAvailable(m.annotationUID, 1500, 50).catch(() => null);
              if (maybe) {
                await safeAddAnnotation(maybe, viewportEl);
                try { (csAnnotation.visibility as any)?.setAnnotationVisibility?.(m.annotationUID, true); } catch {}
                selectionConfirmed = true;
              } else {
              }
            }
          }
        } catch (error) {
        }

        if (selectedSeries !== targetSeriesUID) setSelectedSeries(targetSeriesUID);
        if (selectionConfirmed) {
          await maybeSetSelectedMeasurementUID(m.annotationUID, imageIds, (m.metadata.frameIndex ?? 0));
          setCurrentFrame((m.metadata.frameIndex ?? 0) + 1);
        } else {
          setCurrentFrame((m.metadata.frameIndex ?? 0) + 1);
        }

        safeRenderViewport(viewportId);
        return;
      }

      let desiredIndex: number | undefined = typeof m.metadata?.frameIndex === 'number' ? Number(m.metadata.frameIndex) : undefined;
      if (desiredIndex === undefined || desiredIndex < 0 || desiredIndex >= imageIds.length) {
        const refId = m.metadata?.referencedImageId ?? '';
        if (refId) {
          const normRef = normalizeId(refId);
          const found = imageIds.findIndex((id) => normalizeId(id) === normRef);
          if (found >= 0) desiredIndex = found;
        }
      }
      if (typeof desiredIndex !== 'number' || Number.isNaN(desiredIndex)) desiredIndex = 0;
      desiredIndex = Math.max(0, Math.min(desiredIndex, imageIds.length - 1));

      try {
        const tFast = performance.now();
        if (isViewportShowingDesiredImage(imageIds, desiredIndex)) {
          prevSeriesRef.current = selectedSeries;
          if (selectedSeries !== targetSeriesUID) setSelectedSeries(targetSeriesUID);

          const inst = (csAnnotation.state as any)?.getAnnotation?.(m.annotationUID) ?? null;
          if (inst) {
            try { await safeAddAnnotation(inst, viewportEl); } catch {}
            try { (csAnnotation.visibility as any)?.setAnnotationVisibility?.(m.annotationUID, true); } catch {}
            selectionConfirmed = true;
          } else {
            const maybe = await ensureAnnotationAvailable(m.annotationUID, 600, 30).catch(() => null);
            if (maybe) {
              try { await safeAddAnnotation(maybe, viewportEl); } catch {}
              try { (csAnnotation.visibility as any)?.setAnnotationVisibility?.(m.annotationUID, true); } catch {}
              selectionConfirmed = true;
            } else {
              selectionConfirmed = false;
            }
          }

          if (selectionConfirmed) {
            await maybeSetSelectedMeasurementUID(m.annotationUID, imageIds, desiredIndex);
          }
          setCurrentFrame((desiredIndex ?? 0) + 1);

          safeRenderViewport(viewportId);
          return;
        } else {
        }
      } catch (error) {
      }

      try {
        if (viewportEl) {
          try { enableElement(viewportEl); } catch {}
          await new Promise((r) => setTimeout(r, 40));
        }
      } catch {}

      let ok = false;
      try {
        ok = await ensureStackOnViewport({
          renderingEngineRef: renderingEngineRef as any,
          viewportInstance,
          viewportEl,
          imageIds,
          desiredIndex,
          ensureImageRendered,
          preloadImagesWithTimeout: preloadHelper ?? preloadImagesWithTimeout,
          viewportId,
          settleMs: 120,
        }).catch(() => false);
      } catch (error) {
        ok = false;
      }

      // After attach attempts, try to attach annotation instance
      try {
        const anns = safeGetAnnotations(m.toolName, viewportEl);
        const found = Array.isArray(anns) ? anns.find((a) => a.annotationUID === m.annotationUID) : undefined;
        if (!found) {
          const inst = (csAnnotation.state as any)?.getAnnotation?.(m.annotationUID) ?? null;
          const maybe = inst ?? (await ensureAnnotationAvailable(m.annotationUID, 1500, 50).catch(() => null));
          if (maybe) {
            try { await safeAddAnnotation(maybe, viewportEl); } catch {}
            try { (csAnnotation.visibility as any)?.setAnnotationVisibility?.(m.annotationUID, true); } catch {}
            selectionConfirmed = true;
          } else {
            selectionConfirmed = false;
          }
        } else {
          try { (csAnnotation.visibility as any)?.setAnnotationVisibility?.(m.annotationUID, true); } catch {}
          selectionConfirmed = true;
        }
      } catch {}

      prevSeriesRef.current = selectedSeries;
      if (selectedSeries !== targetSeriesUID) setSelectedSeries(targetSeriesUID);
      if (String(targetSeriesUID).startsWith('SR_')) {
        try { setActiveSrId?.(targetSeriesUID); } catch {}
      } else {
        try { setActiveSrId?.(null); } catch {}
      }

      if (selectionConfirmed) {
        await maybeSetSelectedMeasurementUID(m.annotationUID, imageIds, desiredIndex);
      } else {
      }

      setCurrentFrame((desiredIndex ?? 0) + 1);

      await new Promise((r) => setTimeout(r, 40));
      safeRenderViewport(viewportId);
    } finally {
      try {
        if (selectionInProgressRef && typeof selectionInProgressRef === 'object' && 'current' in selectionInProgressRef) {
          try { (selectionInProgressRef as any).current = false; } catch {}
        }
      } catch {}
      selectingRef.current = false;
      lastSelectingUIDRef.current = null;
    }
  }, [
    mergedSeriesMapRef,
    viewportInstance,
    viewportEl,
    renderingEngineRef,
    selectedSeries,
    prevSeriesRef,
    setSelectedSeries,
    setCurrentFrame,
    setSelectedMeasurementUID,
    setActiveSrId,
    safeRenderViewport,
    ensureImageRendered,
    preloadHelper,
    viewportId,
    isViewportShowingDesiredImage,
    selectionInProgressRef,
    selectedMeasurementUIDRef,
    maybeSetSelectedMeasurementUID,
  ]);


  const handleSelectSr = useCallback(async (srId: string | null) => {
    const token = ++selectFlowCounterRef.current;
    if (srId) {
      prevSeriesRef.current = selectedSeries;
      try { setActiveSrId?.(srId); } catch {}
      const imageIds = mergedSeriesMapRef.current?.[srId]?.files ?? [];
      const srMeasurements = allMeasurements.filter((m) => String(m.metadata?.seriesUID) === String(srId));
      const first = srMeasurements[0];
      const desiredIndex = typeof first?.metadata?.frameIndex === 'number' ? first!.metadata.frameIndex : 0;

      if (viewportInstance && viewportEl && Array.isArray(imageIds) && imageIds.length > 0) {
        try {
          try {
            if (preloadHelper) await preloadHelper(imageIds, { concurrency: 3, perLoadTimeoutMs: 8000, limit: 6 });
            else await preloadImagesWithTimeout(imageIds, { concurrency: 3, perLoadTimeoutMs: 8000, limit: 6 });
          } catch {}
          if (ensureImageRendered && typeof ensureImageRendered === 'function') {
            await ensureImageRendered(viewportInstance, viewportEl, imageIds, Math.max(0, Math.min(desiredIndex, imageIds.length - 1)), 40, 200);
          } else {
            await ensureStackOnViewport({
              renderingEngineRef: renderingEngineRef as any,
              viewportInstance,
              viewportEl,
              imageIds,
              desiredIndex,
              preloadImagesWithTimeout: preloadHelper ?? preloadImagesWithTimeout,
              viewportId,
            });
          }
        } catch {}
      }

      setSelectedSeries(srId);

      for (const m of srMeasurements) {
        try {
          let inst = null;
          try { inst = csAnnotation.state.getAnnotation?.(m.annotationUID); } catch {}
          if (!inst) {
            inst = await ensureAnnotationAvailable(m.annotationUID, 1500, 50).catch(() => null);
          }
          if (!inst) {
            const mm = allMeasurements.find((x) => x.annotationUID === m.annotationUID) as any;
            if (mm && mm.__rawInstance) inst = mm.__rawInstance;
          }
          if (inst) {
            try { await safeAddAnnotation(inst, viewportEl); } catch {}
            try { (csAnnotation.visibility as any)?.setAnnotationVisibility?.(m.annotationUID, !hiddenMeasurements?.has(m.annotationUID)); } catch {}
          } else {
          }
        } catch {}
      }

      if (srMeasurements.length > 0) {
        const firstM = srMeasurements[0];
        await maybeSetSelectedMeasurementUID(firstM.annotationUID, imageIds, firstM.metadata.frameIndex ?? 0);
        setCurrentFrame((firstM.metadata.frameIndex ?? 0) + 1);
        try { (csAnnotation.visibility as any)?.setAnnotationVisibility?.(firstM.annotationUID, true); } catch {}
      }

      safeRenderViewport(viewportId);
    } else {
      try { setActiveSrId?.(null); } catch {}
      setSelectedSeries(prevSeriesRef.current ?? Object.keys(mergedSeriesMapRef.current || {})[0] ?? '');
    }
  }, [
    mergedSeriesMapRef,
    viewportInstance,
    viewportEl,
    renderingEngineRef,
    selectedSeries,
    prevSeriesRef,
    setSelectedSeries,
    setSelectedMeasurementUID,
    setCurrentFrame,
    setActiveSrId,
    ensureImageRendered,
    preloadHelper,
    hiddenMeasurements,
    safeRenderViewport,
    viewportId,
    allMeasurements,
    selectedMeasurementUIDRef,
    maybeSetSelectedMeasurementUID,
  ]);

  return {
    handleSelectMeasurement,
    handleSelectSr,
    isViewportShowingDesiredImage,
  };
}
