// src/hooks/useMeasurementSelector.ts
'use client';

import React from 'react';
import { useCallback, useRef } from 'react';
import { annotation as csAnnotation } from '@cornerstonejs/tools';
import { normalizeId, getEnabledElementSafeLocal } from '@/lib/viewer/dom';
import { ensureStackOnViewport } from '@/lib/viewer/stack';
import { preloadImagesWithTimeout } from '@/lib/viewer/preload';
import { ensureAnnotationAvailable } from '@/lib/annotationUtils';
import { enableElement } from '@/lib/enableElement';
import { VIEWPORT_ID } from '@/constants/viewport';
import { safeAddAnnotation, safeGetAnnotations } from '@/lib/viewer/annotationHelpers';

// import chung constants để thống nhất attempts/timeouts
import { ATTEMPTS_ANNOT } from '@/lib/viewer/constants';

const VERBOSE_LOG = true; // bật/tắt log chi tiết (set false nếu muốn im lặng)
const PREFIX = '[useMeasurementSelector]';

function log(...args: any[]) {
  if (!VERBOSE_LOG) return;
  try {
    console.warn(PREFIX, ...args);
  } catch {}
}

function logError(...args: any[]) {
  try {
    console.error(PREFIX, ...args);
  } catch {}
}

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

  logDebug?: (msg: string, obj?: any) => void;

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
    logDebug,
    selectionInProgressRef,
    selectedMeasurementUIDRef,
  } = opts;

  // existing refs
  const selectFlowCounterRef = useRef(0);
  const selectingRef = useRef(false);
  const lastSelectingUIDRef = useRef<string | null>(null);

  function dbg(msg: string, obj?: any) {
    try {
      if (typeof logDebug === 'function') {
        logDebug(msg, obj);
      } else {
        log(msg, obj ?? '');
      }
    } catch {}
  }

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
        log('skip setSelectedMeasurementUID (same)', { prev, uid });
        return;
      }
      log('setSelectedMeasurementUID ->', uid, '(prev=', prev, ')');
      setter(uid);
    } catch (error) {
      logError('safeSetSelectedMeasurementUIDHelper error', error);
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
      logError('isViewportShowingDesiredImage error', error);
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
          dbg('maybeSetSelectedMeasurementUID -> clear requested', uid);
          safeSetSelectedMeasurementUIDHelper(setSelectedMeasurementUID, selectedMeasurementUIDRef, null);
          return;
        }

        const prev = selectedMeasurementUIDRef && selectedMeasurementUIDRef.current ? selectedMeasurementUIDRef.current : null;
        if (prev === uid) {
          dbg('maybeSetSelectedMeasurementUID -> already set, skip', { prev, uid });
          return;
        }

        dbg('maybeSetSelectedMeasurementUID -> start', { uid, desiredIndex, attempts: maxAttempts });

        for (let i = 0; i < maxAttempts; i += 1) {
          try {
            if (typeof isViewportShowingDesiredImage === 'function' && Array.isArray(imageIds) && typeof desiredIndex === 'number') {
              try {
                const ok = isViewportShowingDesiredImage(imageIds, desiredIndex);
                if (ok) {
                  dbg('maybeSetSelectedMeasurementUID -> viewport shows desired image, setting', { uid, attempt: i });
                  safeSetSelectedMeasurementUIDHelper(setSelectedMeasurementUID, selectedMeasurementUIDRef, uid);
                  return;
                }
              } catch (e) {
                dbg('maybeSetSelectedMeasurementUID -> isViewportShowingDesiredImage threw', e);
              }
            }
          } catch (e) { dbg('maybeSetSelectedMeasurementUID -> viewport check outer threw', e); }

          try {
            const anns = safeGetAnnotations(undefined, viewportEl);
            if (Array.isArray(anns) && anns.some((a) => a?.annotationUID === uid)) {
              dbg('maybeSetSelectedMeasurementUID -> annotation present in viewport annotations', { uid, attempt: i });
              safeSetSelectedMeasurementUIDHelper(setSelectedMeasurementUID, selectedMeasurementUIDRef, uid);
              return;
            }

            try {
              const inst = (csAnnotation.state as any)?.getAnnotation?.(uid) ?? null;
              if (inst) {
                dbg('maybeSetSelectedMeasurementUID -> instance found in csAnnotation.state', { uid, attempt: i });
                safeSetSelectedMeasurementUIDHelper(setSelectedMeasurementUID, selectedMeasurementUIDRef, uid);
                return;
              }
            } catch (e) {
              dbg('maybeSetSelectedMeasurementUID -> csAnnotation.state.getAnnotation threw', e);
            }
          } catch (e) { dbg('maybeSetSelectedMeasurementUID -> annotation presence check threw', e); }

          await new Promise((r) => setTimeout(r, attemptDelayMs));
        }

        dbg('maybeSetSelectedMeasurementUID -> fallback set after retries', { uid });
        safeSetSelectedMeasurementUIDHelper(setSelectedMeasurementUID, selectedMeasurementUIDRef, uid);
      } catch (e) {
        dbg('maybeSetSelectedMeasurementUID -> unexpected error, fallback set', e);
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
      log('selection already in progress for same UID - skipping', m?.annotationUID);
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
      log('START select', { token: flowToken, annotationUID: m?.annotationUID, selectedSeries });

      const targetSeriesUID = m.metadata?.seriesUID;
      if (!targetSeriesUID) {
        logError('measurement missing seriesUID', m);
        return;
      }

      const imageIds = mergedSeriesMapRef.current?.[targetSeriesUID]?.files ?? [];
      log('resolved imageIds len=', Array.isArray(imageIds) ? imageIds.length : 0);

      try {
        if (selectedMeasurementUIDRef && selectedMeasurementUIDRef.current === m.annotationUID) {
          log('selectedMeasurementUIDRef already equals requested UID -> light-attach only', m.annotationUID);
          prevSeriesRef.current = selectedSeries;
          if (selectedSeries !== targetSeriesUID) setSelectedSeries(targetSeriesUID);

          try {
            if (viewportEl) {
              const inst = (csAnnotation.state as any)?.getAnnotation?.(m.annotationUID) ?? null;
              if (inst) {
                await safeAddAnnotation(inst, viewportEl);
                try { (csAnnotation.visibility as any)?.setAnnotationVisibility?.(m.annotationUID, true); } catch {}
                log('light-attach: existing instance attached');
                selectionConfirmed = true;
              } else {
                const maybe = await ensureAnnotationAvailable(m.annotationUID, 600, 30).catch(() => null);
                if (maybe) {
                  await safeAddAnnotation(maybe, viewportEl);
                  try { (csAnnotation.visibility as any)?.setAnnotationVisibility?.(m.annotationUID, true); } catch {}
                  log('light-attach: ensured instance attached');
                  selectionConfirmed = true;
                } else {
                  log('light-attach: no instance found');
                }
              }
            }
          } catch (error) {
            logError('light-attach failed', error);
          }

          safeRenderViewport(viewportId);
          return;
        }
      } catch (error) {
        dbg('selectedMeasurementUIDRef compare threw', error);
      }

      if (!Array.isArray(imageIds) || imageIds.length === 0) {
        log('no images in series, will attach annotation to current viewport (best-effort)');
        prevSeriesRef.current = selectedSeries;

        try {
          if (viewportEl) {
            const inst = (csAnnotation.state as any)?.getAnnotation?.(m.annotationUID) ?? null;
            if (inst) {
              await safeAddAnnotation(inst, viewportEl);
              try { (csAnnotation.visibility as any)?.setAnnotationVisibility?.(m.annotationUID, true); } catch {}
              log('attached preexisting annotation (no images)');
              selectionConfirmed = true;
            } else {
              const maybe = await ensureAnnotationAvailable(m.annotationUID, 1500, 50).catch(() => null);
              if (maybe) {
                await safeAddAnnotation(maybe, viewportEl);
                try { (csAnnotation.visibility as any)?.setAnnotationVisibility?.(m.annotationUID, true); } catch {}
                log('attached ensured annotation (no images)');
                selectionConfirmed = true;
              } else {
                log('annotation instance not found (no images)');
              }
            }
          }
        } catch (error) {
          logError('attach (no images) failed', error);
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
      log('desiredIndex computed', desiredIndex);

      try {
        const tFast = performance.now();
        if (isViewportShowingDesiredImage(imageIds, desiredIndex)) {
          log('FAST-PATH hit', { desiredIndex });
          prevSeriesRef.current = selectedSeries;
          if (selectedSeries !== targetSeriesUID) setSelectedSeries(targetSeriesUID);

          const inst = (csAnnotation.state as any)?.getAnnotation?.(m.annotationUID) ?? null;
          if (inst) {
            try { await safeAddAnnotation(inst, viewportEl); } catch (error) { dbg('safeAddAnnotation FAST-PATH failed', error); }
            try { (csAnnotation.visibility as any)?.setAnnotationVisibility?.(m.annotationUID, true); } catch {}
            log('FAST-PATH: annotation attached (existing)');
            selectionConfirmed = true;
          } else {
            const maybe = await ensureAnnotationAvailable(m.annotationUID, 600, 30).catch(() => null);
            if (maybe) {
              try { await safeAddAnnotation(maybe, viewportEl); } catch (error) { dbg('safeAddAnnotation FAST-PATH(ensured) failed', error); }
              try { (csAnnotation.visibility as any)?.setAnnotationVisibility?.(m.annotationUID, true); } catch {}
              log('FAST-PATH: annotation attached (ensured)');
              selectionConfirmed = true;
            } else {
              log('FAST-PATH: annotation instance not found');
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
          log('FAST-PATH miss (not showing desired image)', { tookMs: performance.now() - tFast });
        }
      } catch (error) {
        dbg('FAST-PATH error', error);
      }

      try {
        if (viewportEl) {
          try { enableElement(viewportEl); } catch (error) { dbg('enableElement failed', error); }
          await new Promise((r) => setTimeout(r, 40));
        }
      } catch (error) { dbg('pre-ensure enableElement failed', error); }

      let ok = false;
      try {
        log('calling ensureStackOnViewport', { desiredIndex });
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
        }).catch((error) => { dbg('ensureStackOnViewport catch', error); return false; });
        log('ensureStackOnViewport finished', { ok });
      } catch (error) {
        dbg('ensureStackOnViewport threw', error);
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
            try { await safeAddAnnotation(maybe, viewportEl); } catch (error) { dbg('safeAddAnnotation failed', error); }
            try { (csAnnotation.visibility as any)?.setAnnotationVisibility?.(m.annotationUID, true); } catch {}
            log('annotation attached after setStack');
            selectionConfirmed = true;
          } else {
            log('annotation instance not found after setStack', { annotationUID: m.annotationUID });
            selectionConfirmed = false;
          }
        } else {
          try { (csAnnotation.visibility as any)?.setAnnotationVisibility?.(m.annotationUID, true); } catch {}
          log('annotation already present - visibility set', { annotationUID: m.annotationUID });
          selectionConfirmed = true;
        }
      } catch (error) { dbg('attach annotation after setStack failed', error); }

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
        log('SKIP marking as selected because annotation/image not confirmed attached', { annotationUID: m.annotationUID, ok });
      }

      setCurrentFrame((desiredIndex ?? 0) + 1);

      await new Promise((r) => setTimeout(r, 40));
      safeRenderViewport(viewportId);

      log('END select (robust)', { token: flowToken, ok: ok, selectionConfirmed, durationMs: performance.now() - startAll });
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
    logDebug,
    selectionInProgressRef,
    selectedMeasurementUIDRef,
    maybeSetSelectedMeasurementUID,
  ]);


  const handleSelectSr = useCallback(async (srId: string | null) => {
    const token = ++selectFlowCounterRef.current;
    log('START select SR', { token, srId });
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
          } catch (error) { dbg('preload SR failed (non-fatal)', error); }
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
        } catch (error) { dbg('ensureImageRendered for SR failed', error); }
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
            dbg('SR annotation instance not found', m.annotationUID);
          }
        } catch (error) { dbg('attach SR annotation failed', error); }
      }

      if (srMeasurements.length > 0) {
        const firstM = srMeasurements[0];
        await maybeSetSelectedMeasurementUID(firstM.annotationUID, imageIds, firstM.metadata.frameIndex ?? 0);
        setCurrentFrame((firstM.metadata.frameIndex ?? 0) + 1);
        try { (csAnnotation.visibility as any)?.setAnnotationVisibility?.(firstM.annotationUID, true); } catch {}
      }

      safeRenderViewport(viewportId);
      log('END select SR', { token, srId });
    } else {
      try { setActiveSrId?.(null); } catch {}
      setSelectedSeries(prevSeriesRef.current ?? Object.keys(mergedSeriesMapRef.current || {})[0] ?? '');
      log('CLOSED SR selection', { token });
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
