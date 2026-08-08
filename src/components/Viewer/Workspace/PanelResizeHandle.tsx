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
  disabled?: boolean;
};

export default function PanelResizeHandle({
  side,
  label,
  onResizeStart,
  onResizeMove,
  onResizeEnd,
  onResizeKeyDown,
  disabled = false,
}: PanelResizeHandleProps) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : 0}
      className={`viewer-panel-resize-handle viewer-panel-resize-handle-${side} hidden md:block ${disabled ? 'pointer-events-none opacity-40' : ''}`}
      onPointerDown={(event) => {
        if (!disabled) onResizeStart(side, event);
      }}
      onPointerMove={(event) => {
        if (!disabled) onResizeMove(event);
      }}
      onPointerUp={(event) => {
        if (!disabled) onResizeEnd(event);
      }}
      onPointerCancel={(event) => {
        if (!disabled) onResizeEnd(event);
      }}
      onKeyDown={(event) => {
        if (!disabled) onResizeKeyDown(side, event);
      }}
    />
  );
}
