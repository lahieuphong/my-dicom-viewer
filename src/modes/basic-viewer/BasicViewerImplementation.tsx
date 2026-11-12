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

import { utilities as csCoreUtilities } from '@cornerstonejs/core';

import {
  mergeMeasurementSnapshot,
  resolveSeriesFromImageId as resolveSeriesUIDFromImageId,
  selectDefaultSeriesUID,
  useBatchedFrameState,
  useHiddenMeasurements,
  useSeriesLoader,
  useSrCreateDialog,
} from './application';
import {
  createLatestWinsQueue,
  createSingleFlight,
} from '@/lib/utils/asyncQueues';

import {
  ToolGroupManager,
  annotation as csAnnotation,
  Enums as ToolEnums,
} from '@cornerstonejs/tools';

import { TOOL_GROUP } from '@/constants/toolgroup';
import { VIEWPORT_ID } from '@/constants/viewport';
import { DEFAULT_CINE_FPS } from '@/constants/cine';

import { ViewerWorkspace, useViewerLayout } from '@/extensions/default';
import {
  createDisplaySetFromSeries,
  disableReleaseGraphicsResourcesGlobally,
  readOnlyBlockedToolIDs,
  toolNameMap,
  useFlipHorizontal,
  useImageReadiness,
  useInvert,
  useMeasurementBridge,
  useMeasurementSelector,
  useMeasurements,
  useRenderingEngine,
  useResetViewer,
  useRotate,
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
import { areImageStacksEqual } from '@/lib/cornerstone/helpers';
import { hasActiveAnnotationInteraction } from '@/lib/cornerstone/annotationInteraction';


import { normalizeId } from '@/lib/viewer/dom';
import {
  isAnnotationRemovalTombstoned,
  safeRemoveAnnotationByUID,
} from '@/lib/viewer/annotationHelpers';
import { isMeasurementInSeries } from '@/lib/viewer/measurementVisibility';
import { createMeasurementListFingerprint } from '@/lib/viewer/measurementFingerprint';


// After this long without useRenderingEngine attaching the selected stack, the
// viewer reports it once; it keeps waiting, since a slow network only delays it.
const ENGINE_ATTACH_WARN_MS = 8000;

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

  const [fps, setFps] = useState(DEFAULT_CINE_FPS);
  const [isPlaying, setIsPlaying] = useState(false);
  const isPlayingRef = useRef(isPlaying);

  useLayoutEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  const handleViewportFrameIndexChange = useCallback(
    (frame: number) => {
      // Overlay and stack scrollbar subscribe to STACK_NEW_IMAGE themselves.
      // Avoid rendering the entire workspace/sidebar tree for every Cine tick.
      if (!isPlayingRef.current) setCurrentFrameBatched(frame);
    },
    [setCurrentFrameBatched]
  );

  const [allMeasurements, setAllMeasurements] = useState<AnnotationMeasurement[]>([]);
  const [selectedMeasurementUID, setSelectedMeasurementUID] = useState<string | null>(null);
  const { hiddenMeasurements, toggleVisibility, forgetMeasurement } =
    useHiddenMeasurements(studyUID, isAnnotationRemovalTombstoned);
  // A second delete click for a measurement that is still being removed
  // gets the same result instead of starting another removal.
  const [measurementDeletions] = useState(() =>
    createSingleFlight<string, boolean>()
  );

  const [mobileSeriesOpen, setMobileSeriesOpen] = useState(false);
  const [mobileMeasurementsOpen, setMobileMeasurementsOpen] = useState(false);

  const [loadingStack, setLoadingStack] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState<number | null>(null);


  // Safe setters
  const setLoadingStackSafe = useCallback((v: boolean) => {
    // only change when different
    setLoadingStack((prev) => (prev === v ? prev : v));
  }, []);



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
    seriesError,
  } = useSeriesLoader(studyUID);

  const mergedSeriesMap = seriesMap;
  const [workspaceActiveSeriesUID, setWorkspaceActiveSeriesUID] =
    useState(selectedSeries);
  const [visibleViewportSeriesUIDs, setVisibleViewportSeriesUIDs] =
    useState<string[]>(selectedSeries ? [selectedSeries] : []);
  const trackedSeriesUID = workspaceActiveSeriesUID || selectedSeries;

  const handleVisibleViewportSeriesChange = useCallback(
    (seriesUIDs: string[]) => {
      const next = Array.from(new Set(seriesUIDs.filter(Boolean)));
      setVisibleViewportSeriesUIDs((current) =>
        current.length === next.length &&
        current.every((seriesUID, index) => seriesUID === next[index])
          ? current
          : next
      );
    },
    []
  );

  useEffect(() => {
    setWorkspaceActiveSeriesUID((current) =>
      current && mergedSeriesMap[current] ? current : selectedSeries
    );
  }, [mergedSeriesMap, selectedSeries]);

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
    onFrameIndexChange: handleViewportFrameIndexChange,
  });

  useEffect(() => {
    if (isPlaying || !viewportInstance) return;
    try {
      const imageIndex = viewportInstance.getCurrentImageIdIndex?.();
      if (Number.isInteger(imageIndex) && Number(imageIndex) >= 0) {
        setCurrentFrame(Number(imageIndex) + 1);
      }
    } catch {}
  }, [isPlaying, setCurrentFrame, viewportInstance]);

  const handleViewportFrameChange = useCallback(
    async (frameOneBased: number) => {
      if (!viewportEl || !viewportInstance) return false;

      const imageIds = viewportInstance.getImageIds?.() ?? [];
      if (!Array.isArray(imageIds) || imageIds.length <= 1) return false;

      const targetIndex = Math.min(
        imageIds.length - 1,
        Math.max(0, Math.round(Number(frameOneBased) || 1) - 1)
      );

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

  const { activateTool, isToolReady } = useToolManager();

  // The engine publishes the viewport once it is enabled on the mounted
  // element; the series settle effect below polls for the stack from there.
  const viewportReady = Boolean(viewportInstance && viewportEl);

  // Whether the viewport displays an image of the selected series, derived
  // from Cornerstone's STACK_NEW_IMAGE/IMAGE_RENDERED events.
  const { imageReady: imageAvailable } = useImageReadiness({
    viewportEl,
    selectedSeries,
    mergedSeriesMap,
  });

  const clearPersistedVoi = useStackVoiPersistence({
    viewportInstance,
    viewportEl,
    stackKey: selectedSeries,
  });


  const rotate = useRotate(viewportInstance);
  const flipHorizontal = useFlipHorizontal(renderingEngineRef, viewportId);
  const {
    isInverted,
    canInvert,
    toggleInvert,
    syncInvertFromViewport,
  } = useInvert({
    viewportInstance,
    stackKey: selectedSeries,
    enabled: imageAvailable && !loadingStack,
  });
  const resetViewer = useResetViewer(viewportInstance, clearPersistedVoi);
  const resetViewerAndSyncInvert = useCallback(() => {
    resetViewer();
    syncInvertFromViewport();
  }, [resetViewer, syncInvertFromViewport]);
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

  // ---------- Settle the selected stack ----------
  // useRenderingEngine is the only owner of StackViewport.setStack for this
  // pane. This effect waits until the viewport shows the selected stack, then
  // applies a pending navigation index and settles the frame and loading UI.
  // It used to run its own attach path (attachDisplaySet/ensureStackOnViewport)
  // whenever the engine had not set the stack yet; the two raced and reset,
  // resized and re-rendered the viewport twice. The effect deliberately does
  // not depend on viewportInstance/viewportEl: it is gated on viewportReady.
  useEffect(() => {
    if (!selectedSeries || !viewportReady) return;

    let cancelled = false;
    const thisSession = (currentAttachSessionRef.current =
      (currentAttachSessionRef.current || 0) + 1);
    const shouldAbort = () =>
      cancelled || thisSession !== currentAttachSessionRef.current;

    async function settleSelectedSeries() {
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

      const getAttachedViewport = () => {
        try {
          const vp: any =
            renderingEngineRef.current?.getViewport?.(VIEWPORT_ID) ??
            viewportInstance;
          return areImageStacksEqual(vp?.getImageIds?.() ?? null, ds.imageIds)
            ? vp
            : null;
        } catch {
          return null;
        }
      };

      // A slow network only delays the engine; keep waiting until it attaches
      // the stack or this effect is superseded, and report a long wait once.
      let attachedViewport = getAttachedViewport();
      if (!attachedViewport) {
        setLoadingStackSafe(true);
        const waitStartedAt = Date.now();
        let reportedSlowAttach = false;
        while (!attachedViewport) {
          await new Promise((resolve) => setTimeout(resolve, 50));
          if (shouldAbort()) return;
          attachedViewport = getAttachedViewport();
          if (
            !attachedViewport &&
            !reportedSlowAttach &&
            Date.now() - waitStartedAt > ENGINE_ATTACH_WARN_MS
          ) {
            reportedSlowAttach = true;
            console.warn(
              `[viewer] Series ${selectedSeries} is still not attached after ${
                ENGINE_ATTACH_WARN_MS / 1000
              } s.`
            );
          }
        }
      }

      try {
        const vp = attachedViewport;
        let currentIndex = Number(vp.getCurrentImageIdIndex?.() ?? 0);
        if (
          pendingNavigation &&
          currentIndex !== desiredImageIndex &&
          typeof vp.setImageIdIndex === 'function'
        ) {
          await vp.setImageIdIndex(desiredImageIndex);
          if (shouldAbort()) return;
          currentIndex = Number(vp.getCurrentImageIdIndex?.() ?? desiredImageIndex);
        }
        if (!Number.isInteger(currentIndex) || currentIndex < 0) {
          currentIndex = desiredImageIndex;
        }
        setCurrentFrame(currentIndex + 1);
        if (
          currentIndex === desiredImageIndex &&
          pendingSeriesNavigationRef.current === pendingNavigation
        ) {
          pendingSeriesNavigationRef.current = null;
        }
      } catch {
        // The viewport can be replaced while settling; the next run settles it.
      }
      // The overlay stays until the image renders (imageAvailable).
      setLoadingStackSafe(false);
      setLoadingProgress(null);
    }

    // Small debounce so rapid series switches do not start parallel jobs.
    const kickTimer = window.setTimeout(() => {
      if (!cancelled) void settleSelectedSeries();
    }, 60);

    return () => {
      cancelled = true;
      clearTimeout(kickTimer);
      currentAttachSessionRef.current = (currentAttachSessionRef.current || 0) + 1;
      try { disableReleaseGraphicsResourcesGlobally(); } catch {}
    };
  }, [
    selectedSeries,
    mergedSeriesMap,
    renderingEngineRef,
    viewportReady,
  ]);

  const resolveSeriesFromImageId = useCallback(
    (refId?: string) =>
      resolveSeriesUIDFromImageId(mergedSeriesMapRef.current || {}, refId),
    []
  );
  // -------------------------------------------------

  const handleMeasurementsChange = useCallback(
    (current: AnnotationMeasurement[]) => {
      setAllMeasurements((prev) => {
        const getAnnotation = (csAnnotation.state as any)?.getAnnotation;
        const next = mergeMeasurementSnapshot(prev, current, {
          seriesMap: mergedSeriesMapRef.current || {},
          isRemoved: isAnnotationRemovalTombstoned,
          getAnnotation:
            typeof getAnnotation === 'function'
              ? (annotationUID) =>
                  getAnnotation.call(csAnnotation.state, annotationUID)
              : undefined,
        });

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

  const blurViewportActiveElement = useCallback(() => {
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
  }, []);




  // Now we can call useMeasurements and pass stable handler
  const { refreshMeasurements, updateLabel } = useMeasurements({
    element: viewportEl,
    viewportId,
    seriesInstanceUID: mergedSeriesMap[selectedSeries]?.metadata?.seriesInstanceUID,
    studyInstanceUID: studyUID,
    onMeasurementsChange: handleMeasurementsChange,
    resolveSeriesUID: resolveSeriesFromImageId,
  });

  useStackScrollWheel(viewportEl, selectedSeries);

  // ---------------- SR / measurement lists --------------
  const [loadedSrList, setLoadedSrList] = useState<
    LocalStructuredReport[]
  >([]);

  const [activeSrId, setActiveSrId] = useState<string | null>(null);

  useEffect(() => {
    currentAttachSessionRef.current += 1;
    pendingSeriesNavigationRef.current = null;
    setLoadedSrList([]);
    setActiveSrId(null);
    setAllMeasurements([]);
    selectedMeasurementUIDRef.current = null;
    setSelectedMeasurementUID(null);
    measurementDeletions.clear();
  }, [measurementDeletions, studyUID]);

  // Measurement-panel clicks navigate one at a time and only the latest
  // pending click is kept, so rapid clicks stay deterministic without
  // dropping the last one. useMeasurementSelector below provides the
  // handler; the ref always holds the one from the latest render.
  const handleSelectMeasurementRef = useRef<
    ((measurement: AnnotationMeasurement) => Promise<unknown> | unknown) | null
  >(null);
  const [measurementSelectionQueue] = useState(() =>
    createLatestWinsQueue<AnnotationMeasurement>({
      run: async (measurement) => {
        blurViewportActiveElement();
        await handleSelectMeasurementRef.current?.(measurement);
      },
      shouldSkip: (measurement) =>
        !measurement || isAnnotationRemovalTombstoned(measurement.annotationUID),
    })
  );

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
    trackedSeriesUID,
    viewportId,
  });

  const isSeriesReadOnly = Boolean(activeSrId);

  const {
    isCreatingSr,
    srDialogOpen,
    srNameValue,
    openSrNameDialog,
    saveSrDialog,
    cancelSrDialog,
  } = useSrCreateDialog({
    exportReport: exportSRAsDICOM,
    readOnly: isSeriesReadOnly,
    isAnnotationInteractionActive: hasActiveAnnotationInteraction,
  });

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
    if (!trackedSeriesUID) return [];
    const currentFiles = new Set(
      (mergedSeriesMap[trackedSeriesUID]?.files ?? []).map(normalizeId)
    );

    return allMeasurements.filter(
      (measurement) =>
        !measurement.metadata?.reportSeriesUID &&
        isMeasurementInSeries(
          measurement,
          trackedSeriesUID,
          currentFiles
        )
    );
  }, [activeSrId, allMeasurements, trackedSeriesUID, mergedSeriesMap]);

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
      if (measurementSelectionQueue.isRunning()) return;
      commitSelectedMeasurementUID(uid);
      setCurrentFrame(frameIndex + 1);
    },
    [commitSelectedMeasurementUID, measurementSelectionQueue, setCurrentFrame]
  );

  // Pass a safe renderer into the measurement bridge
  useMeasurementBridge({
    allMeasurements,
    viewportEl,
    renderingEngineRender: safeRenderViewport,
    hiddenMeasurements,
    selectedSeries,
    visibleSeriesUIDs: visibleViewportSeriesUIDs,
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
      const defaultSeries = selectDefaultSeriesUID(seriesMap);
      if (defaultSeries) setSelectedSeries(defaultSeries);
    }
  }, [loadingSeries, selectedSeries, seriesMap, setSelectedSeries]);


  useEffect(() => {
    const tg = ToolGroupManager.getToolGroup(TOOL_GROUP);
    if (!tg) return;

    if (isSeriesReadOnly) {
      // only change local state if needed
      if (activeTool !== 'adjust') setActiveTool('adjust');

      readOnlyBlockedToolIDs.forEach((id) => {
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
      readOnlyBlockedToolIDs.forEach((id) => {
        const name = toolNameMap[id];
        try { tg.setToolConfiguration(name, { bindings: [{ mouseButton: ToolEnums.MouseBindings.Primary }] }); } catch (e) {}
      });
    }
  }, [isSeriesReadOnly, isToolReady, activateTool, activeTool]);


  const handleRemoveMeasurement = useCallback(
    (uid: string): Promise<boolean> => {
      if (!uid) return Promise.resolve(false);

      return measurementDeletions.run(uid, async () => {
        const wasSelected = selectedMeasurementUIDRef.current === uid;

        try {
          measurementSelectionQueue.dropPending(
            (measurement) => measurement.annotationUID === uid
          );
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
          forgetMeasurement(uid);

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
      });
    },
    [
      commitSelectedMeasurementUID,
      forgetMeasurement,
      measurementDeletions,
      measurementSelectionQueue,
      refreshMeasurements,
      safeRenderViewport,
    ]
  );





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
  useLayoutEffect(() => {
    handleSelectMeasurementRef.current = handleSelectMeasurement;
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

  const handleSelectImageSeries = useCallback(
    (uid: string) => {
      pendingSeriesNavigationRef.current = {
        seriesUID: uid,
        imageIndex: 0,
      };
      setIsPlaying(false);
      setCurrentFrame(1);
      setSelectedSeries(uid);
    },
    [setCurrentFrame]
  );

  const handleSelectMobileImageSeries = useCallback(
    (uid: string) => {
      handleSelectImageSeries(uid);
      setMobileSeriesOpen(false);
    },
    [handleSelectImageSeries]
  );

  if (seriesError) {
    return (
      <div
        role="alert"
        className="flex h-full min-h-64 items-center justify-center bg-background p-6 text-center"
      >
        <div className="max-w-xl rounded-lg border border-destructive/50 bg-card p-5 text-destructive shadow-sm">
          <p className="font-semibold">Không thể tải dữ liệu DICOM.</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Vui lòng kiểm tra kết nối PACS, quyền truy cập và URL ảnh DICOM.
          </p>
        </div>
      </div>
    );
  }

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
      onActiveViewportSeriesChange={setWorkspaceActiveSeriesUID}
      onVisibleViewportSeriesChange={handleVisibleViewportSeriesChange}
      onSelectSeries={handleSelectImageSeries}
      onSelectMobileSeries={handleSelectMobileImageSeries}
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
        void measurementSelectionQueue.enqueue(m);
      }}
      onRemoveMeasurement={handleRemoveMeasurement}
      hiddenMeasurements={hiddenMeasurements}
      onToggleVisibility={toggleVisibility}
      onCreateSR={openSrNameDialog}
      currentFrame={currentFrame}
      onFrameChange={handleViewportFrameChange}
      viewportEl={viewportEl}
      selectedMeasurementUID={selectedMeasurementUID}
      activeTool={activeTool}
      onSelectTool={handleSelectTool}
      onReset={resetViewerAndSyncInvert}
      onRotate90={() => rotate()}
      onFlipHorizontal={() => flipHorizontal()}
      isInverted={isInverted}
      canInvert={canInvert}
      onToggleInvert={toggleInvert}
      isPlaying={isPlaying}
      fps={fps}
      onPlayChange={setIsPlaying}
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
      onSaveSrDialog={saveSrDialog}
      blurViewportActiveElement={blurViewportActiveElement}
    />
  );
};

export default BasicViewerImplementation;
