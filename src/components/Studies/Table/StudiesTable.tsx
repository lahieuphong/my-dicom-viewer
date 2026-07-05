'use client';

import React, { useCallback, useMemo, useRef, useState } from 'react';
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
import { emptyStudyFilters } from './types';
import type { SeriesWithInstances, StudiesTableProps } from './types';
import {
  filterStudies,
  getStudyInstanceTotal,
  getStudySeries,
  getStudyUid,
  prefetchFirstImageForStudy,
} from './utils';

export default function StudiesTable({ data: studies = [] }: StudiesTableProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState(emptyStudyFilters);
  const [seriesByStudy, setSeriesByStudy] = useState<Partial<Record<string, SeriesWithInstances[]>>>({});
  const [seriesLoadingByStudy, setSeriesLoadingByStudy] = useState<Partial<Record<string, boolean>>>({});
  const seriesRequestsRef = useRef<Partial<Record<string, Promise<void>>>>({});

  const router = useRouter();
  const shouldReduceMotion = useReducedMotion();
  const expandTransition = shouldReduceMotion
    ? { duration: 0 }
    : { duration: 0.34, ease: [0.22, 1, 0.36, 1] as const };

  const filteredStudies = useMemo(
    () => filterStudies(studies || [], filters),
    [studies, filters]
  );

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

      <div className="overflow-x-auto">
        <ShadTable
          className="
            min-w-max md:min-w-full
            rounded-lg
            border border-border
            bg-card
            table-fixed
            text-sm
          "
        >
          <TableHeader>
            <TableRow className="bg-card hover:bg-card !border-b-0 cursor-default">
              <TableHead className="w-10 text-center">#</TableHead>
              <TableHead className="truncate">Tên bệnh nhân</TableHead>
              <TableHead className="truncate">Mã bệnh nhân</TableHead>
              <TableHead className="truncate">Ngày chụp</TableHead>
              <TableHead className="truncate">Diễn giải</TableHead>
              <TableHead className="truncate">Thiết bị</TableHead>
              <TableHead className="truncate">Study UID</TableHead>
              <TableHead className="truncate">Mã phiếu</TableHead>
              <TableHead className="truncate w-20 text-center">Thể hiện</TableHead>
            </TableRow>

            <StudiesFilterRow filters={filters} setFilters={setFilters} />
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
      </div>
    </div>
  );
}
