'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useReducedMotion } from 'framer-motion';
import { fetchSeries, type Study } from '@/lib/pacs/services';
import { Loading } from '@/components/ui/loading';
import {
  Table as ShadTable,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import StudiesFilterRow from './StudiesFilterRow';
import StudyDataRow from './StudyDataRow';
import StudyExpandedRow from './StudyExpandedRow';
import { studyTableColumns, type StudyTableColumn, type StudyTableColumnId } from './columns';
import { emptyStudyFilters } from './types';
import type { SeriesWithInstances, StudiesTableProps } from './types';
import {
  filterStudies,
  getStudyInstanceTotal,
  getStudySeries,
  getStudyUid,
  prefetchFirstImageForStudy,
} from './utils';
import { useResizableColumns } from './useResizableColumns';
import { cn } from '@/lib/utils';

function ResizableHeaderCell({
  column,
  highlightedColumnId,
}: {
  column: StudyTableColumn;
  highlightedColumnId: StudyTableColumnId | null;
}) {
  return (
    <TableHead
      className={cn(
        'relative select-none truncate',
        column.className,
        highlightedColumnId === column.id && 'studies-resizable-boundary-active'
      )}
      scope="col"
    >
      <span className="block truncate" title={column.label}>
        {column.label}
      </span>
    </TableHead>
  );
}

function ColumnResizeHandle({
  column,
  left,
  active,
  onResizeStart,
  onResetWidth,
  onResizeBy,
  onHoverChange,
}: {
  column: StudyTableColumn;
  left: number;
  active: boolean;
  onResizeStart: (column: StudyTableColumn, event: React.PointerEvent<HTMLElement>) => void;
  onResetWidth: (column: StudyTableColumn) => void;
  onResizeBy: (column: StudyTableColumn, delta: number) => void;
  onHoverChange: (columnId: StudyTableColumnId | null) => void;
}) {
  return (
    <span
      role="separator"
      aria-orientation="vertical"
      aria-label={`Đổi độ rộng cột ${column.label}`}
      title="Kéo để đổi độ rộng cột. Nhấp đúp để đặt lại."
      tabIndex={0}
      data-active={active ? 'true' : undefined}
      onPointerEnter={() => onHoverChange(column.id)}
      onPointerLeave={() => onHoverChange(null)}
      onFocus={() => onHoverChange(column.id)}
      onBlur={() => onHoverChange(null)}
      onPointerDown={(event) => onResizeStart(column, event)}
      onDoubleClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onResetWidth(column);
      }}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault();
          onResizeBy(column, event.key === 'ArrowLeft' ? -12 : 12);
        }

        if (event.key === 'Enter' || event.key === 'Home') {
          event.preventDefault();
          onResetWidth(column);
        }
      }}
      className={cn(
        'studies-resize-handle pointer-events-auto absolute top-0 bottom-0 z-30 w-3 -translate-x-1/2 cursor-col-resize touch-none outline-none',
        active && 'bg-transparent'
      )}
      style={{ left }}
    />
  );
}

