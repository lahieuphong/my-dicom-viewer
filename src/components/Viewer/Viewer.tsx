// src/components/Viewer/Viewer.tsx
'use client';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useLayoutEffect,
  useMemo,
} from 'react';

import { imageLoader } from '@cornerstonejs/core';

import { Loading } from '@/components/ui/loading';
import ViewerWorkspace from '@/components/Viewer/Workspace';
import { useBatchedFrameState } from '@/hooks/useBatchedFrameState';

import {
  ToolGroupManager,
  annotation as csAnnotation,
  Enums as ToolEnums,
} from '@cornerstonejs/tools';

import { TOOL_GROUP } from '@/constants/toolgroup';
import { VIEWPORT_ID } from '@/constants/viewport';

import { useStudies } from '@/context/StudiesContext';
import { useSeriesLoader } from '@/hooks/useSeriesLoader';
import { useMeasurements, AnnotationMeasurement } from '@/hooks/useMeasurements';
import { useToolManager, ToolID } from '@/hooks/useToolManager';
import { useViewportState } from '@/hooks/useViewportState';
import { useRotate } from '@/hooks/useRotate';
import { useFlipHorizontal } from '@/hooks/useFlip';
import { useResetViewer } from '@/hooks/useResetViewer';
import { useCine } from '@/hooks/useCine';
import useViewerLayout from '@/hooks/useViewerLayout';

import type { Series } from '@/lib/pacs/services';

import { useMeasurementBridge } from '@/hooks/useMeasurementBridge';
import { useSrExport } from '@/hooks/useSrExport';
import { measurementToolIDs, toolNameMap } from '@/hooks/useToolManager';
import { ensureAnnotationAvailable } from '@/lib/annotationUtils';
import { useRenderingEngine } from '@/hooks/useRenderingEngine';
import { useEnsureImageRendered } from '@/hooks/useEnsureImageRendered';
import useMeasurementSelector from '@/hooks/useMeasurementSelector';

import useImageReadiness from '@/hooks/useImageReadiness';
import { enableElement } from '@/lib/enableElement';

import { useForceZoomOne } from '@/hooks/useForceZoomOne';


import { normalizeId, getEnabledElementSafeLocal, safeInspect, safeInspectSimple } from '@/lib/viewer/dom';
import { waitForElementVisible, waitForCornerstoneReady, waitForEngineAndViewport, logEnabledDebug, forceRenderCheck } from '@/lib/viewer/polling';
import { preloadImagesWithTimeout, loadAndCacheImageWithTimeout } from '@/lib/viewer/preload';
import { safeAddAnnotation, safeGetAnnotations, safeRemoveAnnotationByUID, safeGetAnnotationInstance } from '@/lib/viewer/annotationHelpers';


import { createDisplaySetFromSeries } from '@/lib/viewer/displaySet';
import { attachDisplaySetToViewport } from '@/lib/viewer/attachDisplaySet';
import { normalizeCanvasAndContext, ensureCanvasSizing } from '@/lib/viewer/canvasUtils';

import { disableReleaseGraphicsResourcesGlobally } from '@/lib/cornerstone';
import { ATTEMPTS_ATTACH, ATTEMPTS_ANNOT } from '@/lib/viewer/constants';


