// src/components/Studies/Table.tsx
'use client';

import { imageLoader } from '@cornerstonejs/core';
import React, { useState, useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Loading } from '@/components/ui/loading';
import { Button } from '@/components/ui/button';
import {
  Table as ShadTable,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import type { Study, Series } from '@/lib/pacs/services';
import { formatStudyDate, normalizeValue, fieldToString } from '@/lib/utils';

// ensure cornerstone init before navigation (safety)
import { initCornerstone } from '@/lib/cornerstone';

interface Props {
  data: Study[];
}

interface Instance {
  sopInstanceUID?: string;
  instanceNumber?: number | null;
  url?: string;
  filename?: string;
}

type SeriesWithInstances = Series & { instances?: (Instance | string)[] };

function InstanceCountIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-5 w-5 flex-shrink-0 text-primary"
      fill="none"
    >
      <rect
        x="3"
        y="4"
        width="13"
        height="13"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.7"
      />
      <rect
        x="8"
        y="9"
        width="13"
        height="13"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.7"
      />
    </svg>
  );
}

export default function Table({ data: studies = [] }: Props) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({
    name: '', id: '', date: '', description: '', modality: '', studyUID: '', accession: ''
  });

  const router = useRouter();
  const shouldReduceMotion = useReducedMotion();
  const expandTransition = shouldReduceMotion
    ? { duration: 0 }
    : { duration: 0.34, ease: [0.22, 1, 0.36, 1] as const };

  useEffect(() => {
    console.log('[Table] studies received:', (studies || []).length);
    if (studies && studies.length) {
      console.log('[Table] studies[0] preview:', studies[0]);
    }
  }, [studies]);

  // --- PREWARM Cornerstone as early as possible ---
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        await initCornerstone();
        if (mounted) {
          console.debug('[Table] initCornerstone prewarm done');
        }
      } catch (err) {
        console.warn('[Table] prewarm initCornerstone failed', err);
      }
    })();
    return () => { mounted = false; };
  }, []);

  // helper for filter comparisons: returns lowercase string ('' when empty)
  const f = (s: any = '') => (fieldToString(s) || '').toLowerCase();

  const filtered = useMemo(() => {
    const list = (studies || []).filter(st =>
      f(st.patientName).includes(f(filters.name)) &&
      f(st.patientId).includes(f(filters.id)) &&
      f(st.studyDate).includes(f(filters.date)) &&
      f(st.studyDescription).includes(f(filters.description)) &&
      f(st.modalitiesInStudy).includes(f(filters.modality)) &&
      f(st.studyInstanceUID).includes(f(filters.studyUID)) &&
      f(st.accessionNumber).includes(f(filters.accession))
    );
    console.log('[Table] filtered length:', list.length);
    return list;
  }, [studies, filters]);

  const truncate = (s?: string, max = 25) =>
    !s ? '' : s.length > max ? `${s.slice(0, max)}…` : s;

  async function prefetchFirstImageForStudy(st: Study) {
    try {
      const seriesList: SeriesWithInstances[] = (st.series || []) as SeriesWithInstances[];
      if (!seriesList || seriesList.length === 0) return;

      let instanceCandidate: string | undefined;
      for (const s of seriesList) {
        const insts = (s.instances ?? []) as (Instance | string)[];
        if (Array.isArray(insts) && insts.length > 0) {
          const first = insts[0];
          if (typeof first === 'string') {
            instanceCandidate = first;
          } else if (first && typeof first === 'object') {
            instanceCandidate = (first.url as string) || (first.filename as string) || undefined;
          }
          if (instanceCandidate) break;
        }
      }

      if (!instanceCandidate) return;

      let abs = String(instanceCandidate || '');
      if (!abs.startsWith('http')) {
        if (typeof window !== 'undefined') {
          abs = `${window.location.origin}${abs}`;
        } else {
          return;
        }
      }

      const isLocalhost = typeof window !== 'undefined' && (
        window.location.hostname === 'localhost' ||
        window.location.hostname === '127.0.0.1' ||
        window.location.hostname === '::1'
      );
      const absWithCb = isLocalhost ? `${abs}${abs.includes('?') ? '&' : '?'}cacheBust=${Date.now()}` : abs;
      const imageId = `wadouri:${absWithCb}`;

      try {
        if (imageLoader && typeof (imageLoader as any).loadAndCacheImage === 'function') {
          await (imageLoader as any).loadAndCacheImage(imageId).catch((err: any) => {
            console.warn('[Studies Table][prefetch] loadAndCacheImage failed for', imageId, err);
          });
        } else {
          const csCore = await import('@cornerstonejs/core').catch(()=>null);
          if (csCore && csCore.imageLoader && typeof csCore.imageLoader.loadAndCacheImage === 'function') {
            await csCore.imageLoader.loadAndCacheImage(imageId).catch((err: any) => {
              console.warn('[Studies Table][prefetch][dyn] loadAndCacheImage failed for', imageId, err);
            });
          }
        }
      } catch (e) {
        console.warn('[Studies Table][prefetch] unexpected error for', imageId, e);
      }
    } catch (err) {
      // swallow errors
    }
  }

  return (
    <div className="space-y-2">
      {loading && (
        <Loading fullScreen message="Đang tải thông tin series..." />
      )}

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
            <TableRow className="bg-card hover:bg-muted !border-b-0 cursor-default">
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

            <TableRow className="bg-card hover:bg-muted !border-b-0 cursor-default">
              <TableCell className="min-w-0" />
              {['name','id','date','description','modality','studyUID','accession'].map((key) => (
                <TableCell key={key} className="min-w-0 md:min-w-full">
                  <Input
                    placeholder={key.charAt(0).toUpperCase() + key.slice(1)}
                    value={(filters as any)[key]}
                    onChange={e => setFilters({ ...filters, [key]: e.target.value })}
                    className="w-full min-w-[80px] md:min-w-full border border-border bg-background"
                  />
                </TableCell>
              ))}
              <TableCell className="min-w-0" />
            </TableRow>
          </TableHeader>

          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="p-6 text-center text-muted">
                  Không tìm thấy study phù hợp.
                </TableCell>
              </TableRow>
            ) : null}

            {filtered.map((st, idx) => {
              const uid = normalizeValue(st.studyInstanceUID) || `no-uid-${idx}`;
              const seriesList: SeriesWithInstances[] = (st.series || []) as SeriesWithInstances[];
              const total = seriesList.length
                ? seriesList.reduce((sum, s) => sum + (parseInt(String(s.seriesRelatedInstanceCount || '0')) || 0), 0)
                : Number(st.imageCount) || 0;

              return (
                <React.Fragment key={`study-${uid}-${idx}`}>
                  <TableRow
                    onClick={() => setExpanded(prev => ({ ...prev, [uid]: !prev[uid] }))}
                    className="cursor-pointer bg-background hover:bg-muted"
                  >
                    <TableCell className="text-center">{idx + 1}</TableCell>

                    <TableCell className="truncate">
                      {truncate(normalizeValue(st.patientName))}
                    </TableCell>

                    <TableCell className="truncate">
                      {truncate(normalizeValue(st.patientId))}
                    </TableCell>

                    <TableCell className="truncate">
                      {truncate(formatStudyDate(fieldToString(st.studyDate)))}
                    </TableCell>

                    <TableCell className="truncate">
                      {truncate(normalizeValue(st.studyDescription))}
                    </TableCell>

                    <TableCell className="truncate">
                      {truncate(normalizeValue(st.modalitiesInStudy))}
                    </TableCell>

                    <TableCell className="truncate">
                      {truncate(normalizeValue(st.studyInstanceUID))}
                    </TableCell>

                    <TableCell className="truncate">
                      {truncate(normalizeValue(st.accessionNumber))}
                    </TableCell>

                    <TableCell className="text-center">
                      <span className="inline-flex items-center justify-center gap-2 tabular-nums">
                        <InstanceCountIcon />
                        <span>{truncate(String(total || ''))}</span>
                      </span>
                    </TableCell>
                  </TableRow>

                  <AnimatePresence initial={false}>
                    {expanded[uid] && (
                      <motion.tr
                        key={`expanded-${uid}`}
                        className="border-b bg-popover"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={expandTransition}
                      >
                        <TableCell colSpan={9} className="p-0 bg-popover overflow-hidden">
                          <motion.div
                            initial={{ height: 0, opacity: 0, y: -8 }}
                            animate={{ height: 'auto', opacity: 1, y: 0 }}
                            exit={{ height: 0, opacity: 0, y: -6 }}
                            transition={expandTransition}
                            className="overflow-hidden"
                          >
                            <motion.div
                              initial={{ opacity: 0, y: -4 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, y: -4 }}
                              transition={
                                shouldReduceMotion
                                  ? { duration: 0 }
                                  : { duration: 0.22, ease: [0.22, 1, 0.36, 1] as const }
                              }
                              className="px-6 py-4"
                            >
                              <div className="grid grid-cols-4 gap-0 font-semibold text-sm border-b border-border pb-2">
                                <div className="px-4">Diễn giải</div>
                                <div className="px-4">Chuỗi</div>
                                <div className="px-4">Thiết bị</div>
                                <div className="px-4">Instances</div>
                              </div>

                              <div className="divide-y">
                                {seriesList.length === 0 && (
                                  <div className="py-4 text-sm text-muted">Không có series</div>
                                )}

                                {seriesList.map((s, sidx) => {
                                  const instancesArr = (Array.isArray(s.instances) ? s.instances : []) as (Instance | string)[];
                                  const count = parseInt(String(s.seriesRelatedInstanceCount || instancesArr.length || '0')) || 0;

                                  return (
                                    <div key={`series-${s.seriesInstanceUID || sidx}`} className="grid grid-cols-4 gap-0 items-start py-4">
                                      <div className="px-4">
                                        <div className="text-sm">{truncate(normalizeValue(s.seriesDescription))}</div>
                                      </div>

                                      <div className="px-4">
                                        <div className="text-sm">{truncate(normalizeValue(s.seriesNumber))}</div>
                                      </div>

                                      <div className="px-4">
                                        <div className="text-sm">{truncate(normalizeValue(s.seriesModality))}</div>
                                      </div>

                                      <div className="px-4">
                                        <div className="text-sm">{truncate(normalizeValue(String(count)))}</div>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>

                              <div className="pt-4">
                                <Button
                                  disabled={loading}
                                  onClick={async () => {
                                    setLoading(true);
                                    const target = String(st.studyInstanceUID ?? uid);
                                    try {
                                      // đảm bảo Cornerstone được init before navigation
                                      await initCornerstone();
                                    } catch (e) {
                                      console.warn('[Table] initCornerstone before navigation failed', e);
                                      // continue anyway
                                    }

                                    // HARD NAVIGATION: full page load to viewer URL (avoids client-router timing races)
                                    const url = `/viewer/${encodeURIComponent(target)}`;
                                    try {
                                      // use assign so browser history keeps previous page; replace() can be used if you don't want it
                                      window.location.assign(url);
                                    } catch (err) {
                                      // fallback to router.push if assign fails for some reason
                                      try { router.push(url); } catch { /* ignore */ }
                                    }
                                  }}
                                  onMouseEnter={() => {
                                    prefetchFirstImageForStudy(st);
                                  }}
                                  className="bg-primary text-primary-foreground"
                                >
                                  <i className="fas fa-arrow-right mr-2" />
                                  Mở Viewer
                                </Button>
                              </div>
                            </motion.div>
                          </motion.div>
                        </TableCell>
                      </motion.tr>
                    )}
                  </AnimatePresence>
                </React.Fragment>
              );
            })}
          </TableBody>
        </ShadTable>
      </div>
    </div>
  );
}
