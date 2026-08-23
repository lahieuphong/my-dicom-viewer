'use client';

import { useEffect, useMemo, type ReactNode } from 'react';

import { VIEWPORT_ID } from '@/constants/viewport';
import type { ToolID } from '@/hooks/useToolManager';
import type { ViewportSeriesMap } from '@/components/Viewer/Viewport/DataOverlay';

import SecondaryStackViewport from './SecondaryStackViewport';
import { useViewportGridResize } from './useViewportGridResize';
import {
  getViewportCount,
  getViewportIdAt,
  getViewportLabelAt,
  type ViewportGridLayout,
} from './viewportLayout';

type ViewportGridSeriesMap = ViewportSeriesMap;

type ViewportGridProps = {
  layout: ViewportGridLayout;
  activeViewportId: string;
  onActiveViewportChange: (
    viewportId: string,
    element: HTMLDivElement | null,
    seriesUID: string,
    ready: boolean
  ) => void;
  onViewportSeriesChange: (viewportId: string, seriesUID: string) => void;
  primaryViewportEl: HTMLDivElement | null;
  primaryReady: boolean;
  primary: ReactNode;
  studyDate: string;
  seriesMap: ViewportGridSeriesMap;
  selectedSeriesUID: string;
  activeTool: ToolID;
  interactionDisabled?: boolean;
  voiDefaults?: Record<string, { lower: number; upper: number }>;
};

export default function ViewportGrid({
  layout,
  activeViewportId,
  onActiveViewportChange,
  onViewportSeriesChange,
  primaryViewportEl,
  primaryReady,
  primary,
  studyDate,
  seriesMap,
  selectedSeriesUID,
  activeTool,
  interactionDisabled = false,
  voiDefaults = {},
}: ViewportGridProps) {
  const viewportCount = getViewportCount(layout);
  const secondaryIndices = useMemo(
    () => Array.from({ length: viewportCount - 1 }, (_, index) => index + 1),
    [viewportCount]
  );

  useViewportGridResize({ layout, primaryViewportEl });

  useEffect(() => {
    if (!primaryViewportEl) return;
    if (activeViewportId === VIEWPORT_ID) {
      onActiveViewportChange(
        VIEWPORT_ID,
        primaryViewportEl,
        selectedSeriesUID,
        primaryReady
      );
    }
  }, [
    activeViewportId,
    onActiveViewportChange,
    primaryViewportEl,
    primaryReady,
    selectedSeriesUID,
  ]);

  return (
    <div
      data-viewport-grid
      data-layout={`${layout.rows}x${layout.columns}`}
      className="grid h-full min-h-0 w-full min-w-0 gap-px overflow-hidden bg-primary/30"
      style={{
        gridTemplateRows: `repeat(${layout.rows}, minmax(0, 1fr))`,
        gridTemplateColumns: `repeat(${layout.columns}, minmax(0, 1fr))`,
      }}
    >
      <div
        className={
          activeViewportId === VIEWPORT_ID
            ? 'relative min-h-0 min-w-0 overflow-hidden bg-black ring-1 ring-inset ring-primary'
            : 'relative min-h-0 min-w-0 overflow-hidden bg-black ring-1 ring-inset ring-border/70'
        }
        data-viewport-pane={VIEWPORT_ID}
        data-active-viewport={
          activeViewportId === VIEWPORT_ID || undefined
        }
        onPointerDownCapture={() =>
          onActiveViewportChange(
            VIEWPORT_ID,
            primaryViewportEl,
            selectedSeriesUID,
            primaryReady
          )
        }
        onFocusCapture={() =>
          onActiveViewportChange(
            VIEWPORT_ID,
            primaryViewportEl,
            selectedSeriesUID,
            primaryReady
          )
        }
      >
        {primary}
      </div>

      {secondaryIndices.map((index) => {
        const viewportId = getViewportIdAt(index);
        return (
          <SecondaryStackViewport
            key={viewportId}
            viewportId={viewportId}
            viewportLabel={getViewportLabelAt(index)}
            studyDate={studyDate}
            seriesMap={seriesMap}
            initialSeriesUID={selectedSeriesUID}
            activeTool={activeTool}
            active={activeViewportId === viewportId}
            interactionDisabled={interactionDisabled}
            voiDefaults={voiDefaults}
            onActivate={onActiveViewportChange}
            onSeriesChange={onViewportSeriesChange}
          />
        );
      })}
    </div>
  );
}
