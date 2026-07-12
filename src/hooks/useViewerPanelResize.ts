'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type SetStateAction,
} from 'react';

import {
  VIEWER_LEFT_PANEL_COLLAPSED,
  VIEWER_LEFT_PANEL_MAX,
  VIEWER_LEFT_PANEL_MIN,
  VIEWER_MAIN_MIN,
  VIEWER_RIGHT_PANEL_COLLAPSED,
  VIEWER_RIGHT_PANEL_MAX,
  VIEWER_RIGHT_PANEL_MIN,
} from '@/constants/viewerLayout';

export type ViewerPanelResizeSide = 'left' | 'right';

export type ViewerPanelResizeStartHandler = (
  side: ViewerPanelResizeSide,
  event: ReactPointerEvent<HTMLDivElement>
) => void;

export type ViewerPanelResizeMoveHandler = (
  event: ReactPointerEvent<HTMLDivElement>
) => void;

export type ViewerPanelResizeEndHandler = (
  event: ReactPointerEvent<HTMLDivElement>
) => void;

export type ViewerPanelResizeKeyHandler = (
  side: ViewerPanelResizeSide,
  event: ReactKeyboardEvent<HTMLDivElement>
) => void;

type UseViewerPanelResizeArgs = {
  disabled?: boolean;
  sidebarCollapsed: boolean;
  setSidebarCollapsed: Dispatch<SetStateAction<boolean>>;
  measurementCollapsed: boolean;
  setMeasurementCollapsed: Dispatch<SetStateAction<boolean>>;
  leftPanelWidth: number;
  setLeftPanelWidth: Dispatch<SetStateAction<number>>;
  rightPanelWidth: number;
  setRightPanelWidth: Dispatch<SetStateAction<number>>;
};

type ViewerPanelResizeState = {
  side: ViewerPanelResizeSide;
  pointerId: number;
  startX: number;
  startLeftWidth: number;
  startRightWidth: number;
  gridWidth: number;
  currentWidth: number;
  previewCollapsed: boolean;
};

type ViewerPanelResizePreview = {
  side: ViewerPanelResizeSide;
  collapsed: boolean;
};

