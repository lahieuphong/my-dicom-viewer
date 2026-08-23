'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ComponentProps, CSSProperties, Dispatch, RefObject, SetStateAction } from 'react';
import {
  Enums as CoreEnums,
  getEnabledElement,
  type StackViewport,
} from '@cornerstonejs/core';

import { Loading } from '@/components/ui/loading';
import { Button } from '@/components/ui/button';
import {
  VIEWER_LEFT_PANEL_COLLAPSED,
  VIEWER_RIGHT_PANEL_COLLAPSED,
} from '@/constants/viewerLayout';
import { VIEWPORT_ID } from '@/constants/viewport';
import type { AnnotationMeasurement } from '@/hooks/useMeasurements';
import { useCine } from '@/hooks/useCine';
import { useCalibrationLine } from '@/hooks/useCalibrationLine';
import { useImageSliceSync } from '@/hooks/useImageSliceSync';
import { useStackPrefetch } from '@/hooks/useStackPrefetch';
import type { ToolID } from '@/hooks/useToolManager';
import { useViewerPanelResize } from '@/hooks/useViewerPanelResize';
import { cancelActiveAnnotationInteraction } from '@/lib/cornerstone/annotationInteraction';

import { MeasurementPanel } from '@/components/Viewer/Measurement';
import { SeriesSidebar } from '@/components/Viewer/Series';
import { SrNameDialog } from '@/components/Viewer/SR';
import { CineControls, Toolbar } from '@/components/Viewer/Toolbar';
import { CalibrationDialog } from '@/components/Viewer/Calibration';
import { DicomTagBrowserDialog } from '@/components/Viewer/DicomTagBrowser';
import {
  ViewportGrid,
  useViewportGridLayout,
} from '@/components/Viewer/ViewportLayout';
import {
  getViewportCount,
  getViewportIdAt,
} from '@/components/Viewer/ViewportLayout/viewportLayout';
import PanelResizeHandle from './PanelResizeHandle';
import {
  DicomViewport,
  ViewportLoadingOverlay,
  ViewportOverlay,
  ViewportStackScrollbar,
} from '@/components/Viewer/Viewport';

type SeriesSidebarProps = ComponentProps<typeof SeriesSidebar>;
type MeasurementPanelProps = ComponentProps<typeof MeasurementPanel>;

type ViewerWorkspaceProps = {
  loadingSeries: boolean;
  gridCols: string;
  leftPanelWidth: number;
  setLeftPanelWidth: Dispatch<SetStateAction<number>>;
  rightPanelWidth: number;
  setRightPanelWidth: Dispatch<SetStateAction<number>>;
  studyDate: string;
  studyDescription: string;
  seriesMap: SeriesSidebarProps['seriesMap'];
  voiDefaults: Record<string, { lower: number; upper: number }>;
  selectedSeries: string;
  onActiveViewportSeriesChange: (seriesUID: string) => void;
  onVisibleViewportSeriesChange: (seriesUIDs: string[]) => void;
  onSelectSeries: (seriesUID: string) => void;
  onSelectMobileSeries: (seriesUID: string) => void;
  sidebarCollapsed: boolean;
  setSidebarCollapsed: Dispatch<SetStateAction<boolean>>;
  mobileSeriesOpen: boolean;
  setMobileSeriesOpen: Dispatch<SetStateAction<boolean>>;
  loadedSrList: SeriesSidebarProps['loadedSrList'];
  activeSrId: SeriesSidebarProps['activeSrId'];
  onSelectSr: SeriesSidebarProps['onSelectSr'];
  mobileMeasurementsOpen: boolean;
  setMobileMeasurementsOpen: Dispatch<SetStateAction<boolean>>;
  measurements: MeasurementPanelProps['measurements'];
  measurementCollapsed: boolean;
  setMeasurementCollapsed: Dispatch<SetStateAction<boolean>>;
  onUpdateLabel: MeasurementPanelProps['onUpdateLabel'];
  onSelectMeasurement: (measurement: AnnotationMeasurement) => void;
  onRemoveMeasurement: MeasurementPanelProps['onRemoveMeasurement'];
  hiddenMeasurements: MeasurementPanelProps['hiddenMeasurements'];
  onToggleVisibility: MeasurementPanelProps['onToggleVisibility'];
  onCreateSR: () => void;
  currentFrame: number;
  onFrameChange: (frame: number) => boolean | void | Promise<boolean | void>;
  viewportEl: HTMLDivElement | null;
  selectedMeasurementUID: string | null;
  activeTool: ToolID;
  onSelectTool: (tool: ToolID) => void;
  onReset: () => void;
  onRotate90: () => void;
  onFlipHorizontal: () => void;
  isInverted: boolean;
  canInvert: boolean;
  onToggleInvert: () => void;
  isPlaying: boolean;
  fps: number;
  onPlayChange: (isPlaying: boolean) => void;
  onFpsChange: (fps: number) => void;
  loadingStack: boolean;
  imageAvailable: boolean;
  loadingProgress: number | null;
  isSeriesToolbarReadOnly: boolean;
  elementRef: RefObject<HTMLDivElement | null>;
  srDialogOpen: boolean;
  srNameValue: string;
  isCreatingSr: boolean;
  onCancelSrDialog: () => void;
  onSaveSrDialog: (name: string) => void;
  blurViewportActiveElement: () => void;
};

