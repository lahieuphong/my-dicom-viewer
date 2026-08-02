// Transitional implementation for the basic-viewer mode.
'use client';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useLayoutEffect,
  useMemo,
} from 'react';
import { toast } from 'sonner';

import { imageLoader, utilities as csCoreUtilities } from '@cornerstonejs/core';

import { useBatchedFrameState, useSeriesLoader } from './application';

import {
  ToolGroupManager,
  annotation as csAnnotation,
  Enums as ToolEnums,
} from '@cornerstonejs/tools';

import { TOOL_GROUP } from '@/constants/toolgroup';
import { VIEWPORT_ID } from '@/constants/viewport';

import { ViewerWorkspace, useViewerLayout } from '@/extensions/default';
import {
  attachDisplaySetToViewport,
  createDisplaySetFromSeries,
  disableReleaseGraphicsResourcesGlobally,
  enableElement,
  measurementToolIDs,
  toolNameMap,
  useCine,
  useEnsureImageRendered,
  useFlipHorizontal,
  useForceZoomOne,
  useImageReadiness,
  useMeasurementBridge,
  useMeasurementSelector,
  useMeasurements,
  useRenderingEngine,
  useResetViewer,
  useRotate,
  useStackPrefetch,
  useStackScrollWheel,
  useStackVoiPersistence,
  useToolManager,
  useViewportAutoFitOnResize,
  type AnnotationMeasurement,
  type ToolID,
} from '@/extensions/cornerstone';
import { useSrExport } from '@/extensions/dicom-sr';

import {
  fetchStudyMeta,
} from '@/extensions/static-dicom-data-source';
import type {
  LocalStructuredReport,
  Study,
} from '@/platform/core';

import {
  releaseMeasurementAnnotationStyle,
  syncMeasurementNativeSelection,
  syncMeasurementSelectionStyles,
} from '@/lib/cornerstone/measurementStyles';
import {
  areImageStacksEqual,
  findMatchingImageIdIndex,
} from '@/lib/cornerstone/helpers';
import { hasActiveAnnotationInteraction } from '@/lib/cornerstone/annotationInteraction';


import { normalizeId, getEnabledElementSafeLocal } from '@/lib/viewer/dom';
import { waitForElementVisible, waitForCornerstoneReady, waitForEngineAndViewport, forceRenderCheck } from '@/lib/viewer/polling';
import { preloadImagesWithTimeout, loadAndCacheImageWithTimeout } from '@/lib/viewer/preload';
import {
  isAnnotationRemovalTombstoned,
  safeRemoveAnnotationByUID,
} from '@/lib/viewer/annotationHelpers';
import { isMeasurementInSeries } from '@/lib/viewer/measurementVisibility';
import { createMeasurementListFingerprint } from '@/lib/viewer/measurementFingerprint';


import { normalizeCanvasAndContext, ensureCanvasSizing } from '@/lib/viewer/canvasUtils';

import { ATTEMPTS_ATTACH } from '@/lib/viewer/constants';

function createFallbackStudyMeta(studyUID: string): Study {
  return {
    studyInstanceUID: studyUID,
    patientName: '-',
    patientId: '-',
    studyDate: '-',
    studyDescription: studyUID,
    accessionNumber: '-',
    modalitiesInStudy: '-',
    seriesCount: 0,
    imageCount: 0,
    series: [],
  };
}

