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

function getWidthTotal(columns: StudyTableColumn[], widths: ColumnWidths) {
  return columns.reduce((total, column) => total + widths[column.id], 0);
}

function distributeWidths(columns: StudyTableColumn[], widths: ColumnWidths, targetWidth: number) {
  const minTotal = columns.reduce((total, column) => total + column.minWidth, 0);
  const maxTotal = columns.reduce((total, column) => total + column.maxWidth, 0);
  const target = Math.max(minTotal, Math.min(maxTotal, Math.round(targetWidth)));
  const next = { ...widths };
  let remaining = target - getWidthTotal(columns, next);
  const direction = remaining > 0 ? 1 : -1;

  if (remaining === 0) return next;

  for (let round = 0; round < columns.length && remaining !== 0; round += 1) {
    const eligible = columns.filter((column) =>
      direction > 0 ? next[column.id] < column.maxWidth : next[column.id] > column.minWidth
    );

    if (!eligible.length) break;

    const perColumn = remaining / eligible.length;
    let appliedTotal = 0;

    for (const column of eligible) {
      const current = next[column.id];
      const limit = direction > 0 ? column.maxWidth : column.minWidth;
      const candidate = current + perColumn;
      const applied =
        direction > 0
          ? Math.min(limit, candidate) - current
          : Math.max(limit, candidate) - current;

      if (applied !== 0) {
        next[column.id] = current + applied;
        appliedTotal += applied;
      }
    }

    if (Math.abs(appliedTotal) < 0.01) break;
    remaining -= appliedTotal;
  }

  const rounded = columns.reduce((acc, column) => {
    acc[column.id] = clampWidth(next[column.id], column);
    return acc;
  }, {} as ColumnWidths);

  let roundingDiff = target - getWidthTotal(columns, rounded);
  for (let guard = 0; roundingDiff !== 0 && guard < 1000; guard += 1) {
    let changed = false;

    for (const column of columns) {
      if (roundingDiff > 0 && rounded[column.id] < column.maxWidth) {
        rounded[column.id] += 1;
        roundingDiff -= 1;
        changed = true;
      } else if (roundingDiff < 0 && rounded[column.id] > column.minWidth) {
        rounded[column.id] -= 1;
        roundingDiff += 1;
        changed = true;
      }

      if (roundingDiff === 0) break;
    }

    if (!changed) break;
  }

  return rounded;
}

function createDefaultWidths(columns: StudyTableColumn[], targetWidth = 0) {
  const defaultWidths = columns.reduce((acc, column) => {
    acc[column.id] = clampWidth(column.defaultWidth, column);
    return acc;
  }, {} as ColumnWidths);

  if (targetWidth > 0) {
    return distributeWidths(columns, defaultWidths, targetWidth);
  }

  return defaultWidths;
}

export function useResizableColumns(columns: StudyTableColumn[], availableWidth = 0) {
  const defaultWidths = useMemo(
    () => createDefaultWidths(columns, availableWidth),
    [availableWidth, columns]
  );
  const [widths, setWidths] = useState<ColumnWidths>(() => createDefaultWidths(columns));
  const [activeColumnId, setActiveColumnId] = useState<StudyTableColumnId | null>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const hasUserResizedRef = useRef(false);

  useEffect(() => {
    setWidths((current) => {
      if (!hasUserResizedRef.current && availableWidth > 0) {
        return defaultWidths;
      }

      const next = { ...current };
      for (const column of columns) {
        next[column.id] = clampWidth(next[column.id] ?? column.defaultWidth, column);
      }
      return next as ColumnWidths;
    });
  }, [availableWidth, columns, defaultWidths]);

  const resetColumnWidth = useCallback((column: StudyTableColumn) => {
    hasUserResizedRef.current = true;
    setWidths((current) => ({
      ...current,
      [column.id]: defaultWidths[column.id] ?? column.defaultWidth,
    }));
  }, [defaultWidths]);

  const resizeColumnBy = useCallback((column: StudyTableColumn, delta: number) => {
    hasUserResizedRef.current = true;
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
      hasUserResizedRef.current = true;

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
