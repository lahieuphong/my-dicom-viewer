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
  useMeasurementRemoval,
  useMeasurementSelection,
  useMeasurementSelectionStyles,
  useSelectedSeriesLoading,
  useSeriesLoader,
  useSrCreateDialog,
  useViewerToolMode,
  type PendingSeriesNavigation,
} from './application';
import { createLatestWinsQueue } from '@/lib/utils/asyncQueues';

import { annotation as csAnnotation } from '@cornerstonejs/tools';

import { VIEWPORT_ID } from '@/constants/viewport';
import { DEFAULT_CINE_FPS } from '@/constants/cine';

import { ViewerWorkspace, useViewerLayout } from '@/extensions/default';
import {
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
  useViewportAutoFitOnResize,
  type AnnotationMeasurement,
} from '@/extensions/cornerstone';
import { useSrExport } from '@/extensions/dicom-sr';

import {
  fetchStudyMeta,
} from '@/extensions/static-dicom-data-source';
import type {
  LocalStructuredReport,
  Study,
} from '@/platform/core';

import { hasActiveAnnotationInteraction } from '@/lib/cornerstone/annotationInteraction';


import { normalizeId } from '@/lib/viewer/dom';
import { isAnnotationRemovalTombstoned } from '@/lib/viewer/annotationHelpers';
import { isMeasurementInSeries } from '@/lib/viewer/measurementVisibility';
import { createMeasurementListFingerprint } from '@/lib/viewer/measurementFingerprint';


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
  const { hiddenMeasurements, toggleVisibility, forgetMeasurement } =
    useHiddenMeasurements(studyUID, isAnnotationRemovalTombstoned);

  const [mobileSeriesOpen, setMobileSeriesOpen] = useState(false);
  const [mobileMeasurementsOpen, setMobileMeasurementsOpen] = useState(false);

  // ==============================
  // 🔗 Refs & Context
  // ==============================
  const pendingSeriesNavigationRef = useRef<PendingSeriesNavigation | null>(
    null
  );

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


  // ---------- Rendering engine ----------
  // A series opened for a navigation (a measurement, an SR or the sidebar)
  // starts at the requested image instead of jumping there after the first.
  const getPendingNavigationIndex = useCallback((seriesUID: string) => {
    const pending = pendingSeriesNavigationRef.current;
    return pending?.seriesUID === seriesUID ? pending.imageIndex : null;
  }, []);

  const {
    renderingEngineRef,
    viewportInstance,
    viewportEl,
    attachedStack,
  } = useRenderingEngine({
    elRef,
    selectedSeriesId: selectedSeries,
    mergedSeriesMap,
    onFrameIndexChange: handleViewportFrameIndexChange,
    getInitialImageIndex: getPendingNavigationIndex,
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

  // The engine publishes the viewport once it shows its first stack;
  // useSelectedSeriesLoading settles the series from there.
  const viewportReady = Boolean(viewportInstance && viewportEl);

  // Whether the viewport displays an image of the selected series, derived
  // from Cornerstone's STACK_NEW_IMAGE/IMAGE_RENDERED events.
  const { imageReady: imageAvailable } = useImageReadiness({
    viewportEl,
    selectedSeries,
    mergedSeriesMap,
  });

  const { loadingStack } = useSelectedSeriesLoading({
    selectedSeries,
    mergedSeriesMap,
    attachedStack,
    viewportReady,
    imageAvailable,
    renderingEngineRef,
    viewportInstance,
    pendingSeriesNavigationRef,
    setCurrentFrame,
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

        // useMeasurementSelection clears a selection that left the list.
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
    pendingSeriesNavigationRef.current = null;
    setLoadedSrList([]);
    setActiveSrId(null);
    setAllMeasurements([]);
  }, [studyUID]);

  const {
    selectedMeasurementUID,
    selectedMeasurementUIDRef,
    commitSelectedMeasurementUID,
  } = useMeasurementSelection({
    studyUID,
    allMeasurements,
    activeSrId,
    selectedSeries,
    mergedSeriesMap,
  });

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

  const { activeTool, handleSelectTool } = useViewerToolMode({
    readOnly: isSeriesReadOnly,
  });


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
    if (!loadingSeries && !selectedSeries && Object.keys(seriesMap).length > 0) {
      const defaultSeries = selectDefaultSeriesUID(seriesMap);
      if (defaultSeries) setSelectedSeries(defaultSeries);
    }
  }, [loadingSeries, selectedSeries, seriesMap, setSelectedSeries]);


  const handleRemoveMeasurement = useMeasurementRemoval({
    studyUID,
    selectedMeasurementUIDRef,
    commitSelectedMeasurementUID,
    selectionQueue: measurementSelectionQueue,
    setAllMeasurements,
    forgetMeasurement,
    refreshMeasurements,
    renderViewport: safeRenderViewport,
  });


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


  // After useMeasurementBridge, which applies measurement visibility.
  useMeasurementSelectionStyles({
    allMeasurements,
    hiddenMeasurements,
    selectedMeasurementUID,
    selectedMeasurementUIDRef,
    activeSrId,
    selectedSeries,
    renderViewport: safeRenderViewport,
  });

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
