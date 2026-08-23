'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import type { ToolID } from '@/hooks/useToolManager';
import { useSecondaryStackViewport } from '@/hooks/useSecondaryStackViewport';
import { cancelActiveAnnotationInteraction } from '@/lib/cornerstone/annotationInteraction';
import { cn } from '@/lib/utils';
import {
  DicomViewport,
  ViewportLoadingOverlay,
  ViewportOverlay,
  ViewportStackScrollbar,
} from '@/components/Viewer/Viewport';
import type { ViewportSeriesMap } from '@/components/Viewer/Viewport/DataOverlay';

type SecondarySeriesMap = ViewportSeriesMap;

type SecondaryStackViewportProps = {
  viewportId: string;
  viewportLabel: string;
  studyDate: string;
  seriesMap: SecondarySeriesMap;
  initialSeriesUID: string;
  activeTool: ToolID;
  active: boolean;
  interactionDisabled?: boolean;
  voiDefaults?: Record<string, { lower: number; upper: number }>;
  onActivate: (
    viewportId: string,
    element: HTMLDivElement | null,
    seriesUID: string,
    ready: boolean
  ) => void;
  onSeriesChange: (viewportId: string, seriesUID: string) => void;
};

export default function SecondaryStackViewport({
  viewportId,
  viewportLabel,
  studyDate,
  seriesMap,
  initialSeriesUID,
  activeTool,
  active,
  interactionDisabled = false,
  voiDefaults = {},
  onActivate,
  onSeriesChange,
}: SecondaryStackViewportProps) {
  const [selectedSeriesUID, setSelectedSeriesUID] =
    useState(initialSeriesUID);

  useEffect(() => {
    if ((seriesMap[selectedSeriesUID]?.files?.length ?? 0) > 0) return;
    setSelectedSeriesUID(initialSeriesUID);
  }, [initialSeriesUID, selectedSeriesUID, seriesMap]);

  const selectedSeries = seriesMap[selectedSeriesUID];
  const imageIds = useMemo(
    () =>
      (selectedSeries?.files ?? []).filter(
        (imageId): imageId is string => typeof imageId === 'string'
      ),
    [selectedSeries]
  );
  const viewportState = useSecondaryStackViewport({
    viewportId,
    imageIds,
    stackKey: selectedSeriesUID,
    voiRange: voiDefaults[selectedSeriesUID] ?? null,
  });

  useEffect(() => {
    onSeriesChange(viewportId, selectedSeriesUID);
  }, [onSeriesChange, selectedSeriesUID, viewportId]);

  const viewportReady =
    viewportState.imageAvailable && !viewportState.loading;

  useEffect(() => {
    if (active) {
      onActivate(
        viewportId,
        viewportState.viewportEl,
        selectedSeriesUID,
        viewportReady
      );
    }
  }, [
    active,
    onActivate,
    selectedSeriesUID,
    viewportId,
    viewportState.viewportEl,
    viewportReady,
  ]);

  const handleSelectSeries = useCallback(
    (seriesUID: string) => {
      cancelActiveAnnotationInteraction(viewportState.viewportEl);
      setSelectedSeriesUID(seriesUID);
    },
    [viewportState.viewportEl]
  );

  return (
    <div
      className={cn(
        'relative min-h-0 min-w-0 overflow-hidden bg-black',
        active
          ? 'ring-1 ring-inset ring-primary'
          : 'ring-1 ring-inset ring-border/70'
      )}
      data-viewport-pane={viewportId}
      data-active-viewport={active || undefined}
      onPointerDownCapture={() =>
        onActivate(
          viewportId,
          viewportState.viewportEl,
          selectedSeriesUID,
          viewportReady
        )
      }
      onFocusCapture={() =>
        onActivate(
          viewportId,
          viewportState.viewportEl,
          selectedSeriesUID,
          viewportReady
        )
      }
    >
      <ViewportLoadingOverlay
        visible={
          viewportState.loading ||
          (!viewportState.imageAvailable && !viewportState.error)
        }
        progress={null}
        showPercent={false}
        contained
      />
      <DicomViewport
        elementRef={viewportState.elementRef}
        viewportId={viewportId}
        crosshair={activeTool !== 'adjust'}
        interactionDisabled={interactionDisabled}
      />
      <ViewportOverlay
        studyDate={studyDate}
        seriesDescription={selectedSeries?.metadata?.seriesDescription}
        viewportEl={viewportState.viewportEl}
        currentFrame={viewportState.currentFrame}
        totalFrames={imageIds.length}
        seriesMap={seriesMap}
        selectedSeriesUID={selectedSeriesUID}
        onSelectSeries={handleSelectSeries}
        interactionDisabled={interactionDisabled}
      />
      <ViewportStackScrollbar
        currentFrame={viewportState.currentFrame}
        totalFrames={imageIds.length}
        onFrameChange={viewportState.onFrameChange}
        viewportEl={viewportState.viewportEl}
        disabled={
          interactionDisabled ||
          viewportState.loading ||
          !viewportState.imageAvailable
        }
      />

      <span
        className="pointer-events-none absolute right-3 top-3 z-20 flex size-6 items-center justify-center rounded-md border border-primary/35 bg-black/55 text-xs font-semibold text-primary backdrop-blur-sm"
        aria-hidden="true"
      >
        {viewportLabel}
      </span>

      {viewportState.error && (
        <div
          role="alert"
          className="absolute inset-x-4 bottom-5 z-30 rounded-lg border border-destructive/50 bg-background/95 px-3 py-2 text-center text-xs text-destructive shadow-lg"
        >
          {viewportState.error}
        </div>
      )}
    </div>
  );
}
