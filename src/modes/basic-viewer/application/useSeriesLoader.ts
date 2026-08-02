// Series-loading application state for the basic-viewer mode.
'use client';

import { useEffect, useState } from 'react';
import {
  fetchSeries,
} from '@/extensions/static-dicom-data-source';
import type { Series } from '@/platform/core';
import { resolveDicomImageId, USE_STATIC_DICOMS } from '@/config/dicom';

export type VoiRange = { lower: number; upper: number };

type SeriesMapEntry = {
  files: string[];      // imageIds for cornerstone (wadouri:... or wadors:...)
  metadata: Series;
};

export function useSeriesLoader(studyUID: string) {
  const [seriesMap, setSeriesMap] = useState<Record<string, SeriesMapEntry>>({});
  const [selectedSeries, setSelectedSeries] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [voiDefaults, setVoiDefaults] = useState<Record<string, VoiRange>>({});

  useEffect(() => {
    if (!studyUID) return;

    let cancelled = false;
    setLoading(true);
    setError(null);
    setSeriesMap({});
    setSelectedSeries('');
    setVoiDefaults({});

    const loadSeries = async () => {
      try {
        // 1) Fetch only the series for this study. The studies list stays lightweight.
        const allSeries = await fetchSeries(studyUID);
        // filter out SR from "image series"
        const imageSeries = allSeries.filter(s => s.seriesModality !== 'SR');

        const map: Record<string, SeriesMapEntry> = {};
        const voiMap: Record<string, VoiRange> = {};

        if (USE_STATIC_DICOMS) {
          // Static mode: build imageIds from instance url fields returned by the series endpoint.
          for (const series of imageSeries) {
            const seriesInstanceUID = series.seriesInstanceUID;
            const insts = (series as any).instances ?? [];

            const imageIds: string[] = (Array.isArray(insts) ? insts : []).map((inst: any) => {
              // original urlPath may be string or object with url/filename
              const urlPath = typeof inst === 'string' ? inst : (inst.url ?? inst.filename ?? '');
              const imageId = resolveDicomImageId(urlPath, window.location.origin);

              // DEV: cache-buster when running on localhost to avoid stale 304 responses during development.
              // This appends ?cacheBust=<ts> (or &cacheBust=...) only for local dev hosts.
              // IMPORTANT: do NOT enable this in production.
              const isLocalhost = typeof window !== 'undefined' && (
                window.location.hostname === 'localhost' ||
                window.location.hostname === '127.0.0.1' ||
                window.location.hostname === '::1'
              );

              if (isLocalhost && /^wadouri:https?:/i.test(imageId)) {
                try {
                  const assetUrl = new URL(imageId.slice('wadouri:'.length));
                  assetUrl.searchParams.set('cacheBust', String(Date.now()));
                  return `wadouri:${assetUrl.toString()}`;
                } catch {
                  return imageId;
                }
              }

              return imageId;
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

        // SR is secondary content, so it is intentionally not inserted into
        // the primary image-series map. The SR runtime owns its report list and
        // hydrates annotations over the referenced source stack.

        if (!cancelled) {
          setSeriesMap(map);
          setVoiDefaults(voiMap);
          setSelectedSeries(Object.keys(map)[0] || '');
        }
      } catch (error) {
        if (!cancelled) {
          setError(
            error instanceof Error
              ? error.message
              : 'Failed to load study series'
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadSeries();

    return () => {
      cancelled = true;
    };
  }, [studyUID]);

  return {
    seriesMap,
    selectedSeries,
    setSelectedSeries,
    loadingSeries: loading,
    seriesError: error,
    voiDefaults,
  } as const;
}
