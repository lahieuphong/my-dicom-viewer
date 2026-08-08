'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ComponentProps, CSSProperties, Dispatch, RefObject, SetStateAction } from 'react';

import { Loading } from '@/components/ui/loading';
import { Button } from '@/components/ui/button';
import {
  VIEWER_LEFT_PANEL_COLLAPSED,
  VIEWER_RIGHT_PANEL_COLLAPSED,
} from '@/constants/viewerLayout';
import type { AnnotationMeasurement } from '@/hooks/useMeasurements';
import { useCine } from '@/hooks/useCine';
import { useStackPrefetch } from '@/hooks/useStackPrefetch';
import type { ToolID } from '@/hooks/useToolManager';
import { useViewerPanelResize } from '@/hooks/useViewerPanelResize';

import { MeasurementPanel } from '@/components/Viewer/Measurement';
import { SeriesSidebar } from '@/components/Viewer/Series';
import { SrNameDialog } from '@/components/Viewer/SR';
import { CineControls, Toolbar } from '@/components/Viewer/Toolbar';
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
  selectedSeries: string;
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
  selectedSeries,
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
  // Normal wheel navigation uses a small bounded window. Cine owns prefetch
  // while its panel is open, avoiding two loaders competing for the same
  // decode workers during preparation.
  useStackPrefetch(viewportEl, cineOpen);

  useEffect(() => {
    if (!cineEnabled && isPlaying) onPlayChange(false);
  }, [cineEnabled, isPlaying, onPlayChange]);

  const toggleCine = useCallback(() => {
    // OHIF opens and closes the Cine panel in a paused state.
    onPlayChange(false);
    setCineOpen((current) => !current);
  }, [onPlayChange]);

  const closeCine = useCallback(() => {
    onPlayChange(false);
    setCineOpen(false);
  }, [onPlayChange]);

  const measurementPanelProps = {
    measurements,
    collapsed: measurementCollapsed,
    setCollapsed: setMeasurementCollapsed,
    onUpdateLabel,
    onSelectMeasurement,
    seriesMap: measurementSeriesMap,
    totalFrames,
    selectedMeasurementUID,
    studyDate,
    onRemoveMeasurement,
    hiddenMeasurements,
    onToggleVisibility,
    onCreateSR,
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
    disabled: loadingSeries,
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
          onSelectSeries={onSelectMobileSeries}
          studyDate={studyDate}
          studyDescription={studyDescription}
          collapsed={sidebarCollapsed}
          setCollapsed={setSidebarCollapsed}
          loadedSrList={loadedSrList}
          activeSrId={activeSrId}
          onSelectSr={onSelectSr}
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
            onSelectSeries={onSelectSeries}
            studyDate={studyDate}
            studyDescription={studyDescription}
            collapsed={renderedSidebarCollapsed}
            setCollapsed={setSidebarCollapsed}
            loadedSrList={loadedSrList}
            activeSrId={activeSrId}
            onSelectSr={onSelectSr}
          />
        )}

        <main className="flex flex-col w-full h-full min-h-0">
          <>
            <div
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
                onReset={onReset}
                onRotate90={onRotate90}
                onFlipHorizontal={onFlipHorizontal}
                isCineOpen={cineOpen}
                onToggleCine={toggleCine}
                viewportEl={viewportEl}
                isSeriesSR={isSeriesToolbarReadOnly}
              />
            </div>

            <div className="relative flex-1 min-h-0 w-full">
              {!loadingSeries && (
                <ViewportLoadingOverlay
                  visible={loadingStack || !imageAvailable}
                  progress={loadingProgress}
                />
              )}

              <DicomViewport
                elementRef={elementRef}
                crosshair={activeTool !== 'adjust'}
              />
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
                  onSelectSr?.(null);
                  onSelectSeries(seriesUID);
                }}
              />
              <ViewportStackScrollbar
                currentFrame={currentFrame}
                totalFrames={totalFrames}
                onFrameChange={onFrameChange}
                viewportEl={viewportEl}
                disabled={loadingStack || !imageAvailable}
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
    </>
  );
}