export default function ViewerWorkspace({
  loadingSeries,
  gridCols,
  leftPanelWidth,
  setLeftPanelWidth,
  rightPanelWidth,
  setRightPanelWidth,
  studyDate,
  studyDescription,
  seriesMap,
  voiDefaults,
  selectedSeries,
  onActiveViewportSeriesChange,
  onVisibleViewportSeriesChange,
  onSelectSeries,
  onSelectMobileSeries,
  sidebarCollapsed,
  setSidebarCollapsed,
  mobileSeriesOpen,
  setMobileSeriesOpen,
  loadedSrList,
  activeSrId,
  onSelectSr,
  mobileMeasurementsOpen,
  setMobileMeasurementsOpen,
  measurements,
  measurementCollapsed,
  setMeasurementCollapsed,
  onUpdateLabel,
  onSelectMeasurement,
  onRemoveMeasurement,
  hiddenMeasurements,
  onToggleVisibility,
  onCreateSR,
  currentFrame,
  onFrameChange,
  viewportEl,
  selectedMeasurementUID,
  activeTool,
  onSelectTool,
  onReset,
  onRotate90,
  onFlipHorizontal,
  isInverted,
  canInvert,
  onToggleInvert,
  isPlaying,
  fps,
  onPlayChange,
  onFpsChange,
  loadingStack,
  imageAvailable,
  loadingProgress,
  isSeriesToolbarReadOnly,
  elementRef,
  srDialogOpen,
  srNameValue,
  isCreatingSr,
  onCancelSrDialog,
  onSaveSrDialog,
  blurViewportActiveElement,
}: ViewerWorkspaceProps) {
  const selectedSeriesEntry = seriesMap[selectedSeries];
  const totalFrames = selectedSeriesEntry?.files.length ?? 0;
  const measurementSeriesMap = seriesMap as MeasurementPanelProps['seriesMap'];
  const [cineOpen, setCineOpen] = useState(false);
  const [dicomTagBrowserOpen, setDicomTagBrowserOpen] = useState(false);
  const {
    layout: viewportLayout,
    setLayout: setViewportLayout,
    activeViewportId,
    setActiveViewportId,
  } = useViewportGridLayout();
  const [activeViewportEl, setActiveViewportEl] =
    useState<HTMLDivElement | null>(null);
  const [activeViewportSeriesUID, setActiveViewportSeriesUID] =
    useState(selectedSeries);
  const [activeViewportReady, setActiveViewportReady] = useState(false);
  const [viewportSeriesById, setViewportSeriesById] = useState<
    Record<string, string>
  >({ [VIEWPORT_ID]: selectedSeries });
  const [activeSecondaryInverted, setActiveSecondaryInverted] =
    useState(false);

  const handleActiveViewportChange = useCallback(
    (
      viewportId: string,
      element: HTMLDivElement | null,
      seriesUID: string,
      ready: boolean
    ) => {
      setActiveViewportId(viewportId);
      setActiveViewportEl(element);
      setActiveViewportSeriesUID(seriesUID);
      setActiveViewportReady(ready);
    },
    [setActiveViewportId]
  );

  const handleViewportSeriesChange = useCallback(
    (viewportId: string, seriesUID: string) => {
      setViewportSeriesById((current) =>
        current[viewportId] === seriesUID
          ? current
          : { ...current, [viewportId]: seriesUID }
      );
    },
    []
  );

  useEffect(() => {
    if (activeViewportId !== VIEWPORT_ID) return;
    setActiveViewportEl(viewportEl);
    setActiveViewportSeriesUID(selectedSeries);
    setActiveViewportReady(!loadingStack && imageAvailable);
  }, [
    activeViewportId,
    imageAvailable,
    loadingStack,
    selectedSeries,
    viewportEl,
  ]);

  useEffect(() => {
    handleViewportSeriesChange(VIEWPORT_ID, selectedSeries);
  }, [handleViewportSeriesChange, selectedSeries]);

  const visibleViewportSeriesUIDs = useMemo(() => {
    const viewportCount = getViewportCount(viewportLayout);
    return Array.from(
      new Set(
        Array.from({ length: viewportCount }, (_, index) =>
          index === 0
            ? selectedSeries
            : viewportSeriesById[getViewportIdAt(index)]
        ).filter((seriesUID): seriesUID is string => Boolean(seriesUID))
      )
    );
  }, [selectedSeries, viewportLayout, viewportSeriesById]);

  useEffect(() => {
    onVisibleViewportSeriesChange(visibleViewportSeriesUIDs);
  }, [onVisibleViewportSeriesChange, visibleViewportSeriesUIDs]);

  useEffect(() => {
    if (!activeViewportSeriesUID) return;
    onActiveViewportSeriesChange(activeViewportSeriesUID);
  }, [activeViewportSeriesUID, onActiveViewportSeriesChange]);

  const toolbarViewportEl = activeViewportEl ?? viewportEl;
  const activeStackViewport = useMemo(() => {
    if (!toolbarViewportEl) return null;
    try {
      return getEnabledElement(toolbarViewportEl)?.viewport as StackViewport;
    } catch {
      return null;
    }
  }, [activeViewportId, activeViewportSeriesUID, toolbarViewportEl]);

  useEffect(() => {
    if (activeViewportId === VIEWPORT_ID) return;
    const syncInvertState = () => {
      try {
        setActiveSecondaryInverted(
          Boolean(activeStackViewport?.getProperties?.()?.invert)
        );
      } catch {
        setActiveSecondaryInverted(false);
      }
    };

    syncInvertState();
    if (!toolbarViewportEl) return;
    toolbarViewportEl.addEventListener(
      CoreEnums.Events.VIEWPORT_NEW_IMAGE_SET,
      syncInvertState
    );
    return () => {
      toolbarViewportEl.removeEventListener(
        CoreEnums.Events.VIEWPORT_NEW_IMAGE_SET,
        syncInvertState
      );
    };
  }, [
    activeStackViewport,
    activeViewportId,
    activeViewportSeriesUID,
    toolbarViewportEl,
  ]);

  const resetActiveViewport = useCallback(() => {
    if (activeViewportId === VIEWPORT_ID || !activeStackViewport) {
      onReset();
      return;
    }
    try {
      activeStackViewport.resetProperties();
      const presentation = activeStackViewport.getViewPresentation();
      activeStackViewport.setViewPresentation({
        ...presentation,
        rotation: 0,
      });
      activeStackViewport.resetCamera({
        resetPan: true,
        resetZoom: true,
        resetToCenter: true,
      });
      activeStackViewport.setCamera({
        flipHorizontal: false,
        flipVertical: false,
      });
      activeStackViewport.render();
      setActiveSecondaryInverted(false);
    } catch {}
  }, [activeStackViewport, activeViewportId, onReset]);

  const rotateActiveViewport = useCallback(() => {
    if (activeViewportId === VIEWPORT_ID || !activeStackViewport) {
      onRotate90();
      return;
    }
    try {
      const presentation = activeStackViewport.getViewPresentation();
      activeStackViewport.setViewPresentation({
        ...presentation,
        rotation: ((presentation.rotation ?? 0) + 90) % 360,
      });
      activeStackViewport.render();
    } catch {}
  }, [activeStackViewport, activeViewportId, onRotate90]);

  const flipActiveViewport = useCallback(() => {
    if (activeViewportId === VIEWPORT_ID || !activeStackViewport) {
      onFlipHorizontal();
      return;
    }
    try {
      const flipped = activeStackViewport.getCamera().flipHorizontal ?? false;
      activeStackViewport.setCamera({ flipHorizontal: !flipped });
      activeStackViewport.render();
    } catch {}
  }, [activeStackViewport, activeViewportId, onFlipHorizontal]);

  const toggleActiveInvert = useCallback(() => {
    if (activeViewportId === VIEWPORT_ID || !activeStackViewport) {
      onToggleInvert();
      return;
    }
    try {
      const nextValue = !Boolean(
        activeStackViewport.getProperties?.()?.invert
      );
      activeStackViewport.setProperties({ invert: nextValue });
      activeStackViewport.render();
      setActiveSecondaryInverted(nextValue);
    } catch {}
  }, [activeStackViewport, activeViewportId, onToggleInvert]);

  const activeIsInverted =
    activeViewportId === VIEWPORT_ID
      ? isInverted
      : activeSecondaryInverted;
  const activeCanInvert =
    activeViewportId === VIEWPORT_ID
      ? canInvert
      : Boolean(
          activeViewportReady &&
            activeStackViewport &&
            !isSeriesToolbarReadOnly
        );
  const cineEnabled =
    cineOpen &&
    !loadingStack &&
    imageAvailable &&
    !isSeriesToolbarReadOnly;

  const cinePreparation = useCine({
    enabled: cineEnabled,
    element: viewportEl,
    fps,
    isPlaying,
    stackKey: selectedSeries,
  });
  const cineInteractionLocked =
    cineOpen &&
    !isSeriesToolbarReadOnly &&
    (loadingStack ||
      !imageAvailable ||
      cinePreparation.phase === 'idle' ||
      cinePreparation.phase === 'preparing');
  const calibration = useCalibrationLine({
    element: toolbarViewportEl,
    stackKey: activeViewportSeriesUID,
    enabled:
      activeViewportReady &&
      !isSeriesToolbarReadOnly,
  });
  const imageSliceSync = useImageSliceSync({
    stackKey: `${selectedSeries}:${viewportLayout.rows}x${viewportLayout.columns}`,
    disabled: isSeriesToolbarReadOnly,
  });
  // Normal wheel navigation uses a small bounded window. Cine owns prefetch
  // while its panel is open, avoiding two loaders competing for the same
  // decode workers during preparation.
  useStackPrefetch(viewportEl, cineOpen);

  useEffect(() => {
    if (!cineEnabled && isPlaying) onPlayChange(false);
  }, [cineEnabled, isPlaying, onPlayChange]);

  useEffect(() => {
    if (!cineInteractionLocked) return;

    blurViewportActiveElement();
    try {
      const activeElement = document.activeElement as HTMLElement | null;
      activeElement?.blur?.();
    } catch {}
    setMobileSeriesOpen(false);
    setMobileMeasurementsOpen(false);
  }, [
    blurViewportActiveElement,
    cineInteractionLocked,
    setMobileMeasurementsOpen,
    setMobileSeriesOpen,
  ]);

  const toggleCine = useCallback(() => {
    // OHIF opens and closes the Cine panel in a paused state.
    onPlayChange(false);
    if (!cineOpen) {
      handleActiveViewportChange(
        VIEWPORT_ID,
        viewportEl,
        selectedSeries,
        !loadingStack && imageAvailable
      );
    }
    setCineOpen((current) => !current);
  }, [
    cineOpen,
    handleActiveViewportChange,
    imageAvailable,
    loadingStack,
    onPlayChange,
    selectedSeries,
    viewportEl,
  ]);

  const closeCine = useCallback(() => {
    onPlayChange(false);
    setCineOpen(false);
  }, [onPlayChange]);

  const selectSeriesSafely = useCallback(
    (seriesUID: string) => {
      cancelActiveAnnotationInteraction(toolbarViewportEl);
      onSelectSeries(seriesUID);
    },
    [onSelectSeries, toolbarViewportEl]
  );

  const selectMobileSeriesSafely = useCallback(
    (seriesUID: string) => {
      cancelActiveAnnotationInteraction(toolbarViewportEl);
      onSelectMobileSeries(seriesUID);
    },
    [onSelectMobileSeries, toolbarViewportEl]
  );

  useEffect(() => {
    if (!cineOpen) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      closeCine();
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [cineOpen, closeCine]);

  useEffect(() => {
    if (cineOpen && isSeriesToolbarReadOnly) closeCine();
  }, [cineOpen, closeCine, isSeriesToolbarReadOnly]);

  const measurementPanelProps = {
    measurements,
    collapsed: measurementCollapsed,
    setCollapsed: setMeasurementCollapsed,
    onUpdateLabel,
    onSelectMeasurement,
    seriesMap: measurementSeriesMap,
    totalFrames:
      seriesMap[activeViewportSeriesUID]?.files.length ?? totalFrames,
    selectedMeasurementUID,
    studyDate,
    onRemoveMeasurement,
    hiddenMeasurements,
    onToggleVisibility,
    onCreateSR,
    interactionDisabled: cineInteractionLocked,
    isExportDisabled:
      isSeriesToolbarReadOnly || measurements.length === 0,
    srList: loadedSrList,
    activeSrId,
    onSelectSr,
  } satisfies Omit<MeasurementPanelProps, 'className' | 'mobileSidebarOpen' | 'onCloseMobile'>;

  const {
    gridRef,
    renderedSidebarCollapsed,
    renderedMeasurementCollapsed,
    beginResize,
    handleResizeMove,
    handleResizeEnd,
    handleResizeKeyDown,
  } = useViewerPanelResize({
    disabled: loadingSeries || cineInteractionLocked,
    sidebarCollapsed,
    setSidebarCollapsed,
    measurementCollapsed,
    setMeasurementCollapsed,
    leftPanelWidth,
    setLeftPanelWidth,
    rightPanelWidth,
    setRightPanelWidth,
  });

  return (
    <>
      {loadingSeries && <Loading fullScreen message="Đang tải thông tin series..." />}

      {!loadingSeries && mobileSeriesOpen && (
        <SeriesSidebar
          mobileSidebarOpen={true}
          onCloseMobile={() => setMobileSeriesOpen(false)}
          className="md:hidden"
          seriesMap={seriesMap}
          selectedSeries={selectedSeries}
          onSelectSeries={selectMobileSeriesSafely}
          studyDate={studyDate}
          studyDescription={studyDescription}
          collapsed={sidebarCollapsed}
          setCollapsed={setSidebarCollapsed}
          loadedSrList={loadedSrList}
          activeSrId={activeSrId}
          onSelectSr={onSelectSr}
          interactionDisabled={cineInteractionLocked}
        />
      )}

      {!loadingSeries && mobileMeasurementsOpen && (
        <MeasurementPanel
          {...measurementPanelProps}
          mobileSidebarOpen={true}
          onCloseMobile={() => setMobileMeasurementsOpen(false)}
          className="md:hidden"
        />
      )}

      <div
        ref={gridRef}
        aria-busy={cineInteractionLocked}
        data-cine-preparing={cineInteractionLocked || undefined}
        className="viewer-workspace-grid h-full items-stretch min-h-0"
        style={{
          '--viewer-grid-columns': gridCols,
          '--viewer-left-panel-width': `${
            sidebarCollapsed ? VIEWER_LEFT_PANEL_COLLAPSED : leftPanelWidth
          }px`,
          '--viewer-right-panel-width': `${
            measurementCollapsed ? VIEWER_RIGHT_PANEL_COLLAPSED : rightPanelWidth
          }px`,
        } as CSSProperties}
      >
        {!loadingSeries && (
          <SeriesSidebar
            className="hidden md:flex"
            seriesMap={seriesMap}
            selectedSeries={selectedSeries}
            onSelectSeries={selectSeriesSafely}
            studyDate={studyDate}
            studyDescription={studyDescription}
            collapsed={renderedSidebarCollapsed}
            setCollapsed={setSidebarCollapsed}
            loadedSrList={loadedSrList}
            activeSrId={activeSrId}
            onSelectSr={onSelectSr}
            interactionDisabled={cineInteractionLocked}
          />
        )}

        <main className="flex flex-col w-full h-full min-h-0">
          <>
            <div
              inert={cineInteractionLocked ? true : undefined}
              aria-disabled={cineInteractionLocked || undefined}
              className="
                flex items-center justify-between md:hidden w-full p-2
                bg-background dark:bg-background-dark
                border-b border-border dark:border-border-dark
                z-10
              "
            >
              <Button
                variant="ghost"
                size="icon"
                className="border border-border dark:border-border-dark"
                onClick={() => {
                  blurViewportActiveElement();
                  setMobileSeriesOpen(true);
                }}
                aria-label="Open studies"
              >
                <i className="fas fa-bars text-foreground dark:text-foreground-dark" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="border border-border dark:border-border-dark"
                onClick={() => {
                  blurViewportActiveElement();
                  setMobileMeasurementsOpen(true);
                }}
                aria-label="Open measurements"
              >
                <i className="fas fa-ruler text-foreground dark:text-foreground-dark" />
              </Button>
            </div>

            <div className="sticky top-0 z-20 h-[52px] min-h-[52px] w-full bg-card border-b border-border">
              <Toolbar
                activeTool={activeTool}
                onSelectTool={onSelectTool}
                onReset={resetActiveViewport}
                onRotate90={rotateActiveViewport}
                onFlipHorizontal={flipActiveViewport}
                isInverted={activeIsInverted}
                canInvert={activeCanInvert}
                onToggleInvert={toggleActiveInvert}
                isImageSliceSyncEnabled={imageSliceSync.isEnabled}
                canImageSliceSync={imageSliceSync.canToggle}
                onToggleImageSliceSync={imageSliceSync.toggle}
                canCalibrate={calibration.canCalibrate}
                viewportLayout={viewportLayout}
                onViewportLayoutChange={setViewportLayout}
                onOpenDicomTagBrowser={() => setDicomTagBrowserOpen(true)}
                isCineOpen={cineOpen}
                onToggleCine={toggleCine}
                onCloseCine={closeCine}
                viewportEl={toolbarViewportEl}
                isSeriesSR={isSeriesToolbarReadOnly}
                disabled={cineInteractionLocked}
              />
            </div>

            <div className="relative flex-1 min-h-0 w-full">
              <ViewportGrid
                layout={viewportLayout}
                activeViewportId={activeViewportId}
                onActiveViewportChange={handleActiveViewportChange}
                onViewportSeriesChange={handleViewportSeriesChange}
                primaryViewportEl={viewportEl}
                primaryReady={!loadingStack && imageAvailable}
                studyDate={studyDate}
                seriesMap={seriesMap}
                selectedSeriesUID={selectedSeries}
                activeTool={activeTool}
                interactionDisabled={cineInteractionLocked}
                voiDefaults={voiDefaults}
                primary={
                  <>
                    {!loadingSeries && (
                      <ViewportLoadingOverlay
                        visible={loadingStack || !imageAvailable}
                        progress={loadingProgress}
                      />
                    )}

                    <DicomViewport
                      elementRef={elementRef}
                      crosshair={activeTool !== 'adjust'}
                      interactionDisabled={cineInteractionLocked}
                    />
                    {cineInteractionLocked && (
                      <div
                        data-testid="cine-preparation-interaction-lock"
                        className="absolute inset-0 z-[55] cursor-wait touch-none overscroll-contain bg-black/5"
                        aria-hidden="true"
                        onPointerDown={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                        }}
                        onWheel={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                        }}
                        onContextMenu={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                        }}
                      />
                    )}
                    <CineControls
                      open={cineOpen}
                      isPlaying={isPlaying}
                      fps={fps}
                      onPlayPauseChange={onPlayChange}
                      onFpsChange={onFpsChange}
                      onClose={closeCine}
                      isLoading={loadingStack || !imageAvailable}
                      preparationPhase={cinePreparation.phase}
                      preparationProgress={cinePreparation.percent}
                      preparedImages={cinePreparation.loadedImages}
                      totalImages={cinePreparation.totalImages}
                      onRetryPreparation={cinePreparation.retryPreparation}
                    />
                    <ViewportOverlay
                      studyDate={studyDate}
                      seriesDescription={selectedSeriesEntry?.metadata?.seriesDescription}
                      viewportEl={viewportEl}
                      currentFrame={currentFrame}
                      totalFrames={totalFrames}
                      seriesMap={seriesMap}
                      selectedSeriesUID={selectedSeries}
                      onSelectSeries={(seriesUID) => {
                        if (cineInteractionLocked) return;
                        onSelectSr?.(null);
                        selectSeriesSafely(seriesUID);
                      }}
                      interactionDisabled={cineInteractionLocked}
                    />
                    <ViewportStackScrollbar
                      currentFrame={currentFrame}
                      totalFrames={totalFrames}
                      onFrameChange={onFrameChange}
                      viewportEl={viewportEl}
                      followTargetFrame={isPlaying}
                      disabled={
                        loadingStack ||
                        !imageAvailable ||
                        cineInteractionLocked
                      }
                    />
                  </>
                }
              />
            </div>
          </>
        </main>

        {!loadingSeries && (
          <MeasurementPanel
            {...measurementPanelProps}
            collapsed={renderedMeasurementCollapsed}
            className="hidden md:flex"
          />
        )}

        {!loadingSeries && (
          <PanelResizeHandle
            side="left"
            label="Resize or collapse Studies panel"
            onResizeStart={beginResize}
            onResizeMove={handleResizeMove}
            onResizeEnd={handleResizeEnd}
            onResizeKeyDown={handleResizeKeyDown}
            disabled={cineInteractionLocked}
          />
        )}

        {!loadingSeries && (
          <PanelResizeHandle
            side="right"
            label="Resize or collapse Measurement panel"
            onResizeStart={beginResize}
            onResizeMove={handleResizeMove}
            onResizeEnd={handleResizeEnd}
            onResizeKeyDown={handleResizeKeyDown}
            disabled={cineInteractionLocked}
          />
        )}
      </div>

      <SrNameDialog
        open={srDialogOpen}
        defaultName={srNameValue || ''}
        isSaving={isCreatingSr}
        onCancel={onCancelSrDialog}
        onSave={(name: string) => {
          const trimmed = name?.trim?.() ?? '';
          if (!trimmed) return;
          onSaveSrDialog(trimmed);
        }}
      />
      <CalibrationDialog
        open={calibration.isOpen}
        defaultLength={calibration.defaultLength}
        isApplying={calibration.isApplying}
        applyError={calibration.error}
        onCancel={calibration.cancelCalibration}
        onApply={calibration.applyCalibration}
      />
      <DicomTagBrowserDialog
        open={dicomTagBrowserOpen}
        seriesMap={seriesMap}
        activeSeriesUID={activeViewportSeriesUID}
        onClose={() => setDicomTagBrowserOpen(false)}
      />
    </>
  );
}