export default function StudiesTable({ data: studies = [] }: StudiesTableProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState(emptyStudyFilters);
  const [hoveredColumnId, setHoveredColumnId] = useState<StudyTableColumnId | null>(null);
  const [availableTableWidth, setAvailableTableWidth] = useState(0);
  const [seriesByStudy, setSeriesByStudy] = useState<Partial<Record<string, SeriesWithInstances[]>>>({});
  const [seriesLoadingByStudy, setSeriesLoadingByStudy] = useState<Partial<Record<string, boolean>>>({});
  const seriesRequestsRef = useRef<Partial<Record<string, Promise<void>>>>({});
  const tableViewportRef = useRef<HTMLDivElement>(null);

  const router = useRouter();
  const shouldReduceMotion = useReducedMotion();
  const expandTransition = shouldReduceMotion
    ? { duration: 0 }
    : { duration: 0.34, ease: [0.22, 1, 0.36, 1] as const };
  const {
    widths,
    tableWidth,
    activeColumnId,
    startResize,
    resetColumnWidth,
    resizeColumnBy,
  } = useResizableColumns(studyTableColumns, availableTableWidth);
  const resizeBoundaries = useMemo(() => {
    let left = 0;
    return studyTableColumns.flatMap((column, index) => {
      left += widths[column.id] ?? column.defaultWidth;
      if (index >= studyTableColumns.length - 1) return [];
      return [{ column, left }];
    });
  }, [widths]);
  const highlightedColumnId = activeColumnId ?? hoveredColumnId;

  const filteredStudies = useMemo(
    () => filterStudies(studies || [], filters),
    [studies, filters]
  );

  useEffect(() => {
    const element = tableViewportRef.current;
    if (!element) return;

    const updateWidth = () => {
      const nextWidth = Math.floor(element.clientWidth);
      setAvailableTableWidth((current) => (current === nextWidth ? current : nextWidth));
    };

    updateWidth();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateWidth);
      return () => window.removeEventListener('resize', updateWidth);
    }

    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);

    return () => observer.disconnect();
  }, []);

  const ensureSeriesLoaded = useCallback(
    (study: Study, uid: string) => {
      if (seriesByStudy[uid] || seriesRequestsRef.current[uid]) return;

      const target = String(study.studyInstanceUID ?? uid);
      setSeriesLoadingByStudy((current) => ({ ...current, [uid]: true }));

      const request = fetchSeries(target)
        .then((series) => {
          setSeriesByStudy((current) => ({
            ...current,
            [uid]: series as SeriesWithInstances[],
          }));
        })
        .catch(() => {
          setSeriesByStudy((current) => ({ ...current, [uid]: [] }));
        })
        .finally(() => {
          delete seriesRequestsRef.current[uid];
          setSeriesLoadingByStudy((current) => ({ ...current, [uid]: false }));
        });

      seriesRequestsRef.current[uid] = request;
    },
    [seriesByStudy]
  );

  const handleOpenViewer = (study: Study, uid: string) => {
    setLoading(true);
    const target = String(study.studyInstanceUID ?? uid);

    const url = `/viewer/${encodeURIComponent(target)}`;
    try {
      router.push(url);
    } catch {
      try {
        window.location.assign(url);
      } catch {}
    }
  };

  return (
    <div className="space-y-2">
      {loading && <Loading fullScreen message="Đang tải thông tin series..." />}

      <div ref={tableViewportRef} className="overflow-x-auto">
        <div className="studies-resizable-shell relative min-w-full" style={{ width: tableWidth }}>
          <ShadTable
            noContainer
            className="
              studies-resizable-table
              w-full
              rounded-lg
              border border-border
              bg-card
              table-fixed
              text-sm
            "
            style={{
              width: tableWidth,
            }}
          >
            <colgroup>
              {studyTableColumns.map((column) => (
                <col
                  key={column.id}
                  style={{ width: widths[column.id] ?? column.defaultWidth }}
                />
              ))}
            </colgroup>

            <TableHeader className="studies-resizable-head">
              <TableRow className="studies-resizable-row bg-card hover:bg-card !border-b-0 cursor-default">
                {studyTableColumns.map((column) => (
                  <ResizableHeaderCell
                    key={column.id}
                    column={column}
                    highlightedColumnId={highlightedColumnId}
                  />
                ))}
              </TableRow>

              <StudiesFilterRow
                filters={filters}
                highlightedColumnId={highlightedColumnId}
                setFilters={setFilters}
              />
            </TableHeader>

            <TableBody>
              {filteredStudies.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="p-6 text-center text-foreground">
                    Không tìm thấy study phù hợp
                  </TableCell>
                </TableRow>
              ) : null}

              {filteredStudies.map((study, index) => {
                const uid = getStudyUid(study, index);
                const seriesList = seriesByStudy[uid] ?? getStudySeries(study);
                const totalInstances = getStudyInstanceTotal(study, seriesList);
                const isExpanded = Boolean(expanded[uid]);

                return (
                  <React.Fragment key={`study-${uid}-${index}`}>
                    <StudyDataRow
                      study={study}
                      index={index}
                      highlightedColumnId={highlightedColumnId}
                      totalInstances={totalInstances}
                      onToggle={() => {
                        setExpanded((current) => ({
                          ...current,
                          [uid]: !current[uid],
                        }));
                        if (!isExpanded) {
                          ensureSeriesLoaded(study, uid);
                        }
                      }}
                    />

                    <StudyExpandedRow
                      visible={isExpanded}
                      uid={uid}
                      study={study}
                      seriesList={seriesList}
                      seriesLoading={Boolean(seriesLoadingByStudy[uid])}
                      loading={loading}
                      expandTransition={expandTransition}
                      shouldReduceMotion={Boolean(shouldReduceMotion)}
                      onOpenViewer={handleOpenViewer}
                      onPrefetchStudy={(targetStudy) => {
                        void prefetchFirstImageForStudy(targetStudy);
                      }}
                    />
                  </React.Fragment>
                );
              })}
            </TableBody>
          </ShadTable>

          <div className="pointer-events-none absolute inset-y-0 left-0" style={{ width: tableWidth }}>
            {resizeBoundaries.map(({ column, left }) => (
              <ColumnResizeHandle
                key={column.id}
                column={column}
                left={left}
                active={activeColumnId === column.id}
                onResizeStart={startResize}
                onResetWidth={resetColumnWidth}
                onResizeBy={resizeColumnBy}
                onHoverChange={setHoveredColumnId}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
