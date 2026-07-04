// src/hooks/useSeriesLoader.ts
'use client';

import { useEffect, useState } from 'react';
import { Series, fetchSeries } from '@/lib/pacs/services';
import { USE_STATIC_DICOMS } from '@/lib/pacs/config';

export type VoiRange = { lower: number; upper: number };

type SeriesMapEntry = {
  files: string[];      // imageIds for cornerstone (wadouri:... or wadors:...)
  metadata: Series;
};

export function useSeriesLoader(studyUID: string) {
  const [seriesMap, setSeriesMap] = useState<Record<string, SeriesMapEntry>>({});
  const [selectedSeries, setSelectedSeries] = useState<string>('');
  // giữ 2 state SR để không làm đứt interface (trả về) — hiện không dùng (empty)
  const [srSeriesUIDs, setSrSeriesUIDs] = useState<string[]>([]);
  const [srSeriesMeta, setSrSeriesMeta] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [voiDefaults, setVoiDefaults] = useState<Record<string, VoiRange>>({});

  useEffect(() => {
    if (!studyUID) return;

    setLoading(true);

    const loadSeries = async () => {
      try {
        // 1) Fetch all series for this study using existing service (reads /api/dicoms static index)
        const allSeries = await fetchSeries(studyUID);
        // filter out SR from "image series"
        const imageSeries = allSeries.filter(s => s.seriesModality !== 'SR');

        const map: Record<string, SeriesMapEntry> = {};
        const voiMap: Record<string, VoiRange> = {};

        if (USE_STATIC_DICOMS) {
          // Static mode: build imageIds from instance url fields returned by /api/dicoms
          for (const series of imageSeries) {
            const seriesInstanceUID = series.seriesInstanceUID;
            const insts = (series as any).instances ?? [];

            const imageIds: string[] = (Array.isArray(insts) ? insts : []).map((inst: any) => {
              // original urlPath may be string or object with url/filename
              const urlPath = typeof inst === 'string' ? inst : (inst.url ?? inst.filename ?? '');
              const abs = urlPath.startsWith('http') ? urlPath : `${window.location.origin}${urlPath}`;

              // DEV: cache-buster when running on localhost to avoid stale 304 responses during development.
              // This appends ?cacheBust=<ts> (or &cacheBust=...) only for local dev hosts.
              // IMPORTANT: do NOT enable this in production.
              const isLocalhost = typeof window !== 'undefined' && (
                window.location.hostname === 'localhost' ||
                window.location.hostname === '127.0.0.1' ||
                window.location.hostname === '::1'
              );

              const absWithCb = isLocalhost ? `${abs}${abs.includes('?') ? '&' : '?'}cacheBust=${Date.now()}` : abs;

              return `wadouri:${absWithCb}`;
            }).filter(Boolean);

            map[seriesInstanceUID] = {
              files: imageIds,
              metadata: series,
            };
          }
        } else {
          // Fallback for non-static mode removed — project uses static dicoms
          // Keep empty branch to avoid network calls
        }

        // NOTE: We intentionally do NOT auto-inject SR series here.
        // SR series (if any) should be managed by Viewer / SR export logic (extraSeriesMap).
        // This keeps loading purely static and avoids PACS/SR API usage.

        setSeriesMap(map);
        setVoiDefaults(voiMap);
        setSelectedSeries(Object.keys(map)[0] || '');
        // ensure SR lists are empty (no remote SR calls)
        setSrSeriesUIDs([]);
        setSrSeriesMeta([]);
      } catch (error) {
        console.error('Failed to load series:', error);
      } finally {
        setLoading(false);
      }
    };

    loadSeries();
  }, [studyUID]);

  return {
    seriesMap,
    selectedSeries,
    setSelectedSeries,
    srSeriesUIDs,
    srSeriesMeta,
    loadingSeries: loading,
    voiDefaults,
  } as const;
}