const BasicViewerImplementation = ({ studyUID }: { studyUID: string }) => {
  const viewportId = VIEWPORT_ID;

  // ==============================
  // 🔧 State
  // ==============================
  const elRef = useRef<HTMLDivElement | null>(null);

  // signal that component has been unmounted (hard abort)
  const abortRef = useRef(false);
  useEffect(() => {
    // React StrictMode runs setup -> cleanup -> setup in development while
    // preserving refs. Reset here so the second setup is a live viewer again.
    abortRef.current = false;

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

  const [fps, setFps] = useState(24);
  const [isPlaying, setIsPlaying] = useState(false);

  const [allMeasurements, setAllMeasurements] = useState<AnnotationMeasurement[]>([]);
  const [selectedMeasurementUID, setSelectedMeasurementUID] = useState<string | null>(null);
  const [hiddenMeasurements, setHiddenMeasurements] = useState<Set<string>>(new Set());
  const measurementDeletionPromisesRef = useRef<
    Map<string, Promise<boolean>>
  >(new Map());

  const [mobileSeriesOpen, setMobileSeriesOpen] = useState(false);
  const [mobileMeasurementsOpen, setMobileMeasurementsOpen] = useState(false);

  const [loadingStack, setLoadingStack] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState<number | null>(null);


  // Safe setters
  const setLoadingStackSafe = useCallback((v: boolean) => {
    // only change when different
    setLoadingStack((prev) => (prev === v ? prev : v));
  }, []);

  useEffect(() => {
    // Hidden state belongs to a study, never to the lifetime of the component.
    setHiddenMeasurements(new Set());
  }, [studyUID]);



  // ==============================
  // 🔗 Refs & Context
  // ==============================
  const currentAttachSessionRef = useRef<number>(0);

  const pendingSeriesNavigationRef = useRef<{
    seriesUID: string;
    imageIndex: number;
  } | null>(null);

  const [studyMeta, setStudyMeta] = useState<Study>(() => createFallbackStudyMeta(studyUID));

  useEffect(() => {
    let cancelled = false;
    setStudyMeta(createFallbackStudyMeta(studyUID));

    fetchStudyMeta(studyUID)
      .then((meta) => {
        if (!cancelled && meta) {
          setStudyMeta(meta);
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [studyUID]);

  const {
    seriesMap,
    selectedSeries,
    setSelectedSeries,
    loadingSeries,
    voiDefaults,
  } = useSeriesLoader(studyUID);

  const mergedSeriesMap = seriesMap;

  // Refs that track mutable things used inside stable handlers
  const mergedSeriesMapRef = useRef(mergedSeriesMap);
  useEffect(() => {
    mergedSeriesMapRef.current = mergedSeriesMap;
  }, [mergedSeriesMap]);

  const selectedMeasurementUIDRef = useRef(selectedMeasurementUID);
  useLayoutEffect(() => {
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

  const handleViewportFrameChange = useCallback(
    async (frameOneBased: number) => {
      if (!viewportEl || !viewportInstance) return false;

      const imageIds = viewportInstance.getImageIds?.() ?? [];
      if (!Array.isArray(imageIds) || imageIds.length <= 1) return false;

      const targetIndex = Math.min(
        imageIds.length - 1,
        Math.max(0, Math.round(Number(frameOneBased) || 1) - 1)
      );

      try {
        viewportEl.dataset.__lastUserInteraction = String(Date.now());
      } catch {}

      setCurrentFrame(targetIndex + 1);

      try {
        await csCoreUtilities.jumpToSlice(viewportEl, {
          imageIndex: targetIndex,
          debounceLoading: true,
        });
        return true;
      } catch {
        try {
          await viewportInstance.setImageIdIndex(targetIndex);
          return true;
        } catch {
          const currentIndex = viewportInstance.getCurrentImageIdIndex?.();
          if (typeof currentIndex === 'number' && currentIndex >= 0) {
            setCurrentFrame(currentIndex + 1);
          }
          return false;
        }
      }
    },
    [setCurrentFrame, viewportEl, viewportInstance]
  );

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

  const clearPersistedVoi = useStackVoiPersistence({
    viewportInstance,
    viewportEl,
    stackKey: selectedSeries,
  });

  useEffect(() => {
    if (!viewportInstance) return;

    let cancelled = false;
    const viewportElement = (viewportInstance as any).element as
      | HTMLDivElement
      | null;
    if (viewportElement) {
      try {
        enableElement(viewportElement);
      } catch {}
    }

    const timer = window.setTimeout(() => {
      if (cancelled) return;
      try { renderingEngineRef.current?.resize?.(); } catch {}
      try { renderingEngineRef.current?.renderViewport?.(VIEWPORT_ID); } catch {}
    }, 60);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [renderingEngineRef, viewportInstance]);

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
    }
  }, [imageAvailable, setLoadingStackSafe]);


  const rotate = useRotate(viewportInstance);
  const flipHorizontal = useFlipHorizontal(renderingEngineRef, viewportId);
  const resetViewer = useResetViewer(viewportInstance, clearPersistedVoi);
  // useViewerLayout: quản lý grid + collapsed state cho sidebar & measurement panel
  const {
    gridCols,
    leftPanelWidth,
    setLeftPanelWidth,
    rightPanelWidth,
    setRightPanelWidth,
    sidebarCollapsed,
    setSidebarCollapsed,
    measurementCollapsed,
    setMeasurementCollapsed
  } = useViewerLayout();

  useViewportAutoFitOnResize({
    viewportEl,
    viewportInstance,
    renderingEngineRef,
    viewportId,
    enabled: imageAvailable,
    resizeSignal: `${leftPanelWidth}:${rightPanelWidth}:${sidebarCollapsed}:${measurementCollapsed}`,
  });

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
      const sessionAtStart = thisSession;
      const shouldAbort = () => sessionAtStart !== currentAttachSessionRef.current || cancelled;

      try {
        if (!selectedSeries) return;
        const ds = createDisplaySetFromSeries(mergedSeriesMap[selectedSeries]);
        if (!ds || !Array.isArray(ds.imageIds) || ds.imageIds.length === 0) return;
        const pendingNavigation =
          pendingSeriesNavigationRef.current?.seriesUID === selectedSeries
            ? pendingSeriesNavigationRef.current
            : null;
        const desiredImageIndex = Math.max(
          0,
          Math.min(
            Number.isInteger(pendingNavigation?.imageIndex)
              ? pendingNavigation!.imageIndex
              : ds.initialImageIdIndex ?? 0,
            ds.imageIds.length - 1
          )
        );
        const consumePendingNavigation = () => {
          if (pendingSeriesNavigationRef.current === pendingNavigation) {
            pendingSeriesNavigationRef.current = null;
          }
        };

        const elToCheck = (viewportEl as HTMLElement | null) ?? (viewportInstance as any)?.element ?? elRef.current;
        if (!elToCheck) return;

        // ===== QUICK GUARD -> skip reattach if viewport already showing same series/frame =====
        try {
          const vp = viewportInstance as any;
          if (vp) {
            // get current ids & index from viewportInstance if possible
            let vpIds: string[] | null = null;
            try { vpIds = typeof vp.getImageIds === 'function' ? vp.getImageIds() ?? null : null; } catch {}

            const vpShowsDesired = areImageStacksEqual(vpIds, ds.imageIds);

            if (vpShowsDesired) {
              let currentIndex = Number(vp.getCurrentImageIdIndex?.() ?? 0);
              if (
                pendingNavigation &&
                currentIndex !== desiredImageIndex &&
                typeof vp.setImageIdIndex === 'function'
              ) {
                await vp.setImageIdIndex(desiredImageIndex);
                if (shouldAbort()) return;
                currentIndex = Number(
                  vp.getCurrentImageIdIndex?.() ?? desiredImageIndex
                );
              }
              if (!Number.isInteger(currentIndex) || currentIndex < 0) {
                currentIndex = desiredImageIndex;
              }
              setCurrentFrame(currentIndex + 1);
              if (currentIndex === desiredImageIndex) {
                consumePendingNavigation();
              }
              // Ensure loading UI is not stuck
              setLoadingStackSafe(false);
              setLoadingProgress?.(null);
              return;
            }
          }
        } catch (e) {
          // ignore guard errors — proceed with normal attach if guard fails
        }

        // ===== END QUICK GUARD =====
        setLoadingStackSafe(true);

        // 1) Wait for cornerstone readiness (cancellable)
        await waitForCornerstoneReady(5000).catch(() => false);
        if (shouldAbort()) return;

        // 2) Ensure element visible / small delay
        const visible = await waitForElementVisible(elToCheck, 5000).catch(() => false);
        if (shouldAbort()) return;
        if (!visible) await new Promise((r) => setTimeout(r, 160));
        if (shouldAbort()) return;

        // 3) Warm first image quickly (best-effort)
        const firstImageId = ds.imageIds[desiredImageIndex];
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
              desiredIndex: desiredImageIndex,
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
          const activeViewport: any =
            renderingEngineRef.current?.getViewport?.(VIEWPORT_ID) ??
            viewportInstance;
          if (
            activeViewport?.getCurrentImageIdIndex?.() !== desiredImageIndex &&
            typeof activeViewport?.setImageIdIndex === 'function'
          ) {
            await activeViewport.setImageIdIndex(desiredImageIndex);
            if (shouldAbort()) return;
          }
          const runtimeImageIndex = Number(
            activeViewport?.getCurrentImageIdIndex?.() ?? desiredImageIndex
          );
          const targetImageIndex =
            Number.isInteger(runtimeImageIndex) && runtimeImageIndex >= 0
              ? runtimeImageIndex
              : desiredImageIndex;
          setCurrentFrame(targetImageIndex + 1);
          if (targetImageIndex === desiredImageIndex) {
            consumePendingNavigation();
          }
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
                setLoadingProgress?.(null);
              }
            } catch {}
          }, 80);
        }

      } catch (err) {
      } finally {
        if (!shouldAbort()) {
          try {
            finalTimer = window.setTimeout(() => {
              try {
                if (!shouldAbort()) {
                  setLoadingStackSafe(false);
                }
              } catch {}
            }, 80);
          } catch {
            if (!shouldAbort()) {
              setLoadingStackSafe(false);
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
  }, [
    selectedSeries,
    mergedSeriesMap,
    renderingEngineRef,
    ensureImageRendered,
    preloadImagesWithTimeout,
    viewportReady,
  ]);

  function resolveSeriesFromImageId(refId?: string) {
    if (!refId) return undefined;

    for (const uid of Object.keys(mergedSeriesMapRef.current || {})) {
      const files = mergedSeriesMapRef.current[uid]?.files ?? [];
      if (findMatchingImageIdIndex(files, refId) >= 0) return uid;
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

  const handleMeasurementsChange = useCallback(
    (current: AnnotationMeasurement[]) => {
      setAllMeasurements((prev) => {
        const currentUIDs = new Set(
          current.map((measurement) => measurement.annotationUID)
        );
        const getAnnotation = (csAnnotation.state as any)?.getAnnotation;
        const prevMap = new Map(
          prev
            .filter(
              (measurement) =>
                !isAnnotationRemovalTombstoned(measurement.annotationUID)
            )
            .filter((measurement) => {
              if (
                currentUIDs.has(measurement.annotationUID) ||
                typeof getAnnotation !== 'function'
              ) {
                return true;
              }
              try {
                // Cornerstone is the runtime source of truth. This removes
                // ghost cards after Escape/cancel or an external annotation
                // removal, while retaining annotations outside the mounted FOR.
                return Boolean(
                  getAnnotation.call(
                    csAnnotation.state,
                    measurement.annotationUID
                  )
                );
              } catch {
                return true;
              }
            })
            .map((measurement) => [measurement.annotationUID, measurement])
        );
        const mergedMap = new Map(prevMap);

      for (const m of current) {
        if (isAnnotationRemovalTombstoned(m.annotationUID)) continue;
        try {
          const old = prevMap.get(m.annotationUID);

          if (!old) {
            // New measurement -> attempt to enrich
            let seriesUID = m.metadata?.seriesUID ?? '';

            if (!seriesUID) {
              const ref = (m.metadata?.referencedImageId ?? m.metadata?.imageId ?? m.data?.imageId ?? '').toString();
              if (ref) {
                for (const [uid, data] of Object.entries(mergedSeriesMapRef.current || {})) {
                  if (
                    findMatchingImageIdIndex(data.files || [], ref) >= 0
                  ) {
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
                const found = findMatchingImageIdIndex(
                  filesForSeries,
                  ref,
                  m.metadata?.frameIndex
                );
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
              for (const [uid, data] of Object.entries(mergedSeriesMapRef.current || {})) {
                if (
                  findMatchingImageIdIndex(data.files || [], ref) >= 0
                ) {
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
              const found = findMatchingImageIdIndex(
                filesForFinal,
                ref,
                m.metadata?.frameIndex
              );
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

        const next = Array.from(mergedMap.values());

        // If selectedMeasurementUID no longer present, clear it (defer)
        setTimeout(() => {
          try {
            const selUid = selectedMeasurementUIDRef.current;
            if (selUid && !next.some((x) => x.annotationUID === selUid)) {
              setSelectedMeasurementUID(null);
            }
          } catch {}
        }, 0);

        const identical =
          createMeasurementListFingerprint(prev) ===
          createMeasurementListFingerprint(next);

        if (identical) {
          // return previous array reference to avoid rerender churn
          return prev;
        }
        return next;
      });
    },
    []
  );

  // Helper: safe engine/viewport checks + safe render/resize wrappers
  // Helper robust: kiểm tra engine/viewport + safe wrappers
  const isRenderingEngineAlive = useCallback((eng: any) => {
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
  }, []);

  const safeRenderViewport = useCallback((vpId = VIEWPORT_ID) => {
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
  }, [isRenderingEngineAlive, renderingEngineRef]);

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

  /**
   * Wrapper used when user clicks a measurement in UI.
   * Navigation is serialized and only the latest pending card is retained.
   * This keeps rapid clicks deterministic without dropping the second click.
  */
  async function doUserSelectMeasurement(m: any) {
    if (!m || isAnnotationRemovalTombstoned(m.annotationUID)) return;
    pendingUserMeasurementRef.current = m;

    if (userMeasurementSelectionLoopRef.current) {
      return userMeasurementSelectionLoopRef.current;
    }

    const drainSelections = async () => {
      while (pendingUserMeasurementRef.current) {
        const nextMeasurement = pendingUserMeasurementRef.current;
        pendingUserMeasurementRef.current = null;
        if (
          !nextMeasurement ||
          isAnnotationRemovalTombstoned(nextMeasurement.annotationUID)
        ) {
          continue;
        }
        try {
          blurViewportActiveElement();
          await handleSelectMeasurement(nextMeasurement);
        } catch {}
      }
    };

    const running = drainSelections().finally(() => {
      userMeasurementSelectionLoopRef.current = null;
    });
    userMeasurementSelectionLoopRef.current = running;
    return running;
  }



  // Now we can call useMeasurements and pass stable handler
  const { refreshMeasurements, updateLabel } = useMeasurements({
    element: viewportEl,
    viewportId,
    seriesInstanceUID: mergedSeriesMap[selectedSeries]?.metadata?.seriesInstanceUID,
    studyInstanceUID: studyUID,
    onMeasurementsChange: handleMeasurementsChange,
    resolveSeriesUID: resolveSeriesFromImageId,
  });

  useStackPrefetch(viewportEl);
  useStackScrollWheel(viewportEl, selectedSeries);
  useCine(isPlaying, fps, viewportEl);

  // ---------------- SR / measurement lists --------------
  const [loadedSrList, setLoadedSrList] = useState<
    LocalStructuredReport[]
  >([]);

  const [activeSrId, setActiveSrId] = useState<string | null>(null);
  const [isCreatingSr, setIsCreatingSr] = useState(false);
  const [srDialogOpen, setSrDialogOpen] = useState(false);
  const [srNameValue, setSrNameValue] = useState('');
  const isCreatingSrRef = useRef(false);

  useEffect(() => {
    currentAttachSessionRef.current += 1;
    pendingSeriesNavigationRef.current = null;
    setLoadedSrList([]);
    setActiveSrId(null);
    setAllMeasurements([]);
    selectedMeasurementUIDRef.current = null;
    setSelectedMeasurementUID(null);
    measurementDeletionPromisesRef.current.clear();
  }, [studyUID]);

  // Serialize Measurement-panel navigation and retain the latest pending click.
  const pendingUserMeasurementRef = useRef<any | null>(null);
  const userMeasurementSelectionLoopRef = useRef<Promise<void> | null>(null);

  const commitSelectedMeasurementUID = useCallback((uid: string | null) => {
    selectedMeasurementUIDRef.current = uid;
    setSelectedMeasurementUID((previous) => (previous === uid ? previous : uid));
  }, []);


  const { exportSRAsDICOM } = useSrExport({
    allMeasurements,
    mergedSeriesMap,
    setAllMeasurements,
    refreshMeasurements,
    setLoadedSrList,
    studyUID,
    trackedSeriesUID: selectedSeries,
    viewportId,
  });

  const isSeriesReadOnly = Boolean(activeSrId);

  const openSrNameDialog = () => {
    if (isCreatingSrRef.current || isSeriesReadOnly) return;
    if (hasActiveAnnotationInteraction()) {
      toast.error(
        'Vui lòng hoàn tất thao tác vẽ hoặc chỉnh sửa Measurement trước khi tạo SR.'
      );
      return;
    }
    setSrNameValue('Measurement Report');
    setSrDialogOpen(true);
  };

  const executeSrExportWithName = async (name: string) => {
    if (isCreatingSrRef.current) return;

    isCreatingSrRef.current = true;
    setIsCreatingSr(true);
    try {
      const createdReportUID = await exportSRAsDICOM(name);

      if (createdReportUID) {
        toast.success('Đã tạo và tải xuống DICOM SR.');
      }
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Không thể tạo Structured Report.'
      );
    } finally {
      isCreatingSrRef.current = false;
      setIsCreatingSr(false);
      setSrDialogOpen(false);
      setSrNameValue('');
    }
  };

  const cancelSrDialog = () => {
    setSrDialogOpen(false);
    setSrNameValue('');
  };

  const lastActivatedToolRef = useRef<ToolID | null>(null);

  const handleSelectTool = useCallback((tool: ToolID) => {
    if (!isToolReady) {
      lastActivatedToolRef.current = null;
      setActiveTool(tool);
      return;
    }
    try {
      const ok = activateTool(tool, { isSeriesSR: isSeriesReadOnly });
      if (ok) {
        lastActivatedToolRef.current = tool;
        setActiveTool(tool);
      } else {
        lastActivatedToolRef.current = null;
        setActiveTool('adjust');
      }
    } catch (e) {
      lastActivatedToolRef.current = null;
      setActiveTool('adjust');
    }
  }, [isToolReady, activateTool, isSeriesReadOnly]);


  const measurementsForPanel = useMemo(() => {
    if (activeSrId) {
      return allMeasurements.filter(
        (measurement) =>
          measurement.metadata?.reportSeriesUID === activeSrId
      );
    }
    if (!selectedSeries) return [];
    const currentFiles = new Set(
      (mergedSeriesMap[selectedSeries]?.files ?? []).map(normalizeId)
    );

    return allMeasurements.filter(
      (measurement) =>
        !measurement.metadata?.reportSeriesUID &&
        isMeasurementInSeries(
          measurement,
          selectedSeries,
          currentFiles
        )
    );
  }, [activeSrId, allMeasurements, selectedSeries, mergedSeriesMap]);

  useLayoutEffect(() => {
    if (typeof window !== 'undefined') {
      (window as any).__CURRENT_SERIES_IS_SR = !!isSeriesReadOnly;
    }
  }, [isSeriesReadOnly]);

  useEffect(() => {
    if (!selectedSeries) return;
    setLoadingStackSafe(true);
  }, [selectedSeries, setLoadingStackSafe]);

  const handleAutoSelectMeasurement = useCallback(
    (uid: string, frameIndex: number) => {
      // An explicit card-navigation flow always wins over automatic selection
      // emitted while the measurement list is reconciling.
      if (userMeasurementSelectionLoopRef.current) return;
      commitSelectedMeasurementUID(uid);
      setCurrentFrame(frameIndex + 1);
    },
    [commitSelectedMeasurementUID, setCurrentFrame]
  );

  // Pass a safe renderer into the measurement bridge
  useMeasurementBridge({
    allMeasurements,
    viewportEl,
    renderingEngineRender: safeRenderViewport,
    hiddenMeasurements,
    selectedSeries,
    activeSrId,
    mergedSeriesMap,
    onAutoSelect: handleAutoSelectMeasurement,
  });

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
    if (!selectedMeasurementUID) return;
    const sel = allMeasurements.find((m) => m.annotationUID === selectedMeasurementUID);
    if (!sel) {
      commitSelectedMeasurementUID(null);
      return;
    }

    const selectedReportUID = sel.metadata?.reportSeriesUID ?? null;
    if (
      (activeSrId && selectedReportUID !== activeSrId) ||
      (!activeSrId && selectedReportUID)
    ) {
      commitSelectedMeasurementUID(null);
      return;
    }

    const files = new Set(
      (mergedSeriesMap[selectedSeries]?.files ?? []).map(normalizeId)
    );
    if (!isMeasurementInSeries(sel, selectedSeries, files)) {
      commitSelectedMeasurementUID(null);
    }
  }, [
    activeSrId,
    allMeasurements,
    commitSelectedMeasurementUID,
    mergedSeriesMap,
    normalizeId,
    selectedMeasurementUID,
    selectedSeries,
  ]);

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


  const handleRemoveMeasurement = useCallback(
    (uid: string): Promise<boolean> => {
      if (!uid) return Promise.resolve(false);

      const pending = measurementDeletionPromisesRef.current.get(uid);
      if (pending) return pending;

      const deletion = (async () => {
        const wasSelected = selectedMeasurementUIDRef.current === uid;

        try {
          if (pendingUserMeasurementRef.current?.annotationUID === uid) {
            pendingUserMeasurementRef.current = null;
          }
          if (wasSelected) {
            commitSelectedMeasurementUID(null);
          }

          const removed = await safeRemoveAnnotationByUID(uid);
          if (!removed) {
            if (
              wasSelected &&
              (csAnnotation.state as any)?.getAnnotation?.(uid)
            ) {
              commitSelectedMeasurementUID(uid);
            }
            return false;
          }

          releaseMeasurementAnnotationStyle(uid);
          setAllMeasurements((previous) =>
            previous.filter(
              (measurement) => measurement.annotationUID !== uid
            )
          );
          setHiddenMeasurements((previous) => {
            if (!previous.has(uid)) return previous;
            const next = new Set(previous);
            next.delete(uid);
            return next;
          });

          try {
            refreshMeasurements();
          } catch {}
          safeRenderViewport(VIEWPORT_ID);
          return true;
        } catch {
          if (
            wasSelected &&
            (csAnnotation.state as any)?.getAnnotation?.(uid)
          ) {
            commitSelectedMeasurementUID(uid);
          }
          return false;
        }
      })();

      measurementDeletionPromisesRef.current.set(uid, deletion);
      void deletion.then(
        () => {
          if (measurementDeletionPromisesRef.current.get(uid) === deletion) {
            measurementDeletionPromisesRef.current.delete(uid);
          }
        },
        () => {
          if (measurementDeletionPromisesRef.current.get(uid) === deletion) {
            measurementDeletionPromisesRef.current.delete(uid);
          }
        }
      );
      return deletion;
    },
    [commitSelectedMeasurementUID, refreshMeasurements, safeRenderViewport]
  );




  const handleToggleVisibility = useCallback((uid: string) => {
    if (!uid || isAnnotationRemovalTombstoned(uid)) return;

    setHiddenMeasurements((prev) => {
      const set = new Set(prev);
      if (set.has(uid)) {
        set.delete(uid);
      } else {
        set.add(uid);
      }
      return set;
    });
  }, []);

  const {
    handleSelectMeasurement,
    handleSelectSr,
  } = useMeasurementSelector({
    renderingEngineRef,
    viewportInstance,
    viewportEl,
    viewportId: VIEWPORT_ID,
    mergedSeriesMapRef,
    allMeasurements,
    selectedSeries,
    pendingSeriesNavigationRef,
    setSelectedSeries,
    setSelectedMeasurementUID: commitSelectedMeasurementUID,
    setCurrentFrame,
    setActiveSrId,
    safeRenderViewport,
    selectedMeasurementUIDRef,
  });

  // --- Auto-clear loading overlay when image becomes available OR when preload reaches 100% ---
  useEffect(() => {
    // If imageAvailable becomes true, hide loading and clear progress
    if (imageAvailable) {
      try { setLoadingProgress(null); } catch {}
      setLoadingStackSafe(false);
      return;
    }
    // If loadingProgress reached 100% but imageAvailable not yet true, still hide overlay after small delay
    if (loadingProgress !== null && loadingProgress >= 100) {
      // give tiny delay so user sees 100% then hide
      const t = window.setTimeout(() => {
        try { setLoadingProgress(null); } catch {}
        setLoadingStackSafe(false);
      }, 300);
      return () => window.clearTimeout(t);
    }
  }, [imageAvailable, loadingProgress, setLoadingStackSafe]);


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
        .join('\u001f'),
    [allMeasurements]
  );

  const hiddenMeasurementUIDSignature = useMemo(
    () => Array.from(hiddenMeasurements).sort().join('\u001f'),
    [hiddenMeasurements]
  );

  useEffect(() => {
    const annotationUIDs = measurementUIDSignature
      ? measurementUIDSignature.split('\u001f')
      : [];
    syncMeasurementSelectionStyles(
      annotationUIDs,
      selectedMeasurementUID
    );
    safeRenderViewport(VIEWPORT_ID);
  }, [measurementUIDSignature, selectedMeasurementUID, safeRenderViewport]);

  useEffect(() => {
    // Hiding deselects natively inside Cornerstone. Showing the same card must
    // restore native selection without re-running all annotation style writes.
    // The same applies when the selected series is hidden and shown again.
    syncMeasurementNativeSelection(selectedMeasurementUIDRef.current);
  }, [activeSrId, hiddenMeasurementUIDSignature, selectedSeries]);

  useEffect(
    () => () => {
      syncMeasurementSelectionStyles([], null);
    },
    []
  );


  return (
    <ViewerWorkspace
      loadingSeries={loadingSeries}
      gridCols={gridCols}
      leftPanelWidth={leftPanelWidth}
      setLeftPanelWidth={setLeftPanelWidth}
      rightPanelWidth={rightPanelWidth}
      setRightPanelWidth={setRightPanelWidth}
      studyDate={studyMeta.studyDate}
      studyDescription={studyMeta.studyDescription}
      seriesMap={mergedSeriesMap}
      selectedSeries={selectedSeries}
      onSelectSeries={(uid) => {
        pendingSeriesNavigationRef.current = {
          seriesUID: uid,
          imageIndex: 0,
        };
        setIsPlaying(false);
        setCurrentFrame(1);
        setSelectedSeries(uid);
      }}
      onSelectMobileSeries={(uid) => {
        pendingSeriesNavigationRef.current = {
          seriesUID: uid,
          imageIndex: 0,
        };
        setIsPlaying(false);
        setCurrentFrame(1);
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
      hiddenMeasurements={hiddenMeasurements}
      onToggleVisibility={handleToggleVisibility}
      onCreateSR={openSrNameDialog}
      currentFrame={currentFrame}
      onFrameChange={handleViewportFrameChange}
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

export default BasicViewerImplementation;