const Viewer = ({ studyUID }: { studyUID: string; debugLabel?: string }) => {
  // cooldown (ms) sau khi attach hoàn tất: watchdog/fallback sẽ tôn trọng khoảng này
  const COOLDOWN_AFTER_ATTACH_MS = 3000;

  const viewportId = VIEWPORT_ID;

  // ==============================
  // 🔧 State
  // ==============================
  const elRef = useRef<HTMLDivElement | null>(null);

  // signal that component has been unmounted (hard abort)
  const abortRef = useRef(false);
  useEffect(() => {
    return () => {
      // mark globally aborted on unmount
      abortRef.current = true;
    };
  }, []);

  const [activeTool, setActiveTool] = useState<ToolID>('adjust');

  const {
    currentFrame,
    setCurrentFrame,
    setCurrentFrameBatched,
  } = useBatchedFrameState(1);

  const [voiRange, setVoiRange] = useState<{ lower: number; upper: number } | null>(null);
  const [fps, setFps] = useState(24);
  const [isPlaying, setIsPlaying] = useState(false);

  const [allMeasurements, setAllMeasurements] = useState<AnnotationMeasurement[]>([]);
  const [selectedMeasurementUID, setSelectedMeasurementUID] = useState<string | null>(null);
  const [hiddenMeasurements, setHiddenMeasurements] = useState<Set<string>>(new Set());

  const [mobileSeriesOpen, setMobileSeriesOpen] = useState(false);
  const [mobileMeasurementsOpen, setMobileMeasurementsOpen] = useState(false);

  const [loadingStack, setLoadingStack] = useState(false);
  const [sidebarLoading, setSidebarLoading] = useState(false);
  // thêm sau dòng khai báo sidebarLoading
  const [loadingProgress, setLoadingProgress] = useState<number | null>(null);


  // Safe setters
  const setLoadingStackSafe = useCallback((v: boolean) => {
    // only change when different
    setLoadingStack((prev) => (prev === v ? prev : v));
  }, []);

  const setSidebarLoadingSafe = useCallback((v: boolean) => {
    setSidebarLoading((prev) => (prev === v ? prev : v));
  }, []);

  

  // ==============================
  // 🔗 Refs & Context
  // ==============================
  const currentAttachSessionRef = useRef<number>(0);

  const prevMeasurementUIDs = useRef<Set<string>>(new Set());
  const prevSeriesRef = useRef<string | null>(null);
  const viewSrRef = useRef<((seriesUID: string, instanceUID?: string | null) => Promise<boolean>) | null>(null);

  const { studies } = useStudies();
  const studyMeta = studies.find((s) => s.studyInstanceUID === studyUID);

  const {
    seriesMap,
    selectedSeries,
    setSelectedSeries,
    loadingSeries,
    voiDefaults,
  } = useSeriesLoader(studyUID);

  const [extraSeriesMap, setExtraSeriesMap] = useState<Record<string, { files: string[]; metadata: Series }>>({});
  const mergedSeriesMap = useMemo(() => ({ ...seriesMap, ...extraSeriesMap }), [seriesMap, extraSeriesMap]);

  // Refs that track mutable things used inside stable handlers
  const mergedSeriesMapRef = useRef(mergedSeriesMap);
  useEffect(() => {
    mergedSeriesMapRef.current = mergedSeriesMap;
  }, [mergedSeriesMap]);

  const selectedMeasurementUIDRef = useRef(selectedMeasurementUID);
  useEffect(() => {
    selectedMeasurementUIDRef.current = selectedMeasurementUID;
  }, [selectedMeasurementUID]);

  // ---------- Rendering engine ----------
  const { renderingEngineRef, viewportInstance, viewportEl } = useRenderingEngine({
    elRef,
    selectedSeriesId: selectedSeries,
    mergedSeriesMap,
    voiDefaults,
    onFrameIndexChange: setCurrentFrameBatched,
  });

  const { ensureImageRendered } = useEnsureImageRendered({
    renderingEngineRef,
    mergedSeriesMap,
    voiDefaults,
  });


  const { activateTool, isToolReady } = useToolManager();

  const [viewportReady, setViewportReady] = useState(false);

  const {
    imageReady: hookImageReady,
    enabledHasImage,
  } = useImageReadiness({
    renderingEngineRef,
    viewportInstance,
    viewportEl,
    selectedSeries,
    mergedSeriesMap,
    ensureImageRendered,
    viewportReady,
  });

  useForceZoomOne(viewportInstance, renderingEngineRef, {
    enabled: true,   // 👈 bật/tắt cực dễ
    delayMs: 80,     // 👈 có thể chỉnh nếu cần
  });

  // đặt gần các useEffect khác, trong body Viewer component
  useEffect(() => {
    if (!viewportInstance) return;

    let cancelled = false;

    (async () => {
      try {
        const vpEl = (viewportInstance as any).element as HTMLElement | null;
        if (vpEl) {
          try {
            enableElement(vpEl as HTMLDivElement);
          } catch (e) {
            // ignore
          }
        }

        // small delay then resize + render
        await new Promise((r) => setTimeout(r, 60));
        try { renderingEngineRef.current?.resize?.(); } catch {}
        try { renderingEngineRef.current?.renderViewport?.(VIEWPORT_ID); } catch {}

        // finally, try to check enabled element and log if missing (debug)
        try {
          const csCore: any = await import('@cornerstonejs/core').catch(() => null);
          const en = csCore?.getEnabledElement ? csCore.getEnabledElement(vpEl) : null;
        } catch {}
      } catch (e) {
        // ignore
      }
    })();

    return () => { cancelled = true; };
  }, [viewportInstance]);


  const { saveInitialState, resetToInitial } = useViewportState();

  // --- Robust runtime check of enabled element presence (safe, effect-based)
  const [runtimeHasImage, setRuntimeHasImage] = useState<boolean>(false);

  // Poll once (immediate) then a few retries to catch when Cornerstone finishes enabling
  useEffect(() => {
    let cancelled = false;
    let tries = 0;
    const maxTries = 8; // ~8 * intervalMs = ~1 second of polling
    const intervalMs = 120;

    const checkOnce = () => {
      try {
        const en = getEnabledElementSafeLocal(viewportEl);
        return Boolean((en as any)?.image);
      } catch {
        return false;
      }
    };

    // immediate check
    if (checkOnce()) {
      setRuntimeHasImage(true);
      return () => { cancelled = true; };
    } else {
      setRuntimeHasImage(false);
    }

    const id = window.setInterval(() => {
      if (cancelled) {
        clearInterval(id);
        return;
      }
      tries += 1;
      const found = checkOnce();
      if (found) {
        setRuntimeHasImage(true);
        clearInterval(id);
        return;
      }
      if (tries >= maxTries) {
        clearInterval(id);
      }
    }, intervalMs);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [viewportEl]);

  // Combine signals from useImageReadiness hook + hook's enabledHasImage + this runtime check
  // --- add viewportInstance signal as extra fallback ---
  const viewportRenderedSignal = (() => {
    try {
      if (!viewportInstance) return false;
      const vi: any = viewportInstance;
      const enabled = getEnabledElementSafeLocal(viewportEl);
      const hasRenderedImage = Boolean((enabled as any)?.image);
      if (vi.viewportStatus === 'rendered') return hasRenderedImage;
      if (hasRenderedImage) return true;
      return false;
    } catch {
      return false;
    }
  })();

  const imageAvailable = Boolean(hookImageReady) || Boolean(enabledHasImage) || Boolean(runtimeHasImage) || Boolean(viewportRenderedSignal);


  // When any indicates ready, hide loading overlay
  useEffect(() => {
    if (imageAvailable) {
      setLoadingStackSafe(false);
      setSidebarLoadingSafe(false);
    }
  }, [imageAvailable, setLoadingStackSafe, setSidebarLoadingSafe]);

  useEffect(() => {
    if (imageAvailable) {
      setLoadingStackSafe(false);
      setSidebarLoadingSafe(false);
    }
  }, [hookImageReady, enabledHasImage, runtimeHasImage, viewportRenderedSignal, imageAvailable, setLoadingStackSafe, setSidebarLoadingSafe]);


  const rotate = useRotate(viewportInstance);
  const flipHorizontal = useFlipHorizontal(renderingEngineRef, viewportId);
  const resetViewer = useResetViewer(resetToInitial, viewportInstance);
  // useViewerLayout: quản lý grid + collapsed state cho sidebar & measurement panel
  const {
    gridCols,
    sidebarCollapsed,
    setSidebarCollapsed,
    measurementCollapsed,
    setMeasurementCollapsed
  } = useViewerLayout();

  const attachCounterRef = useRef(0);
  // Remember last successful attach to avoid duplicate re-attaches
  const lastAttachedSeriesRef = useRef<string | null>(null);
  const lastAttachedViewportElRef = useRef<HTMLElement | null>(null);

  // ---------- Unified attach-displaySet effect (OHIF-like) ----------
  // NOTE: This effect intentionally avoids depending on volatile refs like viewportInstance/viewportEl
  // to reduce spurious re-triggers. We gate on viewportReady and remember the last successful attach
  // (series + element) to skip duplicate work.
  useEffect(() => {
    // Only try to attach when we have a selected series AND viewport has settled.
    // This prevents premature attach attempts while viewportInstance/element are still being created.
    if (!selectedSeries) return;
    if (!viewportReady) {
      return;
    }

    let cancelled = false;
    let finalTimer: number | null = null;
    const thisSession = (currentAttachSessionRef.current = (currentAttachSessionRef.current || 0) + 1);

    async function attachSelectedSeries() {
      attachCounterRef.current += 1;

      const sessionAtStart = thisSession;
      const shouldAbort = () => sessionAtStart !== currentAttachSessionRef.current || cancelled;

      try {
        if (!selectedSeries) return;
        const ds = createDisplaySetFromSeries(mergedSeriesMap[selectedSeries]);
        if (!ds || !Array.isArray(ds.imageIds) || ds.imageIds.length === 0) return;

        const elToCheck = (viewportEl as HTMLElement | null) ?? (viewportInstance as any)?.element ?? elRef.current;
        if (!elToCheck) return;

        // ===== QUICK GUARD -> skip reattach if viewport already showing same series/frame =====
        try {
          const vp = viewportInstance as any;
          if (vp) {
            // get current ids & index from viewportInstance if possible
            let vpIds: string[] | null = null;
            try { vpIds = typeof vp.getImageIds === 'function' ? vp.getImageIds() ?? null : null; } catch {}
            let vpIdx: number | null = null;
            try {
              if (typeof vp.getCurrentImageIdIndex === 'function') vpIdx = vp.getCurrentImageIdIndex();
              else if (typeof vp.getImageIdIndex === 'function') vpIdx = vp.getImageIdIndex();
            } catch {}

            const normalize = (s: any) => normalizeId(s);
            const desiredIdx = Math.max(0, Math.min(ds.initialImageIdIndex ?? 0, (ds.imageIds || []).length - 1));
            const desiredIdNorm = normalize(ds.imageIds[desiredIdx]);

            const vpShowsDesired =
              Array.isArray(vpIds) &&
              vpIds.length > 0 &&
              (typeof vpIdx === 'number' ? vpIdx === desiredIdx : vpIds.some((id) => normalize(id) === desiredIdNorm));

            if (vpShowsDesired) {
              // The viewport already shows the intended image/frame — skip expensive attach.
              // Ensure loading UI is not stuck
              setLoadingStackSafe(false);
              setSidebarLoadingSafe(false);
              setLoadingProgress?.(null);
              // mark lastAttached so future triggers skip quickly
              try {
                lastAttachedSeriesRef.current = selectedSeries;
                lastAttachedViewportElRef.current = elToCheck;
              } catch {}
              return;
            }
          }
        } catch (e) {
          // ignore guard errors — proceed with normal attach if guard fails
        }

        // ===== END QUICK GUARD =====
        setLoadingStackSafe(true);
        setSidebarLoadingSafe(true);

        // 1) Wait for cornerstone readiness (cancellable)
        await waitForCornerstoneReady(5000).catch(() => false);
        if (shouldAbort()) return;

        // 2) Ensure element visible / small delay
        const visible = await waitForElementVisible(elToCheck, 5000).catch(() => false);
        if (shouldAbort()) return;
        if (!visible) await new Promise((r) => setTimeout(r, 160));
        if (shouldAbort()) return;

        // 3) Warm first image quickly (best-effort)
        const firstImageId = ds.imageIds[ds.initialImageIdIndex ?? 0];
        try {
          await loadAndCacheImageWithTimeout(firstImageId, 6000).catch(() => {});
        } catch {}
        if (shouldAbort()) return;

        // 4) Ensure engine/viewport registration (best-effort)
        try {
          await waitForEngineAndViewport(renderingEngineRef, viewportInstance, elToCheck as HTMLDivElement, 5000, 100);
        } catch (e) {
        }
        if (shouldAbort()) return;

        // 5) Try to attach with multiple attempts + fallbacks
        let attached = false;
        const maxAttempts = ATTEMPTS_ATTACH;
        for (let attempt = 1; attempt <= maxAttempts && !attached && !shouldAbort(); attempt++) {
          try {
            attached = await attachDisplaySetToViewport({
              displaySet: ds,
              renderingEngineRef,
              viewportInstance,
              viewportEl: elToCheck as HTMLDivElement,
              ensureImageRendered,
              preloadImagesWithTimeoutFn: preloadImagesWithTimeout,
              desiredIndex: ds.initialImageIdIndex ?? 0,
              viewportId: VIEWPORT_ID,
            }).catch(() => false);

            if (shouldAbort()) return;

            if (attached) break;

            if (shouldAbort()) return;

            // gentle nudge: normalize canvases, enable element, resize+render, force render check
            try { enableElement(elToCheck); } catch {}
            try { normalizeCanvasAndContext(elToCheck); } catch {}
            try { ensureCanvasSizing(elToCheck); } catch {}
            try { renderingEngineRef.current?.resize?.(); } catch {}
            try { renderingEngineRef.current?.renderViewport?.(VIEWPORT_ID); } catch {}
            try { await forceRenderCheck(elToCheck as HTMLDivElement, viewportInstance, renderingEngineRef); } catch {}

            if (shouldAbort()) return;

            await new Promise((r) => setTimeout(r, 220 + attempt * 80));
          } catch (err) {
            await new Promise((r) => setTimeout(r, 200 + attempt * 100));
          }
        } // end attempts

        // 6) If still not attached -> warm-first-image + forceRenderCheck
        if (!attached && !shouldAbort()) {
          try {
            if (imageLoader && typeof (imageLoader as any).loadAndCacheImage === 'function') {
              await (imageLoader as any).loadAndCacheImage(firstImageId).catch(() => {});
            } else {
              const csCore = await import('@cornerstonejs/core').catch(() => null);
              if (csCore && csCore.imageLoader && typeof csCore.imageLoader.loadAndCacheImage === 'function') {
                await csCore.imageLoader.loadAndCacheImage(firstImageId).catch(() => {});
              }
            }
          } catch {}
          if (shouldAbort()) return;

          try {
            try { normalizeCanvasAndContext(elToCheck); } catch {}
            try { ensureCanvasSizing(elToCheck); } catch {}
            await forceRenderCheck(elToCheck as HTMLDivElement, viewportInstance, renderingEngineRef);
          } catch {}
        }
        if (shouldAbort()) return;

        // 7) Final settle: reset/presentation -> render -> wait two RAF -> normalize + forceRenderCheck
        try {
          try {
            if (viewportInstance && typeof (viewportInstance as any).setViewPresentation === 'function') {
              try { (viewportInstance as any).setViewPresentation({ rotation: 0, zoom: 1, flipHorizontal: false, flipVertical: false }); } catch {}
            }
          } catch {}

          try { viewportInstance?.reset?.(); } catch {}
          try { normalizeCanvasAndContext(elToCheck); } catch {}
          try { ensureCanvasSizing(elToCheck); } catch {}
          try { renderingEngineRef.current?.resize?.(); } catch {}
          try { renderingEngineRef.current?.renderViewport?.(VIEWPORT_ID); } catch {}
          try { await viewportInstance?.render?.(); } catch {}

          // two rAF delay
          await new Promise<void>((resolve) => {
            requestAnimationFrame(() => {
              requestAnimationFrame(() => { resolve(); });
            });
          });

          try { normalizeCanvasAndContext(elToCheck); } catch {}
          try { ensureCanvasSizing(elToCheck); } catch {}
          try { await forceRenderCheck(elToCheck as HTMLDivElement, viewportInstance, renderingEngineRef); } catch {}
        } catch (e) {
        }
        if (shouldAbort()) return;

        // 8) Fire STACK_NEW_IMAGE so tools react like OHIF
        try {
          const evName = (ToolEnums as any)?.Events?.STACK_NEW_IMAGE ?? 'cornerstone-stack-new-image';
          const targetEl = elToCheck ?? (viewportInstance as any)?.element ?? document.querySelector(`[data-viewport-uid="${VIEWPORT_ID}"]`);
          const targetImageIndex = Math.max(0, Math.min(ds.initialImageIdIndex ?? 0, ds.imageIds.length - 1));
          setCurrentFrame(targetImageIndex + 1);
          targetEl?.dispatchEvent?.(new CustomEvent(evName, { detail: { imageIdIndex: targetImageIndex }, bubbles: true }));
        } catch (e) {
        }
        if (shouldAbort()) return;

        // 9) Start background preload (safe, cancellable via shouldAbort checks in onProgress)
        // khi attach finished thành công (trong finally, khi !shouldAbort())
        try {
          // mark progress as complete (100%) only when attach flow is done/settled
          setLoadingProgress(100);
          // small delay so overlay shows 100% then hide
          finalTimer = window.setTimeout(() => {
            try {
              if (!shouldAbort()) {
                setLoadingStackSafe(false);
                setSidebarLoadingSafe(false);
                setLoadingProgress(null); // reset after hiding
              }
            } catch {}
          }, 350); // 350ms để overlay hiển thị 100% trước khi ẩn (giống behavior cũ)
        } catch (e) {
          // fallback: still ensure flags cleared
          finalTimer = window.setTimeout(() => {
            try {
              if (!shouldAbort()) {
                setLoadingStackSafe(false);
                setSidebarLoadingSafe(false);
                setLoadingProgress?.(null);
              }
            } catch {}
          }, 80);
        }

        // remember last successful attach signature (series + element) so we don't reattach unnecessarily
        if (!shouldAbort()) {
          try {
            lastAttachedSeriesRef.current = selectedSeries;
            lastAttachedViewportElRef.current = elToCheck;
          } catch {}
        }
      } catch (err) {
      } finally {
        if (!shouldAbort()) {
          try {
            finalTimer = window.setTimeout(() => {
              try {
                if (!shouldAbort()) {
                  setLoadingStackSafe(false);
                  setSidebarLoadingSafe(false);
                }
              } catch {}
            }, 80);
          } catch {
            if (!shouldAbort()) {
              setLoadingStackSafe(false);
              setSidebarLoadingSafe(false);
            }
          }
        } else {
          try { setLoadingProgress?.(null); } catch {}
        }
      }
    } // end attachSelectedSeries

    // small debounce so rapid toggles don't start duplicate parallel jobs
    const kickTimer = window.setTimeout(() => {
      if (!cancelled) {
        void attachSelectedSeries();
      }
    }, 60);

    return () => {
      cancelled = true;
      clearTimeout(kickTimer);
      currentAttachSessionRef.current = (currentAttachSessionRef.current || 0) + 1;
      try { disableReleaseGraphicsResourcesGlobally(); } catch {}
      if (finalTimer != null) {
        try { clearTimeout(finalTimer); } catch {}
        finalTimer = null;
      }
    };
    // Only re-run when selectedSeries or viewportReady (and some stable dependencies) change.
    // Avoid including volatile refs like viewportInstance/viewportEl to reduce spurrious retriggers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    selectedSeries,
    mergedSeriesMap,
    renderingEngineRef,
    ensureImageRendered,
    preloadImagesWithTimeout,
    voiDefaults,
    viewportReady,
  ]);

  function resolveSeriesFromImageId(refId?: string) {
    if (!refId) return undefined;
    const normRef = normalizeId(refId);

    for (const uid of Object.keys(mergedSeriesMapRef.current || {})) {
      const files = mergedSeriesMapRef.current[uid]?.files ?? [];
      for (const f of files) {
        if (normalizeId(f) === normRef) return uid;
      }
    }

    const sopMatch = String(refId).replace(/^imageId:/, '').split('/').pop();
    if (sopMatch) {
      for (const uid of Object.keys(mergedSeriesMapRef.current || {})) {
        const files = mergedSeriesMapRef.current[uid]?.files ?? [];
        if (files.some((f) => normalizeId(f).includes(sopMatch))) return uid;
      }
    }
      
    return undefined;
  }
  // -------------------------------------------------

  // ---------------- Stable measurements handler ----------------
  const handleMeasurementsChangeImplRef = useRef<((current: AnnotationMeasurement[]) => void) | null>(null);

  handleMeasurementsChangeImplRef.current = (current) => {
    try {
    } catch {}

    setAllMeasurements((prev) => {
      const prevMap = new Map(prev.map((m) => [m.annotationUID, m]));
      const mergedMap = new Map(prevMap);

      for (const m of current) {
        try {
          const old = prevMap.get(m.annotationUID);

          if (!old) {
            // New measurement -> attempt to enrich
            let seriesUID = m.metadata?.seriesUID ?? '';

            if (!seriesUID) {
              const ref = (m.metadata?.referencedImageId ?? m.metadata?.imageId ?? m.data?.imageId ?? '').toString();
              if (ref) {
                const normRef = normalizeId(ref);
                for (const [uid, data] of Object.entries(mergedSeriesMapRef.current || {})) {
                  if ((data.files || []).some((id) => normalizeId(id) === normRef)) {
                    seriesUID = uid;
                    break;
                  }
                }
              }
            }

            const filesForSeries = mergedSeriesMapRef.current?.[seriesUID]?.files ?? [];

            let newFrameIdx = Number.isFinite(Number(m.metadata?.frameIndex)) ? Number(m.metadata.frameIndex) : undefined;
            if (newFrameIdx === undefined) {
              const ref = (m.metadata?.referencedImageId ?? m.metadata?.imageId ?? m.data?.imageId ?? '').toString();
              if (ref && filesForSeries.length) {
                const found = filesForSeries.findIndex((id) => normalizeId(id) === normalizeId(ref));
                if (found >= 0) newFrameIdx = found;
              }
            }
            if (newFrameIdx === undefined) newFrameIdx = 0;

            const mergedMeta = {
              ...(m.metadata || {}),
              seriesUID,
              frameIndex: newFrameIdx,
            };

            const newItem: AnnotationMeasurement = {
              ...m,
              label: m.label ?? '',
              data: m.data ?? {},
              metadata: mergedMeta,
              createdAt: m.createdAt || new Date().toISOString(),
            };

            mergedMap.set(m.annotationUID, newItem);
            continue;
          }

          // Merge when old exists
          const newSeries = m.metadata?.seriesUID ?? '';
          const oldSeries = old.metadata?.seriesUID ?? '';

          let finalSeriesUID = '';
          if (typeof newSeries === 'string' && newSeries.length > 0 && Boolean(mergedSeriesMapRef.current?.[newSeries])) {
            finalSeriesUID = newSeries;
          } else if (oldSeries && Boolean(mergedSeriesMapRef.current?.[oldSeries])) {
            finalSeriesUID = oldSeries;
          } else {
            const ref = (m.metadata?.referencedImageId ?? m.metadata?.imageId ?? m.data?.imageId ?? '').toString();
            if (ref) {
              const normRef = normalizeId(ref);
              for (const [uid, data] of Object.entries(mergedSeriesMapRef.current || {})) {
                if ((data.files || []).some((id) => normalizeId(id) === normRef)) {
                  finalSeriesUID = uid;
                  break;
                }
              }
            }
          }

          const filesForFinal = mergedSeriesMapRef.current?.[finalSeriesUID]?.files ?? [];

          let newFrameIdx = Number.isFinite(Number(m.metadata?.frameIndex)) ? Number(m.metadata.frameIndex) : undefined;
          if (
            newFrameIdx === undefined ||
            newFrameIdx < 0 ||
            (filesForFinal.length && newFrameIdx >= filesForFinal.length)
          ) {
            const ref = (m.metadata?.referencedImageId ?? '').toString();
            if (ref && filesForFinal.length) {
              const found = filesForFinal.findIndex((id) => normalizeId(id) === normalizeId(ref));
              if (found >= 0) {
                newFrameIdx = found;
              } else {
                const oldIdx = typeof old.metadata?.frameIndex === 'number' ? old.metadata.frameIndex : 0;
                newFrameIdx = Math.max(0, Math.min(oldIdx, filesForFinal.length ? filesForFinal.length - 1 : oldIdx));
              }
            } else {
              newFrameIdx = typeof old.metadata?.frameIndex === 'number' ? old.metadata.frameIndex : 0;
            }
          }

          const mergedMeta = {
            ...(old.metadata || {}),
            ...(m.metadata || {}),
            seriesUID: finalSeriesUID,
            frameIndex: newFrameIdx,
          };

          const mergedItem: AnnotationMeasurement = {
            ...old,
            ...m,
            label: m.label ?? old.label,
            data: m.data ?? old.data,
            metadata: mergedMeta,
            createdAt: m.createdAt || old.createdAt || new Date().toISOString(),
          };

          mergedMap.set(m.annotationUID, mergedItem);
        } catch (err) {
        }
      }

      const uniqueByUID = new Map<string, any>();
      for (const it of Array.from(mergedMap.values())) {
        uniqueByUID.set(it.annotationUID, it);
      }
      const next = Array.from(uniqueByUID.values());

      try {
      } catch (e) {}

      // If selectedMeasurementUID no longer present, clear it (defer)
      setTimeout(() => {
        try {
          const selUid = selectedMeasurementUIDRef.current;
          if (selUid && !next.some((x) => x.annotationUID === selUid)) {
            setSelectedMeasurementUID(null);
          }
        } catch (e) {}
      }, 0);

      // Order-insensitive equality check by annotationUID to avoid false diffs
      let identical = true;
      if (prev.length !== next.length) {
        identical = false;
      } else {
        const prevMap = new Map<string, typeof prev[0]>();
        for (const p of prev) {
          prevMap.set(p.annotationUID, p);
        }
        for (const n of next) {
          const p = prevMap.get(n.annotationUID);
          if (!p) {
            identical = false;
            break;
          }
          // Compare the small set of stabilizing fields only
          if (p.createdAt !== n.createdAt || p.label !== n.label) {
            identical = false;
            break;
          }
        }
      }

      if (identical) {
        // return previous array reference to avoid rerender churn
        return prev;
      }
      return next;

    });
  };

  const handleMeasurementsChange = useCallback((current: AnnotationMeasurement[]) => {
    // stable wrapper - forward to impl
    try {
      handleMeasurementsChangeImplRef.current?.(current);
    } catch (e) {
    }
  }, []);
  // ---------------------------------------------------------------

  // Helper: safe engine/viewport checks + safe render/resize wrappers
  // Helper robust: kiểm tra engine/viewport + safe wrappers
  function isRenderingEngineAlive(eng: any) {
    try {
      // if component fully aborted/unmounted, treat engine as dead
      if (abortRef.current) return false;
      if (!eng) return false;
      if ((eng as any)._destroyed === true) return false;
      if ((eng as any).destroyed === true) return false;
      if ((eng as any).isDestroyed === true) return false;
      return typeof eng.renderViewport === 'function' || typeof eng.resize === 'function';
    } catch {
      return false;
    }
  }

  function safeRenderViewport(vpId = VIEWPORT_ID) {
    try {
      if (abortRef.current) return;
      const eng = renderingEngineRef.current as any;
      if (!eng) return;
      if (!isRenderingEngineAlive(eng)) return;
      try {
        eng.renderViewport?.(vpId);
      } catch (err: any) {
        const msg = String(err || '').toLowerCase();
        if (msg.includes('destroy')) return;
      }
    } catch (e) {
    }
  }

  function safeResizeAndRender(vpId = VIEWPORT_ID) {
    try {
      if (abortRef.current) return;
      const eng = renderingEngineRef.current as any;
      if (!eng) return;
      if (!isRenderingEngineAlive(eng)) return;
      try { eng.resize?.(); } catch (e) { /* ignore */ }
      try {
        eng.renderViewport?.(vpId);
      } catch (err: any) {
        const msg = String(err || '').toLowerCase();
        if (msg.includes('destroy')) return;
      }
    } catch (e) {
    }
  }

  function blurViewportActiveElement() {
    try {
      const active = document.activeElement as HTMLElement | null;
      if (!active) return;
      // elRef là ref tới div viewport container trong component
      if (elRef.current && elRef.current.contains(active)) {
        active.blur();
        // đảm bảo focus không mất hoàn toàn — set focus vào body
        try { (document.body as HTMLElement).focus?.(); } catch {}
      }
    } catch {}
  }

  // small helper
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  /**
   * Try to attach annotation instance (csAnnotation.state) into viewportEl with retries.
   * Returns true if successfully attached and visible.
   */
  async function attachAnnotationWithRetries(annotationUID: string, attempts = ATTEMPTS_ANNOT, intervalMs = 120): Promise<boolean> {
    if (!annotationUID) return false;
    try {
      for (let i = 0; i < attempts; i++) {
        try {
          const inst = (csAnnotation.state as any)?.getAnnotation?.(annotationUID) ?? null;
          if (inst && viewportEl) {
            // try to add it; safeAddAnnotation above already exists in file
            try {
              await safeAddAnnotation(inst, viewportEl);
            } catch {}
            // try set visibility
            try { (csAnnotation.visibility as any)?.setAnnotationVisibility?.(annotationUID, true); } catch {}
            // small pause then verify it is attached
            await sleep(40);
            const anns = safeGetAnnotations(inst?.toolName, viewportEl);
            const found = Array.isArray(anns) ? anns.find((a) => a.annotationUID === annotationUID) : undefined;
            if (found) return true;
          } else {
            // try to ensure annotation available (maybe still being created)
            const maybe = await ensureAnnotationAvailable(annotationUID, 600, 30).catch(() => null);
            if (maybe && viewportEl) {
              try {
                await safeAddAnnotation(maybe, viewportEl);
              } catch {}
              try { (csAnnotation.visibility as any)?.setAnnotationVisibility?.(annotationUID, true); } catch {}
              await sleep(40);
              const anns = safeGetAnnotations(maybe?.toolName, viewportEl);
              const found = Array.isArray(anns) ? anns.find((a) => a.annotationUID === annotationUID) : undefined;
              if (found) return true;
            }
          }
        } catch (e) {
          // ignore, try again
        }
        await sleep(intervalMs);
      }
    } catch {}
    return false;
  }

  /**
   * Wrapper used when user clicks a measurement in UI.
   * - prevents re-entrancy via selectionInProgressRef
   * - sets suppression flag so auto-select doesn't race
   * - ensures annotation attached after selection attempts
   */
  async function doUserSelectMeasurement(m: any) {
    if (!m) return;
    if (selectionInProgressRef.current) {
      return;
    }

    selectionInProgressRef.current = true;
    // temporarily suppress auto selection churn
    selectionSuppressedRef.current = true;
    if (selectionSuppressTimeoutRef.current) {
      window.clearTimeout(selectionSuppressTimeoutRef.current);
      selectionSuppressTimeoutRef.current = null;
    }

    try {
      try { blurViewportActiveElement(); } catch {}
      // optimistic set selected (use suppression wrapper)
      try { setSelectedMeasurementUIDWithSuppression(m.annotationUID, { force: true }); } catch {}

      // call the hook's robust handler
      try {
        await handleSelectMeasurement(m);
      } catch (err) {
      }

      // After main flow: try to ensure annotation is attached/visible
      try {
        await attachAnnotationWithRetries(m.annotationUID, 6, 140);
      } catch (e) {
        // ignore
      }
    } finally {
      // release flags after short delay to avoid immediate re-entry
      window.setTimeout(() => {
        selectionSuppressedRef.current = false;
      }, 400);

      selectionInProgressRef.current = false;
    }
  }



  // Now we can call useMeasurements and pass stable handler
  const { measurements, refreshMeasurements, updateLabel } = useMeasurements({
    element: viewportEl,
    viewportId,
    seriesInstanceUID: mergedSeriesMap[selectedSeries]?.metadata?.seriesInstanceUID,
    studyInstanceUID: studyUID,
    onMeasurementsChange: handleMeasurementsChange,
    resolveSeriesUID: resolveSeriesFromImageId,
  });

  useCine(isPlaying, fps, viewportEl);

  // ---------------- SR / measurement lists --------------
  const [loadedSrList, setLoadedSrList] = useState<
    { id: string; label: string; count: number; instances: any[]; groupLabel?: string }[]
  >([]);

  const [srGroups, setSrGroups] = useState<{ id: number; srIds: string[]; label?: string }[]>([]);
  const prevLoadedSrRef = useRef<string[]>([]);
  const srGroupCounterRef = useRef<number>(0);

  const [activeSrId, setActiveSrId] = useState<string | null>(null);
  const [isCreatingSr, setIsCreatingSr] = useState(false);

  // Add near other refs/state in Viewer component:
  const selectionSuppressedRef = useRef(false);
  const selectionSuppressTimeoutRef = useRef<number | null>(null);

  // NEW: global flag to indicate a selection flow is currently in progress
  // This will be passed into useMeasurementSelector so the hook can mark it true/false.
  const selectionInProgressRef = useRef(false);


  // Cleanup suppression timeout on unmount to avoid stray timers
  useEffect(() => {
    return () => {
      try {
        if (selectionSuppressTimeoutRef.current) {
          window.clearTimeout(selectionSuppressTimeoutRef.current);
          selectionSuppressTimeoutRef.current = null;
        }
        selectionSuppressedRef.current = false;
      } catch (e) {
        // ignore
      }
    };
  }, []);


  // wrapped setter that prevents rapid external overrides for a short window
  const setSelectedMeasurementUIDWithSuppression = useCallback((uid: string | null, opts?: { force?: boolean }) => {
    try {
      const bypass = Boolean(opts?.force);
      if (selectionSuppressedRef.current && !bypass) {
        // optional: ignore if suppressed, or still set as you prefer
      }

      // --- IMPORTANT: set suppression BEFORE calling the state setter ---
      selectionSuppressedRef.current = true;
      if (selectionSuppressTimeoutRef.current) {
        window.clearTimeout(selectionSuppressTimeoutRef.current);
      }
      // call state setter
      setSelectedMeasurementUID(uid);

      // keep suppression window (600ms)
      selectionSuppressTimeoutRef.current = window.setTimeout(() => {
        selectionSuppressedRef.current = false;
        selectionSuppressTimeoutRef.current = null;
      }, 600);
    } catch (e) {
      try { setSelectedMeasurementUID(uid); } catch {}
    }
  }, [setSelectedMeasurementUID]);


  const {
    exportSRAsJSON,
    exportSRAsDICOMPlaceholder,
  } = useSrExport({
    allMeasurements,
    mergedSeriesMap,
    viewportInstance,
    viewportEl,
    setExtraSeriesMap,
    setAllMeasurements,
    refreshMeasurements,
    setLoadedSrList,
    setActiveSrId,
    setSelectedMeasurementUID: setSelectedMeasurementUIDWithSuppression,
    setCurrentFrame,
    renderingEngineRef,
    studyUID,
    viewportId,
    viewSr: async (seriesUID: string, instanceUID?: string | null) => {
      if (viewSrRef.current) {
        try {
          return await viewSrRef.current(seriesUID, instanceUID);
        } catch (err) {
          return false;
        }
      }
      return false;
    },
  });

  const openSrNameDialog = (type: 'json' | 'dicom') => {
    setPendingSrType(type);
    setSrNameValue('');
    setSrDialogOpen(true);
  };

  const executeSrExportWithName = async (name: string) => {
    setSrDialogOpen(false);
    setIsCreatingSr(true);
    try {
      let createdIds: string[] | null = null;
      if (pendingSrType === 'json') {
        createdIds = await exportSRAsJSON(name);
      } else if (pendingSrType === 'dicom') {
        createdIds = await exportSRAsDICOMPlaceholder(name);
      }

      if (createdIds && createdIds.length) {
        setLoadedSrList((prev) =>
          prev.map((item) => {
            if (createdIds!.includes(item.id)) {
              return { ...item, groupLabel: name };
            }
            return item;
          })
        );

        setSrGroups((prev) => {
          const maxId = prev.reduce((max, g) => Math.max(max, Number(g.id ?? 0)), 0);
          const grpId = maxId + 1;
          const cleaned = prev
            .map((g) => ({ ...g, srIds: g.srIds.filter((id) => !createdIds!.includes(id)) }))
            .filter((g) => g.srIds && g.srIds.length > 0);
          const newGroup = { id: grpId, srIds: createdIds, label: `Group ${grpId} — ${name}` };
          srGroupCounterRef.current = grpId;
          return [...cleaned, newGroup];
        });

        prevLoadedSrRef.current = Array.from(new Set(createdIds));
      }
    } catch (e) {
    } finally {
      setIsCreatingSr(false);
      setPendingSrType(null);
      setSrNameValue('');
    }
  };

  const cancelSrDialog = () => {
    setSrDialogOpen(false);
    setPendingSrType(null);
    setSrNameValue('');
  };

  const isSR = seriesMap[selectedSeries]?.metadata?.seriesModality === 'SR';

  const isSeriesReadOnly =
    isSR ||
    Boolean(mergedSeriesMap[selectedSeries]?.metadata?.seriesModality === 'SR') ||
    (typeof selectedSeries === 'string' && selectedSeries.startsWith?.('SR_'));

  const handleSelectTool = useCallback((tool: ToolID) => {
    if (!isToolReady) {
      setActiveTool(tool);
      return;
    }
    try {
      const ok = activateTool(tool, { isSeriesSR: isSeriesReadOnly });
      if (ok) {
        setActiveTool(tool);
      } else {
        setActiveTool('adjust');
      }
    } catch (e) {
      setActiveTool('adjust');
    }
  }, [isToolReady, activateTool, isSeriesReadOnly]);


  const measurementsForPanel = useMemo(() => {
    if (!selectedSeries) return [];
    const currentFiles = mergedSeriesMap[selectedSeries]?.files ?? [];

    const isSelectedSR = typeof selectedSeries === 'string' && selectedSeries.startsWith('SR_');

    return allMeasurements.filter((m) => {
      const mSeries = m.metadata?.seriesUID ?? '';

      if (isSelectedSR) {
        return String(mSeries) === String(selectedSeries);
      }

      if (String(mSeries).startsWith('SR_')) {
        return mSeries === selectedSeries;
      }

      if (mSeries === selectedSeries) return true;

      if (prevSeriesRef.current && mSeries === prevSeriesRef.current) return true;

      const ref =
        (m.metadata as any)?.referencedImageId ??
        (m.metadata as any)?.imageId ??
        (m.data as any)?.imageId ??
        (m.data as any)?.referencedImageId ??
        '';
      const normRef = normalizeId(ref);
      if (normRef && currentFiles.some((id) => normalizeId(id) === normRef)) return true;

      return false;
    });
  }, [allMeasurements, selectedSeries, mergedSeriesMap]);


  const [srDialogOpen, setSrDialogOpen] = useState(false);
  const [pendingSrType, setPendingSrType] = useState<'json' | 'dicom' | null>(null);
  const [srNameValue, setSrNameValue] = useState<string>('');

  useLayoutEffect(() => {
    if (typeof window !== 'undefined') {
      (window as any).__CURRENT_SERIES_IS_SR = !!isSeriesReadOnly;
    }
  }, [isSeriesReadOnly]);

  useEffect(() => {
    if (activeSrId) {
      setSelectedSeries(activeSrId);
      if (activeTool !== 'adjust') setActiveTool('adjust');
    }
  }, [activeSrId, setSelectedSeries, activeTool]);

  useEffect(() => {
    if (!selectedSeries) return;
    setLoadingStackSafe(true);
    setSidebarLoadingSafe(true);
  }, [selectedSeries, setLoadingStackSafe, setSidebarLoadingSafe]);

  // Pass a safe renderer into the measurement bridge
  useMeasurementBridge({
    allMeasurements,
    viewportEl,
    renderingEngineRender: () => safeRenderViewport(VIEWPORT_ID),
    viewportId: VIEWPORT_ID,
    hiddenMeasurements,
    selectedSeries,
    prevSelectedSeries: prevSeriesRef.current,
    mergedSeriesMap,
    onAutoSelect: (uid, frameIdx) => {
      // programmatic auto-select should respect suppression window, so use the wrapper
      setSelectedMeasurementUIDWithSuppression(uid);
      setCurrentFrame(frameIdx + 1);
    },
  });

  useEffect(() => {
    setVoiRange(selectedSeries && voiDefaults[selectedSeries] ? voiDefaults[selectedSeries] : null);
  }, [selectedSeries, voiDefaults]);


  // tránh gọi activateTool nhiều lần nếu cùng tool đã active trước đó
  const lastActivatedToolRef = useRef<ToolID | null>(null);

  useEffect(() => {
    if (!isToolReady) return;

    // nếu lần trước đã active cùng tool, skip
    if (lastActivatedToolRef.current === activeTool) return;

    try {
      const ok = activateTool(activeTool, { isSeriesSR: isSeriesReadOnly });
      if (ok) {
        lastActivatedToolRef.current = activeTool;
      } else {
        // activation bị chặn -> clear ref để có thể thử lại sau
        lastActivatedToolRef.current = null;
      }
    } catch (e) {
      lastActivatedToolRef.current = null;
    }
  }, [activeTool, isToolReady, isSeriesReadOnly, activateTool]);


  // settle effect (mình đã đề xuất trước đó) – thêm setViewportReady(true) ở cuối
  useEffect(() => {
    if (!viewportInstance || !viewportEl) { setViewportReady(false); return; }

    let cancelled = false;
    let nudgeId: number | null = null;

    const settle = async () => {
      try {
        // wait two raf + small timeout so layout has a chance to settle
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              setTimeout(() => resolve(), 60);
            });
          });
        });

        if (cancelled) return;

        // initial reset / present / render
        try { (viewportInstance as any).reset?.(); } catch {}
        try { (viewportInstance as any).setViewPresentation?.({ rotation: 0 }); } catch {}
        try { renderingEngineRef.current?.resize?.(); } catch {}
        try { renderingEngineRef.current?.renderViewport?.(VIEWPORT_ID); } catch {}
        try { (viewportInstance as any).render?.(); } catch {}

        if (cancelled) return;

        // DELAYED NUDGE:
        // call another lightweight resize/render/reset after a small delay. This
        // helps when some CSS/layout reflow happens slightly after mount and the
        // first render was done too early.
        try {
          nudgeId = window.setTimeout(() => {
            if (cancelled) return;
            try { renderingEngineRef.current?.resize?.(); } catch {}
            try { renderingEngineRef.current?.renderViewport?.(VIEWPORT_ID); } catch {}
            try { (viewportInstance as any).reset?.(); } catch {}
            try { (viewportInstance as any).render?.(); } catch {}
          }, 80);
        } catch {
          // ignore
        }

        if (cancelled) {
          if (nudgeId != null) { clearTimeout(nudgeId); nudgeId = null; }
          return;
        }

        // finally mark ready (UI can hide loading overlay etc.)
        setViewportReady(true);
      } catch (e) {
        // ignore errors but ensure ready flag not left stuck
        try { setViewportReady(true); } catch {}
      }
    };

    setViewportReady(false);
    const id = window.setTimeout(settle, 20);

    return () => {
      cancelled = true;
      clearTimeout(id);
      if (nudgeId != null) {
        clearTimeout(nudgeId);
        nudgeId = null;
      }
      setViewportReady(false);
    };
  }, [viewportInstance, viewportEl, renderingEngineRef]);


  // Nếu viewportEl thay đổi, gọi enableElement một lần nữa như final nudge.
  // Điều này giúp khi engine đã enable phần tử khác (timing mismatch) — gọi lại trên phần tử thực tế.
  // --- MARK: detect user interaction on the viewport to avoid aggressive background re-attach ---
  useEffect(() => {
    const el = (viewportEl as HTMLElement | null) ?? elRef.current;
    if (!el) return () => {};

    const markInteraction = () => {
      try {
        (el as HTMLElement).dataset.__lastUserInteraction = String(Date.now());
        // small debug
      } catch {}
    };

    // common user gestures that indicate user intentionally moved frame/view:
    el.addEventListener('wheel', markInteraction, { passive: true });
    el.addEventListener('pointerdown', markInteraction);
    el.addEventListener('touchstart', markInteraction, { passive: true });

    // also listen for keyboard navigation while the viewport holds focus
    const onKey = (ev: KeyboardEvent) => {
      try {
        const active = document.activeElement as HTMLElement | null;
        if (active && el.contains(active)) {
          // arrow keys, pageUp/Down, home/end often used for navigation
          if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','PageUp','PageDown','Home','End'].includes(ev.key)) {
            markInteraction();
          }
        }
      } catch {}
    };
    window.addEventListener('keydown', onKey);

    return () => {
      try {
        el.removeEventListener('wheel', markInteraction as EventListener);
        el.removeEventListener('pointerdown', markInteraction as EventListener);
        el.removeEventListener('touchstart', markInteraction as EventListener);
        window.removeEventListener('keydown', onKey);
      } catch {}
    };
  }, [viewportEl]);


  useEffect(() => {
    const onResize = () => {
      safeResizeAndRender(viewportId);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [renderingEngineRef, viewportId]);


  useEffect(() => {
    if (measurements.length === 0) {
      setSelectedMeasurementUID(null);
      prevMeasurementUIDs.current.clear();
    }
  }, [measurements]);

  useEffect(() => {
    if (!selectedMeasurementUID) return;
    const sel = allMeasurements.find((m) => m.annotationUID === selectedMeasurementUID);
    if (!sel) {
      setSelectedMeasurementUID(null);
      return;
    }

    const seriesUID = sel.metadata?.seriesUID ?? '';
    if (String(seriesUID).startsWith('SR_')) {
      if (seriesUID !== selectedSeries) {
        setSelectedMeasurementUID(null);
      }
      return;
    }

    if (seriesUID === selectedSeries) return;

    if (prevSeriesRef.current && seriesUID === prevSeriesRef.current) return;

    const files = mergedSeriesMap[selectedSeries]?.files ?? [];

    const ref =
      (sel.metadata as any)?.referencedImageId ??
      (sel.metadata as any)?.imageId ??
      (sel.data as any)?.imageId ??
      (sel.data as any)?.referencedImageId ??
      '';
    const normRef = normalizeId(ref);
    const refMatches = Boolean(normRef && files.some((id: string) => normalizeId(id) === normRef));
    if (refMatches) return;

    setSelectedMeasurementUID(null);
  }, [selectedSeries, allMeasurements, selectedMeasurementUID, mergedSeriesMap, normalizeId]);

  useEffect(() => {
    if (!loadingSeries && !selectedSeries && Object.keys(seriesMap).length > 0) {
      const orderedImageSeries = Object.entries(seriesMap)
        .filter(([, e]) => e?.metadata?.seriesModality !== 'SR' && (Number(e.metadata.seriesRelatedInstanceCount ?? 0) > 0 || (Array.isArray(e.files) && e.files.length > 0)))
        .sort(([, a], [, b]) => (Number(a.metadata?.seriesNumber ?? 0) - Number(b.metadata?.seriesNumber ?? 0)))
        .map(([uid]) => uid);

      const defaultSeries = orderedImageSeries[0] ?? Object.keys(seriesMap)[0];
      setSelectedSeries(defaultSeries);
    }
  }, [loadingSeries, selectedSeries, seriesMap, setSelectedSeries]);


  useEffect(() => {
    const tg = ToolGroupManager.getToolGroup(TOOL_GROUP);
    if (!tg) return;

    if (isSeriesReadOnly) {
      // only change local state if needed
      if (activeTool !== 'adjust') setActiveTool('adjust');

      measurementToolIDs.forEach((id) => {
        const name = toolNameMap[id];
        try { tg.setToolPassive(name); } catch (e) {}
        try { tg.setToolConfiguration(name, { bindings: [] }); } catch (e) {}
      });

      if (isToolReady) {
        // avoid redundant activateTool calls via lastActivatedToolRef
        if (lastActivatedToolRef.current !== 'adjust') {
          try {
            const ok = activateTool('adjust', { isSeriesSR: true });
            if (ok) lastActivatedToolRef.current = 'adjust';
          } catch (e) {
            lastActivatedToolRef.current = null;
          }
        }
      }
    } else {
      measurementToolIDs.forEach((id) => {
        const name = toolNameMap[id];
        try { tg.setToolConfiguration(name, { bindings: [{ mouseButton: ToolEnums.MouseBindings.Primary }] }); } catch (e) {}
      });
    }
  }, [isSeriesReadOnly, isToolReady, activateTool, activeTool]);


  const handleRemoveMeasurement = useCallback(async (uid: string) => {
    if (!uid) return;
    try {
      // mark + remove via central helper
      await safeRemoveAnnotationByUID(uid).catch(() => null);

      // refresh measurement list from annotation.state
      try { refreshMeasurements?.(); } catch {}

      // Update local state once
      setAllMeasurements((prev) => prev.filter((m) => m.annotationUID !== uid));
      setSelectedMeasurementUID((prev) => (prev === uid ? null : prev));

      // Force redraw
      setTimeout(() => safeRenderViewport(VIEWPORT_ID), 0);
    } catch (err) {
    }
  }, [safeRenderViewport, refreshMeasurements]);




  function handleToggleVisibility(uid: string) {
    setHiddenMeasurements((prev) => {
      const set = new Set(prev);
      set.has(uid) ? set.delete(uid) : set.add(uid);
      return set;
    });

    // đảm bảo redraw
    setTimeout(() => {
      safeRenderViewport(VIEWPORT_ID);
    }, 0);
  }

  /**
   * Robust select measurement:
   *  - wait for engine/viewport
   *  - ensure image(s) rendered (ensureImageRendered does setStack + polling)
   *  - then attach / show annotation
   */

  // sau khi có các biến / refs trong Viewer (renderingEngineRef, viewportInstance, viewportEl, mergedSeriesMap, allMeasurements, ...)
  // gọi hook:
  const {
    handleSelectMeasurement,
    handleSelectSr,
    isViewportShowingDesiredImage,
  } = useMeasurementSelector({
    renderingEngineRef,
    viewportInstance,
    viewportEl,
    viewportId: VIEWPORT_ID,
    mergedSeriesMapRef,
    allMeasurements,
    selectedSeries,
    prevSeriesRef,
    setSelectedSeries,
    setSelectedMeasurementUID: setSelectedMeasurementUIDWithSuppression,
    setCurrentFrame,
    setActiveSrId,
    hiddenMeasurements,
    safeRenderViewport,
    ensureImageRendered,
    preloadImagesWithTimeout,
    // <-- pass ref so hook can mark selection in progress
    selectionInProgressRef,
    // <-- NEW: allow selector to compare current selection and avoid redundant sets
    selectedMeasurementUIDRef,   // <<-- đây là dòng mới
  });

  // --- Auto-clear loading overlay when image becomes available OR when preload reaches 100% ---
  useEffect(() => {
    // If imageAvailable becomes true, hide loading and clear progress
    if (imageAvailable) {
      try { setLoadingProgress(null); } catch {}
      setLoadingStackSafe(false);
      setSidebarLoadingSafe(false);
      return;
    }
    // If loadingProgress reached 100% but imageAvailable not yet true, still hide overlay after small delay
    if (loadingProgress !== null && loadingProgress >= 100) {
      // give tiny delay so user sees 100% then hide
      const t = window.setTimeout(() => {
        try { setLoadingProgress(null); } catch {}
        setLoadingStackSafe(false);
        setSidebarLoadingSafe(false);
      }, 300);
      return () => window.clearTimeout(t);
    }
  }, [imageAvailable, loadingProgress, setLoadingStackSafe, setSidebarLoadingSafe]);


  useEffect(() => {
  }, [selectedMeasurementUID]);


  if (!studyMeta) return <Loading fullScreen message="Đang tải thông tin Study..." />;

  return (
    <ViewerWorkspace
      loadingSeries={loadingSeries}
      gridCols={gridCols}
      isSR={isSR}
      studyUID={studyUID}
      studyDate={studyMeta.studyDate}
      studyDescription={studyMeta.studyDescription}
      seriesMap={mergedSeriesMap}
      selectedSeries={selectedSeries}
      onSelectSeries={(uid) => {
        prevSeriesRef.current = selectedSeries;
        setIsPlaying(false);
        setCurrentFrame(1);
        setVoiRange(null);
        setSidebarLoadingSafe(true);
        setSelectedSeries(uid);
      }}
      onSelectMobileSeries={(uid) => {
        prevSeriesRef.current = selectedSeries;
        setIsPlaying(false);
        setCurrentFrame(1);
        setVoiRange(null);
        setSidebarLoadingSafe(true);
        setSelectedSeries(uid);
        setMobileSeriesOpen(false);
      }}
      sidebarCollapsed={sidebarCollapsed}
      setSidebarCollapsed={setSidebarCollapsed}
      mobileSeriesOpen={mobileSeriesOpen}
      setMobileSeriesOpen={setMobileSeriesOpen}
      loadedSrList={loadedSrList}
      activeSrId={activeSrId}
      onSelectSr={handleSelectSr}
      srGroups={srGroups}
      mobileMeasurementsOpen={mobileMeasurementsOpen}
      setMobileMeasurementsOpen={setMobileMeasurementsOpen}
      measurements={measurementsForPanel}
      measurementCollapsed={measurementCollapsed}
      setMeasurementCollapsed={setMeasurementCollapsed}
      onUpdateLabel={updateLabel}
      onSelectMeasurement={(m) => {
        void doUserSelectMeasurement(m);
      }}
      onRemoveMeasurement={handleRemoveMeasurement}
      refreshMeasurements={refreshMeasurements}
      hiddenMeasurements={hiddenMeasurements}
      onToggleVisibility={handleToggleVisibility}
      onExportJSON={() => openSrNameDialog('json')}
      onExportDICOMSR={() => openSrNameDialog('dicom')}
      currentFrame={currentFrame}
      viewportEl={viewportEl}
      selectedMeasurementUID={selectedMeasurementUID}
      activeTool={activeTool}
      onSelectTool={handleSelectTool}
      onReset={resetViewer}
      onRotate90={() => rotate()}
      onFlipHorizontal={() => flipHorizontal()}
      isPlaying={isPlaying}
      fps={fps}
      onTogglePlay={() => setIsPlaying((v) => !v)}
      onFpsChange={setFps}
      loadingStack={loadingStack}
      imageAvailable={imageAvailable}
      loadingProgress={loadingProgress}
      isSeriesToolbarReadOnly={isSeriesReadOnly || isCreatingSr}
      elementRef={elRef}
      srDialogOpen={srDialogOpen}
      srNameValue={srNameValue}
      isCreatingSr={isCreatingSr}
      onCancelSrDialog={cancelSrDialog}
      onSaveSrDialog={executeSrExportWithName}
      blurViewportActiveElement={blurViewportActiveElement}
    />
  );
};

export default Viewer;
