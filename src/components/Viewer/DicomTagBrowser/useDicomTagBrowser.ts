'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import type { DicomTagTree } from '@/lib/dicom-tags';
import type { DicomSeries } from '@/platform/core/domain/dicom';

export type DicomTagBrowserSeriesMap = Record<
  string,
  { files: readonly unknown[]; metadata?: DicomSeries }
>;

export type DicomTagBrowserSeries = {
  uid: string;
  label: string;
  files: string[];
};

type UseDicomTagBrowserOptions = {
  open: boolean;
  seriesMap: DicomTagBrowserSeriesMap;
  activeSeriesUID: string;
};

const DICOM_TAG_LOAD_TIMEOUT_MS = 30_000;

async function withLoadTimeout<T>(promise: Promise<T>): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error('DICOM tag load timed out')),
      DICOM_TAG_LOAD_TIMEOUT_MS
    );
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

function numericSeriesNumber(value: string | undefined): number {
  const normalized = value?.trim();
  if (!normalized) return Number.POSITIVE_INFINITY;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

function makeSeriesLabel(
  metadata: DicomSeries
): string {
  const number = metadata.seriesNumber || '—';
  const modality = metadata.seriesModality || 'DICOM';
  const description = metadata.seriesDescription || 'Không có mô tả';
  return `${number} (${modality}): ${description}`;
}

export function useDicomTagBrowser({
  open,
  seriesMap,
  activeSeriesUID,
}: UseDicomTagBrowserOptions) {
  const series = useMemo<DicomTagBrowserSeries[]>(
    () =>
      Object.entries(seriesMap)
        .filter(([, entry]) => entry.files.length > 0 && Boolean(entry.metadata))
        .sort(([, left], [, right]) => {
          const leftNumber = numericSeriesNumber(left.metadata?.seriesNumber);
          const rightNumber = numericSeriesNumber(right.metadata?.seriesNumber);
          if (leftNumber !== rightNumber) {
            if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
              return leftNumber - rightNumber;
            }
            return Number.isFinite(leftNumber) ? -1 : 1;
          }
          return (left.metadata?.seriesDescription ?? '').localeCompare(
            right.metadata?.seriesDescription ?? ''
          );
        })
        .map(([uid, entry]) => ({
          uid,
          label: makeSeriesLabel(entry.metadata!),
          files: entry.files.map(String),
        })),
    [seriesMap]
  );

  const [selectedSeriesUID, setSelectedSeriesUID] = useState(activeSeriesUID);
  const [instanceIndex, setInstanceIndex] = useState(0);
  const [tree, setTree] = useState<DicomTagTree | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  const wasOpenRef = useRef(false);
  const requestVersionRef = useRef(0);
  const loadQueueRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    const justOpened = open && !wasOpenRef.current;
    wasOpenRef.current = open;
    if (!justOpened) return;

    const initialSeries = series.some((item) => item.uid === activeSeriesUID)
      ? activeSeriesUID
      : series[0]?.uid ?? '';
    setSelectedSeriesUID(initialSeries);
    // OHIF opens the browser at position 1 of the selected display set. This
    // is an independent metadata browser and must not navigate/follow the
    // currently displayed viewport frame.
    setInstanceIndex(0);
    setTree(null);
    setError(null);
  }, [activeSeriesUID, open, series]);

  const selectedSeries =
    series.find((item) => item.uid === selectedSeriesUID) ?? series[0] ?? null;
  const instanceCount = selectedSeries?.files.length ?? 0;
  const safeInstanceIndex =
    instanceCount > 0
      ? Math.min(instanceCount - 1, Math.max(0, instanceIndex))
      : 0;
  const imageId = selectedSeries?.files[safeInstanceIndex] ?? '';

  useEffect(() => {
    const requestVersion = ++requestVersionRef.current;

    if (!open) {
      setLoading(false);
      setTree(null);
      setError(null);
      return;
    }

    if (!imageId) {
      setLoading(false);
      setTree(null);
      setError('Không có instance DICOM để hiển thị metadata.');
      return;
    }

    setLoading(true);
    setTree(null);
    setError(null);

    // Avoid firing a network/parse request for every intermediate slider tick.
    const timer = window.setTimeout(() => {
      // The DICOM loader cannot safely abort a shared cache request. Serialize
      // work instead, and drop stale queued entries before they acquire/parse
      // a DataSet. This keeps rapid slider/series changes latest-only without
      // interfering with the viewport's own image-loader references.
      loadQueueRef.current = loadQueueRef.current
        .catch(() => undefined)
        .then(async () => {
          if (requestVersionRef.current !== requestVersion) return;

          try {
            const nextTree = await withLoadTimeout(
              import('@/lib/dicom-tags/loadDicomTagTree').then(
                ({ loadDicomTagTree }) => {
                  if (requestVersionRef.current !== requestVersion) return null;
                  return loadDicomTagTree(imageId);
                }
              )
            );
            if (!nextTree || requestVersionRef.current !== requestVersion) return;

            setTree(nextTree);
            setLoading(false);
          } catch {
            if (requestVersionRef.current !== requestVersion) return;
            setError('Không thể đọc metadata DICOM của instance này.');
            setLoading(false);
          }
        });
    }, 120);

    return () => {
      window.clearTimeout(timer);
      if (requestVersionRef.current === requestVersion) {
        requestVersionRef.current += 1;
      }
    };
  }, [imageId, open, retryToken]);

  const selectSeries = (uid: string) => {
    setSelectedSeriesUID(uid);
    setInstanceIndex(0);
    setTree(null);
    setError(null);
  };

  const selectInstance = (index: number) => {
    const nextIndex =
      instanceCount > 0
        ? Math.min(instanceCount - 1, Math.max(0, Math.round(index)))
        : 0;
    setInstanceIndex(nextIndex);
  };

  return {
    series,
    selectedSeries,
    selectedSeriesUID: selectedSeries?.uid ?? '',
    selectSeries,
    instanceIndex: safeInstanceIndex,
    instanceCount,
    selectInstance,
    tree,
    loading,
    error,
    retry: () => setRetryToken((current) => current + 1),
  };
}
