'use client';

import type {
  ViewerPanelResizeEndHandler,
  ViewerPanelResizeKeyHandler,
  ViewerPanelResizeMoveHandler,
  ViewerPanelResizeSide,
  ViewerPanelResizeStartHandler,
} from '@/hooks/useViewerPanelResize';

type PanelResizeHandleProps = {
  side: ViewerPanelResizeSide;
  label: string;
  onResizeStart: ViewerPanelResizeStartHandler;
  onResizeMove: ViewerPanelResizeMoveHandler;
  onResizeEnd: ViewerPanelResizeEndHandler;
  onResizeKeyDown: ViewerPanelResizeKeyHandler;
};

export default function PanelResizeHandle({
  side,
  label,
  onResizeStart,
  onResizeMove,
  onResizeEnd,
  onResizeKeyDown,
}: PanelResizeHandleProps) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      tabIndex={0}
      className={`viewer-panel-resize-handle viewer-panel-resize-handle-${side} hidden md:block`}
      onPointerDown={(event) => onResizeStart(side, event)}
      onPointerMove={onResizeMove}
      onPointerUp={onResizeEnd}
      onPointerCancel={onResizeEnd}
      onKeyDown={(event) => onResizeKeyDown(side, event)}
    />
  );
}
