import { PACS_API_BASE } from '@/config/dicom';
import type {
  DataSourceRequestOptions,
  DicomInstance,
  SeriesRequestOptions,
  StudyQuery,
} from '@/platform/core';

import type {
  FetchSeriesOptions,
  InstanceReference,
  Series,
  StaticDicomDataSource,
  Study,
} from './types';
import { STATIC_DICOM_DATA_SOURCE_ID } from './manifest';

let studiesCache: Study[] | null = null;
let studiesRequest: Promise<Study[]> | null = null;
const studyMetaCache = new Map<string, Study | null>();
const studyMetaRequests = new Map<string, Promise<Study | null>>();
const seriesCache = new Map<string, Series[]>();
const seriesRequests = new Map<string, Promise<Series[]>>();
const seriesSummaryCache = new Map<string, Series[]>();
const seriesSummaryRequests = new Map<string, Promise<Series[]>>();

function buildPacsApiUrl(pathname: string): string {
  if (/^https?:\/\//i.test(pathname)) return pathname;
  if (!PACS_API_BASE) return pathname;

  const base = PACS_API_BASE.replace(/\/+$/, '');
  const remotePath = pathname.replace(/^\/api(?=\/)/, '');
  const normalizedPath = remotePath.startsWith('/')
    ? remotePath
    : `/${remotePath}`;

  return `${base}${normalizedPath}`;
}

export function getViewerPath(studyInstanceUID: string): string {
  return `/viewer?StudyInstanceUIDs=${encodeURIComponent(studyInstanceUID)}`;
}

export function getCachedStudies(): Study[] | null {
  return studiesCache;
}

export function setCachedStudies(studies: Study[]): void {
  studiesCache = studies;
}

export async function fetchStudiesWithMeta(): Promise<Study[]> {
  if (studiesCache) return studiesCache;

  if (!studiesRequest) {
    studiesRequest = fetch(buildPacsApiUrl('/api/studies'))
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Failed to load /api/studies: ${response.status}`);
        }

        const studies = (await response.json()) as Study[];
        studiesCache = studies;
        return studies;
      })
      .finally(() => {
        studiesRequest = null;
      });
  }

  return studiesRequest;
}

export async function fetchStudyMeta(
  studyInstanceUID: string
): Promise<Study | null> {
  if (studyMetaCache.has(studyInstanceUID)) {
    return studyMetaCache.get(studyInstanceUID) ?? null;
  }

  if (!studyMetaRequests.has(studyInstanceUID)) {
    const request = fetch(
      buildPacsApiUrl(
        `/api/studies/${encodeURIComponent(studyInstanceUID)}`
      )
    )
      .then(async (response) => {
        if (response.status === 404) {
          studyMetaCache.set(studyInstanceUID, null);
          return null;
        }
        if (!response.ok) {
          throw new Error(`Failed to load study metadata: ${response.status}`);
        }

        const study = (await response.json()) as Study;
        studyMetaCache.set(studyInstanceUID, study);
        return study;
      })
      .finally(() => {
        studyMetaRequests.delete(studyInstanceUID);
      });

    studyMetaRequests.set(studyInstanceUID, request);
  }

  return studyMetaRequests.get(studyInstanceUID)!;
}

export async function fetchSeries(
  studyInstanceUID: string,
  options: FetchSeriesOptions = {}
): Promise<Series[]> {
  const includeInstances = options.includeInstances !== false;
  const cache = includeInstances ? seriesCache : seriesSummaryCache;
  const requests = includeInstances ? seriesRequests : seriesSummaryRequests;
  const cached = cache.get(studyInstanceUID);
  if (cached) return cached;

  if (!requests.has(studyInstanceUID)) {
    const query = includeInstances ? '' : '?includeInstances=false';
    const request = fetch(
      buildPacsApiUrl(
        `/api/studies/${encodeURIComponent(studyInstanceUID)}/series${query}`
      )
    )
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Failed to load study series: ${response.status}`);
        }

        const series = (await response.json()) as Series[];
        cache.set(studyInstanceUID, series);
        return series;
      })
      .finally(() => {
        requests.delete(studyInstanceUID);
      });

    requests.set(studyInstanceUID, request);
  }

  return requests.get(studyInstanceUID)!;
}

export async function fetchInstances(
  studyInstanceUID: string,
  seriesInstanceUID: string
): Promise<InstanceReference[]> {
  const series = await fetchSeries(studyInstanceUID);
  const selectedSeries = series.find(
    (item) => item.seriesInstanceUID === seriesInstanceUID
  );
  if (!selectedSeries) return [];

  return (selectedSeries.instances || []).map((instance, index) => ({
    uid:
      typeof instance === 'string'
        ? instance
        : instance.url ??
          instance.filename ??
          `/dicoms/unknown-${index}`,
    number: index + 1,
  }));
}

export function prefetchStudyViewerData(studyInstanceUID: string): void {
  void fetchStudyMeta(studyInstanceUID).catch(() => null);
  void fetchSeries(studyInstanceUID, { includeInstances: false }).catch(
    () => []
  );
}

async function queryStudies(query: StudyQuery = {}): Promise<Study[]> {
  query.signal?.throwIfAborted?.();
  const studies = await fetchStudiesWithMeta();
  query.signal?.throwIfAborted?.();
  return studies;
}

async function getStudy(
  studyInstanceUID: string,
  options: DataSourceRequestOptions = {}
): Promise<Study | null> {
  options.signal?.throwIfAborted?.();
  const study = await fetchStudyMeta(studyInstanceUID);
  options.signal?.throwIfAborted?.();
  return study;
}

async function getSeries(
  studyInstanceUID: string,
  options: SeriesRequestOptions = {}
): Promise<Series[]> {
  options.signal?.throwIfAborted?.();
  const series = await fetchSeries(studyInstanceUID, options);
  options.signal?.throwIfAborted?.();
  return series;
}

async function getDicomInstances(
  studyInstanceUID: string,
  seriesInstanceUID: string,
  options: DataSourceRequestOptions = {}
): Promise<DicomInstance[]> {
  options.signal?.throwIfAborted?.();
  const series = await fetchSeries(studyInstanceUID);
  const instances =
    series.find((item) => item.seriesInstanceUID === seriesInstanceUID)
      ?.instances ?? [];
  options.signal?.throwIfAborted?.();
  return instances;
}

export const staticDicomDataSource: StaticDicomDataSource = Object.freeze({
  id: STATIC_DICOM_DATA_SOURCE_ID,
  getViewerPath,
  getCachedStudies,
  setCachedStudies,
  listStudies: fetchStudiesWithMeta,
  queryStudies,
  getStudy,
  getSeries,
  getInstances: getDicomInstances,
  prefetchStudy: prefetchStudyViewerData,
});

/**
 * The adapter remains shared because the current client intentionally shares
 * request de-duplication and metadata caches across consumers.
 */
export function createStaticDicomDataSource(): StaticDicomDataSource {
  return staticDicomDataSource;
}
