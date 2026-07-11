'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { StudyTableColumn, StudyTableColumnId } from './columns';

type ColumnWidths = Record<StudyTableColumnId, number>;

type DragState = {
  column: StudyTableColumn;
  startX: number;
  startWidth: number;
  originalCursor: string;
  originalUserSelect: string;
};

function clampWidth(width: number, column: StudyTableColumn) {
  return Math.max(column.minWidth, Math.min(column.maxWidth, Math.round(width)));
}

function createDefaultWidths(columns: StudyTableColumn[]) {
  return columns.reduce((acc, column) => {
    acc[column.id] = column.defaultWidth;
    return acc;
  }, {} as ColumnWidths);
}

export function useResizableColumns(columns: StudyTableColumn[]) {
  const [widths, setWidths] = useState<ColumnWidths>(() => createDefaultWidths(columns));
  const [activeColumnId, setActiveColumnId] = useState<StudyTableColumnId | null>(null);
  const dragStateRef = useRef<DragState | null>(null);

  useEffect(() => {
    setWidths((current) => {
      const next = { ...current };
      for (const column of columns) {
        next[column.id] = clampWidth(next[column.id] ?? column.defaultWidth, column);
      }
      return next as ColumnWidths;
    });
  }, [columns]);

  const resetColumnWidth = useCallback((column: StudyTableColumn) => {
    setWidths((current) => ({
      ...current,
      [column.id]: column.defaultWidth,
    }));
  }, []);

  const resizeColumnBy = useCallback((column: StudyTableColumn, delta: number) => {
    setWidths((current) => {
      const currentWidth = current[column.id] ?? column.defaultWidth;
      return {
        ...current,
        [column.id]: clampWidth(currentWidth + delta, column),
      };
    });
  }, []);

  const finishDrag = useCallback(() => {
    const dragState = dragStateRef.current;
    dragStateRef.current = null;
    setActiveColumnId(null);

    if (!dragState || typeof document === 'undefined') return;

    document.body.style.cursor = dragState.originalCursor;
    document.body.style.userSelect = dragState.originalUserSelect;
  }, []);

  useEffect(() => {
    return () => {
      finishDrag();
    };
  }, [finishDrag]);

  const startResize = useCallback(
    (column: StudyTableColumn, event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;

      event.preventDefault();
      event.stopPropagation();

      const currentWidth = widths[column.id] ?? column.defaultWidth;
      const dragState: DragState = {
        column,
        startX: event.clientX,
        startWidth: currentWidth,
        originalCursor: document.body.style.cursor,
        originalUserSelect: document.body.style.userSelect,
      };

      dragStateRef.current = dragState;
      setActiveColumnId(column.id);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      const handlePointerMove = (moveEvent: PointerEvent) => {
        const activeDrag = dragStateRef.current;
        if (!activeDrag) return;

        const delta = moveEvent.clientX - activeDrag.startX;
        const nextWidth = clampWidth(activeDrag.startWidth + delta, activeDrag.column);
        setWidths((current) => ({
          ...current,
          [activeDrag.column.id]: nextWidth,
        }));
      };

      const handlePointerUp = () => {
        document.removeEventListener('pointermove', handlePointerMove);
        document.removeEventListener('pointerup', handlePointerUp);
        document.removeEventListener('pointercancel', handlePointerUp);
        finishDrag();
      };

      document.addEventListener('pointermove', handlePointerMove);
      document.addEventListener('pointerup', handlePointerUp);
      document.addEventListener('pointercancel', handlePointerUp);
    },
    [finishDrag, widths]
  );

  const tableWidth = useMemo(
    () => columns.reduce((total, column) => total + (widths[column.id] ?? column.defaultWidth), 0),
    [columns, widths]
  );

  return {
    widths,
    tableWidth,
    activeColumnId,
    startResize,
    resetColumnWidth,
    resizeColumnBy,
  } as const;
}
