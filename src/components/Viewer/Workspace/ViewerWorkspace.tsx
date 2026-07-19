'use client';

import type { ComponentProps, CSSProperties, Dispatch, RefObject, SetStateAction } from 'react';

import { Loading } from '@/components/ui/loading';
import { Button } from '@/components/ui/button';
import { VIEWPORT_ID } from '@/constants/viewport';
import {
  VIEWER_LEFT_PANEL_COLLAPSED,
  VIEWER_RIGHT_PANEL_COLLAPSED,
} from '@/constants/viewerLayout';
import type { AnnotationMeasurement } from '@/hooks/useMeasurements';
import type { ToolID } from '@/hooks/useToolManager';
import { useViewerPanelResize } from '@/hooks/useViewerPanelResize';

import { MeasurementPanel } from '@/components/Viewer/Measurement';
import { SeriesSidebar } from '@/components/Viewer/Series';
import { SrNameDialog } from '@/components/Viewer/SR';
import { Toolbar } from '@/components/Viewer/Toolbar';
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
  isSR: boolean;
  studyUID: string;
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
  srGroups: SeriesSidebarProps['srGroups'];
  mobileMeasurementsOpen: boolean;
  setMobileMeasurementsOpen: Dispatch<SetStateAction<boolean>>;
  measurements: MeasurementPanelProps['measurements'];
  measurementCollapsed: boolean;
  setMeasurementCollapsed: Dispatch<SetStateAction<boolean>>;
  onUpdateLabel: MeasurementPanelProps['onUpdateLabel'];
  onSelectMeasurement: (measurement: AnnotationMeasurement) => void;
  onRemoveMeasurement: MeasurementPanelProps['onRemoveMeasurement'];
  refreshMeasurements: MeasurementPanelProps['refreshMeasurements'];
  hiddenMeasurements: MeasurementPanelProps['hiddenMeasurements'];
  onToggleVisibility: MeasurementPanelProps['onToggleVisibility'];
  onExportJSON: () => void;
  onExportDICOMSR: () => void;
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
  onTogglePlay: () => void;
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
  isSR,
  studyUID,
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
  srGroups,
  mobileMeasurementsOpen,
  setMobileMeasurementsOpen,
  measurements,
  measurementCollapsed,
  setMeasurementCollapsed,
  onUpdateLabel,
  onSelectMeasurement,
  onRemoveMeasurement,
  refreshMeasurements,
  hiddenMeasurements,
  onToggleVisibility,
  onExportJSON,
  onExportDICOMSR,
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
  onTogglePlay,
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

  const measurementPanelProps = {
    measurements,
    collapsed: measurementCollapsed,
    setCollapsed: setMeasurementCollapsed,
    onUpdateLabel,
    onSelectMeasurement,
    seriesMap: measurementSeriesMap,
    seriesInstanceUID: selectedSeriesEntry?.metadata?.seriesInstanceUID,
    refreshMeasurements,
    currentFrame,
    totalFrames,
    viewportEl,
    selectedMeasurementUID,
    studyDate,
    onRemoveMeasurement,
    hiddenMeasurements,
    onToggleVisibility,
    onExportJSON,
    onExportDICOMSR,
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
          srGroups={srGroups}
          studyUID={studyUID}
          viewportId={VIEWPORT_ID}
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
            srGroups={srGroups}
            studyUID={studyUID}
            viewportId={VIEWPORT_ID}
          />
        )}

        <main className="flex flex-col w-full h-full min-h-0">
          {!isSR && (
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
                  isPlaying={isPlaying}
                  fps={fps}
                  onTogglePlay={onTogglePlay}
                  onFpsChange={onFpsChange}
                  isLoading={loadingStack}
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
                  disabled={loadingStack || !imageAvailable}
                />
              </div>
            </>
          )}
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
