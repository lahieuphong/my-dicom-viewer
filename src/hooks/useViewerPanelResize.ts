'use client';

import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type SetStateAction,
} from 'react';

import {
  VIEWER_LEFT_PANEL_MAX,
  VIEWER_LEFT_PANEL_MIN,
  VIEWER_MAIN_MIN,
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
  measurementCollapsed: boolean;
  leftPanelWidth: number;
  setLeftPanelWidth: Dispatch<SetStateAction<number>>;
  rightPanelWidth: number;
  setRightPanelWidth: Dispatch<SetStateAction<number>>;
};

function clampWidth(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
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
  measurementCollapsed,
  leftPanelWidth,
  setLeftPanelWidth,
  rightPanelWidth,
  setRightPanelWidth,
}: UseViewerPanelResizeArgs) {
  const gridRef = useRef<HTMLDivElement | null>(null);
  const resizeFrameRef = useRef<number | null>(null);
  const resizeClientXRef = useRef<number | null>(null);
  const bodyDragStyleRef = useRef<{ cursor: string; userSelect: string } | null>(null);
  const resizeStateRef = useRef<{
    side: ViewerPanelResizeSide;
    pointerId: number;
    startX: number;
    startLeftWidth: number;
    startRightWidth: number;
    gridWidth: number;
  } | null>(null);

  const applyResize = useCallback(() => {
    resizeFrameRef.current = null;

    const state = resizeStateRef.current;
    const clientX = resizeClientXRef.current;
    if (!state || clientX == null) return;

    const deltaX = clientX - state.startX;

    if (state.side === 'left') {
      const maxWidth = getPanelMax(
        'left',
        state.gridWidth,
        state.startLeftWidth,
        state.startRightWidth
      );
      setLeftPanelWidth(clampWidth(state.startLeftWidth + deltaX, VIEWER_LEFT_PANEL_MIN, maxWidth));
      return;
    }

    const maxWidth = getPanelMax(
      'right',
      state.gridWidth,
      state.startLeftWidth,
      state.startRightWidth
    );
    setRightPanelWidth(clampWidth(state.startRightWidth - deltaX, VIEWER_RIGHT_PANEL_MIN, maxWidth));
  }, [setLeftPanelWidth, setRightPanelWidth]);

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
  }, []);

  useEffect(() => finishResize, [finishResize]);

  const beginResize = useCallback<ViewerPanelResizeStartHandler>(
    (side, event) => {
      if (disabled) return;
      if (side === 'left' && sidebarCollapsed) return;
      if (side === 'right' && measurementCollapsed) return;

      const gridEl = gridRef.current;
      const gridWidth = gridEl?.getBoundingClientRect().width ?? 0;
      if (gridWidth <= 0) return;

      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);

      resizeStateRef.current = {
        side,
        pointerId: event.pointerId,
        startX: event.clientX,
        startLeftWidth: leftPanelWidth,
        startRightWidth: rightPanelWidth,
        gridWidth,
      };
      resizeClientXRef.current = event.clientX;

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
    },
    [applyResize, finishResize]
  );

  const handleResizeKeyDown = useCallback<ViewerPanelResizeKeyHandler>(
    (side, event) => {
      const step = event.shiftKey ? 32 : 12;
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;

      event.preventDefault();
      const gridWidth = gridRef.current?.getBoundingClientRect().width ?? 0;

      if (side === 'left') {
        const maxWidth = getPanelMax('left', gridWidth, leftPanelWidth, rightPanelWidth);
        setLeftPanelWidth((width) =>
          clampWidth(
            width + (event.key === 'ArrowRight' ? step : -step),
            VIEWER_LEFT_PANEL_MIN,
            maxWidth
          )
        );
        return;
      }

      const maxWidth = getPanelMax('right', gridWidth, leftPanelWidth, rightPanelWidth);
      setRightPanelWidth((width) =>
        clampWidth(
          width + (event.key === 'ArrowLeft' ? step : -step),
          VIEWER_RIGHT_PANEL_MIN,
          maxWidth
        )
      );
    },
    [leftPanelWidth, rightPanelWidth, setLeftPanelWidth, setRightPanelWidth]
  );

  return {
    gridRef,
    beginResize,
    handleResizeMove,
    handleResizeEnd,
    handleResizeKeyDown,
  };
}