function clampWidth(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getCollapsedWidth(side: ViewerPanelResizeSide) {
  return side === 'left' ? VIEWER_LEFT_PANEL_COLLAPSED : VIEWER_RIGHT_PANEL_COLLAPSED;
}

function getExpandedMin(side: ViewerPanelResizeSide) {
  return side === 'left' ? VIEWER_LEFT_PANEL_MIN : VIEWER_RIGHT_PANEL_MIN;
}

function getSnapThreshold(side: ViewerPanelResizeSide) {
  return (getCollapsedWidth(side) + getExpandedMin(side)) / 2;
}

function getCollapseThreshold(side: ViewerPanelResizeSide) {
  return getSnapThreshold(side) - 12;
}

function getExpandThreshold(side: ViewerPanelResizeSide) {
  return getSnapThreshold(side) + 12;
}

function applyGridWidths(gridEl: HTMLDivElement, leftWidth: number, rightWidth: number) {
  gridEl.style.setProperty('--viewer-left-panel-width', `${leftWidth}px`);
  gridEl.style.setProperty('--viewer-right-panel-width', `${rightWidth}px`);
  gridEl.style.setProperty(
    '--viewer-grid-columns',
    `${leftWidth}px minmax(0, 1fr) ${rightWidth}px`
  );
}

function getPanelMax(
  side: ViewerPanelResizeSide,
  gridWidth: number,
  leftPanelWidth: number,
  rightPanelWidth: number
) {
  if (gridWidth <= 0) {
    return side === 'left' ? VIEWER_LEFT_PANEL_MAX : VIEWER_RIGHT_PANEL_MAX;
  }

  if (side === 'left') {
    return Math.max(
      VIEWER_LEFT_PANEL_MIN,
      Math.min(VIEWER_LEFT_PANEL_MAX, gridWidth - rightPanelWidth - VIEWER_MAIN_MIN)
    );
  }

  return Math.max(
    VIEWER_RIGHT_PANEL_MIN,
    Math.min(VIEWER_RIGHT_PANEL_MAX, gridWidth - leftPanelWidth - VIEWER_MAIN_MIN)
  );
}

export function useViewerPanelResize({
  disabled = false,
  sidebarCollapsed,
  setSidebarCollapsed,
  measurementCollapsed,
  setMeasurementCollapsed,
  leftPanelWidth,
  setLeftPanelWidth,
  rightPanelWidth,
  setRightPanelWidth,
}: UseViewerPanelResizeArgs) {
  const gridRef = useRef<HTMLDivElement | null>(null);
  const resizeFrameRef = useRef<number | null>(null);
  const resizeClientXRef = useRef<number | null>(null);
  const bodyDragStyleRef = useRef<{ cursor: string; userSelect: string } | null>(null);
  const resizeStateRef = useRef<ViewerPanelResizeState | null>(null);
  const [resizePreview, setResizePreview] = useState<ViewerPanelResizePreview | null>(null);

  const applyResize = useCallback(() => {
    resizeFrameRef.current = null;

    const state = resizeStateRef.current;
    const clientX = resizeClientXRef.current;
    if (!state || clientX == null) return;

    const deltaX = clientX - state.startX;

    const maxWidth = getPanelMax(
      state.side,
      state.gridWidth,
      state.startLeftWidth,
      state.startRightWidth
    );
    const startWidth =
      state.side === 'left' ? state.startLeftWidth : state.startRightWidth;
    const rawWidth = clampWidth(
      startWidth + (state.side === 'left' ? deltaX : -deltaX),
      getCollapsedWidth(state.side),
      maxWidth
    );

    let previewCollapsed = state.previewCollapsed;
    if (previewCollapsed && rawWidth >= getExpandThreshold(state.side)) {
      previewCollapsed = false;
    } else if (!previewCollapsed && rawWidth <= getCollapseThreshold(state.side)) {
      previewCollapsed = true;
    }

    if (previewCollapsed !== state.previewCollapsed) {
      state.previewCollapsed = previewCollapsed;
      setResizePreview({ side: state.side, collapsed: previewCollapsed });
    }

    const nextWidth = previewCollapsed
      ? getCollapsedWidth(state.side)
      : clampWidth(rawWidth, getExpandedMin(state.side), maxWidth);

    state.currentWidth = nextWidth;
    const nextLeftWidth = state.side === 'left' ? nextWidth : state.startLeftWidth;
    const nextRightWidth = state.side === 'right' ? nextWidth : state.startRightWidth;
    const gridEl = gridRef.current;
    if (gridEl) applyGridWidths(gridEl, nextLeftWidth, nextRightWidth);
  }, []);

  const commitResize = useCallback(
    (state: ViewerPanelResizeState) => {
      const shouldCollapse = state.previewCollapsed;
      const maxWidth = getPanelMax(
        state.side,
        state.gridWidth,
        state.startLeftWidth,
        state.startRightWidth
      );

      let nextLeftWidth = state.startLeftWidth;
      let nextRightWidth = state.startRightWidth;

      if (state.side === 'left') {
        if (shouldCollapse) {
          nextLeftWidth = VIEWER_LEFT_PANEL_COLLAPSED;
          setSidebarCollapsed(true);
        } else {
          nextLeftWidth = clampWidth(
            state.currentWidth,
            VIEWER_LEFT_PANEL_MIN,
            maxWidth
          );
          setLeftPanelWidth(nextLeftWidth);
          setSidebarCollapsed(false);
        }
      } else if (shouldCollapse) {
        nextRightWidth = VIEWER_RIGHT_PANEL_COLLAPSED;
        setMeasurementCollapsed(true);
      } else {
        nextRightWidth = clampWidth(
          state.currentWidth,
          VIEWER_RIGHT_PANEL_MIN,
          maxWidth
        );
        setRightPanelWidth(nextRightWidth);
        setMeasurementCollapsed(false);
      }

      const gridEl = gridRef.current;
      setResizePreview(null);
      if (!gridEl) return;

      // Flush the final drag frame before applying the settled snap target.
      gridEl.getBoundingClientRect();
      applyGridWidths(gridEl, nextLeftWidth, nextRightWidth);
    },
    [
      setLeftPanelWidth,
      setMeasurementCollapsed,
      setRightPanelWidth,
      setSidebarCollapsed,
    ]
  );

  const finishResize = useCallback(() => {
    resizeStateRef.current = null;
    resizeClientXRef.current = null;

    if (resizeFrameRef.current != null) {
      window.cancelAnimationFrame(resizeFrameRef.current);
      resizeFrameRef.current = null;
    }

    const previousStyle = bodyDragStyleRef.current;
    if (previousStyle) {
      document.body.style.cursor = previousStyle.cursor;
      document.body.style.userSelect = previousStyle.userSelect;
      bodyDragStyleRef.current = null;
    }

    gridRef.current?.removeAttribute('data-panel-resizing');
  }, []);

  useEffect(() => finishResize, [finishResize]);

  const beginResize = useCallback<ViewerPanelResizeStartHandler>(
    (side, event) => {
      if (disabled) return;

      const gridEl = gridRef.current;
      if (!gridEl) return;

      const gridRect = gridEl.getBoundingClientRect();
      const gridWidth = gridRect.width;
      if (gridWidth <= 0) return;

      const handleRect = event.currentTarget.getBoundingClientRect();
      const renderedWidth =
        side === 'left'
          ? handleRect.left - gridRect.left
          : gridRect.right - handleRect.right;
      const fallbackWidth =
        side === 'left'
          ? sidebarCollapsed
            ? VIEWER_LEFT_PANEL_COLLAPSED
            : leftPanelWidth
          : measurementCollapsed
            ? VIEWER_RIGHT_PANEL_COLLAPSED
            : rightPanelWidth;
      const startWidth = Math.max(
        getCollapsedWidth(side),
        Number.isFinite(renderedWidth) && renderedWidth > 0 ? renderedWidth : fallbackWidth
      );
      const startLeftWidth =
        side === 'left'
          ? startWidth
          : sidebarCollapsed
            ? VIEWER_LEFT_PANEL_COLLAPSED
            : leftPanelWidth;
      const startRightWidth =
        side === 'right'
          ? startWidth
          : measurementCollapsed
            ? VIEWER_RIGHT_PANEL_COLLAPSED
            : rightPanelWidth;

      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);

      resizeStateRef.current = {
        side,
        pointerId: event.pointerId,
        startX: event.clientX,
        startLeftWidth,
        startRightWidth,
        gridWidth,
        currentWidth: startWidth,
        previewCollapsed:
          side === 'left' ? sidebarCollapsed : measurementCollapsed,
      };
      resizeClientXRef.current = event.clientX;
      setResizePreview({
        side,
        collapsed: side === 'left' ? sidebarCollapsed : measurementCollapsed,
      });
      gridEl.dataset.panelResizing = 'true';
      applyGridWidths(gridEl, startLeftWidth, startRightWidth);

      if (!bodyDragStyleRef.current) {
        bodyDragStyleRef.current = {
          cursor: document.body.style.cursor,
          userSelect: document.body.style.userSelect,
        };
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
      }
    },
    [disabled, leftPanelWidth, measurementCollapsed, rightPanelWidth, sidebarCollapsed]
  );

  const handleResizeMove = useCallback<ViewerPanelResizeMoveHandler>(
    (event) => {
      const state = resizeStateRef.current;
      if (!state || state.pointerId !== event.pointerId) return;

      event.preventDefault();
      resizeClientXRef.current = event.clientX;
      if (resizeFrameRef.current == null) {
        resizeFrameRef.current = window.requestAnimationFrame(applyResize);
      }
    },
    [applyResize]
  );

  const handleResizeEnd = useCallback<ViewerPanelResizeEndHandler>(
    (event) => {
      const state = resizeStateRef.current;
      if (!state || state.pointerId !== event.pointerId) return;

      resizeClientXRef.current = event.clientX;
      if (resizeFrameRef.current != null) {
        window.cancelAnimationFrame(resizeFrameRef.current);
        resizeFrameRef.current = null;
      }
      applyResize();

      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        // Pointer capture may already be released by the browser.
      }
      finishResize();
      commitResize(state);
    },
    [applyResize, commitResize, finishResize]
  );

  const handleResizeKeyDown = useCallback<ViewerPanelResizeKeyHandler>(
    (side, event) => {
      const step = event.shiftKey ? 32 : 12;
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;

      event.preventDefault();
      const gridWidth = gridRef.current?.getBoundingClientRect().width ?? 0;
      const effectiveLeftWidth = sidebarCollapsed
        ? VIEWER_LEFT_PANEL_COLLAPSED
        : leftPanelWidth;
      const effectiveRightWidth = measurementCollapsed
        ? VIEWER_RIGHT_PANEL_COLLAPSED
        : rightPanelWidth;

      if (side === 'left') {
        if (sidebarCollapsed) {
          if (event.key === 'ArrowRight') setSidebarCollapsed(false);
          return;
        }

        if (event.key === 'ArrowLeft' && leftPanelWidth <= VIEWER_LEFT_PANEL_MIN) {
          setSidebarCollapsed(true);
          return;
        }

        const maxWidth = getPanelMax(
          'left',
          gridWidth,
          effectiveLeftWidth,
          effectiveRightWidth
        );
        setLeftPanelWidth((width) =>
          clampWidth(
            width + (event.key === 'ArrowRight' ? step : -step),
            VIEWER_LEFT_PANEL_MIN,
            maxWidth
          )
        );
        return;
      }

      if (measurementCollapsed) {
        if (event.key === 'ArrowLeft') setMeasurementCollapsed(false);
        return;
      }

      if (event.key === 'ArrowRight' && rightPanelWidth <= VIEWER_RIGHT_PANEL_MIN) {
        setMeasurementCollapsed(true);
        return;
      }

      const maxWidth = getPanelMax(
        'right',
        gridWidth,
        effectiveLeftWidth,
        effectiveRightWidth
      );
      setRightPanelWidth((width) =>
        clampWidth(
          width + (event.key === 'ArrowLeft' ? step : -step),
          VIEWER_RIGHT_PANEL_MIN,
          maxWidth
        )
      );
    },
    [
      leftPanelWidth,
      measurementCollapsed,
      rightPanelWidth,
      setLeftPanelWidth,
      setMeasurementCollapsed,
      setRightPanelWidth,
      setSidebarCollapsed,
      sidebarCollapsed,
    ]
  );

  return {
    gridRef,
    renderedSidebarCollapsed:
      resizePreview?.side === 'left' ? resizePreview.collapsed : sidebarCollapsed,
    renderedMeasurementCollapsed:
      resizePreview?.side === 'right' ? resizePreview.collapsed : measurementCollapsed,
    beginResize,
    handleResizeMove,
    handleResizeEnd,
    handleResizeKeyDown,
  };
}
