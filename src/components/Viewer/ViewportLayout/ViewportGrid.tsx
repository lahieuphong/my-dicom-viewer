'use client';

import { useEffect, useMemo, type ReactNode } from 'react';
import { Enums as CoreEnums } from '@cornerstonejs/core';

import { VIEWPORT_ID } from '@/constants/viewport';
import type { ToolID } from '@/hooks/useToolManager';
import { getRenderingEngine, RENDERER_ID } from '@/lib/cornerstone/renderer';
import type { ViewportSeriesMap } from '@/components/Viewer/Viewport/DataOverlay';

import SecondaryStackViewport from './SecondaryStackViewport';
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

  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;
    const gridElement = primaryViewportEl?.closest<HTMLElement>(
      '[data-viewport-grid]'
    );
    if (!gridElement) return;

    let frame: number | null = null;
    const retryTimers = new Set<number>();
    const forceGridRender = () => {
      try {
        const engine = getRenderingEngine(RENDERER_ID);
        engine.resize(true, true);
        engine.render();
      } catch {}
    };
    const scheduleResize = () => {
      if (frame !== null) return;
      frame = window.requestAnimationFrame(() => {
        frame = null;
        forceGridRender();
      });
    };
    const scheduleSettlingRenders = () => {
      retryTimers.forEach((timer) => window.clearTimeout(timer));
      retryTimers.clear();
      scheduleResize();
      for (const delay of [100, 260, 600, 1200]) {
        const timer = window.setTimeout(() => {
          retryTimers.delete(timer);
          forceGridRender();
        }, delay);
        retryTimers.add(timer);
      }
    };
    const handleNewStack = (event: Event) => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.dataset.viewportRole === 'content'
      ) {
        scheduleSettlingRenders();
      }
    };
    const observer = new ResizeObserver(scheduleResize);
    observer.observe(gridElement);
    const viewportElements = Array.from(
      gridElement.querySelectorAll<HTMLElement>(
        '[data-viewport-role="content"]'
      )
    );
    viewportElements.forEach((element) => {
      element.addEventListener(
        CoreEnums.Events.VIEWPORT_NEW_IMAGE_SET,
        handleNewStack
      );
    });
    scheduleSettlingRenders();

    return () => {
      observer.disconnect();
      viewportElements.forEach((element) => {
        element.removeEventListener(
          CoreEnums.Events.VIEWPORT_NEW_IMAGE_SET,
          handleNewStack
        );
      });
      if (frame !== null) window.cancelAnimationFrame(frame);
      retryTimers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [layout.columns, layout.rows, primaryViewportEl]);

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
